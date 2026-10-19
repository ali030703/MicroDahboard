const { buildFilterSummary, getReadableColumnLabel } = require('./column-resolution.service');
const { clamp } = require('./format.util');

function buildGenerationExplanation({
  requestedTemplateFamily,
  selectedTemplateFamily,
  intent,
  primaryTable,
  dimensionColumn,
  measureColumn,
  categoryLimit,
  blueprint,
  sessionMode,
  usedPreviousSessionIntent,
  sourceType,
  sourcePath,
}) {
  const filterSummary = buildFilterSummary(intent.filters);
  const adaptationRules = [
    'Schema introspection: tables and columns are detected dynamically from the provided database.',
    `Selected template family: ${selectedTemplateFamily}.`,
    `Selected primary table: ${primaryTable.name}.`,
  ];

  if (sourceType === 'json') {
    adaptationRules.push(`JSON database definition loaded from ${sourcePath}.`);
  }

  if (sourceType === 'sql') {
    adaptationRules.push(`SQL script executed from ${sourcePath} into a temporary SQLite database.`);
  }

  if (requestedTemplateFamily) {
    adaptationRules.push(`Template family forced by the request: ${requestedTemplateFamily}.`);
  }

  if (intent.requestedFamily && !requestedTemplateFamily) {
    adaptationRules.push(`Template family inferred from the prompt: ${intent.requestedFamily}.`);
  }

  if (intent.chartTemplate) {
    adaptationRules.push(`Chart template inferred from the prompt: ${intent.chartTemplate}.`);
  }

  if (intent.topLimit) {
    adaptationRules.push(`Top-N limit inferred from the prompt: ${intent.topLimit}.`);
  }

  if (intent.aggregation) {
    adaptationRules.push(`Aggregation selected for grouped data: ${intent.aggregation}.`);
  }

  if (filterSummary) {
    adaptationRules.push(`Filter clauses applied to the selected table: ${filterSummary}.`);
  }

  if (intent.includeTable === false) {
    adaptationRules.push('The prompt requests hiding the table.');
  }

  if (intent.includeStats === false) {
    adaptationRules.push('The prompt requests hiding KPI/stats.');
  }

  if (sessionMode === 'incremental') {
    adaptationRules.push('Incremental mode enabled: previous session state is reused when fields are not explicitly overridden.');
  }

  if (usedPreviousSessionIntent) {
    adaptationRules.push('Intent fields not present in the current prompt were inherited from the previous turn.');
  }

  const promptConfidence = buildPromptConfidence({
    intent,
    dimensionColumn,
    measureColumn,
    categoryLimit,
    usedPreviousSessionIntent,
  });

  return {
    strategyVersion: '4.0-deterministic-parser',
    selectedTemplateFamily,
    requestedTemplateFamily: requestedTemplateFamily ?? null,
    promptConfidence,
    promptIntent: {
      rawPrompt: intent.rawPrompt,
      chartTemplate: intent.chartTemplate,
      visualRequests: intent.visualRequests ?? [],
      topLimit: intent.topLimit,
      includeTable: intent.includeTable,
      includeStats: intent.includeStats,
      prefersTrend: intent.prefersTrend,
      mentionedTables: intent.mentionedTables,
      mentionedColumns: intent.mentionedColumns,
      selectedEntity: intent.selectedEntity?.key ?? intent.semanticIntent?.entity ?? null,
      selectedDimension: intent.selectedDimension?.key ?? intent.semanticIntent?.dimension ?? null,
      selectedMetric: intent.selectedMetric?.key ?? intent.semanticIntent?.metric ?? null,
      allCategoryComparison: Boolean(intent.allCategoryComparison),
      allMeasureComparison: Boolean(intent.allMeasureComparison),
      microorganismResolution: intent.microorganismResolution ?? null,
      aggregation: intent.aggregation ?? null,
      filters: intent.filters ?? [],
      sortBy: intent.sortBy ?? null,
      sortDirection: intent.sortDirection ?? null,
    },
    selectedDataBindings: {
      table: primaryTable.name,
      dimensionColumn: dimensionColumn?.name ?? null,
      measureColumn: measureColumn?.name ?? null,
      aggregation: intent.aggregation ?? null,
      categoryLimit,
      filters: intent.filters ?? [],
    },
    renderedComponentKinds: blueprint.map((entry) => entry.kind),
    adaptationRules,
    howToChangeDashboard: [
      'Use templateFamily=compact|balanced|analytical|visual to control the base layout.',
      'Use "top N" in the request to limit records in aggregated charts.',
      'Use "line", "bar", "doughnut", or "polar" in the request to set the chart type.',
      'Use "without table" or "charts only" in the request to simplify the dashboard.',
      'Add table, metric, or filter terms to refine data extraction.',
      'Ask for count, sum, average, minimum, or maximum to change the aggregation used for grouped data.',
      'Use the same sessionId with mode="incremental" to continue from previous versions.',
    ],
  };
}

function buildPromptConfidence({
  intent,
  dimensionColumn,
  measureColumn,
  categoryLimit,
  usedPreviousSessionIntent,
}) {
  let score = 0.35;
  const positiveSignals = [];
  const uncertaintySignals = [];

  const mentionedColumnsCount = Array.isArray(intent?.mentionedColumns) ? intent.mentionedColumns.length : 0;
  const filtersCount = Array.isArray(intent?.filters) ? intent.filters.length : 0;
  const hasSelectedMetric = Boolean(intent?.selectedMetric?.key && intent.selectedMetric.key !== 'count');
  const hasSemanticMetric = Boolean(intent?.semanticIntent?.metric && intent.semanticIntent.metric !== 'count');
  const hasExplicitMetric = hasSelectedMetric || hasSemanticMetric || mentionedColumnsCount > 0;
  const hasExplicitView = Boolean(intent?.chartTemplate || intent?.includeTable !== null || intent?.includeStats !== null);
  const hasExplicitLimit = Boolean(intent?.topLimit);
  const hasExplicitAggregation = Boolean(intent?.aggregation);
  const hasExplicitSort = Boolean(intent?.sortDirection || intent?.sortBy);
  const hasComparison = Boolean(intent?.comparisonQuery || intent?.allCategoryComparison || intent?.allMeasureComparison);
  const hasBiologicalConcept = Boolean(intent?.microbeConcept || (Array.isArray(intent?.biologicalConcepts) && intent.biologicalConcepts.length));

  if (hasExplicitMetric) {
    score += 0.22;
    positiveSignals.push('Matched a dataset field or metric.');
  } else if (measureColumn) {
    score += 0.08;
    uncertaintySignals.push('Metric was inferred from defaults.');
  } else {
    uncertaintySignals.push('No explicit metric was detected.');
  }

  if (dimensionColumn) {
    score += 0.12;
    positiveSignals.push('Resolved a grouping dimension.');
  } else {
    uncertaintySignals.push('No grouping dimension was explicit.');
  }

  if (hasExplicitView) {
    score += 0.1;
    positiveSignals.push('Matched the requested output type.');
  }

  if (filtersCount > 0) {
    score += 0.12;
    positiveSignals.push('Applied explicit filter criteria.');
  }

  if (hasExplicitLimit) {
    score += 0.06;
    positiveSignals.push(`Applied top-${categoryLimit} limit.`);
  }

  if (hasExplicitAggregation) {
    score += 0.06;
    positiveSignals.push(`Resolved ${intent.aggregation} aggregation.`);
  }

  if (hasExplicitSort) {
    score += 0.05;
    positiveSignals.push('Resolved sort order.');
  }

  if (hasComparison) {
    score += 0.08;
    positiveSignals.push('Resolved comparison intent.');
  }

  if (hasBiologicalConcept) {
    score += 0.05;
    positiveSignals.push('Matched microorganism context.');
  }

  if (usedPreviousSessionIntent) {
    score -= 0.1;
    uncertaintySignals.push('Some intent fields came from the previous request.');
  }

  if (!hasExplicitMetric && !filtersCount && !hasComparison) {
    score -= 0.12;
    uncertaintySignals.push('Request was broad, so defaults were used.');
  }

  const normalizedScore = clampConfidenceScore(score);

  return {
    score: normalizedScore,
    percentage: Math.round(normalizedScore * 100),
    label: normalizedScore >= 0.78 ? 'High' : normalizedScore >= 0.55 ? 'Medium' : 'Low',
    positiveSignals,
    uncertaintySignals,
  };
}

function clampConfidenceScore(score) {
  return Math.max(0.05, Math.min(0.98, Number(score.toFixed(2))));
}

module.exports = {
  buildGenerationExplanation,
  buildPromptConfidence,
  clampConfidenceScore,
};
