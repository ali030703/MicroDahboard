// Purpose: Validates chatbot-supplied dashboard payloads and returns frontend-renderable responses.
const { validateDashboardDefinition } = require('./dashboard-definition.service');
const { recordDashboardSessionTurn } = require('./dashboard-session.service');
const { buildPromptHelpFromCatalog } = require('./dashboard-semantic-catalog.service');

const LOW_CONFIDENCE_THRESHOLD = 0.55;

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function createInvalidDashboardPayloadError(message, details = {}) {
  const error = new Error(message);

  error.code = 'INVALID_DASHBOARD_PAYLOAD';
  error.details = details;
  return error;
}

function resolvePath(target, path) {
  if (!path) {
    return target;
  }

  return String(path).split('.').reduce((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[segment];
  }, target);
}

function normalizeDatasets(value) {
  if (!isObject(value)) {
    throw createInvalidDashboardPayloadError('datasets must be an object shaped like { dataset: { ... } }.', {
      field: 'datasets',
    });
  }

  if (isObject(value.dataset)) {
    return clone(value);
  }

  return {
    dataset: clone(value),
  };
}

function normalizeConfidenceScore(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numeric = Number(value);

  if (!Number.isFinite(numeric)) {
    return null;
  }

  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, normalized));
}

function buildConfidenceMetadata(confidenceScore) {
  if (confidenceScore === null) {
    return undefined;
  }

  return {
    score: Number(confidenceScore.toFixed(2)),
    percentage: Math.round(confidenceScore * 100),
    label: confidenceScore >= 0.78 ? 'High' : confidenceScore >= LOW_CONFIDENCE_THRESHOLD ? 'Medium' : 'Low',
    positiveSignals: confidenceScore >= LOW_CONFIDENCE_THRESHOLD ? ['Chatbot supplied a render-ready dashboard payload.'] : [],
    uncertaintySignals: confidenceScore < LOW_CONFIDENCE_THRESHOLD ? ['Chatbot confidence was below the dashboard rendering threshold.'] : [],
  };
}

function createLowConfidenceRenderError(confidenceScore, semanticCatalog) {
  const confidence = buildConfidenceMetadata(confidenceScore);
  const promptHelp = {
    ...buildPromptHelpFromCatalog(semanticCatalog),
    title: 'Clarify what you want to view',
    message: 'Clarify what you want to view. Your request is too broad to generate a reliable dashboard. Add at least one dataset field, such as area, solidity, radius, perimeter, eccentricity, filled area, convex area, or microorganism.',
    confidence,
  };
  const error = new Error('The chatbot request is too broad to render a reliable dashboard.');

  error.code = 'INVALID_PROMPT';
  error.promptHelp = promptHelp;
  return error;
}

function assertSourceExists({ datasets, component }) {
  const source = component?.data?.source;
  const resolved = resolvePath(datasets, source);

  if (resolved === undefined) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component?.id || 'unknown'}" references missing dataset source "${source}".`, {
      componentId: component?.id || null,
      source,
    });
  }

  return resolved;
}

function assertCollectionTransform(source, component) {
  const transform = component.data.transform;

  if (transform.type !== 'collection') {
    return;
  }

  if (!Array.isArray(source)) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects "${component.data.source}" to be an array.`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  if (!source.length) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" cannot render an empty collection from "${component.data.source}".`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  const firstObjectRow = source.find((row) => isObject(row));

  if (!firstObjectRow) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects object rows in "${component.data.source}".`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  for (const field of [transform.labelField, transform.valueField]) {
    if (!(field in firstObjectRow)) {
      throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects field "${field}" in "${component.data.source}".`, {
        componentId: component.id,
        source: component.data.source,
        field,
      });
    }
  }
}

function assertKeyValueTransform(source, component) {
  const transform = component.data.transform;

  if (transform.type !== 'keyValue') {
    return;
  }

  if (!isObject(source)) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects "${component.data.source}" to be an object.`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  for (const field of transform.fields || []) {
    if (resolvePath(source, field.path) === undefined) {
      throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects key-value path "${field.path}" in "${component.data.source}".`, {
        componentId: component.id,
        source: component.data.source,
        path: field.path,
      });
    }
  }
}

function assertTableTransform(source, component) {
  const transform = component.data.transform;

  if (transform.type !== 'table') {
    return;
  }

  if (!Array.isArray(source)) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects "${component.data.source}" to be an array.`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  if (!source.length || !Array.isArray(transform.columns)) {
    return;
  }

  const firstObjectRow = source.find((row) => isObject(row));

  if (!firstObjectRow) {
    throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects object rows in "${component.data.source}".`, {
      componentId: component.id,
      source: component.data.source,
      transformType: transform.type,
    });
  }

  for (const column of transform.columns) {
    if (column?.key && !(column.key in firstObjectRow)) {
      throw createInvalidDashboardPayloadError(`Dashboard component "${component.id}" expects table column "${column.key}" in "${component.data.source}".`, {
        componentId: component.id,
        source: component.data.source,
        column: column.key,
      });
    }
  }
}

function validateDatasetBindings(dashboardDefinition, datasets) {
  for (const component of dashboardDefinition.components || []) {
    const source = assertSourceExists({ datasets, component });

    assertCollectionTransform(source, component);
    assertKeyValueTransform(source, component);
    assertTableTransform(source, component);
  }
}

function inferSelectedTemplateFamily(metadata) {
  const candidate = String(metadata?.selectedTemplateFamily || metadata?.templateFamily || '').trim().toLowerCase();

  return ['compact', 'balanced', 'analytical', 'visual'].includes(candidate) ? candidate : 'balanced';
}

function buildRenderMetadata({ dashboardDefinition, metadata, confidenceScore }) {
  const selectedTemplateFamily = inferSelectedTemplateFamily(metadata);
  const renderedComponentKinds = (dashboardDefinition.components || []).map((component) => component.type);
  const promptConfidence = buildConfidenceMetadata(confidenceScore);

  return {
    databasePath: '',
    sourceType: metadata?.source || 'chatbot',
    sourcePath: null,
    databaseDefinition: null,
    selectedTable: metadata?.selectedTable || 'chatbot payload',
    resolvedTable: metadata?.resolvedTable || metadata?.selectedTable || 'chatbot payload',
    selectedTemplateFamily,
    executedQueries: {},
    schema: [],
    semanticCatalog: metadata?.semanticCatalog || null,
    warnings: Array.isArray(metadata?.warnings) ? metadata.warnings : [],
    validated: true,
    generation: {
      strategyVersion: 'chatbot-render-contract-v1',
      selectedTemplateFamily,
      requestedTemplateFamily: null,
      ...(promptConfidence ? { promptConfidence } : {}),
      promptIntent: {
        rawPrompt: String(metadata?.prompt || ''),
        chartTemplate: null,
        topLimit: null,
        includeTable: null,
        includeStats: null,
        prefersTrend: false,
        mentionedTables: [],
        mentionedColumns: [],
      },
      selectedDataBindings: {
        table: metadata?.selectedTable || 'chatbot payload',
        dimensionColumn: null,
        measureColumn: null,
        aggregation: null,
        categoryLimit: 0,
        filters: [],
      },
      renderedComponentKinds,
      adaptationRules: ['Validated chatbot-supplied dashboard definition and datasets.'],
      howToChangeDashboard: [
        'Send dashboardDefinition and datasets using the dashboard render contract.',
        'Make every component data.source point to an existing datasets path.',
        'Include confidenceScore when the chatbot wants the backend to apply clarification safety.',
      ],
    },
  };
}

async function renderDashboardPayload({
  dashboardDefinition,
  datasets,
  metadata = {},
  sessionId,
} = {}) {
  const confidenceScore = normalizeConfidenceScore(metadata?.confidenceScore);

  if (confidenceScore !== null && confidenceScore < LOW_CONFIDENCE_THRESHOLD) {
    throw createLowConfidenceRenderError(confidenceScore, metadata?.semanticCatalog);
  }

  const normalizedDatasets = normalizeDatasets(datasets);
  const { definition } = await validateDashboardDefinition(dashboardDefinition);

  validateDatasetBindings(definition, normalizedDatasets);

  const responsePayload = {
    dashboardDefinition: definition,
    datasets: normalizedDatasets,
    metadata: buildRenderMetadata({
      dashboardDefinition: definition,
      metadata: isObject(metadata) ? metadata : {},
      confidenceScore,
    }),
  };

  if (!sessionId) {
    return clone(responsePayload);
  }

  const sessionRecord = await recordDashboardSessionTurn({
    sessionId,
    prompt: metadata?.prompt || definition.title || 'Chatbot dashboard payload',
    requestedTemplateFamily: responsePayload.metadata.selectedTemplateFamily,
    requestedDatabasePath: 'chatbot-payload',
    mode: 'stateless',
    response: responsePayload,
  });

  return clone(sessionRecord.response);
}

module.exports = {
  LOW_CONFIDENCE_THRESHOLD,
  createInvalidDashboardPayloadError,
  renderDashboardPayload,
  validateDatasetBindings,
};
