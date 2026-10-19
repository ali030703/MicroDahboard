const { normalizeColumnKey, looksIdentifier, looksNumeric } = require('../dashboard-schema-profile.service');
const { SCHEMA, resolveSemanticQuery, resolveMetric, getCategoryIdForColumn: getSchemaCategoryIdForColumn, getPreferredMeasureIndex, getReadableColumnLabel: getSchemaReadableColumnLabel, getReadableTableLabel: getSchemaReadableTableLabel } = require('../../config/schema');
const { formatFilterValueForSummary, normalizeName } = require('./format.util');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;
const ALL_CATEGORY_METRIC_KEYS = Object.entries(MICROORGANISM_SCHEMA.dimensionMeta || {})
  .filter(([key]) => normalizeColumnKey(key) !== 'microorganisms')
  .map(([key]) => key);

function resolveTableByName(schemaProfiles, value) {
  const normalized = normalizeColumnKey(value);

  if (!normalized) {
    return null;
  }

  return schemaProfiles.find((table) => {
    return normalizeColumnKey(table.name) === normalized
      || normalizeColumnKey(getReadableTableLabel(table.name)) === normalized;
  }) ?? null;
}

function resolveColumnByName(table, value) {
  const normalized = normalizeColumnKey(value);

  if (!normalized || !table) {
    return null;
  }

  return table.columns.find((column) => {
    return normalizeColumnKey(column.name) === normalized
      || normalizeColumnKey(getReadableColumnLabel(column.name)) === normalized;
  }) ?? null;
}

function isUsableMeasureColumn(column) {
  return Boolean(column?.name)
    && !looksIdentifier(column.name)
    && (looksNumeric(column.type) || typeof column.valueSample === 'number');
}

function getUsableMeasureColumns(table) {
  const columns = Array.isArray(table?.numericColumns) && table.numericColumns.length
    ? table.numericColumns
    : Array.isArray(table?.columns)
      ? table.columns
      : [];

  return columns
    .filter(isUsableMeasureColumn)
    .filter((column, index, list) => list.findIndex((entry) => normalizeColumnKey(entry.name) === normalizeColumnKey(column.name)) === index);
}

function getKnownMeasureColumns(table) {
  return ALL_CATEGORY_METRIC_KEYS
    .map((metricKey) => {
      const resolvedQuery = resolveSemanticQuery(
        {
          selectedEntity: 'organism',
          selectedMetric: metricKey,
          selectedDimension: 'species',
        },
        MICROORGANISM_SCHEMA,
      );

      return resolveColumnByName(table, resolvedQuery?.columns?.metric || resolvedQuery?.physical?.measureColumn);
    })
    .filter(Boolean)
    .filter(isUsableMeasureColumn);
}

function getDynamicMeasureColumns(table) {
  const knownColumnKeys = new Set(getKnownMeasureColumns(table).map((column) => normalizeColumnKey(column.name)));

  return getUsableMeasureColumns(table)
    .filter((column) => !knownColumnKeys.has(normalizeColumnKey(column.name)))
    .filter((column) => !isWeakMeasureCandidate(column.name));
}

function getAllMeasureColumns(table) {
  const knownColumns = getKnownMeasureColumns(table);
  const dynamicColumns = getDynamicMeasureColumns(table);

  return [...knownColumns, ...dynamicColumns]
    .filter((column, index, list) => list.findIndex((entry) => normalizeColumnKey(entry.name) === normalizeColumnKey(column.name)) === index);
}

function isWeakMeasureCandidate(columnName) {
  return /^([a-z]|boundingbox\d|convexhull\d|centroid\d|extrema)$/i.test(String(columnName || '').trim());
}

function getReadableColumnLabel(columnName) {
  return getSchemaReadableColumnLabel(columnName, MICROORGANISM_SCHEMA);
}

function getReadableTableLabel(tableName) {
  return getSchemaReadableTableLabel(tableName, MICROORGANISM_SCHEMA);
}

function getReadableMeasureLabel(columnName) {
  const normalized = normalizeColumnKey(columnName);

  if (!normalized) {
    return 'Metric';
  }

  const semanticMetric = resolveMetric(normalized, MICROORGANISM_SCHEMA);
  if (semanticMetric?.label) {
    return semanticMetric.label;
  }

  const aggregatedMatch = normalized.match(/^(avg|average|mean|min|max|sum)(.+)$/i);

  if (aggregatedMatch?.[2]) {
    const strippedLabel = getReadableColumnLabel(aggregatedMatch[2]);
    return strippedLabel || 'Metric';
  }

  const readable = getReadableColumnLabel(columnName);

  if (/^Feature\s+[A-Z0-9]+$/i.test(readable) || readable === 'Value' || readable === 'Category') {
    return 'Metric';
  }

  return readable;
}

function getCategoryIdForColumn(columnName) {
  return getSchemaCategoryIdForColumn(columnName, MICROORGANISM_SCHEMA);
}

function scoreMeasureColumn(column, intent) {
  const mentioned = normalizeMentionedColumnNames(intent.mentionedColumns);
  const normalized = normalizeColumnKey(column.name);
  let score = 0;

  if (mentioned.has(column.name.toLowerCase())) {
    score += 100;
  }

  const preferredIndex = getPreferredMeasureIndex(column.name, MICROORGANISM_SCHEMA);
  if (preferredIndex >= 0) {
    score += 50 - preferredIndex;
  }

  if (isWeakMeasureCandidate(column.name)) {
    score -= 25;
  }

  if (looksIdentifier(column.name)) {
    score -= 100;
  }

  return score;
}

function normalizeMentionedColumnNames(mentionedColumns) {
  return new Set(
    (Array.isArray(mentionedColumns) ? mentionedColumns : [])
      .map((item) => String(item?.column ?? item ?? '').trim().toLowerCase())
      .filter(Boolean),
  );
}

function formatFilterSummary(filter) {
  if (!filter || typeof filter !== 'object') {
    return '';
  }

  if (filter.semanticRole === 'microorganism' && filter.label) {
    const label = formatFilterValueForSummary(filter.label);
    return String(filter.operator || '=').toLowerCase() === 'in'
      ? `Microorganisms: ${label}`
      : `Microorganism: ${label}`;
  }

  const columnLabel = getReadableColumnLabel(filter.column);
  const operator = String(filter.operator || '=').toLowerCase();

  if (operator === 'contains') {
    return `${columnLabel} contains ${formatFilterValueForSummary(filter.value)}`;
  }

  if (operator === 'in' && Array.isArray(filter.value)) {
    return `${columnLabel} in (${filter.value.map((entry) => formatFilterValueForSummary(entry)).join(', ')})`;
  }

  if (operator === 'between' && Array.isArray(filter.value) && filter.value.length >= 2) {
    return `${columnLabel} between ${formatFilterValueForSummary(filter.value[0])} and ${formatFilterValueForSummary(filter.value[1])}`;
  }

  return `${columnLabel} ${filter.operator || '='} ${formatFilterValueForSummary(filter.value)}`;
}

function buildFilterSummary(filters) {
  if (!Array.isArray(filters) || !filters.length) {
    return '';
  }

  const summary = filters.slice(0, 3).map((filter) => formatFilterSummary(filter)).filter(Boolean).join('; ');
  const remaining = filters.length - 3;

  if (remaining > 0) {
    return `${summary}${summary ? '; ' : ''}+${remaining} more`;
  }

  return summary;
}

function buildTableFilterDescription(filters) {
  if (!Array.isArray(filters) || !filters.length) {
    return 'Selected dataset rows.';
  }

  const microorganismFilters = filters.filter((filter) => filter?.semanticRole === 'microorganism' && filter.label);

  if (microorganismFilters.length === 1 && filters.length === 1) {
    return `Showing records for ${formatFilterValueForSummary(microorganismFilters[0].label)}.`;
  }

  const summary = buildFilterSummary(filters);

  return summary ? `Filtered by ${summary}.` : 'Selected dataset rows.';
}

module.exports = {
  resolveTableByName,
  resolveColumnByName,
  isUsableMeasureColumn,
  getUsableMeasureColumns,
  getKnownMeasureColumns,
  getDynamicMeasureColumns,
  getAllMeasureColumns,
  isWeakMeasureCandidate,
  getReadableColumnLabel,
  getReadableTableLabel,
  getReadableMeasureLabel,
  getCategoryIdForColumn,
  scoreMeasureColumn,
  normalizeMentionedColumnNames,
  formatFilterSummary,
  buildFilterSummary,
  buildTableFilterDescription,
  ALL_CATEGORY_METRIC_KEYS,
};
