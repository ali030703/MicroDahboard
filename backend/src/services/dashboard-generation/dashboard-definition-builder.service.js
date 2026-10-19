const {
  getReadableColumnLabel,
  getReadableTableLabel,
  getReadableMeasureLabel,
  getCategoryIdForColumn,
  buildFilterSummary,
  buildTableFilterDescription,
} = require('./column-resolution.service');
const { normalizePromptText } = require('./prompt-text.util');
const {
  DEFAULT_CATEGORY_LIMIT,
  MAX_LABEL_COLUMNS,
  SUPPORTED_CHART_TEMPLATES,
  formatReadableList,
  toSlug,
  clone,
  normalizeAggregation,
  normalizeName,
  normalizeNumber,
} = require('./format.util');
const { normalizeColumnKey, looksIdentifier, looksTemporal } = require('../dashboard-schema-profile.service');
const { detectChartTemplate, normalizeTemplateFamily } = require('./prompt-intent-parser.service');
const { resolveMultiMeasureColumns } = require('./microorganism-binding.service');
const { isExplicitTableOnlyRequest, shouldUseRecordPreviewForTable } = require('./intent-enrichment.service');
const { SCHEMA, isMicroorganismDimensionColumn, resolveDimension, resolveMetric } = require('../../config/schema');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;
const TEMPLATE_BLUEPRINTS = {
  compact: [
    { kind: 'stats' },
    { kind: 'categoryChart', defaultTemplate: 'bar-horizontal' },
    { kind: 'table', limit: 10 },
  ],
  balanced: [
    { kind: 'stats' },
    { kind: 'categoryChart', defaultTemplate: 'bar-horizontal' },
    { kind: 'table', limit: 20 },
  ],
  analytical: [
    { kind: 'stats' },
    { kind: 'categoryChart', defaultTemplate: 'bar-horizontal' },
    { kind: 'measureChart', defaultTemplate: 'line' },
    { kind: 'table', limit: 25 },
  ],
  visual: [
    { kind: 'categoryChart', defaultTemplate: 'bar-horizontal' },
    { kind: 'measureChart', defaultTemplate: 'line' },
  ],
};;

function buildDashboardDefinition({
  prompt,
  id,
  primaryTable,
  dimensionColumn,
  measureColumn,
  measureColumns,
  previewRows,
  templateFamily,
  intent,
  categoryLimit,
  hasCategoryData,
  hasMeasureByDimensionData,
  previewColumns,
}) {
  const visualRequests = Array.isArray(intent.visualRequests) ? intent.visualRequests.filter(Boolean) : [];
  const hasExplicitVisualRequests = visualRequests.length >= 2;
  let tableColumns;
  
  if (previewColumns && previewColumns.length > 0) {
    tableColumns = previewColumns;
  } else {
    const allColumns = Object.keys(previewRows[0] ?? {}).slice(0, MAX_LABEL_COLUMNS);
    
    const filteredColumns = allColumns.filter(col => 
      !/^[a-z]$/i.test(col) &&
      !looksIdentifier(col)
    );
    
    tableColumns = (filteredColumns.length > 0 ? filteredColumns : allColumns)
      .map((column) => ({
        key: column,
        label: getReadableColumnLabel(column),
        category_id: getCategoryIdForColumn(column),
      }));
  }
  
  const categoryUsesMeasureValues = shouldUseMeasureValuesForCategoryChart(primaryTable, measureColumn);
  const resolvedMeasureColumns = Array.isArray(measureColumns) && measureColumns.length > 0 ? measureColumns : [measureColumn].filter(Boolean);
  const primaryMeasureColumn = resolvedMeasureColumns[0] ?? measureColumn;
  const normalizedPrompt = normalizePromptText(prompt);
  const explicitChartType = detectChartTemplate(normalizedPrompt);
  const isExplicitLineChart = explicitChartType === 'line';
  const explicitVisualRequestsByIndex = hasExplicitVisualRequests ? new Map(visualRequests.map((request, index) => [index, request])) : new Map();
  
  const blueprint = buildBlueprint(templateFamily, intent, {
    hasCategoryChart: hasCategoryData,
    hasMeasureChart: hasMeasureByDimensionData,
    hasTable: tableColumns.length > 0,
  });

  let componentCounter = 0;
  const components = blueprint.flatMap((entry, blueprintIndex) => {
    if (entry.kind === 'stats') {
      componentCounter++;
      const dataSourceRoot = entry.requestIndex !== undefined ? `dataset.request_${entry.requestIndex}` : 'dataset';
      const componentFilters = getComponentFilters(entry, intent);
      const filterSuffix = buildFilterSummary(componentFilters) ? ` Filtered by ${buildFilterSummary(componentFilters)}.` : '';
      return [{
        id: `${id}-stats-${componentCounter}`,
        widget: 'stats-widget',
        type: 'stats',
        title: 'Key Metrics Snapshot',
        description: `High-level metrics from ${getReadableTableLabel(primaryTable.name).toLowerCase()}.${filterSuffix}`,
        data: {
          source: `${dataSourceRoot}.overview`,
          transform: {
            type: 'keyValue',
            fields: buildStatsFields(resolvedMeasureColumns, intent.aggregation),
          },
        },
      }];
    }

    if (entry.kind === 'categoryChart') {
      componentCounter++;
      const dimensionLabel = dimensionColumn ? getReadableColumnLabel(dimensionColumn.name) : null;
      const dataSourceRoot = entry.requestIndex !== undefined ? `dataset.request_${entry.requestIndex}` : 'dataset';
      const chartTemplate = avoidOvercrowdedChartTemplate(
        resolveChartTemplate(intent, entry.defaultTemplate),
        entry.defaultTemplate,
        { seriesCount: 1, categoryLimit },
      );
      const isMicroorganismDimension = isMicroorganismDimensionColumn(dimensionColumn?.name, MICROORGANISM_SCHEMA);
      const dimensionCategoryId = getCategoryIdForColumn(dimensionColumn?.name);
      const source = categoryUsesMeasureValues ? 'dataset.measureByDimension' : 'dataset.categoryCounts';

      return [{
        id: `${id}-category-chart-${componentCounter}`,
        widget: 'chart-widget',
        type: 'chart',
        chart: {
          template: chartTemplate,
        },
        title: buildCategoryChartTitle(chartTemplate, isMicroorganismDimension ? 'Microorganism' : dimensionLabel),
        data: {
          source: `${dataSourceRoot}.${source.replace('dataset.', '')}`,
          category_id: dimensionCategoryId,
          transform: {
            type: 'collection',
            labelField: 'label',
            valueField: 'value',
            sortBy: intent.sortBy ?? 'value',
            sortDirection: intent.sortDirection ?? 'desc',
            limit: categoryLimit,
            emptyLabel: 'N/A',
            labelMaxLength: 24,
          },
        },
      }];
    }

    if (entry.kind === 'measureChart') {
      componentCounter++;
      const dataSourceRoot = entry.requestIndex !== undefined ? `dataset.request_${entry.requestIndex}` : 'dataset';
      const defaultMeasureTemplate = dimensionColumn && looksTemporal(dimensionColumn.type, dimensionColumn.name)
        ? 'line'
        : entry.defaultTemplate;
      const dimensionLabel = dimensionColumn ? getReadableColumnLabel(dimensionColumn.name) : null;
      const visualRequest = entry.visualRequest || explicitVisualRequestsByIndex.get(entry.requestIndex ?? -1) || null;
      const requestedMeasureColumns = resolveRequestedMeasureColumns(visualRequest, resolvedMeasureColumns, primaryMeasureColumn);
      const effectiveMeasureColumns = visualRequest
        ? requestedMeasureColumns
        : resolvedMeasureColumns;
      const hasEntryMultiMeasureChart = effectiveMeasureColumns.length >= 2;
      const primaryEntryMeasureColumn = effectiveMeasureColumns[0] ?? primaryMeasureColumn;
      const requestedMeasureColumn = primaryEntryMeasureColumn;
      const requestedMeasureLabel = getReadableMeasureLabel(requestedMeasureColumn?.name || requestedMeasureColumn?.key || primaryMeasureColumn?.name);
      const requestedChartTemplate = resolveRequestedChartTemplate(visualRequest, intent, defaultMeasureTemplate);
      const resolvedTemplate = hasEntryMultiMeasureChart
        ? requestedChartTemplate
        : intent.microorganismFocus
        ? defaultMeasureTemplate
        : requestedChartTemplate;
      const chartTemplate = intent.chartTemplate
        ? resolvedTemplate
        : avoidOvercrowdedChartTemplate(
          resolvedTemplate,
          defaultMeasureTemplate,
          { seriesCount: effectiveMeasureColumns.length || 1, categoryLimit },
        );
      const isMicroorganismDimension = isMicroorganismDimensionColumn(dimensionColumn?.name, MICROORGANISM_SCHEMA);
      const dimensionCategoryId = getCategoryIdForColumn(dimensionColumn?.name);
      const measureCategoryId = getCategoryIdForColumn(requestedMeasureColumn?.name || primaryMeasureColumn?.name);
      const shouldSplitMultiMeasureChart = hasEntryMultiMeasureChart
        && isSplitComparisonChartTemplate(chartTemplate)
        && !intent.allCategoryComparison;
      const requestedSeriesLabel = hasEntryMultiMeasureChart ? null : (hasExplicitVisualRequests ? requestedMeasureLabel : null);

      const buildMeasureChartComponent = (measure, measureIndex) => {
        const measureLabel = getReadableMeasureLabel(measure?.name);
        const chartDataSource = intent.allCategoryComparison
          ? 'dataset.categoryMetrics'
          : 'dataset.measureByDimension';

        return {
          id: hasEntryMultiMeasureChart && isSplitComparisonChartTemplate(chartTemplate)
            ? `${id}-measure-chart-${componentCounter}-${measureIndex + 1}`
            : `${id}-measure-chart-${componentCounter}`,
          widget: 'chart-widget',
          type: 'chart',
          chart: {
            template: chartTemplate,
            seriesLabel: shouldSplitMultiMeasureChart ? measureLabel : requestedSeriesLabel,
          },
          title: intent.allCategoryComparison
            ? 'Morphology Categories'
            : visualRequest
            ? hasEntryMultiMeasureChart
              ? buildMultiMeasureChartTitle(
                chartTemplate,
                effectiveMeasureColumns,
                primaryEntryMeasureColumn && dimensionLabel
                  ? isMicroorganismDimension
                    ? 'Microorganism Type'
                    : dimensionLabel
                  : null,
                visualRequest?.aggregation || intent.aggregation,
              )
              : buildMeasureChartTitle(
                chartTemplate,
                requestedMeasureColumn?.name || requestedMeasureLabel,
                dimensionLabel
                  ? isMicroorganismDimension
                    ? 'Microorganism Type'
                    : dimensionLabel
                  : null,
                visualRequest?.aggregation || intent.aggregation,
              )
            : shouldSplitMultiMeasureChart
            ? buildMeasureChartTitle(
              chartTemplate,
              measure?.name,
              dimensionLabel
                ? isMicroorganismDimension
                  ? 'Microorganism Type'
                  : dimensionLabel
                : null,
              intent.aggregation,
            )
            : hasEntryMultiMeasureChart
              ? buildMultiMeasureChartTitle(
                chartTemplate,
                effectiveMeasureColumns,
                primaryEntryMeasureColumn && dimensionLabel
                  ? isMicroorganismDimension
                    ? 'Microorganism Type'
                    : dimensionLabel
                  : null,
                intent.aggregation,
              )
              : buildMeasureChartTitle(
                chartTemplate,
                measureColumn?.name,
                measureColumn && dimensionLabel
                  ? isMicroorganismDimension
                    ? 'Microorganism Type'
                    : dimensionLabel
                  : null,
                intent.aggregation,
              ),
          data: {
            source: `${dataSourceRoot}.${chartDataSource.replace('dataset.', '')}`,
            category_id: intent.allCategoryComparison ? null : dimensionCategoryId,
            measure_category_id: intent.allCategoryComparison ? null : (getCategoryIdForColumn(measure?.name) ?? measureCategoryId),
            transform: {
              type: 'collection',
              labelField: 'label',
              valueField: 'value',
              sortBy: intent.allCategoryComparison ? (intent.sortBy ?? 'label') : (intent.sortBy ?? (intent.prefersTrend ? 'label' : 'value')),
              sortDirection: intent.allCategoryComparison ? (intent.sortDirection ?? 'asc') : (intent.sortDirection ?? (intent.prefersTrend ? 'asc' : 'desc')),
              limit: intent.allCategoryComparison ? null : categoryLimit,
              emptyLabel: 'N/A',
              labelMaxLength: 24,
            },
          },
        };
      };

      if (visualRequest) {
        if (shouldSplitMultiMeasureChart) {
          return effectiveMeasureColumns.map((measure, measureIndex) => buildMeasureChartComponent(measure, measureIndex));
        }

        return [buildMeasureChartComponent(primaryEntryMeasureColumn, 0)];
      }

      if (shouldSplitMultiMeasureChart) {
        return effectiveMeasureColumns.map((measure, measureIndex) => buildMeasureChartComponent(measure, measureIndex));
      }

      return [buildMeasureChartComponent(primaryEntryMeasureColumn, 0)];
    }

    if (entry.kind === 'table') {
      componentCounter++;
      const dataSourceRoot = entry.requestIndex !== undefined ? `dataset.request_${entry.requestIndex}` : 'dataset';
      const componentFilters = getComponentFilters(entry, intent);
      const tableDescription = buildTableFilterDescription(componentFilters);
      const requestColumns = Array.isArray(entry.visualRequest?.previewColumns) && entry.visualRequest.previewColumns.length
        ? entry.visualRequest.previewColumns
        : tableColumns;
      
      return [{
        id: `${id}-table-${componentCounter}`,
        widget: 'table-widget',
        type: 'table',
        title: `${getReadableTableLabel(primaryTable.name)} Preview`,
        description: tableDescription,
        data: {
          source: `${dataSourceRoot}.preview`,
          category_ids: requestColumns.map((column) => column.category_id).filter((value) => value !== null),
          transform: {
            type: 'table',
            limit: entry.limit,
            columns: requestColumns,
          },
        },
      }];
    }

    return [];
  });

  return {
    schemaVersion: '1.0',
    id,
    slug: id,
    status: 'draft',
    title: buildDashboardTitle(templateFamily, primaryTable),
    description: buildDashboardDescription(templateFamily, primaryTable, prompt, intent),
    components,
  };
}

function buildBlueprint(templateFamily, intent, capability) {
  // Build blueprint ONLY based on what the prompt explicitly asks for
  let blueprint = [];
  
  const normalizedPrompt = normalizePromptText(intent.normalizedPrompt || '');
  const visualizationRequest = isVisualizationRequest(intent);
  const analyticalQuestion = isAnalyticalQuestion(intent);
  const visualRequests = Array.isArray(intent.visualRequests) ? intent.visualRequests.filter(Boolean) : [];
  
  // CRITICAL: Check if user explicitly requested a specific chart type
  const explicitChartType = detectChartTemplate(normalizedPrompt);
  const isExplicitLineChart = explicitChartType === 'line';
  
  // Detect what the prompt is asking for
  const explicitly_hides_stats = intent.includeStats === false || /\b(charts?\s+only|no\s+stats|no\s+metrics|no\s+kpi)\b/i.test(normalizedPrompt);
  
  // Category chart: ONLY if prompt asks for distribution, grouping, or specific organizational dimension
  // AND user didn't explicitly request a different chart type
  const asksForCategory = /\b(distribution|grouped?|how\s+many|count\s+by|show.*types?|categories?|ranking|rank|top|share|breakdown|compare)\b/i.test(normalizedPrompt)
    || /\bby\s+[a-z0-9][a-z0-9\s]{1,40}\b/i.test(normalizedPrompt)
    || (Array.isArray(intent?.microorganismResolution?.matches) && intent.microorganismResolution.matches.length >= 2);
  const explicitly_hides_category = /\b(no\s+distribution|line\s+chart|trend|over\s+time)\b/i.test(normalizedPrompt);

  // Enforce semantic grain: only allow category charts when the resolved semantic
  // dimension grain is explicitly 'category'. This prevents numeric filters
  // or numeric dimensions from being used as categorical charts.
  const dimensionGrain = intent?.selectedDimension?.grain
    || (intent?.semanticQuery?.dimensionKey ? (resolveDimension(intent.semanticQuery.dimensionKey)?.grain || null) : null);
  const capabilityHasCategory = Boolean(capability?.hasCategoryChart) && (dimensionGrain === 'category' || dimensionGrain === 'temporal');
  const selectedMetricDefinition = resolveMetric(intent?.selectedMetric?.key || intent?.semanticIntent?.metric, MICROORGANISM_SCHEMA);
  const hasQuantitativeMetric = selectedMetricDefinition?.kind === 'quantitative'
    && selectedMetricDefinition.key !== 'count';
  
  // Measure chart: if prompt mentions measures/metrics/comparisons OR explicitly requested line/bar chart
  const asksForMeasure = intent.comparisonQuery
    || intent.allMeasureComparison
    || hasQuantitativeMetric
    || /\b(compare|versus|vs|show.*average|show.*sum|show.*metric|show.*measure|average.*by|trend|line|bar\s+chart|line\s+chart)\b/i.test(normalizedPrompt);
  const explicitly_hides_measure = /\b(no\s+chart|no\s+graph|category\s+chart|distribution\s+only)\b/i.test(normalizedPrompt);
  
  // Table: only if explicitly asked or if prompt says "with table"
  const asksForTable = intent.includeTable === true || /\b(table|rows?|data|preview|record|list|details?|with\s+table)\b/i.test(normalizedPrompt);
  const explicitly_hides_table = intent.includeTable === false || /\b(charts?\s+only|no\s+table|no\s+data|without\s+table)\b/i.test(normalizedPrompt);

  if (visualRequests.length >= 2) {
    blueprint = visualRequests.map((visualRequest, index) => ({
      kind: visualRequest.chartKind || 'measureChart',
      defaultTemplate: visualRequest.chartTemplate || intent.chartTemplate || 'bar-horizontal',
      visualRequest,
      requestIndex: index,
    }));

    if (capability.hasStats && intent.includeStats === true && !explicitly_hides_stats) {
      blueprint.push({ kind: 'stats' });
    }

    const hasScopedTableRequest = visualRequests.some((request) => request.chartKind === 'table');
    if (!hasScopedTableRequest && !explicitly_hides_table && asksForTable && capability.hasTable) {
      blueprint.push({ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 });
    }

    return blueprint;
  }

  // User explicitly requested a line chart - ONLY show measure chart, no category chart
  if (isExplicitLineChart) {
    if (capability.hasMeasureChart) {
      blueprint.push({ kind: 'measureChart', defaultTemplate: 'line' });
    } else if (capability.hasCategoryChart) {
      blueprint.push({ kind: 'categoryChart', defaultTemplate: 'line' });
    }
    if (capability.hasStats && intent.includeStats !== false) {
      blueprint.push({ kind: 'stats' });
    }
    if (capability.hasTable && intent.includeTable === true) {
      blueprint.push({ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 });
    }
    return blueprint;
  }
  
  if (intent.prefersComparisonTable && capability.hasTable && !explicitly_hides_table) {
    return [{ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 }];
  }

  if (isExplicitTableOnlyRequest(intent) && capability.hasTable && !explicitly_hides_table) {
    return [{ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 }];
  }

  const hasMultiMeasure = intent.allMeasureComparison || (intent.comparisonQuery && (intent.comparisonQuery.type === 'comparison' || intent.comparisonQuery.measures?.length >= 2));
  const hasRequestedMeasure = hasQuantitativeMetric || Boolean(intent.comparisonQuery || intent.allMeasureComparison);
  const wantsMeasureVisualization = visualizationRequest || hasQuantitativeMetric || Boolean(intent.comparisonQuery) || Boolean(intent.allMeasureComparison);
  const requestedCharts = [];

  if (visualizationRequest && !hasRequestedMeasure && !explicitly_hides_category && asksForCategory && capabilityHasCategory && !isExplicitLineChart) {
    requestedCharts.push({ kind: 'categoryChart', defaultTemplate: intent.chartTemplate || 'bar-horizontal' });
  }

  if (wantsMeasureVisualization && !explicitly_hides_measure && asksForMeasure && capability.hasMeasureChart) {
    const defaultMeasureTemplate = hasMultiMeasure ? (intent.chartTemplate || 'bar') : (intent.chartTemplate || 'bar-horizontal');
    requestedCharts.push({ kind: 'measureChart', defaultTemplate: defaultMeasureTemplate });
  }

  if (requestedCharts.length > 0) {
    blueprint = requestedCharts;

    if (capability.hasStats && intent.includeStats === true && !explicitly_hides_stats) {
      blueprint.push({ kind: 'stats' });
    }

    if (!explicitly_hides_table && asksForTable && capability.hasTable) {
      blueprint.push({ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 });
    }

    return blueprint;
  }

  if (capability.hasStats && intent.includeStats === true && !explicitly_hides_stats) {
    blueprint.push({ kind: 'stats' });
  }
  
  if (!explicitly_hides_table && (asksForTable || analyticalQuestion) && capability.hasTable) {
    blueprint.push({ kind: 'table', limit: templateFamily === 'compact' ? 10 : 20 });
  }
  
  // If user explicitly requested line chart but we somehow didn't add it, add it now
  if (isExplicitLineChart && !blueprint.some(b => b.kind === 'measureChart')) {
    if (capability.hasMeasureChart) {
      blueprint.push({ kind: 'measureChart', defaultTemplate: 'line' });
    }
  }
  
  // Fallback: if no components detected, show non-visual data rather than inventing a chart.
  if (!blueprint.length) {
    if (capability.hasTable) {
      return [{ kind: 'table', limit: 12 }];
    }
    return [{ kind: 'stats' }];
  }

  return blueprint;
}

function buildStatsFields(measureColumns, aggregation) {
  const fields = [
    { label: 'Total rows', path: 'total_rows', format: 'integer' },
  ];

  const resolvedAggregation = normalizeAggregation(aggregation) || 'avg';

  const measures = Array.isArray(measureColumns) ? measureColumns : (measureColumns ? [measureColumns] : []);

  if (!measures.length) return fields;

  measures.forEach((measure, idx) => {
    const pos = measures.length >= 2 ? idx + 1 : null;
    const measureLabel = getReadableMeasureLabel(measure.name);

    const primaryPath = pos ? `primary_value_${pos}` : 'primary_value';
    const avgPath = pos ? `avg_value_${pos}` : 'avg_value';
    const minPath = pos ? `min_value_${pos}` : 'min_value';
    const maxPath = pos ? `max_value_${pos}` : 'max_value';

    if (resolvedAggregation === 'count') {
      fields.push({ label: `Matching rows (${measureLabel})`, path: primaryPath, format: 'integer' });
    } else if (resolvedAggregation === 'sum') {
      fields.push({ label: `Total ${measureLabel}`, path: primaryPath, format: 'decimal' });
    } else if (resolvedAggregation === 'min') {
      fields.push({ label: `Minimum ${measureLabel}`, path: primaryPath, format: 'decimal' });
    } else if (resolvedAggregation === 'max') {
      fields.push({ label: `Maximum ${measureLabel}`, path: primaryPath, format: 'decimal' });
    } else {
      fields.push({ label: `Average ${measureLabel}`, path: primaryPath, format: 'decimal' });
    }

    if (resolvedAggregation !== 'avg') {
      fields.push({ label: `Average ${measureLabel}`, path: avgPath, format: 'decimal' });
    }

    if (resolvedAggregation !== 'min') {
      fields.push({ label: `Minimum ${measureLabel}`, path: minPath, format: 'decimal' });
    }

    if (resolvedAggregation !== 'max') {
      fields.push({ label: `Maximum ${measureLabel}`, path: maxPath, format: 'decimal' });
    }
  });

  return fields;
}

function buildDashboardTitle(templateFamily, primaryTable) {
  return `${getReadableFamilyLabel(templateFamily)} ${getReadableTableLabel(primaryTable.name)} Dashboard`;
}

function buildDashboardDescription(templateFamily, primaryTable, prompt, intent) {
  const readableTable = getReadableTableLabel(primaryTable.name).toLowerCase();
  const promptText = String(prompt || '').trim();
  const filterSummary = buildFilterSummary(intent?.filters);
  const filterSuffix = filterSummary ? ` Filtered by ${filterSummary}.` : '';

  if (promptText) {
    return `${getReadableFamilyLabel(templateFamily)} view for ${readableTable}, tailored to the current prompt.${filterSuffix}`;
  }

  return `${getReadableFamilyLabel(templateFamily)} view for ${readableTable}.${filterSuffix}`;
}

function getReadableFamilyLabel(templateFamily) {
  if (templateFamily === 'compact') {
    return 'Compact';
  }

  if (templateFamily === 'analytical') {
    return 'Analytical';
  }

  if (templateFamily === 'visual') {
    return 'Visual';
  }

  return 'Balanced';
}

function getChartTitleSuffix(template, fallback = 'Overview') {
  const suffixByTemplate = {
    bar: 'Distribution',
    'bar-horizontal': 'Ranking',
    line: 'Trend',
    doughnut: 'Share',
    polar: 'Spread',
  };

  return suffixByTemplate[template] ?? fallback;
}

function buildCategoryChartTitle(template, subjectLabel) {
  const subject = String(subjectLabel || 'Category').trim() || 'Category';
  return `${subject} ${getChartTitleSuffix(template, 'Distribution')}`;
}

function buildMeasureChartTitle(template, measureColumnName, dimensionLabel, aggregation) {
  const resolvedAggregation = normalizeAggregation(aggregation) || 'avg';
  const dimension = String(dimensionLabel || '').trim();
  const prefixByTemplate = {
    bar: 'Average',
    'bar-horizontal': 'Ranking of',
    line: 'Trend of',
    doughnut: 'Share of',
    polar: 'Spread of',
  };

  if (resolvedAggregation === 'count') {
    if (dimension) {
      return `${dimension} ${getChartTitleSuffix(template, 'Distribution')}`;
    }

    return getChartTitleSuffix(template, 'Overview');
  }

  const measure = getReadableMeasureLabel(measureColumnName);
  const prefixByAggregation = {
    sum: 'Total',
    avg: 'Average',
    min: 'Minimum',
    max: 'Maximum',
  };

  const prefix = prefixByAggregation[resolvedAggregation] ?? prefixByTemplate[template] ?? 'Average';

  if (dimension) {
    return `${prefix} ${measure} by ${dimension}`;
  }

  return `${prefix} ${measure} ${getChartTitleSuffix(template, 'Overview')}`;
}

function buildMultiMeasureChartTitle(template, measureColumns, dimensionLabel, aggregation) {
  const resolvedAggregation = normalizeAggregation(aggregation) || 'avg';
  const measureLabels = (Array.isArray(measureColumns) ? measureColumns : [])
    .map((column) => getReadableMeasureLabel(column.name))
    .filter(Boolean);
  const measureText = formatReadableList(measureLabels) || 'Metrics';
  const dimension = String(dimensionLabel || '').trim();

  if (resolvedAggregation === 'count') {
    return dimension ? `${dimension} ${getChartTitleSuffix(template, 'Distribution')}` : `${measureText} ${getChartTitleSuffix(template, 'Overview')}`;
  }

  if (Array.isArray(measureColumns) && measureColumns.length > 4) {
    return dimension ? `Morphology Categories by ${dimension}` : 'Morphology Categories';
  }

  const prefixByAggregation = {
    sum: 'Total',
    avg: 'Average',
    min: 'Minimum',
    max: 'Maximum',
  };

  const prefix = prefixByAggregation[resolvedAggregation] ?? 'Average';

  return dimension ? `${prefix} ${measureText} by ${dimension}` : `${prefix} ${measureText} ${getChartTitleSuffix(template, 'Overview')}`;
}

function buildChartSummary({ measureColumns, measureColumn, dimensionLabel, isMicroorganismDimension, aggregation, template }) {
  const resolvedMeasures = Array.isArray(measureColumns) && measureColumns.length
    ? measureColumns
    : [measureColumn].filter(Boolean);
  const measureLabels = resolvedMeasures.map((measure) => getReadableMeasureLabel(measure.name)).filter(Boolean);
  const dimension = isMicroorganismDimension
    ? getReadableColumnLabel(MICROORGANISM_SCHEMA.labelColumn).toLowerCase()
    : String(dimensionLabel || '').trim().toLowerCase();
  const aggregationLabel = normalizeAggregation(aggregation) === 'count'
    ? 'distribution of'
    : (normalizeAggregation(aggregation) || 'average');

  if (measureLabels.length >= 2 && dimension) {
    return `This chart compares ${formatReadableList(measureLabels).toLowerCase()} across ${dimension}.`;
  }

  if (measureLabels.length >= 2) {
    return `This chart compares ${formatReadableList(measureLabels).toLowerCase()}.`;
  }

  if (measureLabels.length === 1 && dimension) {
    return `This chart shows ${aggregationLabel} ${measureLabels[0].toLowerCase()} across ${dimension}.`;
  }

  return `This ${getChartTitleSuffix(template, 'overview').toLowerCase()} chart summarizes the selected records.`;
}

function resolveRequestedMeasureColumn(visualRequest, resolvedMeasureColumns, fallbackMeasureColumn) {
  const requestMetric = normalizeColumnKey(
    visualRequest?.semanticMetricKey
      || visualRequest?.metricKey
      || visualRequest?.measureKey
      || visualRequest?.metric
      || '',
  );

  if (requestMetric) {
    const directMatch = (Array.isArray(resolvedMeasureColumns) ? resolvedMeasureColumns : []).find((column) => {
      const columnKey = normalizeColumnKey(column?.name || column?.key || '');
      return columnKey === requestMetric || columnKey.includes(requestMetric) || requestMetric.includes(columnKey);
    });

    if (directMatch) {
      return directMatch;
    }
  }

  return resolvedMeasureColumns?.[0] ?? fallbackMeasureColumn ?? null;
}

function resolveRequestedMeasureColumns(visualRequest, resolvedMeasureColumns, fallbackMeasureColumn) {
  const requestMetricKeys = [
    ...(Array.isArray(visualRequest?.semanticMetricKeys) ? visualRequest.semanticMetricKeys : []),
    visualRequest?.semanticMetricKey,
    visualRequest?.metricKey,
    visualRequest?.measureKey,
    visualRequest?.metric,
  ]
    .map((value) => normalizeColumnKey(value || ''))
    .filter(Boolean)
    .filter((value, index, list) => list.indexOf(value) === index);

  if (!requestMetricKeys.length) {
    return [resolveRequestedMeasureColumn(visualRequest, resolvedMeasureColumns, fallbackMeasureColumn)].filter(Boolean);
  }

  const requestedColumns = (Array.isArray(resolvedMeasureColumns) ? resolvedMeasureColumns : [])
    .filter((column) => {
      const columnKey = normalizeColumnKey(column?.name || column?.key || '');
      return requestMetricKeys.some((metricKey) => columnKey === metricKey || columnKey.includes(metricKey) || metricKey.includes(columnKey));
    })
    .filter(Boolean)
    .filter((column, index, list) => list.findIndex((entry) => normalizeColumnKey(entry?.name || entry?.key || '') === normalizeColumnKey(column?.name || column?.key || '')) === index);

  if (requestedColumns.length) {
    return requestedColumns;
  }

  return [resolveRequestedMeasureColumn(visualRequest, resolvedMeasureColumns, fallbackMeasureColumn)].filter(Boolean);
}

function resolveRequestedChartTemplate(visualRequest, intent, fallbackTemplate) {
  const requestedTemplate = String(visualRequest?.chartTemplate || '').trim();

  if (requestedTemplate && SUPPORTED_CHART_TEMPLATES.includes(requestedTemplate)) {
    return requestedTemplate;
  }

  return resolveChartTemplate(intent, fallbackTemplate);
}

function getComponentFilters(entry, intent) {
  if (entry?.visualRequest && Array.isArray(entry.visualRequest.filters) && entry.visualRequest.filters.length) {
    return entry.visualRequest.filters;
  }

  if (entry?.requestIndex !== undefined && Array.isArray(entry.visualRequest?.filters) && entry.visualRequest.filters.length) {
    return entry.visualRequest.filters;
  }

  const hasExplicitVisualRequests = Array.isArray(intent?.visualRequests) && intent.visualRequests.filter(Boolean).length >= 2;
  if (hasExplicitVisualRequests) {
    return [];
  }

  return Array.isArray(intent?.filters) ? intent.filters : [];
}

function isTwoDoughnutsOneBarLayout(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) return false;

  if (/\bcompare\s+\S+\s+and\s+\S+/i.test(text)) return true;

  return false;
}

function isVisualizationRequest(intent) {
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');

  if (!text) {
    return false;
  }

  if (intent?.chartTemplate) {
    return true;
  }

  return /\b(chart|charts|graph|graphs|plot|plots|visual|visualize|visualise|dashboard|bar|line|doughnut|donut|pie|polar|trend|distribution|ranking|rank|top|compare|comparison|versus|vs|relationship|correlation)\b/i.test(text);
}

function isAnalyticalQuestion(intent) {
  const text = normalizePromptText(intent?.normalizedPrompt || intent?.rawPrompt || '');

  if (!text) {
    return false;
  }

  return /\b(which|what|who|where|when|list|show|find|filter|records?|rows?|microorganisms?|microbes?|samples?|entries|have|has|with|whose)\b/i.test(text)
    || (Array.isArray(intent?.filters) && intent.filters.length > 0);
}

function resolveChartTemplate(intent, fallbackTemplate) {
  if (intent.chartTemplate && SUPPORTED_CHART_TEMPLATES.includes(intent.chartTemplate)) {
    return intent.chartTemplate;
  }

  if (isTwoDoughnutsOneBarLayout(intent.normalizedPrompt)) {
    return fallbackTemplate;
  }

  return fallbackTemplate;
}

function avoidOvercrowdedChartTemplate(template, fallbackTemplate, { seriesCount = 1, categoryLimit = DEFAULT_CATEGORY_LIMIT } = {}) {
  if ((template === 'doughnut' || template === 'polar') && seriesCount > 2) {
    return fallbackTemplate === 'doughnut' || fallbackTemplate === 'polar' ? 'bar' : fallbackTemplate;
  }

  if ((template === 'doughnut' || template === 'polar') && Number(categoryLimit) > 15) {
    return fallbackTemplate === 'doughnut' || fallbackTemplate === 'polar' ? 'bar-horizontal' : fallbackTemplate;
  }

  return template;
}

function shouldUseMeasureValuesForCategoryChart(primaryTable, measureColumn) {
  if (!primaryTable || !measureColumn) {
    return false;
  }

  return normalizeColumnKey(primaryTable.name).includes('count') || normalizeColumnKey(measureColumn.name) === 'count';
}

function formatMeasureSeriesRows(rows, measureColumns) {
  if (!Array.isArray(rows) || !rows.length || !Array.isArray(measureColumns) || measureColumns.length < 2) {
    return rows;
  }

  return rows.map((row) => {
    const series = measureColumns.map((measure, index) => ({
      label: getReadableMeasureLabel(measure.name),
      value: normalizeNumber(row[`value_${index + 1}`]),
    }));

    return {
      label: normalizeName(row.label),
      value: series.reduce((sum, entry) => sum + normalizeNumber(entry.value), 0),
      series,
    };
  });
}

function isSplitComparisonChartTemplate(template) {
  return template === 'doughnut' || template === 'polar';
}

function buildDefinitionId(prompt) {
  const base = toSlug(prompt || 'generated-dashboard') || 'generated-dashboard';
  return `${base}-${Date.now()}`;
}

module.exports = {
  buildDashboardDefinition,
  buildBlueprint,
  buildStatsFields,
  buildDashboardTitle,
  buildDashboardDescription,
  getReadableFamilyLabel,
  getChartTitleSuffix,
  buildCategoryChartTitle,
  buildMeasureChartTitle,
  buildMultiMeasureChartTitle,
  buildChartSummary,
  isTwoDoughnutsOneBarLayout,
  isVisualizationRequest,
  isAnalyticalQuestion,
  resolveChartTemplate,
  avoidOvercrowdedChartTemplate,
  shouldUseMeasureValuesForCategoryChart,
  formatMeasureSeriesRows,
  isSplitComparisonChartTemplate,
  buildDefinitionId,
  TEMPLATE_BLUEPRINTS,
};
