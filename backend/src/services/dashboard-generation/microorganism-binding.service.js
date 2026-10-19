const { quoteIdentifier } = require('./sql-builder.util');
const { resolveColumnByName, getAllMeasureColumns, isUsableMeasureColumn } = require('./column-resolution.service');
const { normalizeColumnKey, looksIdentifier, looksNumeric } = require('../dashboard-schema-profile.service');
const { SCHEMA, isMicroorganismDimensionColumn, resolveMetric, resolveSemanticQuery } = require('../../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function resolveMicroorganismDimensionBinding(table, dimensionColumn, tableName, microorganismLookup) {
  const lookupContext = typeof microorganismLookup === 'string'
    ? { tableName: microorganismLookup, idColumn: MICROORGANISM_SCHEMA.lookup.id, nameColumn: MICROORGANISM_SCHEMA.lookup.name }
    : (microorganismLookup || MICROORGANISM_SCHEMA.lookup);
  const microorganismIdColumn = table?.columns?.find((column) => normalizeColumnKey(column.name) === normalizeColumnKey(MICROORGANISM_SCHEMA.id)) ?? null;
  const isMicroorganismDimension = isMicroorganismDimensionColumn(dimensionColumn?.name, MICROORGANISM_SCHEMA);
  const rawLabelColumn = table?.columns?.find((column) => normalizeColumnKey(column.name) === normalizeColumnKey(MICROORGANISM_SCHEMA.labelColumn))?.name
    ?? dimensionColumn?.name
    ?? microorganismIdColumn?.name
    ?? null;

  if (microorganismIdColumn && isMicroorganismDimension) {
    // Use the lookup table to get proper names if available
    if (lookupContext?.tableName && lookupContext?.idColumn && lookupContext?.nameColumn) {
      return {
        labelExpression: `cat.${quoteIdentifier(lookupContext.nameColumn)}`,
        groupByExpression: `${tableName}.${quoteIdentifier(microorganismIdColumn.name)}`,
        joinClause: `LEFT JOIN ${quoteIdentifier(lookupContext.tableName)} AS cat ON cat.${quoteIdentifier(lookupContext.idColumn)} = ${tableName}.${quoteIdentifier(microorganismIdColumn.name)}`,
        useJoin: true,
      };
    }
    
    // Fallback: use the raw label column if lookup table not available
    return {
      labelExpression: `COALESCE(CAST(${tableName}.${quoteIdentifier(rawLabelColumn)} AS TEXT), 'Unknown')`,
      groupByExpression: `${tableName}.${quoteIdentifier(microorganismIdColumn.name)}`,
      joinClause: '',
      useJoin: false,
    };
  }

  return {
    labelExpression: `COALESCE(CAST(${quoteIdentifier(dimensionColumn?.name)} AS TEXT), 'N/A')`,
    groupByExpression: quoteIdentifier(dimensionColumn?.name),
    joinClause: '',
    useJoin: false,
  };
}

function resolveMultiMeasureColumns(primaryTable, intent, measureColumn) {
  const visualRequests = Array.isArray(intent?.visualRequests) ? intent.visualRequests : [];
  const hasExplicitRequestedMetrics = visualRequests.some((request) => {
    const keys = [
      ...(Array.isArray(request?.semanticMetricKeys) ? request.semanticMetricKeys : []),
      request?.semanticMetricKey,
      request?.metricKey,
      request?.measureKey,
      request?.metric,
    ].filter(Boolean);

    return keys.length > 0;
  });

  if ((intent?.allCategoryComparison || intent?.allMeasureComparison)
    && Array.isArray(primaryTable?.numericColumns)
    && !hasExplicitRequestedMetrics) {
    return getAllMeasureColumns(primaryTable);
  }

  const requestedMeasureColumns = visualRequests
    .flatMap((request) => {
      const semanticMetrics = [
        ...(Array.isArray(request?.semanticMetricKeys) ? request.semanticMetricKeys : []),
        request?.semanticMetricKey,
        request?.metricKey,
        request?.measureKey,
        request?.metric,
      ]
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

      return semanticMetrics.map((semanticMetric) => {
        if (!semanticMetric) {
          return null;
        }

        const directColumn = resolveColumnByName(primaryTable, semanticMetric);

        if (directColumn && isUsableMeasureColumn(directColumn)) {
          return directColumn;
        }

        const resolvedQuery = resolveSemanticQuery(
          {
            selectedEntity: intent?.selectedEntity || 'organism',
            selectedMetric: semanticMetric,
            selectedDimension: intent?.selectedDimension || 'species',
            semanticIntent: intent?.semanticIntent,
            aggregation: request?.aggregation || intent?.aggregation,
            prefersTrend: Boolean(request?.chartTemplate === 'line' || intent?.prefersTrend),
          },
          MICROORGANISM_SCHEMA,
        );

        const semanticDef = resolveMetric(semanticMetric, MICROORGANISM_SCHEMA);

        if (semanticDef && semanticDef.kind === 'categorical' && semanticDef.key !== 'count') {
          return null;
        }

        return resolveColumnByName(primaryTable, resolvedQuery?.columns?.metric || resolvedQuery?.physical?.measureColumn);
      });
    })
    .filter(Boolean)
    .filter((column) => !looksIdentifier(column.name))
    .filter((column) => (looksNumeric(column.type) || typeof column.valueSample === 'number'))
    .filter((column, index, columns) => columns.findIndex((entry) => entry.name === column.name) === index);

  if (requestedMeasureColumns.length >= 1) {
    return requestedMeasureColumns;
  }

  // First, try to get measures from comparisonQuery
  const comparisonMeasures = Array.isArray(intent?.comparisonQuery?.measures)
    ? intent.comparisonQuery.measures
    : [];

  const resolved = comparisonMeasures
    .map((measure) => {
      const semanticMetric = measure?.semanticMetric || measure?.column || measure?.measure;
      if (!semanticMetric) {
        return null;
      }

      const directColumn = resolveColumnByName(primaryTable, measure?.column || measure?.measure);
      if (directColumn && isUsableMeasureColumn(directColumn)) {
        return directColumn;
      }

      const resolvedQuery = resolveSemanticQuery(
        {
          selectedEntity: intent?.selectedEntity || 'organism',
          selectedMetric: semanticMetric,
          selectedDimension: intent?.selectedDimension || 'species',
          semanticIntent: intent?.semanticIntent,
          aggregation: intent?.aggregation,
          prefersTrend: intent?.prefersTrend,
        },
        MICROORGANISM_SCHEMA,
      );

      // Label-like metrics are not valid numeric comparison measures.
      const semanticDef = resolveMetric(semanticMetric, MICROORGANISM_SCHEMA);
      if (semanticDef && semanticDef.kind === 'categorical' && semanticDef.key !== 'count') {
        return null;
      }

      return resolveColumnByName(primaryTable, resolvedQuery?.columns?.metric || resolvedQuery?.physical?.measureColumn);
    })
    .filter(Boolean)
    .filter((column) => !looksIdentifier(column.name))
    .filter((column) => (looksNumeric(column.type) || typeof column.valueSample === 'number'))
    .filter((column, index, columns) => columns.findIndex((entry) => entry.name === column.name) === index);

  if (resolved.length >= 2) {
    return resolved;
  }

  // If no comparison measures, check if measureColumn is a filter
  const measureIsFilter = measureColumn && (intent.filters || []).some(f => 
    normalizeColumnKey(f.column) === normalizeColumnKey(measureColumn.name)
  );
  
  if (measureColumn && !looksIdentifier(measureColumn.name) && !measureIsFilter) {
    return [measureColumn];
  }
  
  return [];
}

module.exports = {
  resolveMicroorganismDimensionBinding,
  resolveMultiMeasureColumns,
};
