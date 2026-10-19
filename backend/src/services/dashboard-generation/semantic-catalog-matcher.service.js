const { normalizePromptText, tokenizePromptText, hasAllPromptTokens, matchesPromptConcept, escapeRegExp, PROMPT_STOP_WORDS } = require('./prompt-text.util');
const { normalizeColumnKey } = require('../dashboard-schema-profile.service');
const { resolveColumnByName, isUsableMeasureColumn, isWeakMeasureCandidate, getDynamicMeasureColumns, getAllMeasureColumns, getReadableColumnLabel, scoreMeasureColumn } = require('./column-resolution.service');
const { SCHEMA, resolveSemanticQuery, resolveMetric, getCategoryIdForColumn: getSchemaCategoryIdForColumn } = require('../../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function getCatalogEntriesForTable(semanticCatalog, entryType, table) {
  const entries = Array.isArray(semanticCatalog?.[entryType]) ? semanticCatalog[entryType] : [];
  const tableKey = normalizeColumnKey(table?.name);

  return entries.filter((entry) => normalizeColumnKey(entry.table) === tableKey);
}

function catalogEntryAliases(entry) {
  return [
    entry?.column,
    entry?.label,
    entry?.key,
    ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
  ]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);
}

function isWeakPromptAlias(alias) {
  const normalized = normalizePromptText(alias);
  return !normalized || normalized.length === 1 || PROMPT_STOP_WORDS.has(normalized);
}

function promptMentionsAlias(normalizedPrompt, alias) {
  if (!normalizedPrompt || !alias) {
    return false;
  }

  const escaped = escapeRegExp(alias);

  if (isWeakPromptAlias(alias)) {
    const cuedPattern = new RegExp(`\\b(?:column|field|metric|measure|category)\\s+${escaped}\\b`, 'i');
    return cuedPattern.test(normalizedPrompt);
  }

  const pattern = new RegExp(`\\b${escaped}\\b`, 'i');
  return pattern.test(normalizedPrompt);
}

function promptMentionsCatalogEntry(normalizedPrompt, entry) {
  if (!normalizedPrompt || !entry?.column) {
    return false;
  }

  return catalogEntryAliases(entry).some((alias) => promptMentionsAlias(normalizedPrompt, alias));
}

function promptMentionsCatalogEntryAsCategory(normalizedPrompt, entry) {
  if (!promptMentionsCatalogEntry(normalizedPrompt, entry)) {
    return false;
  }

  return catalogEntryAliases(entry).some((alias) => {
    const escaped = escapeRegExp(alias);
    if (isWeakPromptAlias(alias)) {
      const cuedPattern = new RegExp(`\\b(?:column|field|metric|measure|category)\\s+${escaped}\\b`, 'i');
      if (!cuedPattern.test(normalizedPrompt)) {
        return false;
      }
    }
    const afterCue = new RegExp(`\\b(?:by|per|for each|group by|grouped by|split by|across)\\s+${escaped}\\b`, 'i');
    const beforeCue = new RegExp(`\\b${escaped}\\s+(?:by|per|groups?|categories?)\\b`, 'i');
    return afterCue.test(normalizedPrompt) || beforeCue.test(normalizedPrompt);
  });
}

function getMentionedCatalogMetricColumns(primaryTable, intent, semanticCatalog) {
  const normalizedPrompt = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const filterColumns = new Set((Array.isArray(intent?.filters) ? intent.filters : [])
    .map((filter) => normalizeColumnKey(filter.column))
    .filter(Boolean));

  return getCatalogEntriesForTable(semanticCatalog, 'metrics', primaryTable)
    .filter((entry) => promptMentionsCatalogEntry(normalizedPrompt, entry))
    .map((entry) => resolveCatalogColumn(primaryTable, entry))
    .filter(Boolean)
    .filter(isUsableMeasureColumn)
    .filter((column) => {
      if (!filterColumns.has(normalizeColumnKey(column.name))) {
        return true;
      }

      return columnMentionedBeforeFilterClause(normalizedPrompt, column);
    })
    .filter((column, index, list) => list.findIndex((entry) => normalizeColumnKey(entry.name) === normalizeColumnKey(column.name)) === index);
}

function getMentionedCatalogDimensionColumn(primaryTable, intent, semanticCatalog) {
  const normalizedPrompt = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  const dimensions = getCatalogEntriesForTable(semanticCatalog, 'dimensions', primaryTable);
  const categoryMention = dimensions.find((entry) => promptMentionsCatalogEntryAsCategory(normalizedPrompt, entry));
  const plainMention = dimensions.find((entry) => promptMentionsCatalogEntry(normalizedPrompt, entry));

  return resolveCatalogColumn(primaryTable, categoryMention || plainMention || null);
}

function resolveCatalogColumn(primaryTable, entry) {
  return resolveColumnByName(primaryTable, entry?.column);
}

function promptMentionsColumn(normalizedPrompt, column) {
  if (!normalizedPrompt || !column?.name) {
    return false;
  }

  const candidates = [
    column.name,
    getReadableColumnLabel(column.name),
  ]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index)
    .sort((left, right) => right.length - left.length);

  return candidates.some((candidate) => {
    return promptMentionsAlias(normalizedPrompt, candidate);
  });
}

function getPromptMentionedMeasureColumns(primaryTable, intent) {
  const normalizedPrompt = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');
  return getDynamicMeasureColumns(primaryTable).filter((column) => promptMentionsColumn(normalizedPrompt, column));
}

function columnMentionedBeforeFilterClause(normalizedPrompt, column) {
  const filterStart = getFilterClauseStart(normalizedPrompt);

  if (filterStart < 0 || !column?.name) {
    return false;
  }

  const candidates = [
    column.name,
    getReadableColumnLabel(column.name),
  ]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  return candidates.some((candidate) => {
    const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i');
    const match = normalizedPrompt.match(pattern);
    return match?.index !== undefined && match.index < filterStart;
  });
}

function getFilterClauseStart(normalizedPrompt) {
  const match = normalizePromptText(normalizedPrompt).match(/\b(?:where|when|with|whose|having|if|that\s+have|that\s+has)\b/i);
  return match?.index ?? -1;
}

function metricMentionedBeforeFilterClause(normalizedPrompt, metricKey) {
  const filterStart = getFilterClauseStart(normalizedPrompt);

  if (filterStart < 0 || !metricKey) {
    return false;
  }

  const metric = resolveMetric(metricKey, MICROORGANISM_SCHEMA);
  const candidates = [
    metricKey,
    metric?.label,
    ...(Array.isArray(metric?.aliases) ? metric.aliases : []),
  ]
    .map((value) => normalizePromptText(value))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  return candidates.some((candidate) => {
    const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i');
    const match = normalizePromptText(normalizedPrompt).match(pattern);
    return match?.index !== undefined && match.index < filterStart;
  });
}

module.exports = {
  getCatalogEntriesForTable,
  catalogEntryAliases,
  isWeakPromptAlias,
  promptMentionsAlias,
  promptMentionsCatalogEntry,
  promptMentionsCatalogEntryAsCategory,
  getMentionedCatalogMetricColumns,
  getMentionedCatalogDimensionColumn,
  resolveCatalogColumn,
  promptMentionsColumn,
  getPromptMentionedMeasureColumns,
  columnMentionedBeforeFilterClause,
  getFilterClauseStart,
  metricMentionedBeforeFilterClause,
};
