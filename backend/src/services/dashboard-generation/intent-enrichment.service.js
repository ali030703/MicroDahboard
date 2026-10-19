const { buildSqlFilterClause } = require('./sql-builder.util');
const { normalizePromptText } = require('./prompt-text.util');
const { normalizeColumnKey, looksTemporal } = require('../dashboard-schema-profile.service');
const {
  normalizeAggregation,
  normalizeOptionalString,
  normalizeOptionalSortBy,
  normalizeOptionalSortDirection,
  normalizeOptionalBoolean,
  parseOptionalTopLimit,
  clone,
  isObject,
  SUPPORTED_CHART_TEMPLATES,
} = require('./format.util');
const { resolveColumnByName, getDynamicMeasureColumns, getAllMeasureColumns, getCategoryIdForColumn, getReadableColumnLabel, getReadableMeasureLabel, scoreMeasureColumn } = require('./column-resolution.service');
const { resolveMicroorganismDimensionBinding } = require('./microorganism-binding.service');
const { getPromptMentionedMeasureColumns, getMentionedCatalogMetricColumns, getMentionedCatalogDimensionColumn, promptMentionsCatalogEntryAsCategory } = require('./semantic-catalog-matcher.service');
const { extractNumericFilters } = require('./numeric-filter-parser.service');
const { detectTemplateFamily, normalizeTemplateFamily, promptRequestsAllProperties } = require('./prompt-intent-parser.service');
const { SCHEMA, isMicroorganismDimensionColumn, resolveSemanticQuery, resolveMetric } = require('../../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function augmentIntentWithDynamicColumns(intent, primaryTable) {
  if (!intent || !primaryTable) {
    return intent;
  }

  const normalizedPrompt = normalizePromptText(intent.normalizedPrompt || intent.rawPrompt || '');
  const mentionedMeasureColumns = getPromptMentionedMeasureColumns(primaryTable, intent);
  const dynamicNumericFilters = extractNumericFilters(
    intent.normalizedPrompt || intent.rawPrompt || '',
    getDynamicMeasureColumns(primaryTable).map((column) => ({
      table: primaryTable.name,
      column: column.name,
      type: column.type,
    })),
  );

  if (!mentionedMeasureColumns.length && !dynamicNumericFilters.length) {
    return intent;
  }

  const existingMentionedColumns = Array.isArray(intent.mentionedColumns) ? intent.mentionedColumns : [];
  const existingFilters = Array.isArray(intent.filters) ? intent.filters : [];
  const filterColumns = new Set(dynamicNumericFilters.map((filter) => normalizeColumnKey(filter.column)));
  const displayMeasureColumns = mentionedMeasureColumns.filter((column) => {
    const isFilterColumn = filterColumns.has(normalizeColumnKey(column.name));
    return !isFilterColumn || columnMentionedBeforeFilterClause(normalizedPrompt, column);
  });
  const nextIntent = {
    ...intent,
    filters: [...existingFilters, ...dynamicNumericFilters]
      .filter((filter, index, list) => {
        const key = `${normalizeColumnKey(filter.column)}:${filter.operator}:${JSON.stringify(filter.value)}`;
        return key && list.findIndex((entry) => `${normalizeColumnKey(entry.column)}:${entry.operator}:${JSON.stringify(entry.value)}` === key) === index;
      }),
    mentionedColumns: [
      ...existingMentionedColumns,
      ...mentionedMeasureColumns.map((column) => ({
        column: column.name,
        dynamic: true,
      })),
    ].filter((entry, index, list) => list.findIndex((item) => normalizeColumnKey(item.column) === normalizeColumnKey(entry.column)) === index),
  };

  const selectedMetricIsFallback = !nextIntent.selectedMetric
    || nextIntent.selectedMetric.key === 'count'
    || nextIntent.selectedMetric.kind !== 'quantitative'
    || nextIntent.semanticIntent?.metric === 'count';

  if (displayMeasureColumns.length >= 2) {
    const existingMeasures = Array.isArray(nextIntent.comparisonQuery?.measures)
      ? nextIntent.comparisonQuery.measures
      : [];
    const dynamicMeasures = displayMeasureColumns.map((column) => ({
      column: column.name,
      measure: column.name,
      dynamic: true,
    }));

    nextIntent.comparisonQuery = {
      type: 'comparison',
      measures: [...existingMeasures, ...dynamicMeasures]
        .filter((measure, index, list) => {
          const key = normalizeColumnKey(measure.column || measure.measure || measure.semanticMetric);
          return key && list.findIndex((entry) => normalizeColumnKey(entry.column || entry.measure || entry.semanticMetric) === key) === index;
        }),
    };
  }

  if (selectedMetricIsFallback && displayMeasureColumns.length > 0) {
    const primaryDynamicColumn = displayMeasureColumns[0];
    const dynamicMetric = buildDynamicMetricDefinition(primaryDynamicColumn);

    nextIntent.dynamicMeasureColumn = primaryDynamicColumn.name;
    nextIntent.selectedMetric = dynamicMetric;
    nextIntent.semanticIntent = {
      ...(nextIntent.semanticIntent || {}),
      metric: dynamicMetric.key,
    };
    nextIntent.aggregation = normalizeAggregation(nextIntent.instruction?.metric)
      || (normalizeAggregation(nextIntent.aggregation) === 'count' ? 'avg' : normalizeAggregation(nextIntent.aggregation))
      || 'avg';
  }

  return nextIntent;
}

function buildDynamicMetricDefinition(column) {
  return {
    key: normalizeColumnKey(column?.name),
    label: getReadableMeasureLabel(column?.name),
    kind: 'quantitative',
    defaultAggregation: 'avg',
    dynamic: true,
    column: column?.name,
  };
}

function augmentIntentWithSemanticCatalog(intent, primaryTable, semanticCatalog) {
  if (!intent || !primaryTable || !semanticCatalog) {
    return intent;
  }

  const mentionedMetricColumns = getMentionedCatalogMetricColumns(primaryTable, intent, semanticCatalog);
  const mentionedDimensionColumn = getMentionedCatalogDimensionColumn(primaryTable, intent, semanticCatalog);

  if (!mentionedMetricColumns.length && !mentionedDimensionColumn) {
    return intent;
  }

  const nextIntent = {
    ...intent,
    mentionedColumns: [
      ...(Array.isArray(intent.mentionedColumns) ? intent.mentionedColumns : []),
      ...mentionedMetricColumns.map((column) => ({ column: column.name, dynamic: true })),
      ...(mentionedDimensionColumn ? [{ column: mentionedDimensionColumn.name, dynamic: true, role: 'dimension' }] : []),
    ].filter((entry, index, list) => list.findIndex((item) => normalizeColumnKey(item.column) === normalizeColumnKey(entry.column)) === index),
  };

  if (mentionedDimensionColumn) {
    nextIntent.dynamicDimensionColumn = mentionedDimensionColumn.name;
    nextIntent.selectedDimension = {
      key: normalizeColumnKey(mentionedDimensionColumn.name),
      label: getReadableColumnLabel(mentionedDimensionColumn.name),
      entity: 'organism',
      grain: 'category',
      dynamic: true,
    };
    nextIntent.semanticIntent = {
      ...(nextIntent.semanticIntent || {}),
      dimension: normalizeColumnKey(mentionedDimensionColumn.name),
    };
  }

  const selectedMetricIsFallback = !nextIntent.selectedMetric
    || nextIntent.selectedMetric.key === 'count'
    || nextIntent.selectedMetric.kind !== 'quantitative'
    || nextIntent.semanticIntent?.metric === 'count';

  if (mentionedMetricColumns.length >= 2) {
    nextIntent.comparisonQuery = {
      type: 'comparison',
      measures: mentionedMetricColumns.map((column) => ({
        column: column.name,
        measure: column.name,
        dynamic: true,
      })),
    };
  }

  if (selectedMetricIsFallback && mentionedMetricColumns.length > 0) {
    const primaryDynamicColumn = mentionedMetricColumns[0];
    const dynamicMetric = buildDynamicMetricDefinition(primaryDynamicColumn);

    nextIntent.dynamicMeasureColumn = primaryDynamicColumn.name;
    nextIntent.selectedMetric = dynamicMetric;
    nextIntent.semanticIntent = {
      ...(nextIntent.semanticIntent || {}),
      metric: dynamicMetric.key,
    };
    nextIntent.aggregation = normalizeAggregation(nextIntent.instruction?.metric)
      || (normalizeAggregation(nextIntent.aggregation) === 'count' ? 'avg' : normalizeAggregation(nextIntent.aggregation))
      || 'avg';
  }

  return nextIntent;
}

function findTemporalColumn(primaryTable, semanticCatalog) {
  const catalogDimensions = Array.isArray(semanticCatalog?.dimensions) ? semanticCatalog.dimensions : [];
  const hintedTemporal = catalogDimensions
    .filter((entry) => normalizeColumnKey(entry.table) === normalizeColumnKey(primaryTable?.name))
    .find((entry) => {
      const values = [entry.key, entry.column, entry.label, ...(Array.isArray(entry.aliases) ? entry.aliases : [])]
        .map((value) => normalizeColumnKey(value));
      return values.some((value) => /date|time|month|year|day/.test(value));
    });
  const hintedColumn = resolveColumnByName(primaryTable, hintedTemporal?.column);

  if (hintedColumn && looksTemporal(hintedColumn.type, hintedColumn.name)) {
    return hintedColumn;
  }

  return (primaryTable?.columns || []).find((column) => looksTemporal(column.type, column.name)) || null;
}

function applyTemporalResolutionToIntent(intent, primaryTable, semanticCatalog) {
  if (!intent || !primaryTable) {
    return intent;
  }

  const normalizedPrompt = normalizePromptText(intent.normalizedPrompt || intent.rawPrompt || '');
  const temporalColumn = findTemporalColumn(primaryTable, semanticCatalog);

  if (!temporalColumn) {
    return intent;
  }

  const nextIntent = {
    ...intent,
    filters: Array.isArray(intent.filters) ? [...intent.filters] : [],
  };
  const yearMatch = normalizedPrompt.match(/\b(18\d{2}|19\d{2}|20\d{2})\b/);

  if (yearMatch && !nextIntent.filters.some((filter) => normalizeColumnKey(filter.column) === normalizeColumnKey(temporalColumn.name))) {
    const year = Number(yearMatch[1]);
    const textTemporal = /CHAR|CLOB|TEXT|DATE|TIME/i.test(temporalColumn.type || '') && !looksNumeric(temporalColumn.type);

    nextIntent.filters.push({
      column: temporalColumn.name,
      operator: textTemporal ? 'contains' : '=',
      value: textTemporal ? String(year) : year,
      semanticRole: 'time',
      label: String(year),
    });
  }

  if (/\b(?:trend|trends|over time|time series|yearly|annual|by month|month|months)\b/i.test(normalizedPrompt)) {
    nextIntent.dynamicDimensionColumn = temporalColumn.name;
    nextIntent.selectedDimension = {
      key: normalizeColumnKey(temporalColumn.name),
      label: getReadableColumnLabel(temporalColumn.name),
      entity: 'organism',
      grain: 'temporal',
      dynamic: true,
    };
    nextIntent.semanticIntent = {
      ...(nextIntent.semanticIntent || {}),
      dimension: normalizeColumnKey(temporalColumn.name),
    };
  }

  return nextIntent;
}

function applyMicroorganismResolutionToIntent({ intent, resolution, microorganismCatalog }) {
  if (!intent || !microorganismCatalog) {
    return intent;
  }

  const matches = Array.isArray(resolution?.matches) ? resolution.matches : [];
  const mentionsMicroorganismGrouping = /\b(?:by|per|across|top|group(?:ed)? by|compare)\s+(?:microorganisms?|microbes?|organisms?|species|pathogens?)\b/i.test(normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || ''))
    || /\b(?:microorganisms?|microbes?|organisms?|species|pathogens?)\b.*\b(?:by|per|top|ranking|rank|distribution|breakdown)\b/i.test(normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || ''));

  if (!matches.length && !mentionsMicroorganismGrouping) {
    return intent;
  }

  const existingFilters = Array.isArray(intent.filters) ? intent.filters : [];
  const microorganismFilters = matches
    .map((match) => createMicroorganismFilter(match, microorganismCatalog))
    .filter(Boolean);
  const filterColumn = microorganismCatalog.filterColumn;
  const groupedValues = microorganismFilters.map((filter) => filter.value);
  const nextFilters = existingFilters.filter((filter) => filter.semanticRole !== 'microorganism');

  if (microorganismFilters.length === 1) {
    nextFilters.push(microorganismFilters[0]);
  } else if (microorganismFilters.length > 1 && filterColumn) {
    nextFilters.push({
      column: filterColumn,
      operator: 'in',
      value: groupedValues,
      semanticRole: 'microorganism',
      label: matches.map((match) => match.name).join(', '),
    });
  }

  const nextIntent = {
    ...intent,
    filters: nextFilters,
    microorganismResolution: {
      status: resolution.status,
      matches,
      ambiguous: resolution.ambiguous || [],
      source: microorganismCatalog.source,
      table: microorganismCatalog.table,
      nameColumn: microorganismCatalog.nameColumn,
      filterColumn: microorganismCatalog.filterColumn,
    },
    microorganismFocus: matches.length ? matches : intent.microorganismFocus,
    mentionedColumns: [
      ...(Array.isArray(intent.mentionedColumns) ? intent.mentionedColumns : []),
      ...(microorganismCatalog.dimensionColumn ? [{
        column: microorganismCatalog.dimensionColumn,
        dynamic: true,
        role: 'microorganism',
      }] : []),
    ].filter((entry, index, list) => list.findIndex((item) => normalizeColumnKey(item.column) === normalizeColumnKey(entry.column)) === index),
  };

  if (microorganismCatalog.dimensionColumn && (mentionsMicroorganismGrouping || shouldGroupByResolvedMicroorganisms(intent, matches.length))) {
    nextIntent.dynamicDimensionColumn = microorganismCatalog.dimensionColumn;
    nextIntent.selectedDimension = {
      key: 'microorganism',
      label: 'Microorganism',
      entity: 'organism',
      grain: 'category',
      dynamic: true,
    };
    nextIntent.semanticIntent = {
      ...(nextIntent.semanticIntent || {}),
      dimension: 'microorganism',
    };
  }

  return nextIntent;
}

function createMicroorganismFilter(match, microorganismCatalog) {
  const column = microorganismCatalog?.filterColumn;

  if (!column) {
    return null;
  }

  const value = microorganismCatalog.filterValueField === 'id' && match.id !== null && match.id !== undefined
    ? match.id
    : match.name;

  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }

  return {
    column,
    operator: '=',
    value,
    semanticRole: 'microorganism',
    label: match.name,
  };
}

function shouldGroupByResolvedMicroorganisms(intent, matchCount) {
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');

  return matchCount >= 2
    || /\bcompare\b/i.test(text)
    || /\bby\s+(?:microorganisms?|microbes?|organisms?|species|pathogens?)\b/i.test(text);
}

async function applyPromptBiologicalConceptFilter({ db, prompt, intent, primaryTable }) {
  if (!db || !primaryTable || !intent) {
    return intent;
  }

  const normalizedPrompt = normalizePromptText(prompt);

  if (/(?:\bfungi\b|\bfungal\b|\byeast\b|\bmicrobes?\b|\bmicroorganisms?\b|\borganisms?\b)/i.test(normalizedPrompt)) {
    return intent;
  }

  return intent;
}

function isCircularMicroorganismGroupingRequest(intent) {
  const matches = Array.isArray(intent?.microorganismResolution?.matches)
    ? intent.microorganismResolution.matches
    : [];
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const selectedMetricKey = intent?.selectedMetric?.key || intent?.semanticIntent?.metric;
  const selectedMetric = resolveMetric(selectedMetricKey, MICROORGANISM_SCHEMA);
  const hasQuantitativeMetric = selectedMetric?.kind === 'quantitative' && selectedMetric.key !== 'count';
  const groupsByMicroorganism = intent?.selectedDimension?.key === 'microorganism'
    || /\bby\s+(?:microorganisms?|microbes?|organisms?|species|pathogens?)\b/i.test(text);
  const explicitlyCompares = /\bcompare\b/i.test(text) || matches.length >= 2;

  return matches.length === 1
    && groupsByMicroorganism
    && !hasQuantitativeMetric
    && !explicitlyCompares;
}

function getSingleMicroorganismUnderspecifiedViewType(intent) {
  const matches = Array.isArray(intent?.microorganismResolution?.matches)
    ? intent.microorganismResolution.matches
    : [];
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const explicitlyRequestsVisualChart = Boolean(intent?.chartTemplate)
    || /\b(?:chart|graph|plot|bar|line|doughnut|donut|pie|polar|radar|trend|time\s+series)\b/i.test(text);
  const explicitlyRequestsTable = /\b(?:table|records?|rows?|list|preview)\b/i.test(text);

  const hasMultiMetricComparison = Boolean(intent?.comparisonQuery)
    && Array.isArray(intent.comparisonQuery.measures)
    && intent.comparisonQuery.measures.length >= 2;

  const explicitlyCompares = /\b(?:compare|versus|vs)\b/i.test(text)
    || matches.length >= 2
    || hasMultiMetricComparison;

  const hasUsefulGrouping = /\b(?:by|per|across|group(?:ed)? by)\s+(?!microorganisms?\b|microbes?\b|organisms?\b|species\b|pathogens?\b)[a-z0-9_ -]+\b/i.test(text);
  const hasTemporalAxis = /\b(?:over\s+time|time\s+series|by\s+(?:year|month|date|day)|per\s+(?:year|month|date|day)|trend)\b/i.test(text);

  if (matches.length !== 1 || explicitlyCompares || hasUsefulGrouping || hasTemporalAxis) {
    return null;
  }

  if (explicitlyRequestsVisualChart && !explicitlyRequestsTable) {
    return 'chart';
  }

  if (explicitlyRequestsTable && !hasExplicitTableDetailRequest(intent)) {
    return 'table';
  }

  return null;
}

function hasExplicitTableDetailRequest(intent) {
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const requestedAllProperties = promptRequestsAllProperties(text);
  const selectedMetricKey = intent?.selectedMetric?.key || intent?.semanticIntent?.metric;
  const selectedMetric = resolveMetric(selectedMetricKey, MICROORGANISM_SCHEMA);
  const hasQuantitativeMetric = selectedMetric?.kind === 'quantitative' && selectedMetric.key !== 'count';
  const nonMicroorganismColumns = (Array.isArray(intent?.mentionedColumns) ? intent.mentionedColumns : [])
    .filter((entry) => entry?.role !== 'microorganism')
    .filter((entry) => normalizeColumnKey(entry?.column) !== 'microorganism');
  const explicitWithFields = /\bwith\b.+\b(?:and|,)\b/i.test(text) && nonMicroorganismColumns.length > 0;

  return requestedAllProperties
    || hasQuantitativeMetric
    || nonMicroorganismColumns.length >= 2
    || explicitWithFields
    || Boolean(intent?.comparisonQuery);
}

function isExplicitTableOnlyRequest(intent) {
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const asksForTable = /\b(?:table|rows?|records?|list|preview|details?)\b/i.test(text);
  const asksForVisualOutput = /\b(?:chart|charts|graph|graphs|plot|plots|visual|visuali[sz]e|dashboard|bar|line|doughnut|donut|pie|polar|radar|trend|time\s+series|distribution)\b/i.test(text);

  return asksForTable && !asksForVisualOutput;
}

function shouldUseRecordPreviewForTable(intent) {
  return isExplicitTableOnlyRequest(intent) && hasExplicitTableDetailRequest(intent);
}

function mergeIntentWithSession(currentIntent, previousPromptIntent) {
  if (!previousPromptIntent || typeof previousPromptIntent !== 'object') {
    return currentIntent;
  }

  return {
    ...currentIntent,
    requestedFamily: normalizeTemplateFamily(currentIntent.requestedFamily),
    chartTemplate: SUPPORTED_CHART_TEMPLATES.includes(currentIntent.chartTemplate)
      ? currentIntent.chartTemplate
      : null,
    visualRequests: Array.isArray(currentIntent.visualRequests) ? currentIntent.visualRequests : [],
    includeTable: normalizeOptionalBoolean(currentIntent.includeTable),
    includeStats: normalizeOptionalBoolean(currentIntent.includeStats),
    prefersTrend: Boolean(currentIntent.prefersTrend),
    aggregation: normalizeAggregation(currentIntent.aggregation),
    filters: Array.isArray(currentIntent.filters) ? currentIntent.filters : [],
    sortBy: normalizeOptionalSortBy(currentIntent.sortBy),
    sortDirection: normalizeOptionalSortDirection(currentIntent.sortDirection),
    mentionedTables: Array.isArray(currentIntent.mentionedTables) ? currentIntent.mentionedTables : [],
    mentionedColumns: Array.isArray(currentIntent.mentionedColumns) ? currentIntent.mentionedColumns : [],
    selectedEntity: currentIntent.selectedEntity ?? null,
    selectedMetric: currentIntent.selectedMetric ?? null,
    selectedDimension: currentIntent.selectedDimension ?? null,
    semanticIntent: isObject(currentIntent.semanticIntent) ? { ...currentIntent.semanticIntent } : null,
  };
}

module.exports = {
  augmentIntentWithDynamicColumns,
  buildDynamicMetricDefinition,
  augmentIntentWithSemanticCatalog,
  findTemporalColumn,
  applyTemporalResolutionToIntent,
  applyMicroorganismResolutionToIntent,
  createMicroorganismFilter,
  shouldGroupByResolvedMicroorganisms,
  applyPromptBiologicalConceptFilter,
  isCircularMicroorganismGroupingRequest,
  getSingleMicroorganismUnderspecifiedViewType,
  hasExplicitTableDetailRequest,
  isExplicitTableOnlyRequest,
  shouldUseRecordPreviewForTable,
  mergeIntentWithSession,
};
