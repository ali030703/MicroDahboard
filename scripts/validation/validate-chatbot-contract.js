// Purpose: Validates chatbot-facing dashboard generation response shape and session behavior.
const path = require('path');
const { generateDashboardFromPrompt } = require('../../backend/src/services/dashboard-generation.service');
const { renderDashboardPayload } = require('../../backend/src/services/dashboard-render.service');
const { buildDashboardSemanticCatalogResponse } = require('../../backend/src/services/dashboard-semantic-catalog-api.service');

const databasePath = path.join(__dirname, '..', '..', 'backend', 'sql', 'microbes.db');

const smokeCases = [
  {
    prompt: 'Show species distribution',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(['species', 'microorganism'].includes(intent.selectedDimension), 'expected species/microorganism dimension');
    },
  },
  {
    prompt: 'Compare Area and Perimeter',
    expect: ({ response, seriesCount }) => {
      assertHasContract(response);
      assert(seriesCount >= 2, 'expected multi-series Area/Perimeter data');
    },
  },
  {
    prompt: 'Show all',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(intent.allCategoryComparison === false, 'must not use morphology category rows');
      assert(response.datasets.dataset.categoryMetrics.length === 0, 'must not emit morphology category metrics');
      assert(response.datasets.dataset.categoryCounts.length > 0, 'expected microorganism count data');
    },
  },
  {
    prompt: 'Show all categories',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(intent.allCategoryComparison === false, 'must not use morphology category rows');
      assert(response.datasets.dataset.categoryMetrics.length === 0, 'must not emit morphology category metrics');
      assert(response.datasets.dataset.categoryCounts.length > 0, 'expected microorganism count data');
    },
  },
  {
    prompt: 'Show polar comparison of perimeter',
    expect: ({ response, intent, seriesCount }) => {
      assertHasContract(response);
      assert(intent.selectedMetric === 'perimeter', 'expected perimeter as selected metric');
      assert(intent.allMeasureComparison === false, 'perimeter polar prompt must stay single-metric');
      assert(seriesCount === 0, 'expected no expanded all-feature series');
      assert(hasChartTemplate(response, 'polar'), 'expected polar chart');
    },
  },
  {
    prompt: 'Show polar comparison of all categories',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(intent.allCategoryComparison === false, 'must not use morphology category rows');
      assert(response.datasets.dataset.categoryMetrics.length === 0, 'must not emit morphology category metrics');
      assert(response.datasets.dataset.categoryCounts.length > 0, 'expected microorganism count data');
      assert(hasChartTemplate(response, 'polar'), 'expected polar chart');
    },
  },
  {
    prompt: 'Show microorganisms with Solidity > 0.8',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(intent.selectedMetric === 'count', 'filter-only prompt should resolve to count');
      assert(hasFilter(intent, 'Solidity', '>'), 'expected Solidity > filter');
      assert(!String(response.metadata.executedQueries.stats || '').includes('AVG("microorganisms")'), 'must not average label column');
    },
  },
  {
    prompt: 'Show Area where Solidity > 0.8',
    expect: ({ response, intent }) => {
      assertHasContract(response);
      assert(intent.selectedMetric === 'area', 'expected Area as selected metric');
      assert(hasFilter(intent, 'Solidity', '>'), 'expected Solidity > filter');
      assert(String(response.metadata.executedQueries.measureByDimension || '').includes('AVG("microbes"."Area") AS value'), 'expected Area measure query');
    },
  },
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assertHasContract(response) {
  assert(response && typeof response === 'object', 'response must be an object');
  assert(response.dashboardDefinition && typeof response.dashboardDefinition === 'object', 'missing dashboardDefinition');
  assert(response.datasets?.dataset && typeof response.datasets.dataset === 'object', 'missing datasets.dataset');
  assert(response.metadata && typeof response.metadata === 'object', 'missing metadata');
  assert(response.metadata.resolvedTable || response.metadata.selectedTable, 'missing resolved table metadata');
  assert(response.metadata.generation?.promptIntent, 'missing generation.promptIntent metadata');
}

function getIntent(response) {
  return response.metadata.generation.promptIntent;
}

function getSeriesCount(response) {
  const first = response.datasets?.dataset?.measureByDimension?.[0];
  return Array.isArray(first?.series) ? first.series.length : 0;
}

function hasChartTemplate(response, template) {
  return Array.isArray(response.dashboardDefinition?.components)
    && response.dashboardDefinition.components.some((component) => component.type === 'chart' && component.chart?.template === template);
}

function hasFilter(intent, column, operator) {
  return Array.isArray(intent.filters)
    && intent.filters.some((filter) => filter.column === column && filter.operator === operator);
}

function buildFlexibleDatabaseDefinition() {
  return {
    database: 'custom_microbio',
    tables: {
      samples: {
        columns: [
          { name: 'sample_id', type: 'INTEGER' },
          { name: 'strain', type: 'TEXT' },
          { name: 'cell_length', type: 'REAL' },
          { name: 'membrane_integrity', type: 'REAL' },
        ],
        data: [
          { sample_id: 1, strain: 'A', cell_length: 2.5, membrane_integrity: 0.91 },
          { sample_id: 2, strain: 'A', cell_length: 2.9, membrane_integrity: 0.88 },
          { sample_id: 3, strain: 'B', cell_length: 3.4, membrane_integrity: 0.77 },
        ],
      },
    },
    semanticHints: {
      primaryTable: 'samples',
      metrics: ['cell_length', 'membrane_integrity'],
      dimensions: ['strain'],
      labels: {
        cell_length: 'Cell Length',
        membrane_integrity: 'Membrane Integrity',
        strain: 'Strain',
      },
      aliases: {
        cell_length: ['cell length', 'length'],
        membrane_integrity: ['membrane integrity', 'integrity'],
        strain: ['strain', 'microbe strain'],
      },
    },
  };
}

async function validateSmokeCases() {
  for (const smokeCase of smokeCases) {
    const response = await generateDashboardFromPrompt({
      prompt: smokeCase.prompt,
      databasePath,
      mode: 'stateless',
    });

    smokeCase.expect({
      response,
      intent: getIntent(response),
      seriesCount: getSeriesCount(response),
    });

    console.log(`PASS | ${smokeCase.prompt}`);
  }
}

async function validateSessionContract() {
  const sessionId = `session-chatbot-${Date.now()}`;
  const first = await generateDashboardFromPrompt({
    prompt: 'Compare Area and Perimeter',
    databasePath,
    sessionId,
    mode: 'incremental',
  });
  const second = await generateDashboardFromPrompt({
    prompt: 'Show all categories',
    databasePath,
    sessionId,
    mode: 'incremental',
  });

  assert(first.metadata.session?.sessionId === sessionId, 'first response missing session id');
  assert(first.metadata.session?.turnCount === 1, 'first response should be turn 1');
  assert(second.metadata.session?.sessionId === sessionId, 'second response missing session id');
  assert(second.metadata.session?.turnCount === 2, 'second response should be turn 2');
  assert(second.metadata.session?.continuedFromTurnId === first.metadata.session?.turnId, 'second response should continue from first turn');

  console.log('PASS | incremental session contract');
}

async function validateFlexibleMicrobiologyDefinition() {
  const databaseDefinition = buildFlexibleDatabaseDefinition();

  const response = await generateDashboardFromPrompt({
    prompt: 'Show average cell length by strain',
    databaseDefinition,
    mode: 'stateless',
  });
  const intent = getIntent(response);

  assertHasContract(response);
  assert(response.metadata.selectedTable === 'samples', 'expected custom samples table');
  assert(response.metadata.semanticCatalog?.primaryTable === 'samples', 'expected semantic catalog primary table');
  assert(
    intent.selectedMetric === 'celllength' || response.metadata.generation.selectedDataBindings.measureColumn === 'cell_length',
    'expected dynamic cell_length metric',
  );
  assert(
    intent.selectedDimension === 'strain' || response.metadata.generation.selectedDataBindings.dimensionColumn === 'strain',
    'expected dynamic strain dimension',
  );
  assert(response.datasets.dataset.categoryCounts.length >= 1, 'expected category counts from custom dimension');

  console.log('PASS | flexible microbiology schema catalog');
}

async function validateSemanticCatalogEndpoint() {
  const defaultResponse = await buildDashboardSemanticCatalogResponse();
  const customResponse = await buildDashboardSemanticCatalogResponse({
    databaseDefinition: buildFlexibleDatabaseDefinition(),
  });

  assert(defaultResponse.semanticCatalog?.primaryTable, 'default semantic catalog should include primaryTable');
  assert(Array.isArray(defaultResponse.semanticCatalog?.metrics), 'default semantic catalog should include metrics');
  assert(Array.isArray(defaultResponse.semanticCatalog?.dimensions), 'default semantic catalog should include dimensions');
  assert(defaultResponse.contract?.renderEndpoint === '/api/dashboard/render', 'semantic catalog should advertise render endpoint');

  assert(customResponse.semanticCatalog?.primaryTable === 'samples', 'custom semantic catalog should use samples table');
  assert(
    customResponse.semanticCatalog.metrics.some((entry) => entry.column === 'cell_length'),
    'custom semantic catalog should include cell_length metric',
  );
  assert(
    customResponse.semanticCatalog.dimensions.some((entry) => entry.column === 'strain'),
    'custom semantic catalog should include strain dimension',
  );
  assert(
    customResponse.promptHelp?.examples?.some((example) => /Cell Length|Strain/i.test(example)),
    'semantic catalog should include dataset-aware prompt examples',
  );

  console.log('PASS | chatbot semantic catalog contract');
}

function buildValidRenderPayload() {
  return {
    dashboardDefinition: {
      schemaVersion: '1.0',
      id: 'chatbot-contract-smoke',
      title: 'Chatbot Contract Smoke',
      components: [
        {
          id: 'chatbot-contract-smoke-chart',
          widget: 'chart-widget',
          type: 'chart',
          title: 'Cell Length by Strain',
          chart: { template: 'bar' },
          data: {
            source: 'dataset.rows',
            transform: {
              type: 'collection',
              labelField: 'label',
              valueField: 'value',
            },
          },
        },
        {
          id: 'chatbot-contract-smoke-stats',
          widget: 'stats-widget',
          type: 'stats',
          title: 'Summary',
          data: {
            source: 'dataset.stats',
            transform: {
              type: 'keyValue',
              fields: [{ label: 'Rows', path: 'rows', format: 'integer' }],
            },
          },
        },
      ],
    },
    datasets: {
      dataset: {
        rows: [
          { label: 'A', displayLabel: 'Strain A', value: 2.7 },
          { label: 'B', displayLabel: 'Strain B', value: 3.4 },
        ],
        stats: {
          rows: 3,
        },
      },
    },
    metadata: {
      source: 'chatbot',
      prompt: 'Show cell length by strain',
      confidenceScore: 0.86,
    },
  };
}

async function validateRenderContract() {
  const sessionId = `session-render-${Date.now()}`;
  const response = await renderDashboardPayload({
    ...buildValidRenderPayload(),
    sessionId,
  });

  assertHasContract(response);
  assert(response.metadata.validated === true, 'expected render payload validation flag');
  assert(response.metadata.sourceType === 'chatbot', 'expected chatbot source type');
  assert(response.metadata.session?.sessionId === sessionId, 'expected render response to be stored in session');

  try {
    await renderDashboardPayload({
      ...buildValidRenderPayload(),
      datasets: { dataset: { stats: { rows: 3 } } },
    });
    throw new Error('expected missing dataset source to fail');
  } catch (error) {
    assert(error.code === 'INVALID_DASHBOARD_PAYLOAD', 'expected missing dataset source to return INVALID_DASHBOARD_PAYLOAD');
    assert(/missing dataset source/i.test(error.message), 'expected missing dataset source validation error');
  }

  try {
    await renderDashboardPayload({
      ...buildValidRenderPayload(),
      datasets: { dataset: { rows: [], stats: { rows: 0 } } },
    });
    throw new Error('expected empty chart data to fail');
  } catch (error) {
    assert(error.code === 'INVALID_DASHBOARD_PAYLOAD', 'expected empty chart data to return INVALID_DASHBOARD_PAYLOAD');
    assert(/empty collection/i.test(error.message), 'expected empty collection validation error');
  }

  try {
    await renderDashboardPayload({
      ...buildValidRenderPayload(),
      metadata: { source: 'chatbot', prompt: 'show data', confidenceScore: 0.31 },
    });
    throw new Error('expected low-confidence payload to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'expected low-confidence render payload to return INVALID_PROMPT');
    assert(error.promptHelp?.title === 'Clarify what you want to view', 'expected clarification prompt help');
  }

  console.log('PASS | chatbot render payload contract');
}

async function main() {
  await validateSmokeCases();
  await validateSessionContract();
  await validateFlexibleMicrobiologyDefinition();
  await validateSemanticCatalogEndpoint();
  await validateRenderContract();
  console.log('\nChatbot contract validation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
