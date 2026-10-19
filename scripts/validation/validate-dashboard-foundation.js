// Purpose: Validates dashboard generation foundation behavior and service-level safety checks.
const path = require('path');
const {
  resolveDimension,
  resolveEntity,
  resolveMetric,
  resolveSemanticQuery,
  getReadableColumnLabel,
} = require('../../backend/src/config/schema');
const {
  enrichSchema,
  looksIdentifier,
  looksNumeric,
  looksTemporal,
} = require('../../backend/src/services/dashboard-schema-profile.service');
const { buildSemanticCatalog } = require('../../backend/src/services/dashboard-semantic-catalog.service');
const { validateDashboardDefinition } = require('../../backend/src/services/dashboard-definition.service');
const { resolveMicroorganismLookupContext } = require('../../backend/src/services/microorganism-dimension.service');
const { generateDashboardFromPrompt } = require('../../backend/src/services/dashboard-generation.service');

const databasePath = path.join(__dirname, '..', '..', 'backend', 'sql', 'microbes.db');

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function assertRejectsWith(fn, predicate, message) {
  try {
    await fn();
  } catch (error) {
    assert(predicate(error), message || error.message);
    return error;
  }

  throw new Error(message || 'Expected function to reject.');
}

function buildValidDashboardDefinition(overrides = {}) {
  return {
    schemaVersion: '1.0',
    id: 'foundation-validation-dashboard',
    title: 'Foundation Validation Dashboard',
    components: [
      {
        id: 'foundation-validation-chart',
        widget: 'chart-widget',
        type: 'chart',
        title: 'Area by Microorganism',
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
    ],
    ...overrides,
  };
}

async function validateSemanticResolution() {
  const entity = resolveEntity('microbe');
  const metric = resolveMetric('equivalent diameter');
  const dimension = resolveDimension('species');
  const query = resolveSemanticQuery({
    selectedMetric: 'area',
    selectedDimension: 'species',
  });

  assert(entity?.key === 'organism', 'microbe alias should resolve to organism entity');
  assert(metric?.key === 'equivdiameter', 'equivalent diameter alias should resolve to equivdiameter metric');
  assert(dimension?.grain === 'category', 'species dimension should resolve to category grain');
  assert(query.table === 'microbes', 'semantic query should use default microbes table');
  assert(query.columns.metric === 'Area', 'semantic query should bind area metric to Area column');
  assert(query.columns.dimension === 'microorganism_id', 'semantic query should bind species to microorganism_id');
  assert(query.aggregations.metric === 'avg', 'area metric should aggregate with avg');
  assert(getReadableColumnLabel('ConvexArea') === 'Convex Area', 'ConvexArea should have readable label');

  console.log('PASS | semantic entity, metric, dimension resolution');
}

async function validateColumnProfilingAndCatalog() {
  assert(looksNumeric('INTEGER'), 'INTEGER should be numeric');
  assert(looksNumeric('DOUBLE PRECISION'), 'DOUBLE PRECISION should be numeric');
  assert(looksTemporal('TEXT', 'captured_time'), 'captured_time should be temporal by name');
  assert(looksIdentifier('sample_id'), 'sample_id should be detected as identifier');

  const adapter = {
    async countRows(tableName) {
      return { c: tableName === 'samples' ? 3 : 0 };
    },
  };
  const profiles = await enrichSchema(adapter, [
    {
      name: 'samples',
      columns: [
        { name: 'sample_id', type: 'INTEGER', distinctValues: [1, 2, 3] },
        { name: 'strain', type: 'TEXT', distinctValues: ['A', 'B'] },
        { name: 'cell_length', type: 'REAL', distinctValues: [2.5, 2.9] },
        { name: 'captured_time', type: 'TEXT', distinctValues: ['2026-01-01'] },
      ],
    },
  ]);
  const profile = profiles[0];

  assert(profile.rowCount === 3, 'schema profile should keep row count');
  assert(profile.numericColumns.some((column) => column.name === 'cell_length'), 'cell_length should be numeric');
  assert(profile.dimensionColumns.some((column) => column.name === 'strain'), 'strain should be a dimension candidate');
  assert(profile.temporalColumns.some((column) => column.name === 'captured_time'), 'captured_time should be temporal');

  const catalog = buildSemanticCatalog({
    schemaProfiles: profiles,
    databaseDefinition: {
      semanticHints: {
        primaryTable: 'samples',
        metrics: ['cell_length'],
        dimensions: ['strain'],
        labels: {
          cell_length: 'Cell Length',
          strain: 'Strain',
        },
        aliases: {
          cell_length: ['cell length'],
          strain: ['microbe strain'],
        },
      },
    },
  });

  assert(catalog.primaryTable === 'samples', 'catalog should use hinted primary table');
  assert(catalog.metrics.some((entry) => entry.column === 'cell_length' && entry.label === 'Cell Length'), 'catalog should include hinted metric label');
  assert(catalog.dimensions.some((entry) => entry.column === 'strain' && entry.label === 'Strain'), 'catalog should include hinted dimension label');
  assert(catalog.promptFields.includes('Cell Length'), 'catalog prompt fields should include hinted metric');

  console.log('PASS | numeric, temporal, category detection and semantic catalog');
}

async function validateMicroorganismLookupUsesActiveAdapter() {
  const adapter = {
    tableCalls: 0,
    columnCalls: 0,
    async getTables() {
      this.tableCalls += 1;
      return [{ name: 'samples' }, { name: 'organism_lookup' }];
    },
    async getColumns(tableName) {
      this.columnCalls += 1;
      if (tableName === 'organism_lookup') {
        return [
          { name: 'microorganism_id' },
          { name: 'microorganism_name' },
        ];
      }

      return [{ name: 'sample_id' }];
    },
  };

  const first = await resolveMicroorganismLookupContext(adapter);
  const second = await resolveMicroorganismLookupContext(adapter);

  assert(first?.tableName === 'organism_lookup', 'lookup table should come from supplied adapter');
  assert(first?.idColumn === 'microorganism_id', 'lookup id column should be resolved');
  assert(first?.nameColumn === 'microorganism_name', 'lookup name column should be resolved');
  assert(second?.tableName === first.tableName, 'cached lookup should preserve context');
  assert(adapter.tableCalls === 1, 'lookup context should be cached per adapter');

  console.log('PASS | microorganism lookup uses active adapter and cache');
}

async function validateDashboardDefinitionRules() {
  await validateDashboardDefinition(buildValidDashboardDefinition());

  await assertRejectsWith(
    () => validateDashboardDefinition(buildValidDashboardDefinition({ schemaVersion: '2.0' })),
    (error) => /not valid/i.test(error.message),
    'invalid schema version should be rejected',
  );

  await assertRejectsWith(
    () => validateDashboardDefinition(buildValidDashboardDefinition({
      title: '   ',
    })),
    (error) => /not valid/i.test(error.message),
    'whitespace-only dashboard title should be rejected',
  );

  await assertRejectsWith(
    () => validateDashboardDefinition(buildValidDashboardDefinition({
      components: [
        {
          ...buildValidDashboardDefinition().components[0],
          chart: { template: 'radar' },
        },
      ],
    })),
    (error) => /not valid/i.test(error.message),
    'unsupported chart template should be rejected',
  );

  await assertRejectsWith(
    () => validateDashboardDefinition(buildValidDashboardDefinition({
      components: [
        {
          ...buildValidDashboardDefinition().components[0],
          data: {
            source: 'dataset.rows',
            transform: {
              type: 'collection',
              labelField: 'label',
            },
          },
        },
      ],
    })),
    (error) => /not valid/i.test(error.message),
    'collection transform without valueField should be rejected',
  );

  console.log('PASS | dashboard definition validation');
}

async function validateNaturalLanguagePromptHandling() {
  const response = await generateDashboardFromPrompt({
    prompt: 'Show Area where Solidity > 0.8',
    databasePath,
    mode: 'stateless',
  });
  const intent = response.metadata.generation.promptIntent;

  assert(response.dashboardDefinition?.schemaVersion === '1.0', 'prompt generation should return valid dashboard definition');
  assert(response.datasets?.dataset, 'prompt generation should return dataset wrapper');
  assert(intent.selectedMetric === 'area', 'prompt should resolve Area as selected metric');
  assert(intent.filters.some((filter) => filter.column === 'Solidity' && filter.operator === '>'), 'prompt should preserve Solidity filter');

  const filteredLineResponse = await generateDashboardFromPrompt({
    prompt: 'Compare the area on a line chart of microorganisms that have a solidity under 7',
    databasePath,
    mode: 'stateless',
  });
  const filteredLineIntent = filteredLineResponse.metadata.generation.promptIntent;
  const filteredLineBindings = filteredLineResponse.metadata.generation.selectedDataBindings;
  const filteredLineChart = filteredLineResponse.dashboardDefinition.components.find((component) => component.type === 'chart');

  assert(filteredLineIntent.selectedMetric === 'area', 'filtered comparison prompt should display only Area');
  assert(filteredLineBindings.measureColumn === 'Area', 'filtered comparison prompt should bind Area as the measure column');
  assert(filteredLineIntent.filters.some((filter) => filter.column === 'Solidity' && filter.operator === '<'), 'filtered comparison prompt should keep Solidity as a filter');
  assert(filteredLineChart?.chart?.template === 'line', 'filtered comparison prompt should preserve the requested line chart');
  assert(!filteredLineChart?.chart?.seriesLabel, 'filtered comparison prompt should not create a multi-metric series for the filter metric');

  const scopedOutputsResponse = await generateDashboardFromPrompt({
    prompt: 'Generate the average Area of all microorganism as a bar chart and a table of Area, Perimeter and Eccentricity of Aspergillus sp',
    databasePath,
    mode: 'stateless',
  });
  const scopedComponents = scopedOutputsResponse.dashboardDefinition.components;
  const scopedChart = scopedComponents.find((component) => component.type === 'chart');
  const scopedTables = scopedComponents.filter((component) => component.type === 'table');
  const scopedTable = scopedTables[0];

  assert(scopedChart?.data.source === 'dataset.request_0.measureByDimension', 'chart and table prompt should give the chart its own dataset');
  assert(scopedTables.length === 1 && scopedTable?.data.source === 'dataset.request_1.preview', 'chart and table prompt should create one independently scoped table');
  assert(
    scopedTable.data.transform.columns.map((column) => column.label).join('|') === 'Microorganism|Average Area|Average Perimeter|Average Eccentricity',
    'scoped table should retain only its requested fields',
  );
  assert(
    scopedOutputsResponse.datasets.dataset.request_1.preview.every((row) => row.label === 'Aspergillus sp'),
    'scoped table should retain its microorganism filter without applying it to the chart',
  );

  const independentlyScopedResponse = await generateDashboardFromPrompt({
    prompt: 'Generate a bar chart of MajorAxisLength and MinorAxisLength of Aspergillus sp and Yeast, and a table of Area, Perimeter and Eccentricity of Aspergillus sp',
    databasePath,
    mode: 'stateless',
  });
  const independentlyScopedRequests = independentlyScopedResponse.metadata.generation.promptIntent.visualRequests;
  assert(
    independentlyScopedRequests[0].microorganismNames.join('|') === 'Aspergillus sp|Yeast',
    'chart scope should preserve its two requested microorganisms',
  );
  assert(
    independentlyScopedRequests[1].microorganismNames.join('|') === 'Aspergillus sp',
    'table scope should not inherit microorganism names from the chart',
  );
  assert(
    independentlyScopedResponse.datasets.dataset.request_1.preview.every((row) => row.label === 'Aspergillus sp'),
    'table output should contain only the microorganism named in its own clause',
  );

  const error = await assertRejectsWith(
    () => generateDashboardFromPrompt({
      prompt: 'show data',
      databasePath,
      mode: 'stateless',
    }),
    (candidate) => candidate.code === 'INVALID_PROMPT',
    'broad prompt should ask for clarification',
  );

  assert(error.promptHelp?.title === 'Clarify what you want to view', 'broad prompt should use clarification title');
  assert(/too broad|dataset field/i.test(error.promptHelp?.message || ''), 'broad prompt should explain missing detail');

  console.log('PASS | natural-language prompt handling and clarification');
}

async function main() {
  await validateSemanticResolution();
  await validateColumnProfilingAndCatalog();
  await validateMicroorganismLookupUsesActiveAdapter();
  await validateDashboardDefinitionRules();
  await validateNaturalLanguagePromptHandling();
  console.log('\nDashboard foundation validation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
