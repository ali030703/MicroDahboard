// Purpose: Builds a flexible semantic catalog from microbiology-style database schemas and optional hints.
const { SCHEMA, getReadableColumnLabel: getSchemaReadableColumnLabel } = require('../config/schema');
const {
  looksIdentifier,
  looksNumeric,
  looksTemporal,
  normalizeColumnKey,
} = require('./dashboard-schema-profile.service');

const DEFAULT_SCHEMA = SCHEMA.microorganism;
const DEFAULT_PROMPT_FIELDS = ['area', 'solidity', 'radius', 'perimeter', 'eccentricity', 'filled area', 'convex area', 'microorganism'];
const CATEGORY_NAME_KEYS = ['microorganism', 'organism', 'species', 'strain', 'taxon', 'taxonomy', 'category', 'class', 'type', 'group', 'label', 'name'];

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toArray(value) {
  if (!value) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}


function normalizeHints(databaseDefinition) {
  if (!isObject(databaseDefinition)) {
    return {};
  }

  const semanticHints = isObject(databaseDefinition.semanticHints) ? databaseDefinition.semanticHints : {};
  const semanticCatalog = isObject(databaseDefinition.semanticCatalog) ? databaseDefinition.semanticCatalog : {};

  return {
    ...semanticCatalog,
    ...semanticHints,
    labels: {
      ...(isObject(semanticCatalog.labels) ? semanticCatalog.labels : {}),
      ...(isObject(semanticCatalog.displayLabels) ? semanticCatalog.displayLabels : {}),
      ...(isObject(semanticHints.labels) ? semanticHints.labels : {}),
      ...(isObject(semanticHints.displayLabels) ? semanticHints.displayLabels : {}),
      ...(isObject(databaseDefinition.labels) ? databaseDefinition.labels : {}),
      ...(isObject(databaseDefinition.displayLabels) ? databaseDefinition.displayLabels : {}),
    },
    aliases: {
      ...(isObject(semanticCatalog.aliases) ? semanticCatalog.aliases : {}),
      ...(isObject(semanticHints.aliases) ? semanticHints.aliases : {}),
      ...(isObject(databaseDefinition.aliases) ? databaseDefinition.aliases : {}),
    },
  };
}

function getHintEntries(hints, ...keys) {
  for (const key of keys) {
    const value = hints?.[key];

    if (Array.isArray(value)) {
      return value;
    }

    if (isObject(value)) {
      return Object.entries(value).map(([entryKey, entryValue]) => {
        if (isObject(entryValue)) {
          return {
            key: entryKey,
            ...entryValue,
          };
        }

        return {
          key: entryKey,
          column: String(entryValue || entryKey),
        };
      });
    }
  }

  return [];
}

function getHintLabel(hints, tableName, columnName) {
  const labels = hints?.labels || {};
  const candidates = [
    `${tableName}.${columnName}`,
    columnName,
    normalizeColumnKey(`${tableName}.${columnName}`),
    normalizeColumnKey(columnName),
  ];

  for (const candidate of candidates) {
    const label = labels[candidate];

    if (typeof label === 'string' && label.trim()) {
      return label.trim();
    }
  }

  return null;
}

function getHintAliases(hints, tableName, columnName, key) {
  const aliases = hints?.aliases || {};
  const candidates = [
    `${tableName}.${columnName}`,
    columnName,
    key,
    normalizeColumnKey(`${tableName}.${columnName}`),
    normalizeColumnKey(columnName),
    normalizeColumnKey(key),
  ];
  const values = [];

  for (const candidate of candidates) {
    values.push(...toArray(aliases[candidate]));
  }

  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean);
}

function getReadableColumnLabel(columnName, hints, tableName) {
  const hintedLabel = getHintLabel(hints, tableName, columnName);

  if (hintedLabel) {
    return hintedLabel;
  }

  return getSchemaReadableColumnLabel(columnName, DEFAULT_SCHEMA);
}

function findTable(schemaProfiles, tableName) {
  const normalized = normalizeColumnKey(tableName);

  if (!normalized) {
    return null;
  }

  return (Array.isArray(schemaProfiles) ? schemaProfiles : []).find((table) => normalizeColumnKey(table.name) === normalized) ?? null;
}

function findColumn(table, columnName) {
  const normalized = normalizeColumnKey(columnName);

  if (!table || !normalized) {
    return null;
  }

  return table.columns.find((column) => normalizeColumnKey(column.name) === normalized) ?? null;
}

function isUsableMetricColumn(column) {
  return Boolean(column?.name)
    && !looksIdentifier(column.name)
    && (looksNumeric(column.type) || typeof column.valueSample === 'number');
}

function isDimensionCandidate(column) {
  if (!column?.name || looksTemporal(column.type, column.name)) {
    return false;
  }

  const normalized = normalizeColumnKey(column.name);
  const isTextLike = typeof column.valueSample === 'string' || /CHAR|CLOB|TEXT/i.test(column.type || '');
  const isNamedCategory = CATEGORY_NAME_KEYS.some((key) => normalized.includes(key));

  return isTextLike || isNamedCategory;
}

function scorePrimaryTable(table, hints) {
  const normalized = normalizeColumnKey(table?.name);
  const hintedTable = normalizeColumnKey(hints?.primaryTable || hints?.table || hints?.defaultTable);

  if (hintedTable && hintedTable === normalized) {
    return Number.MAX_SAFE_INTEGER;
  }

  if (normalizeColumnKey(DEFAULT_SCHEMA.table) === normalized) {
    return 5000 + Number(table?.rowCount || 0);
  }

  const metricCount = (table?.columns || []).filter(isUsableMetricColumn).length;
  const dimensionCount = (table?.columns || []).filter(isDimensionCandidate).length;

  return Number(table?.rowCount || 0) + metricCount * 100 + dimensionCount * 50;
}

function resolvePrimaryTable(schemaProfiles, hints) {
  const profiles = Array.isArray(schemaProfiles) ? schemaProfiles : [];
  const hintedTable = findTable(profiles, hints?.primaryTable || hints?.table || hints?.defaultTable);

  if (hintedTable) {
    return hintedTable;
  }

  return [...profiles].sort((left, right) => scorePrimaryTable(right, hints) - scorePrimaryTable(left, hints))[0] ?? null;
}

function normalizeHintEntry(entry) {
  if (typeof entry === 'string') {
    return {
      key: entry,
      column: entry,
    };
  }

  if (isObject(entry)) {
    return {
      key: entry.key || entry.name || entry.column,
      column: entry.column || entry.name || entry.key,
      table: entry.table,
      label: entry.label || entry.displayLabel,
      aliases: toArray(entry.aliases),
      aggregation: entry.aggregation,
    };
  }

  return null;
}

function buildCatalogEntry({ table, column, hints, hintEntry, kind, preferred }) {
  const key = normalizeColumnKey(hintEntry?.key || column.name);
  const label = String(
    hintEntry?.label
      || getReadableColumnLabel(column.name, hints, table.name)
      || column.name,
  ).trim();
  const aliases = [
    column.name,
    label,
    key,
    ...toArray(hintEntry?.aliases),
    ...getHintAliases(hints, table.name, column.name, key),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex((entry) => normalizeColumnKey(entry) === normalizeColumnKey(value)) === index);

  return {
    key,
    table: table.name,
    column: column.name,
    label,
    type: column.type,
    valueSample: column.valueSample ?? null,
    aliases,
    kind,
    preferred: Boolean(preferred),
    aggregation: hintEntry?.aggregation || (kind === 'metric' ? 'avg' : null),
  };
}

function addHintedEntries({ entries, schemaProfiles, primaryTable, hints, kind }) {
  const hintEntries = kind === 'metric'
    ? getHintEntries(hints, 'metrics', 'measures', 'preferredMetrics', 'preferredMeasures')
    : getHintEntries(hints, 'dimensions', 'categories', 'preferredDimensions', 'preferredCategories');

  for (const rawEntry of hintEntries) {
    const hintEntry = normalizeHintEntry(rawEntry);
    const table = findTable(schemaProfiles, hintEntry?.table) || primaryTable;
    const column = findColumn(table, hintEntry?.column);

    if (!table || !column) {
      continue;
    }

    if (kind === 'metric' && !isUsableMetricColumn(column)) {
      continue;
    }

    if (kind === 'dimension' && !isDimensionCandidate(column) && !looksIdentifier(column.name)) {
      continue;
    }

    entries.push(buildCatalogEntry({
      table,
      column,
      hints,
      hintEntry,
      kind,
      preferred: true,
    }));
  }
}

function uniqueEntries(entries) {
  return entries.filter((entry, index, list) => {
    const key = `${normalizeColumnKey(entry.table)}.${normalizeColumnKey(entry.column)}`;
    return key && list.findIndex((candidate) => `${normalizeColumnKey(candidate.table)}.${normalizeColumnKey(candidate.column)}` === key) === index;
  });
}

function buildMetricEntries(schemaProfiles, primaryTable, hints) {
  const entries = [];

  addHintedEntries({ entries, schemaProfiles, primaryTable, hints, kind: 'metric' });

  const preferredMeasures = Array.isArray(DEFAULT_SCHEMA.preferredMeasures) ? DEFAULT_SCHEMA.preferredMeasures : [];
  const columns = primaryTable?.columns || [];

  for (const preferredMeasure of preferredMeasures) {
    const meta = DEFAULT_SCHEMA.dimensionMeta?.[normalizeColumnKey(preferredMeasure)];
    const column = findColumn(primaryTable, meta?.column || preferredMeasure);

    if (column && isUsableMetricColumn(column)) {
      entries.push(buildCatalogEntry({
        table: primaryTable,
        column,
        hints,
        hintEntry: {
          key: preferredMeasure,
          label: meta?.label,
          aliases: meta?.aliases,
        },
        kind: 'metric',
        preferred: true,
      }));
    }
  }

  for (const column of columns) {
    if (!isUsableMetricColumn(column)) {
      continue;
    }

    entries.push(buildCatalogEntry({
      table: primaryTable,
      column,
      hints,
      hintEntry: null,
      kind: 'metric',
      preferred: false,
    }));
  }

  return uniqueEntries(entries);
}

function scoreDimensionEntry(entry) {
  const normalized = normalizeColumnKey(entry.column);
  const preferredName = CATEGORY_NAME_KEYS.some((key) => normalized.includes(key));
  return (entry.preferred ? 1000 : 0)
    + (preferredName ? 200 : 0)
    + (/name|label|species|strain|type|category|group/i.test(entry.column) ? 50 : 0)
    - (looksIdentifier(entry.column) ? 25 : 0);
}

function buildDimensionEntries(schemaProfiles, primaryTable, hints) {
  const entries = [];

  addHintedEntries({ entries, schemaProfiles, primaryTable, hints, kind: 'dimension' });

  for (const column of primaryTable?.columns || []) {
    if (!isDimensionCandidate(column)) {
      continue;
    }

    entries.push(buildCatalogEntry({
      table: primaryTable,
      column,
      hints,
      hintEntry: null,
      kind: 'dimension',
      preferred: false,
    }));
  }

  return uniqueEntries(entries).sort((left, right) => scoreDimensionEntry(right) - scoreDimensionEntry(left));
}

function buildLabelMap(entries) {
  return Object.fromEntries(
    entries.flatMap((entry) => [
      [entry.column, entry.label],
      [normalizeColumnKey(entry.column), entry.label],
      [`${entry.table}.${entry.column}`, entry.label],
      [normalizeColumnKey(`${entry.table}.${entry.column}`), entry.label],
    ]),
  );
}

function buildPromptFieldExamples(catalog) {
  const fields = [
    ...(catalog?.metrics || []).slice(0, 5).map((entry) => entry.label),
    ...(catalog?.dimensions || []).slice(0, 2).map((entry) => entry.label),
  ]
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .filter((value, index, list) => list.findIndex((entry) => normalizeColumnKey(entry) === normalizeColumnKey(value)) === index);

  return fields.length ? fields : DEFAULT_PROMPT_FIELDS;
}

function buildPromptHelpFromCatalog(catalog) {
  const fields = buildPromptFieldExamples(catalog);
  const fieldText = fields.join(', ');
  const primaryMetric = catalog?.metrics?.[0]?.label || fields[0] || 'area';
  const primaryDimension = catalog?.dimensions?.[0]?.label || fields[fields.length - 1] || 'microorganism';

  return {
    title: 'Need more detail',
    message: `Clarify what you want to view. Add at least one dataset field, such as ${fieldText}.`,
    suggestions: [
      `Add a metric or category: ${fieldText}.`,
      'Add a view type when useful: table, dashboard, bar chart, line chart, doughnut chart, or polar chart.',
      'Add a limit: top 5, top 10, top 12, or another top-N value.',
      'Add a filter or sort order: between 7 and 10, above 5, below 3, ascending, or descending.',
    ],
    examples: [
      `show the top 10 records by ${primaryMetric}`,
      `show a dashboard of ${primaryDimension} by ${primaryMetric}`,
      `compare average ${primaryMetric} by ${primaryDimension}`,
      `show records with ${primaryMetric} above 5`,
    ],
  };
}

function buildSemanticCatalog({ schemaProfiles, databaseDefinition } = {}) {
  const hints = normalizeHints(databaseDefinition);
  const profiles = Array.isArray(schemaProfiles) ? schemaProfiles : [];
  const primaryTable = resolvePrimaryTable(profiles, hints);

  if (!primaryTable) {
    return {
      version: 1,
      source: 'fallback',
      primaryTable: null,
      metrics: [],
      dimensions: [],
      labels: {},
      promptFields: DEFAULT_PROMPT_FIELDS,
    };
  }

  const metrics = buildMetricEntries(profiles, primaryTable, hints);
  const dimensions = buildDimensionEntries(profiles, primaryTable, hints);
  const entries = [...metrics, ...dimensions];

  return {
    version: 1,
    source: 'schema-inference',
    primaryTable: primaryTable.name,
    metrics,
    dimensions,
    labels: buildLabelMap(entries),
    promptFields: buildPromptFieldExamples({ metrics, dimensions }),
  };
}

function getCatalogLabel(catalog, columnName, fallback = null) {
  const labels = catalog?.labels || {};
  const label = labels[columnName] || labels[normalizeColumnKey(columnName)];

  return typeof label === 'string' && label.trim()
    ? label.trim()
    : fallback;
}

module.exports = {
  buildPromptHelpFromCatalog,
  buildSemanticCatalog,
  getCatalogLabel,
};
