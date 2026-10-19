const { getReadableTableLabel } = require('./column-resolution.service');
const { normalizePromptText, buildPromptTokenSet } = require('./prompt-text.util');
const { collectSemanticMetricKeysFromPrompt } = require('./prompt-intent-parser.service');
const { promptMentionsCatalogEntry } = require('./semantic-catalog-matcher.service');
const { normalizeColumnKey, looksTemporal } = require('../dashboard-schema-profile.service');
const { buildPromptHelpFromCatalog, buildSemanticCatalog } = require('../dashboard-semantic-catalog.service');

function createAmbiguousMicroorganismPromptError(resolution, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const firstAmbiguous = resolution?.ambiguous?.[0];
  const candidateNames = (firstAmbiguous?.candidates || [])
    .map((candidate) => candidate.name)
    .filter(Boolean);
  const error = new Error('The microorganism name matches multiple values in the selected database.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    ...catalogHelp,
    title: 'Need more detail',
    message: candidateNames.length
      ? `The microorganism "${firstAmbiguous.phrase}" is ambiguous. Choose one of: ${candidateNames.join(', ')}.`
      : 'The microorganism name is ambiguous. Choose a more specific microorganism before generating the dashboard.',
    candidates: firstAmbiguous?.candidates || [],
  };
  return error;
}

function createCircularMicroorganismGroupingError(intent, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const microorganismName = intent?.microorganismResolution?.matches?.[0]?.name || 'the selected microorganism';
  const error = new Error('The request filters and groups by the same microorganism field.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    ...catalogHelp,
    title: 'Need more detail',
    message: `Filtering to ${microorganismName} and grouping by microorganism would only show that same microorganism. Add a metric such as area, solidity, perimeter, radius, or prevalence, or compare it with another microorganism.`,
    suggestions: [
      `Show a metric for ${microorganismName}: area, solidity, perimeter, radius, or another available metric.`,
      `Compare ${microorganismName} with another microorganism.`,
      'Group by a different category if the database provides one.',
    ],
    examples: [
      `show average area for ${microorganismName}`,
      `compare ${microorganismName} and another microorganism`,
      `show solidity for ${microorganismName}`,
    ],
  };
  return error;
}

function createSingleMicroorganismChartError(intent, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const microorganismName = intent?.microorganismResolution?.matches?.[0]?.name || 'the selected microorganism';
  const requestedChart = intent?.chartTemplate ? `${intent.chartTemplate} chart` : 'visual chart';
  const error = new Error('The request would create a chart with only one useful data point.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    ...catalogHelp,
    title: 'Need more detail',
    message: `A ${requestedChart} for only ${microorganismName} would likely show a single data point. Add a metric, category, time field, or another microorganism so the chart can show a real comparison.`,
    suggestions: [
      `Compare ${microorganismName} with another microorganism.`,
      `Show ${microorganismName} over time if the database has a date or year field.`,
      `Add a metric such as area, solidity, perimeter, radius, or prevalence.`,
      `Use a table with all properties or specific fields if you want to inspect records for ${microorganismName}.`,
    ],
    examples: [
      `compare ${microorganismName} and another microorganism line chart`,
      `show bar chart of ${microorganismName} by area`,
      `show ${microorganismName} table with all properties`,
    ],
  };
  return error;
}

function createSingleMicroorganismTableError(intent, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const microorganismName = intent?.microorganismResolution?.matches?.[0]?.name || 'the selected microorganism';
  const error = new Error('The request would create a table with too little useful detail.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    ...catalogHelp,
    title: 'Need more detail',
    message: `For ${microorganismName}, ask for all properties or choose fields such as area and perimeter.`,
    suggestions: [
      `Use: show ${microorganismName} table with all properties.`,
      `Or choose fields: area, perimeter, contamination rate, prevalence.`,
      `Compare ${microorganismName} with another microorganism.`,
    ],
    examples: [
      `show ${microorganismName} table with all properties`,
      `show ${microorganismName} table with area and perimeter`,
      `show ${microorganismName} table with contamination rate and prevalence`,
      `compare ${microorganismName} and another microorganism table`,
    ],
  };
  return error;
}

function validateDashboardPrompt(prompt) {
  const normalized = normalizePromptText(prompt);

  if (!normalized) {
    throw createInvalidPromptError();
  }

  const meaningfulTokens = buildPromptTokenSet(normalized);
  const hasKnownMetric = collectSemanticMetricKeysFromPrompt(normalized, meaningfulTokens).length > 0;
  const hasKnownIntent = /\b(show|compare|plot|chart|dashboard|table|distribution|top|filter|records|microorganisms|categories|all|analy[sz]e|summary|summari[sz]e|describe|dataset|data|patterns?|insights?|report|overall|outliers?|anomal(?:y|ies)|cluster|groups?|structure|morpholog(?:y|ical)|features?)\b/i.test(normalized);

  if (isUnderspecifiedChartRequest(normalized, hasKnownMetric)) {
    throw createUnderspecifiedChartPromptError();
  }
}

function isUnderspecifiedChartRequest(normalizedPrompt, hasKnownMetric) {
  if (hasKnownMetric) {
    return false;
  }

  const asksForChart = /\b(?:chart|graph|plot|bar|line|doughnut|donut|polar|visuali[sz]ation)\b/i.test(normalizedPrompt);

  if (!asksForChart) {
    return false;
  }

  const hasProbableNamedChartTarget = asksForChart
    && normalizedPrompt
      .split(/\s+/)
      .map((token) => token.replace(/[^a-z0-9]/gi, '').toLowerCase())
      .filter(Boolean)
      .some((token) => token.length >= 4 && ![
        'show',
        'create',
        'generate',
        'plot',
        'chart',
        'graph',
        'plot',
        'bar',
        'line',
        'doughnut',
        'donut',
        'pie',
        'polar',
        'radar',
        'trend',
        'time',
        'series',
        'dashboard',
        'data',
        'morphology',
        'morphological',
        'comparison',
        'compare',
        'features',
        'categories',
      ].includes(token));

  if (hasProbableNamedChartTarget) {
    return false;
  }

  const hasDataTarget = /\b(?:microorganisms?|microbes?|organisms?|fungi|fungal|yeast|categories?|records?|rows?|samples?|dataset|data|table|distribution|breakdown|ranking|rank|top|filter|where|between|above|below|over|under|greater|less|area|radius|perimeter|solidity|eccentricity|metric|measure|count|average|avg|sum|min|max|country|countries|pathogens?|species|prevalence|contamination|resistance|positive)\b/i.test(normalizedPrompt)
    || /\bby\s+[a-z0-9][a-z0-9\s]{1,40}\b/i.test(normalizedPrompt)
    || /\bcompare\b.+\band\b/i.test(normalizedPrompt);

  return !hasDataTarget;
}

function semanticCatalogHasTerm(semanticCatalog, term) {
  const normalizedTerm = normalizeColumnKey(term);

  if (!normalizedTerm) {
    return false;
  }

  const entries = [
    ...(Array.isArray(semanticCatalog?.metrics) ? semanticCatalog.metrics : []),
    ...(Array.isArray(semanticCatalog?.dimensions) ? semanticCatalog.dimensions : []),
  ];

  return entries.some((entry) => {
    const values = [
      entry?.key,
      entry?.column,
      entry?.label,
      ...(Array.isArray(entry?.aliases) ? entry.aliases : []),
    ]
      .map((value) => normalizeColumnKey(value))
      .filter(Boolean);

    return values.some((value) => value === normalizedTerm
      || value.includes(normalizedTerm)
      || (value.length >= 4 && normalizedTerm.includes(value)));
  });
}

function schemaProfilesHaveTemporalColumn(schemaProfiles) {
  return (Array.isArray(schemaProfiles) ? schemaProfiles : []).some((table) => {
    if (Array.isArray(table?.temporalColumns) && table.temporalColumns.length > 0) {
      return true;
    }

    return (Array.isArray(table?.columns) ? table.columns : []).some((column) => looksTemporal(column?.type, column?.name));
  });
}

function collectUnavailablePromptRequirements({ normalizedPrompt, schemaProfiles, semanticCatalog }) {
  const missing = [];

  function addMissing(label) {
    if (!missing.includes(label)) {
      missing.push(label);
    }
  }

  function requireCatalogTerm(label, pattern, ...terms) {
    if (!pattern.test(normalizedPrompt)) {
      return;
    }

    const hasCatalogMatch = terms.some((term) => semanticCatalogHasTerm(semanticCatalog, term));

    if (!hasCatalogMatch) {
      addMissing(label);
    }
  }

  if (/\b(?:trend|trends|over time|time series|yearly|annual|by month|month|months|year|years|date|dates|20\d{2}|19\d{2}|18\d{2})\b/i.test(normalizedPrompt)
    && !schemaProfilesHaveTemporalColumn(schemaProfiles)) {
    addMissing('date or time');
  }

  requireCatalogTerm('antibiotic', /\bantibiotics?\b/i, 'antibiotic');
  requireCatalogTerm('resistance', /\bresistan(?:ce|t)\b/i, 'resistance', 'resistance rate');
  requireCatalogTerm('prevalence', /\bprevalence\b/i, 'prevalence', 'prevalence rate');
  requireCatalogTerm('contamination', /\bcontamination|contaminated|contaminants?\b/i, 'contamination', 'contamination rate');
  requireCatalogTerm('country', /\bcountr(?:y|ies)\b/i, 'country', 'country name');
  requireCatalogTerm('food category', /\bfood\s+categor(?:y|ies)\b/i, 'food category');
  requireCatalogTerm('product type', /\bproduct\s+types?\b/i, 'product type', 'product');
  requireCatalogTerm('food/product group', /\bmeat|dairy\b/i, 'food category', 'product type', 'product', 'food');
  requireCatalogTerm('pathogen', /\bpathogens?\b/i, 'pathogen', 'microorganism');
  requireCatalogTerm('positive samples', /\b(?:positive\s+samples?|percent\s+positive|positive\s+rate)\b/i, 'positive samples', 'percent positive', 'positive rate', 'result');
  requireCatalogTerm('risk', /\brisk\b/i, 'risk', 'risk score');

  if (/\b(?:unknown|nonexistent|fake|empty|no data)\b/i.test(normalizedPrompt)) {
    addMissing('valid filter value');
  }

  return missing;
}

function assertPromptRequirementsAvailable({ normalizedPrompt, schemaProfiles, semanticCatalog }) {
  const unavailableRequirements = collectUnavailablePromptRequirements({
    normalizedPrompt,
    schemaProfiles,
    semanticCatalog,
  });

  if (unavailableRequirements.length > 0) {
    throw createUnavailablePromptRequirementsError(unavailableRequirements, semanticCatalog);
  }
}

async function quickDiagnosis(db, intent, primaryTable, dimensionColumn) {
  if (dimensionColumn?.name !== intent?.filters?.[0]?.column) {
    return;
  }
}

async function ensureCategoryMapsLoaded() {
  return;
}

function createUnavailablePromptRequirementsError(requirements, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const fieldText = requirements.join(', ');
  const error = new Error('The request references fields or values that are not available in the selected database.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    ...catalogHelp,
    title: 'Need more detail',
    message: `This database does not expose ${fieldText}. Add an available dataset field or choose one of the detected fields before generating the dashboard.`,
  };
  return error;
}

function createInvalidPromptError() {
  const error = new Error('The request was not specific enough to generate a dashboard.');
  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    title: 'Clarify the analysis request',
    message: 'Specify at least one dataset field, such as a metric or category. You can also include an optional chart type, top-N limit, filter, or sort order.',
    suggestions: [
      'Choose a view type: table, dashboard, bar chart, line chart, doughnut chart, or polar chart.',
      'Add a metric or category: area, solidity, radius, perimeter, eccentricity, filled area, convex area, or microorganism.',
      'Add a limit: top 5, top 10, top 12, or another top-N value.',
      'Add a filter or sort order: between 7 and 10, above 5, below 3, ascending, or descending.',
    ],
    examples: [
      'show a dashboard of microorganism categories by area',
      'plot the top 10 records by area',
      'compare average radius and perimeter by microorganism',
      'show records with solidity between 7 and 10',
    ],
  };
  return error;
}

function createUnderspecifiedChartPromptError() {
  const error = new Error('The chart request is missing a data target.');
  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    title: 'Specify what the chart should show',
    message: 'The chart type is clear, but the renderer also needs at least one dataset field, such as a metric or category.',
    suggestions: [
      'Add a metric or category: area, solidity, radius, perimeter, eccentricity, filled area, convex area, or microorganism.',
      'Add a limit: top 5, top 10, top 12, or another top-N value.',
      'Add a filter or sort order: between 7 and 10, above 5, below 3, ascending, or descending.',
      'Use a supported view type: bar chart, line chart, doughnut chart, polar chart, table, or dashboard.',
    ],
    examples: [
      'generate a line chart of average area by microorganism',
      'show a bar chart of microorganism categories',
      'plot the top 10 records by radius',
      'generate a line chart of solidity between 7 and 10',
    ],
  };
  return error;
}

function createLowConfidencePromptError(promptConfidence, semanticCatalog) {
  const catalogHelp = buildPromptHelpFromCatalog(semanticCatalog);
  const error = new Error('The request is too broad to generate a reliable dashboard.');
  error.code = 'INVALID_PROMPT';
  error.promptHelp = {
    title: 'Clarify what you want to view',
    message: catalogHelp.message.replace('Clarify what you want to view. ', 'Your request is too broad to generate a reliable dashboard. '),
    suggestions: catalogHelp.suggestions,
    examples: catalogHelp.examples,
    confidence: promptConfidence,
  };
  return error;
}

module.exports = {
  createAmbiguousMicroorganismPromptError,
  createCircularMicroorganismGroupingError,
  createSingleMicroorganismChartError,
  createSingleMicroorganismTableError,
  validateDashboardPrompt,
  isUnderspecifiedChartRequest,
  semanticCatalogHasTerm,
  schemaProfilesHaveTemporalColumn,
  collectUnavailablePromptRequirements,
  assertPromptRequirementsAvailable,
  quickDiagnosis,
  ensureCategoryMapsLoaded,
  createUnavailablePromptRequirementsError,
  createInvalidPromptError,
  createUnderspecifiedChartPromptError,
  createLowConfidencePromptError,
};
