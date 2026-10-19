// Purpose: Validates dynamic microorganism discovery, fuzzy matching, filters, and grouping.
const { generateDashboardFromPrompt } = require('../../backend/src/services/dashboard-generation.service');

const databaseDefinition = {
  database: 'microorganism_resolution_test',
  tables: {
    samples: {
      columns: [
        { name: 'sample_id', type: 'INTEGER' },
        { name: 'microorganism_name', type: 'TEXT' },
        { name: 'country', type: 'TEXT' },
        { name: 'sample_year', type: 'INTEGER' },
        { name: 'contamination_rate', type: 'REAL' },
        { name: 'prevalence', type: 'REAL' },
        { name: 'positive_samples', type: 'INTEGER' },
      ],
      data: [
        { sample_id: 1, microorganism_name: 'Salmonella', country: 'Italy', sample_year: 2024, contamination_rate: 0.42, prevalence: 0.18, positive_samples: 12 },
        { sample_id: 2, microorganism_name: 'Salmonella', country: 'France', sample_year: 2024, contamination_rate: 0.33, prevalence: 0.11, positive_samples: 8 },
        { sample_id: 3, microorganism_name: 'Escherichia coli', country: 'Italy', sample_year: 2024, contamination_rate: 0.27, prevalence: 0.09, positive_samples: 5 },
        { sample_id: 4, microorganism_name: 'Listeria monocytogenes', country: 'Italy', sample_year: 2023, contamination_rate: 0.12, prevalence: 0.04, positive_samples: 2 },
        { sample_id: 5, microorganism_name: 'Listeria innocua', country: 'Spain', sample_year: 2024, contamination_rate: 0.1, prevalence: 0.03, positive_samples: 1 },
        { sample_id: 6, microorganism_name: 'Staphylococcus aureus', country: 'France', sample_year: 2024, contamination_rate: 0.21, prevalence: 0.07, positive_samples: 4 },
        { sample_id: 7, microorganism_name: 'Campylobacter jejuni', country: 'Spain', sample_year: 2024, contamination_rate: 0.38, prevalence: 0.16, positive_samples: 7 },
        { sample_id: 8, microorganism_name: 'NewMicrobe nova', country: 'Italy', sample_year: 2024, contamination_rate: 0.5, prevalence: 0.22, positive_samples: 9 },
      ],
    },
  },
  semanticHints: {
    primaryTable: 'samples',
    metrics: ['contamination_rate', 'prevalence', 'positive_samples'],
    dimensions: ['microorganism_name', 'country', 'sample_year'],
    labels: {
      microorganism_name: 'Microorganism',
      contamination_rate: 'Contamination Rate',
      positive_samples: 'Positive Samples',
      sample_year: 'Sample Year',
    },
    aliases: {
      contamination_rate: ['contamination', 'contamination rate'],
      microorganism_name: ['microorganism', 'pathogen', 'species'],
      sample_year: ['year', 'date'],
      positive_samples: ['positive samples', 'percent positive'],
    },
  },
};

const resolutionCases = [
  ['exact name', 'show bar chart of Salmonella by country', ['Salmonella']],
  ['different casing', 'show bar chart of SALMONELLA by country', ['Salmonella']],
  ['punctuation variant', 'show bar chart of E. coli by country', ['Escherichia coli']],
  ['compact abbreviation', 'show bar chart of ecoli by country', ['Escherichia coli']],
  ['common abbreviation', 'show bar chart of staph aureus by country', ['Staphylococcus aureus']],
  ['safe misspelling', 'show bar chart of salmonela by country', ['Salmonella']],
  ['transposed misspelling', 'show bar chart of salmnonella by country', ['Salmonella']],
  ['partial unambiguous name', 'show bar chart of campylo by country', ['Campylobacter jejuni']],
  ['scientific name', 'show bar chart of Listeria monocytogenes by country', ['Listeria monocytogenes']],
  ['new database value', 'show bar chart of newmicrobe by country', ['NewMicrobe nova']],
  ['multi-organism comparison', 'compare E. coli and Salmonella', ['Escherichia coli', 'Salmonella']],
  ['multi-organism line chart', 'compare E. coli and Salmonella line chart', ['Escherichia coli', 'Salmonella']],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function getMicroorganismFilter(response) {
  const filters = response.metadata?.generation?.promptIntent?.filters || [];
  return filters.find((filter) => filter.semanticRole === 'microorganism') || null;
}

function getResolvedNames(response) {
  return (response.metadata?.generation?.promptIntent?.microorganismResolution?.matches || [])
    .map((match) => match.name);
}

function hasNonEmptyChart(response) {
  const components = response.dashboardDefinition?.components || [];
  const chartComponents = components.filter((component) => component.type === 'chart');

  return chartComponents.some((component) => {
    const source = String(component.data?.source || '').split('.').reduce((current, segment) => {
      if (!current || typeof current !== 'object') {
        return undefined;
      }

      return current[segment];
    }, response.datasets);

    return Array.isArray(source) && source.length > 0;
  });
}

function hasChartTemplate(response, template) {
  return (response.dashboardDefinition?.components || [])
    .some((component) => component.type === 'chart' && component.chart?.template === template);
}

function getComponentsByType(response, type) {
  return (response.dashboardDefinition?.components || []).filter((component) => component.type === type);
}

async function generate(prompt) {
  return generateDashboardFromPrompt({
    prompt,
    databaseDefinition,
    mode: 'stateless',
  });
}

async function validateResolutionCases() {
  for (const [label, prompt, expectedNames] of resolutionCases) {
    const response = await generate(prompt);
    const actualNames = getResolvedNames(response);
    const filter = getMicroorganismFilter(response);

    for (const expectedName of expectedNames) {
      assert(actualNames.includes(expectedName), `${label}: expected ${expectedName}, got ${actualNames.join(', ')}`);
    }

    assert(filter, `${label}: expected microorganism filter`);
    assert(hasNonEmptyChart(response), `${label}: expected at least one non-empty chart`);

    if (label === 'multi-organism line chart') {
      assert(hasChartTemplate(response, 'line'), `${label}: expected line chart`);
    }

    console.log(`PASS | ${label} -> ${actualNames.join(', ')}`);
  }
}

async function validateGroupingAndTemporalCases() {
  const contamination = await generate('show bar chart of contamination by microorganism');
  assert(
    contamination.metadata.generation.promptIntent.selectedMetric === 'contaminationrate',
    'contamination prompt should resolve contamination_rate as metric',
  );
  assert(
    contamination.metadata.generation.selectedDataBindings.dimensionColumn === 'microorganism_name',
    'contamination prompt should group by microorganism_name',
  );
  assert(hasNonEmptyChart(contamination), 'contamination by microorganism should render a chart');

  const topInYear = await generate('top microorganisms in 2024');
  const timeFilter = topInYear.metadata.generation.promptIntent.filters.find((filter) => filter.semanticRole === 'time');
  assert(timeFilter?.column === 'sample_year' && timeFilter.value === 2024, 'top microorganisms in 2024 should filter sample_year');
  assert(topInYear.metadata.generation.selectedDataBindings.dimensionColumn === 'microorganism_name', 'top microorganisms should group by microorganism_name');
  assert(hasNonEmptyChart(topInYear), 'top microorganisms in 2024 should render a chart');

  const prevalence = await generate('prevalence by microorganism over time');
  assert(prevalence.metadata.generation.promptIntent.selectedMetric === 'prevalence', 'prevalence prompt should resolve prevalence metric');
  assert(hasNonEmptyChart(prevalence), 'prevalence by microorganism over time should render a chart');

  console.log('PASS | microorganism grouping, charting, and temporal filter cases');
}

async function validateAmbiguousAndUnknownCases() {
  try {
    await generate('show bar chart of listeria by country');
    throw new Error('expected ambiguous Listeria prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'ambiguous Listeria should return INVALID_PROMPT');
    assert(Array.isArray(error.promptHelp?.candidates) && error.promptHelp.candidates.length === 2, 'ambiguous Listeria should return two candidates');
  }

  try {
    await generate('show unknown microorganism by country');
    throw new Error('expected unknown microorganism prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'unknown microorganism should return INVALID_PROMPT');
  }

  try {
    await generate('show bar chart of Salmonella by microorganism');
    throw new Error('expected circular microorganism grouping prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'circular microorganism grouping should return INVALID_PROMPT');
    assert(/grouping by microorganism/i.test(error.promptHelp?.message || ''), 'circular microorganism grouping should explain the issue');
  }

  try {
    await generate('show Salmonella line chart');
    throw new Error('expected single-point microorganism line chart prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'single-point microorganism line chart should return INVALID_PROMPT');
    assert(/single point|real trend|comparison/i.test(error.promptHelp?.message || ''), 'single-point line chart should explain the issue');
  }

  for (const chartPrompt of [
    'show Salmonella bar chart',
    'show Salmonella doughnut chart',
    'show Salmonella polar chart',
  ]) {
    try {
      await generate(chartPrompt);
      throw new Error(`expected ${chartPrompt} to fail`);
    } catch (error) {
      assert(error.code === 'INVALID_PROMPT', `${chartPrompt} should return INVALID_PROMPT`);
      assert(/single data point|metric|category|comparison/i.test(error.promptHelp?.message || ''), `${chartPrompt} should explain the issue`);
    }
  }

  try {
    await generate('show Salmonella ine chart');
    throw new Error('expected misspelled chart prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'misspelled chart prompt should return INVALID_PROMPT');
    assert(/visual chart|single data point|metric|category|comparison/i.test(error.promptHelp?.message || ''), 'misspelled chart prompt should not be treated as a valid line chart');
  }

  try {
    await generate('show Salmonella table');
    throw new Error('expected underspecified single microorganism table prompt to fail');
  } catch (error) {
    assert(error.code === 'INVALID_PROMPT', 'underspecified single microorganism table should return INVALID_PROMPT');
    assert(/all properties|fields|too little information/i.test(error.promptHelp?.message || ''), 'single microorganism table should ask for fields or all properties');
  }

  const detailedTableResponse = await generate('show Salmonella table with all properties');
  assert(
    getComponentsByType(detailedTableResponse, 'table').length === 1,
    'single microorganism table with all properties should render',
  );
  assert(getComponentsByType(detailedTableResponse, 'chart').length === 0, 'single microorganism table with all properties should not add a chart');
  assert(
    detailedTableResponse.datasets.dataset.preview.some((row) => Object.prototype.hasOwnProperty.call(row, 'prevalence')),
    'single microorganism table with all properties should include record fields',
  );
  const detailedTableDescription = getComponentsByType(detailedTableResponse, 'table')[0].description;
  assert(/Salmonella/i.test(detailedTableDescription), 'single microorganism table description should show the resolved microorganism name');
  assert(!/microorganism.*=\s*\d+/i.test(detailedTableDescription), 'single microorganism table description should not expose internal microorganism ids');

  const typoPropertiesResponse = await generate('show Salmonella table with all proprities');
  assert(
    getComponentsByType(typoPropertiesResponse, 'table').length === 1,
    'single microorganism table with typo properties should render',
  );
  assert(getComponentsByType(typoPropertiesResponse, 'chart').length === 0, 'single microorganism table with typo properties should not add a chart');

  const fieldTableResponse = await generate('show Salmonella table with contamination rate and prevalence');
  assert(
    getComponentsByType(fieldTableResponse, 'table').length === 1,
    'single microorganism table with explicit fields should render',
  );
  assert(getComponentsByType(fieldTableResponse, 'chart').length === 0, 'single microorganism table with explicit fields should not add a chart');
  const fieldColumns = getComponentsByType(fieldTableResponse, 'table')[0].data.transform.columns.map((column) => column.key);
  assert(fieldColumns.includes('contamination_rate') && fieldColumns.includes('prevalence'), 'explicit field table should include requested fields');

  console.log('PASS | ambiguous and unknown microorganism handling');
}

async function main() {
  await validateResolutionCases();
  await validateGroupingAndTemporalCases();
  await validateAmbiguousAndUnknownCases();
  console.log('\nMicroorganism resolution validation passed.');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
