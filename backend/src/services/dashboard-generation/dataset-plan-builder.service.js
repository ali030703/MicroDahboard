const { quoteIdentifier, buildSqlWhereClause } = require('./sql-builder.util');
const { DEFAULT_CATEGORY_LIMIT, MAX_LABEL_COLUMNS, clamp, normalizeAggregation } = require('./format.util');
const { normalizeColumnKey, looksNumeric, looksTemporal } = require('../dashboard-schema-profile.service');
const {
  resolveTableByName,
  resolveColumnByName,
  getAllMeasureColumns,
  getReadableColumnLabel,
  getReadableMeasureLabel,
} = require('./column-resolution.service');
const { resolveMultiMeasureColumns, resolveMicroorganismDimensionBinding } = require('./microorganism-binding.service');
const { getCatalogEntriesForTable, getMentionedCatalogDimensionColumn, getMentionedCatalogMetricColumns, resolveCatalogColumn } = require('./semantic-catalog-matcher.service');
const { normalizeTemplateFamily, promptRequestsAllProperties } = require('./prompt-intent-parser.service');
const { shouldUseRecordPreviewForTable } = require('./intent-enrichment.service');
const { SCHEMA, isMicroorganismDimensionColumn, resolveDimension, resolveSemanticQuery } = require('../../config/schema');
const MICROORGANISM_SCHEMA = SCHEMA.microorganism;
const EXCLUDED_DIMENSION_COLUMNS = new Set(MICROORGANISM_SCHEMA.excludedDimensionKeys || []);

function buildDatasetPlan({ primaryTable, dimensionColumn, measureColumn, measureColumns, templateFamily, intent, microorganismLookupContext }) {
  const tableName = quoteIdentifier(primaryTable.name);
  const microorganismBinding = resolveMicroorganismDimensionBinding(primaryTable, dimensionColumn, tableName, microorganismLookupContext);
  const categoryLimit = intent.microorganismFocus
    ? clamp(intent.topLimit ?? DEFAULT_CATEGORY_LIMIT, 1, 100)
    : clamp(intent.topLimit ?? DEFAULT_CATEGORY_LIMIT, 1, 100);
  const requestedAggregation = normalizeAggregation(intent.aggregation);
  const aggregation = intent.allCategoryComparison
    ? (requestedAggregation && requestedAggregation !== 'count' ? requestedAggregation : 'avg')
    : measureColumn
      ? requestedAggregation || 'avg'
      : 'count';
  const whereClause = buildSqlWhereClause(intent.filters, primaryTable.name);

  const resolvedMeasureColumns = Array.isArray(measureColumns) && measureColumns.length >= 2 ? measureColumns : [measureColumn].filter(Boolean);

  const statsSelect = ['COUNT(*) AS total_rows'];

  if (resolvedMeasureColumns.length >= 2) {
    resolvedMeasureColumns.forEach((m, idx) => {
      const measureIdentifier = quoteIdentifier(m.name);
      const pos = idx + 1;
      statsSelect.push(`${getAggregationExpression(aggregation, m)} AS primary_value_${pos}`);
      statsSelect.push(`AVG(${measureIdentifier}) AS avg_value_${pos}`);
      statsSelect.push(`MIN(${measureIdentifier}) AS min_value_${pos}`);
      statsSelect.push(`MAX(${measureIdentifier}) AS max_value_${pos}`);
    });
  } else if (measureColumn) {
    const measureIdentifier = quoteIdentifier(measureColumn.name);
    statsSelect.push(`${getAggregationExpression(aggregation, measureColumn)} AS primary_value`);
    statsSelect.push(`AVG(${measureIdentifier}) AS avg_value`);
    statsSelect.push(`MIN(${measureIdentifier}) AS min_value`);
    statsSelect.push(`MAX(${measureIdentifier}) AS max_value`);
  }

  const statsQuery = `SELECT ${statsSelect.join(', ')} FROM ${tableName}${whereClause ? ` ${whereClause}` : ''}`;

  // Only build category queries when the semantic dimension is categorical.
  const staticDimensionGrain = intent?.semanticQuery?.dimensionKey
    ? (resolveDimension(intent.semanticQuery.dimensionKey, MICROORGANISM_SCHEMA)?.grain || null)
    : null;
  const dimensionGrain = dimensionColumn && looksTemporal(dimensionColumn.type, dimensionColumn.name)
    ? 'temporal'
    : dimensionColumn && !looksNumeric(dimensionColumn.type)
      ? 'category'
      : staticDimensionGrain;
  const canGroupDimension = dimensionGrain === 'category' || dimensionGrain === 'temporal';

  const categoryQuery = (dimensionColumn && canGroupDimension)
    ? `
    SELECT COALESCE(CAST(${microorganismBinding.labelExpression} AS TEXT), 'N/A') AS label,
             COUNT(*) AS value
      FROM ${tableName}
    ${microorganismBinding.joinClause}
      ${whereClause}
      GROUP BY ${microorganismBinding.groupByExpression}
      ORDER BY value DESC
      LIMIT ${categoryLimit}
    `
    : null;

  const measureByDimensionQuery = (dimensionColumn && canGroupDimension && resolvedMeasureColumns.length > 0)
    ? (resolvedMeasureColumns.length >= 2
      ? buildMultiMeasureQuery({ primaryTable, dimensionColumn, measureColumns: resolvedMeasureColumns, intent, microorganismLookupContext })
      : `
      SELECT COALESCE(CAST(${microorganismBinding.labelExpression} AS TEXT), 'N/A') AS label,
             ${getAggregationExpression(aggregation, measureColumn, primaryTable.name)} AS value
      FROM ${tableName}
      ${microorganismBinding.joinClause}
      ${whereClause}
        GROUP BY ${microorganismBinding.groupByExpression}
      ORDER BY value DESC
      LIMIT ${categoryLimit}
    `)
    : null;
  const categoryMetricsQuery = intent.allCategoryComparison && resolvedMeasureColumns.length > 0
    ? buildCategoryMetricSummaryQuery({
      primaryTable,
      measureColumns: resolvedMeasureColumns,
      aggregation,
      whereClause,
    })
    : null;

  const relevantColumns = getRelevantTableColumns(intent, dimensionColumn, measureColumn);
  
  let previewQuery;
  let previewColumns;
  
  const hasFilters = Array.isArray(intent.filters) && intent.filters.length > 0;
  const previewLimit = hasFilters && intent.topLimit 
    ? intent.topLimit 
    : (templateFamily === 'compact' ? 10 : 20);
  const useRecordPreviewForTable = shouldUseRecordPreviewForTable(intent);
  
  if (useRecordPreviewForTable && promptRequestsAllProperties(intent.normalizedPrompt || intent.rawPrompt || '')) {
    previewQuery = `SELECT * FROM ${tableName}${whereClause ? ` ${whereClause}` : ''} LIMIT ${previewLimit}`;
    previewColumns = null;
  } else if (dimensionColumn && !useRecordPreviewForTable) {
    if (resolvedMeasureColumns.length >= 2) {
      // Use the multi-measure aggregation as the preview so preview rows match chart logic
      previewQuery = buildMultiMeasureQuery({ primaryTable, dimensionColumn, measureColumns: resolvedMeasureColumns, intent, microorganismLookupContext });
      previewColumns = [
        { key: 'label', label: (isMicroorganismDimensionColumn(dimensionColumn?.name, MICROORGANISM_SCHEMA) ? getReadableColumnLabel(MICROORGANISM_SCHEMA.labelColumn) : getReadableColumnLabel(dimensionColumn.name)) },
        ...resolvedMeasureColumns.map((measure, index) => ({
          key: `value_${index + 1}`,
          label: `${getAggregationLabel(aggregation)} ${getReadableMeasureLabel(measure.name)}`,
        })),
      ];
    } else {
      const isCountAggregation = normalizeAggregation(aggregation) === 'count' || !measureColumn;
      const valueExpression = measureColumn
        ? getAggregationExpression(aggregation, measureColumn, primaryTable.name)
        : 'COUNT(*)';
      const valueLabel = measureColumn
        ? `${getAggregationLabel(aggregation)} ${getReadableMeasureLabel(measureColumn.name)}`
        : 'Count';

      previewQuery = `
      SELECT COALESCE(CAST(${microorganismBinding.labelExpression} AS TEXT), 'N/A') AS category,
             COUNT(*) AS record_count,
             ${valueExpression} AS value
      FROM ${tableName}
      ${microorganismBinding.joinClause}
      ${whereClause}
        GROUP BY ${microorganismBinding.groupByExpression}
      ORDER BY value DESC
      LIMIT ${categoryLimit}
    `.trim();

      previewColumns = [
        { key: 'category', label: (isMicroorganismDimensionColumn(dimensionColumn?.name, MICROORGANISM_SCHEMA) ? getReadableColumnLabel(MICROORGANISM_SCHEMA.labelColumn) : getReadableColumnLabel(dimensionColumn.name)) },
        { key: 'value', label: valueLabel },
      ];

      if (!isCountAggregation) {
        previewColumns.splice(1, 0, { key: 'record_count', label: 'Rows' });
      }
    }
  } else if (relevantColumns && relevantColumns.length > 0) {
    const columnSelects = relevantColumns
      .map(col => `${quoteIdentifier(col.key)}`)
      .join(', ');
    
    let orderByClause = '';
    if (intent.sortBy === 'value' && measureColumn) {
      const direction = intent.sortDirection === 'asc' ? 'ASC' : 'DESC';
      orderByClause = `ORDER BY ${quoteIdentifier(measureColumn.name)} ${direction}`;
    } else if (intent.sortBy === 'label' && dimensionColumn) {
      const direction = intent.sortDirection === 'asc' ? 'ASC' : 'DESC';
      orderByClause = `ORDER BY ${quoteIdentifier(dimensionColumn.name)} ${direction}`;
    } else if (measureColumn) {
      orderByClause = `ORDER BY ${quoteIdentifier(measureColumn.name)} DESC`;
    }
    
    previewQuery = `
      SELECT ${columnSelects}
      FROM ${tableName}
      ${whereClause}
      ${orderByClause}
      LIMIT ${previewLimit}
    `.trim();
    
    previewColumns = relevantColumns;
  } else {
    previewQuery = `SELECT * FROM ${tableName}${whereClause ? ` ${whereClause}` : ''} LIMIT ${previewLimit}`;
    previewColumns = null;
  }

  return {
    categoryLimit,
    aggregation,
    queries: {
      stats: statsQuery,
      category: categoryQuery,
      measureByDimension: measureByDimensionQuery,
      categoryMetrics: categoryMetricsQuery,
      preview: previewQuery,
    },
    previewColumns,
  };
}

function buildMultiMeasureQuery({ primaryTable, dimensionColumn, measureColumns, intent, microorganismLookupContext }) {
  const tableName = quoteIdentifier(primaryTable.name);
  const whereClause = buildSqlWhereClause(intent.filters, primaryTable.name);
  const microorganismBinding = resolveMicroorganismDimensionBinding(primaryTable, dimensionColumn, tableName, microorganismLookupContext);
  
  const selectClauses = [
    `COALESCE(CAST(${microorganismBinding.labelExpression} AS TEXT), 'N/A') AS label`
  ];
  
  measureColumns.forEach((col, index) => {
    const aggregation = normalizeAggregation(intent.aggregation) || 'avg';
    selectClauses.push(`${getAggregationExpression(aggregation, col, primaryTable.name)} AS value_${index + 1}`);
  });
  
  return `
    SELECT ${selectClauses.join(', ')}
    FROM ${tableName}
    ${microorganismBinding.joinClause}
    ${whereClause}
    GROUP BY ${microorganismBinding.groupByExpression}
    ORDER BY value_1 DESC
    LIMIT ${intent.topLimit || DEFAULT_CATEGORY_LIMIT}
  `;
}

function buildCategoryMetricSummaryQuery({ primaryTable, measureColumns, aggregation, whereClause }) {
  const tableName = quoteIdentifier(primaryTable.name);
  const rows = (Array.isArray(measureColumns) ? measureColumns : [])
    .filter((column) => column?.name)
    .map((column, index) => {
      const label = getReadableMeasureLabel(column.name).replace(/'/g, "''");
      const valueExpression = getAggregationExpression(aggregation, column, primaryTable.name);
      return `${index === 0 ? 'SELECT' : 'UNION ALL SELECT'} '${label}' AS label, ${valueExpression} AS value FROM ${tableName} ${whereClause}`;
    });

  if (!rows.length) {
    return null;
  }

  return `
    WITH category_metrics AS (
      ${rows.join('\n      ')}
    )
    SELECT label, value
    FROM category_metrics
    ORDER BY label ASC
  `;
}

function getRelevantTableColumns(intent, dimensionColumn, measureColumn) {
  const columns = [];
  const seen = new Set();

  function addColumn(columnName, label = null) {
    const key = normalizeColumnKey(columnName);

    if (!key || seen.has(key)) {
      return;
    }

    columns.push({
      key: columnName,
      label: label || getReadableColumnLabel(columnName),
    });
    seen.add(key);
  }
  
  if (dimensionColumn && !EXCLUDED_DIMENSION_COLUMNS.has(normalizeColumnKey(dimensionColumn.name))) {
    addColumn(dimensionColumn.name);
  }
  
  // Include filter columns in preview (they have useful context)
  if (Array.isArray(intent.filters)) {
    for (const filter of intent.filters) {
      addColumn(filter.column);
    }
  }

  if (Array.isArray(intent.mentionedColumns)) {
    for (const mentionedColumn of intent.mentionedColumns) {
      if (mentionedColumn?.role !== 'microorganism') {
        addColumn(mentionedColumn?.column);
      }
    }
  }
  
  // Include measure columns
  if (measureColumn) {
    addColumn(measureColumn.name);
  }
  
  // Include microorganism name column if available and not already included
  const microorganismNameCol = (intent.mentionedColumns || []).find(c => 
    c.column && (normalizeColumnKey(c.column).includes('microorganism') || normalizeColumnKey(c.column).includes('organism')) && !seen.has(normalizeColumnKey(c.column))
  );
  if (microorganismNameCol && microorganismNameCol.column) {
    addColumn(microorganismNameCol.column);
  }
  
  return columns.length > 0 ? columns : null;
}

function resolvePhysicalPlanFromSemanticIntent(schemaProfiles, intent, semanticCatalog) {
  const semanticQuery = resolveSemanticQuery(intent, MICROORGANISM_SCHEMA);

  if (!Array.isArray(schemaProfiles) || !schemaProfiles.length) {
    return {
      semanticQuery,
      primaryTable: null,
      dimensionColumn: null,
      measureColumn: null,
    };
  }

  const catalogPrimaryTable = resolveTableByName(schemaProfiles, semanticCatalog?.primaryTable);
  const primaryTable = resolveTableByName(schemaProfiles, semanticQuery?.table)
    || resolveTableByName(schemaProfiles, MICROORGANISM_SCHEMA.table)
    || catalogPrimaryTable
    || schemaProfiles[0]
    || null;

  const semanticDimensionColumn = primaryTable
    ? resolveColumnByName(primaryTable, semanticQuery?.columns?.dimension || semanticQuery?.physical?.dimensionColumn)
    : null;
  const dynamicDimensionColumn = primaryTable
    ? resolveColumnByName(primaryTable, intent?.dynamicDimensionColumn)
    : null;
  const catalogDimensionColumn = primaryTable
    ? dynamicDimensionColumn || getMentionedCatalogDimensionColumn(primaryTable, intent, semanticCatalog)
      || resolveCatalogColumn(primaryTable, getCatalogEntriesForTable(semanticCatalog, 'dimensions', primaryTable)[0])
    : null;
  const dimensionColumn = semanticDimensionColumn || dynamicDimensionColumn || catalogDimensionColumn;
  const semanticMeasureColumn = primaryTable
    ? resolveColumnByName(primaryTable, semanticQuery?.columns?.metric || semanticQuery?.physical?.measureColumn)
    : null;
  const dynamicMeasureColumn = primaryTable
    ? resolveColumnByName(primaryTable, intent?.dynamicMeasureColumn)
      || null
    : null;
  const catalogMeasureColumn = primaryTable
    ? getMentionedCatalogMetricColumns(primaryTable, intent, semanticCatalog)[0] ?? null
    : null;
  const measureColumn = semanticMeasureColumn || dynamicMeasureColumn || catalogMeasureColumn;

  return {
    semanticQuery,
    primaryTable,
    dimensionColumn,
    measureColumn,
  };
}

function resolveTemplateFamily(requestedFamily, intent, fallbackFamily) {
  const requested = normalizeTemplateFamily(requestedFamily) || intent.requestedFamily;

  if (requested) {
    return requested;
  }

  if (intent.comparisonQuery && (intent.comparisonQuery.type === 'comparison' || intent.comparisonQuery.measures?.length >= 2)) {
    return 'analytical';
  }

  return intent.prefersTrend ? 'analytical' : 'balanced';
}

function getAggregationExpression(aggregation, measureColumn, tableName) {
  const measureIdentifier = tableName && measureColumn?.name
    ? `${quoteIdentifier(tableName)}.${quoteIdentifier(measureColumn.name)}`
    : quoteIdentifier(measureColumn?.name);

  switch (normalizeAggregation(aggregation) ?? 'avg') {
    case 'count':
      return 'COUNT(*)';
    case 'sum':
      return `SUM(${measureIdentifier})`;
    case 'min':
      return `MIN(${measureIdentifier})`;
    case 'max':
      return `MAX(${measureIdentifier})`;
    case 'avg':
    default:
      return `AVG(${measureIdentifier})`;
  }
}

function getAggregationLabel(aggregation) {
  switch (normalizeAggregation(aggregation) ?? 'avg') {
    case 'count':
      return 'Count';
    case 'sum':
      return 'Total';
    case 'min':
      return 'Minimum';
    case 'max':
      return 'Maximum';
    case 'avg':
    default:
      return 'Average';
  }
}

module.exports = {
  buildDatasetPlan,
  buildMultiMeasureQuery,
  buildCategoryMetricSummaryQuery,
  getRelevantTableColumns,
  resolvePhysicalPlanFromSemanticIntent,
  resolveTemplateFamily,
  getAggregationExpression,
  getAggregationLabel,
  EXCLUDED_DIMENSION_COLUMNS,
};
