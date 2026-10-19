// Purpose: Guards failure-analysis prompts against unsafe guesses and invalid chart outputs.
const path = require('path');
const { generateDashboardFromPrompt } = require('../../backend/src/services/dashboard-generation.service');

const databasePath = path.join(__dirname, '..', '..', 'backend', 'sql', 'microbes.db');

const promptCases = [
  ['A', 'show antibiotic resistance trends', 'clarify'],
  ['A', 'compare salmonella prevalence by country', 'clarify'],
  ['A', 'top microorganisms in 2024', 'clarify'],
  ['A', 'contamination by month', 'clarify'],
  ['A', 'resistance over time', 'clarify'],
  ['A', 'prevalence by food category', 'clarify'],
  ['A', 'compare contamination across countries', 'clarify'],
  ['A', 'show yearly trend of positive samples', 'clarify'],
  ['A', 'show most common pathogens by product type', 'clarify'],
  ['A', 'compare prevalence between meat and dairy', 'clarify'],

  ['B', 'salmonella', 'clarify'],
  ['B', 'Salmonella', 'clarify'],
  ['B', 'SALMONELLA', 'clarify'],
  ['B', 'salmnonella', 'clarify'],
  ['B', 'salmonela', 'clarify'],
  ['B', 'e coli', 'clarify'],
  ['B', 'E. coli', 'clarify'],
  ['B', 'ecoli', 'clarify'],
  ['B', 'Escherichia coli', 'clarify'],
  ['B', 'listeria', 'clarify'],
  ['B', 'Listeria monocytogenes', 'clarify'],
  ['B', 'campylobacter', 'clarify'],
  ['B', 'campylo', 'clarify'],
  ['B', 'staph aureus', 'clarify'],
  ['B', 'Staphylococcus aureus', 'clarify'],

  ['C', 'show contamination', 'clarify'],
  ['C', 'show bacteria', 'clarify'],
  ['C', 'compare countries', 'clarify'],
  ['C', 'show trends', 'clarify'],
  ['C', 'create a dashboard', 'clarify'],
  ['C', 'show risk', 'clarify'],
  ['C', 'give me insights', 'clarify'],
  ['C', 'food safety dashboard', 'clarify'],

  ['D', 'top microorganisms in 1800', 'clarify'],
  ['D', 'salmonella by country in year with no data', 'clarify'],
  ['D', 'resistance trend for unknown organism', 'clarify'],
  ['D', 'compare nonexistent species', 'clarify'],
  ['D', 'prevalence by empty category', 'clarify'],
  ['D', 'show data for fake country', 'clarify'],

  ['E', 'compare salmonella and prevalence', 'clarify'],
  ['E', 'show resistance by antibiotic', 'clarify'],
  ['E', 'show positive samples by microorganism', 'clarify'],
  ['E', 'show sample count by country', 'clarify'],
  ['E', 'show prevalence over time', 'clarify'],
  ['E', 'compare contamination rate and total samples', 'clarify'],
  ['E', 'show percent positive by food category', 'clarify'],

  ['baseline', 'show distribution of area', 'generate'],
  ['baseline', 'compare area and perimeter', 'generate'],
  ['baseline', 'show records with solidity above 0.8', 'generate'],
];

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function resolvePath(target, sourcePath) {
  return String(sourcePath || '').split('.').reduce((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return current[segment];
  }, target);
}

function assertGeneratedDashboard(response, prompt) {
  assert(response && typeof response === 'object', `${prompt}: missing response object`);
  assert(response.dashboardDefinition?.schemaVersion === '1.0', `${prompt}: invalid dashboard schema version`);
  assert(response.datasets?.dataset && typeof response.datasets.dataset === 'object', `${prompt}: missing datasets.dataset`);
  assert(response.metadata?.generation?.promptIntent, `${prompt}: missing prompt intent metadata`);

  const components = response.dashboardDefinition.components;
  assert(Array.isArray(components) && components.length > 0, `${prompt}: dashboard must have components`);

  for (const component of components) {
    assert(component.id && component.type && component.widget, `${prompt}: component is missing id/type/widget`);
    assert(component.data?.source && component.data?.transform?.type, `${prompt}: component ${component.id} has invalid data binding`);

    const source = resolvePath(response.datasets, component.data.source);
    assert(source !== undefined, `${prompt}: component ${component.id} points to missing source ${component.data.source}`);

    if (component.type === 'chart') {
      assert(component.chart?.template, `${prompt}: chart component ${component.id} is missing a template`);
      assert(Array.isArray(source) && source.length > 0, `${prompt}: chart component ${component.id} has empty source data`);
    }
  }
}

async function runCase([category, prompt, expected]) {
  try {
    const response = await generateDashboardFromPrompt({
      prompt,
      databasePath,
      mode: 'stateless',
    });

    assert(expected === 'generate', `${prompt}: expected clarification but generated a dashboard`);
    assertGeneratedDashboard(response, prompt);
    return { category, prompt, expected, actual: 'generate', pass: true };
  } catch (error) {
    if (expected === 'clarify' && error?.code === 'INVALID_PROMPT') {
      return { category, prompt, expected, actual: 'clarify', pass: true };
    }

    return {
      category,
      prompt,
      expected,
      actual: error?.code === 'INVALID_PROMPT' ? 'clarify' : 'error',
      pass: false,
      error: error.message,
    };
  }
}

async function main() {
  const results = [];

  for (const promptCase of promptCases) {
    results.push(await runCase(promptCase));
  }

  const failures = results.filter((result) => !result.pass);

  for (const result of results) {
    console.log(`${result.pass ? 'PASS' : 'FAIL'} | ${result.category} | ${result.prompt} -> ${result.actual}`);
    if (result.error) {
      console.log(`  ${result.error}`);
    }
  }

  console.log(`\nDashboard failure regressions: ${results.length - failures.length}/${results.length} passed.`);

  if (failures.length) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
