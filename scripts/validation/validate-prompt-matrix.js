// Purpose: Runs broad prompt coverage checks against dashboard generation behavior.
const path = require('path');
const { SCHEMA } = require('../../backend/src/config/schema');
const { generateDashboardFromPrompt } = require('../../backend/src/services/dashboard-generation.service');

const databasePath = path.join(__dirname, '..', '..', 'backend', 'sql', 'microbes.db');
const morphologyCategoryEntries = Object.entries(SCHEMA.microorganism.dimensionMeta || {})
  .filter(([key]) => key !== 'microorganisms');

const sections = [
  {
    name: '1. Basic single-metric queries',
    kind: 'single-metric',
    prompts: [
      'Show distribution of Area',
      'Show distribution of Perimeter',
      'Show distribution of Solidity',
      'Show distribution of Eccentricity',
      'Show distribution of ConvexArea',
      'Show distribution of Extrema',
    ],
  },
  {
    name: '2. Comparison queries',
    kind: 'comparison',
    prompts: [
      'Compare Eccentricity and Solidity',
      'Compare Area and Perimeter',
      'Compare MajorAxisLength and MinorAxisLength',
      'Compare ConvexArea and FilledArea',
      'Compare Extent and Solidity',
    ],
  },
  {
    name: '3. Relationship / correlation queries',
    kind: 'relationship',
    prompts: [
      'Show correlation between Area and Perimeter',
      'Relationship between Solidity and Eccentricity',
      'Correlation between MajorAxisLength and MinorAxisLength',
      'Relationship between ConvexArea and Area',
      'Correlation matrix of all features',
    ],
  },
  {
    name: '4. Ranking / top-N queries',
    kind: 'ranking',
    prompts: [
      'Top 10 microorganisms by Area',
      'Top 10 by Perimeter',
      'Top 10 by EquivDiameter',
      'Top 10 most complex by Eccentricity',
      'Top 10 by ConvexArea',
    ],
  },
  {
    name: '5. Multi-metric analysis',
    kind: 'multi-metric',
    prompts: [
      'Compare Area, Perimeter, and Solidity across samples',
      'Show Area, ConvexArea, and FilledArea together',
      'Analyze Eccentricity, Solidity, and Extent together',
      'Compare all shape features',
    ],
  },
  {
    name: '6. Full feature mode',
    kind: 'overview',
    prompts: [
      'Show full morphology profile of microorganisms',
      'Compare microorganisms using all features',
      'Show complete dataset overview',
      'Analyze all geometric properties',
      'Give full morphological summary',
    ],
  },
  {
    name: '7. Exploratory / ambiguous prompts',
    kind: 'overview',
    prompts: [
      'What patterns exist in the data?',
      'Give a summary of the dataset',
      'What can you tell me about these microorganisms?',
      'Show interesting insights',
      'What stands out in the data?',
    ],
  },
  {
    name: '8. Statistical summary mode',
    kind: 'stats',
    prompts: [
      'Provide statistical summary of all features',
      'Show mean, variance of morphological properties',
      'Summarize dataset distribution',
      'Describe dataset structure',
    ],
  },
  {
    name: '9. Anomaly / outlier detection',
    kind: 'analysis',
    prompts: [
      'Find anomalies in Area and Perimeter',
      'Detect unusual microorganisms',
      'Identify outliers in morphology',
      'Show extreme values in dataset',
    ],
  },
  {
    name: '10. Clustering / grouping intent',
    kind: 'grouping',
    prompts: [
      'Group microorganisms by similarity',
      'Cluster based on morphology',
      'Find natural groups in the data',
      'Identify structure in feature space',
    ],
  },
  {
    name: '11. Visualization forcing',
    kind: 'chart-forcing',
    prompts: [
      'Plot Area distribution',
      'Show scatter plot of Eccentricity vs Solidity',
      'Visualize Perimeter vs Area',
      'Create morphology comparison chart',
      'Show polar comparison of features',
    ],
  },
  {
    name: '12. Invalid / edge input',
    kind: 'fallback',
    prompts: [
      'Show species distribution',
      'Compare bacteria types',
      'Show microorganism categories',
      'Group by organism type',
      'Compare species differences',
    ],
  },
  {
    name: '13. Mixed complex prompts',
    kind: 'mixed',
    prompts: [
      'Compare Area and Perimeter and show distribution of Solidity',
      'Show top microorganisms and correlation between features',
      'Give overview and compare all shape metrics',
      'Show anomalies and ranking by Area',
      'Analyze structure and compare Eccentricity and Solidity',
    ],
  },
  {
    name: '14. Absolute stress test',
    kind: 'overview',
    prompts: [
      'Analyze everything in the dataset',
      'Show complete morphological analysis',
      'What is happening in the data overall?',
      'Give full insight report',
      'Find all patterns, anomalies, and relationships',
    ],
  },
  {
    name: '15. Category-as-metric coverage',
    kind: 'category-metrics',
    prompts: [
      'Compare Orientation and EulerNumber',
      'Compare BoundingBox1 and ConvexHull1',
      'Compare Extrema and Perimeter',
      'Show all categories chart',
      'Plot all categories',
      'Show polar comparison of all categories',
      'Show categories distribution',
    ],
  },
  {
    name: '16. Every CSV category distribution',
    kind: 'csv-category-distribution',
    prompts: morphologyCategoryEntries.map(([, meta]) => `Show distribution of ${meta.label}`),
  },
  {
    name: '17. Filter-only metric handling',
    kind: 'filter-only',
    prompts: [
      'Show microorganisms with Solidity > 0.8',
      'Show records where Bounding Box 1 > 5',
      'Show Area where Solidity > 0.8',
      'Show distribution of Area where Bounding Box 1 > 5',
      'Compare Area and Solidity where Solidity > 0.8',
    ],
  },
];

function normalize(value) {
  return String(value ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function countSeries(result) {
  const rows = result?.datasets?.dataset?.measureByDimension;
  const first = Array.isArray(rows) && rows.length ? rows[0] : null;
  return Array.isArray(first?.series) ? first.series.length : 0;
}

const knownMetrics = [
  'boundingbox1',
  'boundingbox2',
  'boundingbox3',
  'boundingbox4',
  'convexhull1',
  'convexhull2',
  'convexhull3',
  'convexhull4',
  'majoraxislength',
  'minoraxislength',
  'equivdiameter',
  'convexarea',
  'filledarea',
  'extrema',
  'orientation',
  'eulernumber',
  'centroid1',
  'centroid2',
  'eccentricity',
  'solidity',
  'perimeter',
  'extent',
  'area',
];

function extractPromptMetrics(prompt) {
  const text = normalize(prompt);
  return knownMetrics.filter((metric) => {
    const readable = metric.replace(/(axis|diameter|area|length)/g, ' $1').replace(/\s+/g, ' ').trim();
    const metricPattern = new RegExp(`\\b${metric}\\b`, 'i');
    const readablePattern = readable ? new RegExp(`\\b${readable}\\b`, 'i') : null;
    return metricPattern.test(text) || (readablePattern && readablePattern.test(text));
  });
}

function requestsAllFeatures(prompt) {
  const text = normalize(prompt);
  return /\b(all|complete|full|every|everything|overall)\b.*\b(features?|metrics?|properties|morphology|morphological|geometric|shape)\b/i.test(text)
    || /\b(features?|metrics?|properties|morphology|morphological|geometric|shape)\b.*\b(all|complete|full|every|everything|overall)\b/i.test(text)
    || /\b(correlation matrix|polar comparison|morphology comparison|shape metrics|feature space)\b/i.test(text);
}

function requestsAllCategories(prompt) {
  const text = normalize(prompt);
  return /\b(all|complete|full|every|everything)\b.*\b(categories|category|measurements?|features?|properties)\b/i.test(text)
    || /\b(categories|category|measurements?|features?|properties)\b.*\b(all|complete|full|every|everything)\b/i.test(text)
    || /\b(plot|chart|graph|visuali[sz]e|distribution|compare|comparison|polar|bar)\b.*\bcategories\b/i.test(text)
    || /\bcategories\b.*\b(plot|chart|graph|visuali[sz]e|distribution|compare|comparison|polar|bar)\b/i.test(text);
}

function hasChart(result) {
  return Array.isArray(result?.dashboardDefinition?.components)
    && result.dashboardDefinition.components.some((component) => component.type === 'chart' || component.widget === 'chart-widget');
}

function usesIdDrivenLookups(result) {
  const queries = result?.metadata?.executedQueries || {};
  return Object.values(queries).filter(Boolean).every((query) => {
    const sql = String(query);
    const onClauses = sql.match(/\bON\b[\s\S]*?(?=\bWHERE\b|\bGROUP BY\b|\bORDER BY\b|\bLIMIT\b|$)/gi) || [];
    return onClauses.every((clause) => {
      const normalizedClause = normalize(clause);
      if (!normalizedClause.includes('microorganism')) {
        return true;
      }

      return normalizedClause.includes('microorganism id')
        && !normalizedClause.includes('microorganism name')
        && !/\bon\b[\s\S]*\bmicroorganisms\b/i.test(clause);
    });
  });
}

function chartComponents(result) {
  return Array.isArray(result?.dashboardDefinition?.components)
    ? result.dashboardDefinition.components.filter((component) => component.type === 'chart' || component.widget === 'chart-widget')
    : [];
}

function categoryMetricChartUsesCategoryLabels(result) {
  const charts = chartComponents(result);
  const categoryMetrics = result?.datasets?.dataset?.categoryMetrics;
  return charts.some((component) => {
    const title = normalize(component?.title);
    return component?.data?.source === 'dataset.categoryMetrics'
      && component?.data?.transform?.labelField === 'label'
      && component?.data?.transform?.valueField === 'value'
      && !title.includes('count');
  }) && Array.isArray(categoryMetrics)
    && categoryMetrics.length >= 20
    && categoryMetrics.some((row) => normalize(row?.label) === 'area')
    && categoryMetrics.some((row) => normalize(row?.label) === 'solidity');
}

function usesMicroorganismCountInsteadOfCategoryMetrics(result) {
  const charts = chartComponents(result);
  const categoryMetrics = result?.datasets?.dataset?.categoryMetrics;
  const categoryCounts = result?.datasets?.dataset?.categoryCounts;

  return charts.some((component) => component?.data?.source !== 'dataset.categoryMetrics')
    && Array.isArray(categoryMetrics)
    && categoryMetrics.length === 0
    && Array.isArray(categoryCounts)
    && categoryCounts.length > 0;
}

function summary(result) {
  const promptIntent = result?.metadata?.generation?.promptIntent ?? {};
  const semanticIntent = promptIntent.semanticIntent ?? result?.metadata?.promptStructure?.semanticIntent ?? {};
  return {
    title: result?.dashboardDefinition?.title ?? null,
    selectedMetric: promptIntent.selectedMetric ?? null,
    selectedDimension: promptIntent.selectedDimension ?? null,
    selectedEntity: promptIntent.selectedEntity ?? null,
    allCategoryComparison: Boolean(promptIntent.allCategoryComparison),
    allMeasureComparison: Boolean(promptIntent.allMeasureComparison),
    action: semanticIntent.action ?? null,
    seriesCount: countSeries(result),
    components: Array.isArray(result?.dashboardDefinition?.components)
      ? result.dashboardDefinition.components.map((component) => component.type || component.widget)
      : [],
  };
}

function validate(sectionKind, prompt, result) {
  const text = normalize(prompt);
  const promptIntent = result?.metadata?.generation?.promptIntent ?? {};
  const seriesCount = countSeries(result);
  const selectedMetric = normalize(promptIntent.selectedMetric);
  const selectedDimension = normalize(promptIntent.selectedDimension);
  const semanticAction = normalize(promptIntent.semanticIntent?.action);
  const promptMetrics = extractPromptMetrics(prompt);
  const expectedPrimaryMetric = promptMetrics[0] ?? null;
  const allFeatures = requestsAllFeatures(prompt);
  const allCategories = requestsAllCategories(prompt);

  if (!usesIdDrivenLookups(result)) {
    return false;
  }

  if (sectionKind === 'single-metric') {
    return selectedMetric === expectedPrimaryMetric && seriesCount <= 1;
  }

  if (sectionKind === 'comparison' || sectionKind === 'multi-metric') {
    if (allFeatures) {
      return promptIntent.allMeasureComparison === true && seriesCount >= 5;
    }

    return seriesCount >= Math.max(2, promptMetrics.length);
  }

  if (sectionKind === 'ranking') {
    const selectedExpectedMetric = expectedPrimaryMetric ? selectedMetric === expectedPrimaryMetric : selectedMetric.length > 0;
    return text.includes('top') && selectedExpectedMetric;
  }

  if (sectionKind === 'relationship') {
    if (allFeatures) {
      return promptIntent.allMeasureComparison === true && seriesCount >= 5;
    }

    return seriesCount >= Math.max(2, promptMetrics.length);
  }

  if (sectionKind === 'chart-forcing') {
    if (allFeatures) {
      return hasChart(result) && promptIntent.allMeasureComparison === true && seriesCount >= 5;
    }

    return hasChart(result);
  }

  if (sectionKind === 'category-metrics') {
    if (allCategories) {
      return hasChart(result)
        && promptIntent.allCategoryComparison === false
        && usesMicroorganismCountInsteadOfCategoryMetrics(result);
    }

    return seriesCount >= Math.max(2, promptMetrics.length);
  }

  if (sectionKind === 'csv-category-distribution') {
    const categoryLabel = prompt.replace(/^show distribution of\s+/i, '').trim();
    const entry = morphologyCategoryEntries.find(([, meta]) => normalize(meta.label) === normalize(categoryLabel));
    const [expectedMetric, meta] = entry || [];
    const measureSql = String(result?.metadata?.executedQueries?.measureByDimension || '');
    const expectedValueExpression = `AVG(\"microbes\".\"${meta?.column}\") AS value`;

    return Boolean(expectedMetric)
      && selectedMetric === normalize(expectedMetric)
      && hasChart(result)
      && measureSql.includes(expectedValueExpression)
      && !/COUNT\(\*\) AS value/i.test(measureSql);
  }

  if (sectionKind === 'filter-only') {
    const queries = result?.metadata?.executedQueries || {};
    const measureSql = String(queries.measureByDimension || '');
    const previewSql = String(queries.preview || '');
    const filters = Array.isArray(promptIntent.filters) ? promptIntent.filters : [];
    const hasSolidityFilter = filters.some((filter) => filter.column === 'Solidity');
    const hasBoundingBoxFilter = filters.some((filter) => filter.column === 'BoundingBox1');

    if (prompt.includes('Compare Area and Solidity')) {
      return hasSolidityFilter
        && selectedMetric === 'area'
        && measureSql.includes('AVG(\"microbes\".\"Area\") AS value_1')
        && measureSql.includes('AVG(\"microbes\".\"Solidity\") AS value_2')
        && measureSql.includes('WHERE \"microbes\".\"Solidity\" > 0.8');
    }

    if (prompt.includes('Show Area')) {
      return hasSolidityFilter
        && selectedMetric === 'area'
        && measureSql.includes('AVG(\"microbes\".\"Area\") AS value')
        && !measureSql.includes('AVG(\"microbes\".\"Solidity\") AS value')
        && measureSql.includes('WHERE \"microbes\".\"Solidity\" > 0.8');
    }

    if (prompt.includes('Bounding Box 1')) {
      const boundingBoxIsOnlyFilter = hasBoundingBoxFilter
        && selectedMetric !== 'boundingbox1'
        && previewSql.includes('WHERE \"microbes\".\"BoundingBox1\" > 5');

      if (prompt.includes('distribution of Area')) {
        return hasBoundingBoxFilter
          && selectedMetric === 'area'
          && measureSql.includes('AVG(\"microbes\".\"Area\") AS value')
          && !measureSql.includes('AVG(\"microbes\".\"BoundingBox1\") AS value')
          && measureSql.includes('WHERE \"microbes\".\"BoundingBox1\" > 5');
      }

      return boundingBoxIsOnlyFilter;
    }

    return hasSolidityFilter
      && selectedMetric !== 'solidity'
      && previewSql.includes('WHERE \"microbes\".\"Solidity\" > 0.8');
  }

  if ((sectionKind === 'overview' || sectionKind === 'stats' || sectionKind === 'analysis' || sectionKind === 'grouping' || sectionKind === 'mixed') && allFeatures) {
    return promptIntent.allMeasureComparison === true && seriesCount >= 5;
  }

  if (sectionKind === 'fallback' || sectionKind === 'overview' || sectionKind === 'stats' || sectionKind === 'analysis' || sectionKind === 'grouping' || sectionKind === 'mixed') {
    return Boolean(selectedDimension || selectedMetric || semanticAction || result?.dashboardDefinition?.components?.length);
  }

  return true;
}

function expectsClarification(sectionKind, prompt, error) {
  if (error?.code !== 'INVALID_PROMPT') {
    return false;
  }

  const text = normalize(prompt);
  const broadSections = new Set(['overview', 'stats', 'grouping', 'fallback']);
  const broadPrompt = /\b(patterns?|insights?|stands out|overview|overall|distribution|summary|summari[sz]e|natural groups?|report|bacteria types)\b/i.test(text);
  const underspecifiedChart = /\b(chart|polar|comparison)\b/i.test(text)
    && /\b(morphology|features?)\b/i.test(text)
    && !/\b(area|perimeter|solidity|eccentricity|radius|convex|filled|microorganism|species|category|categories)\b/i.test(text);

  return (broadSections.has(sectionKind) && broadPrompt) || underspecifiedChart;
}

async function run() {
  let passed = 0;
  let failed = 0;
  const failures = [];

  for (const section of sections) {
    console.log(`\n## ${section.name}`);
    for (const prompt of section.prompts) {
      try {
        const result = await generateDashboardFromPrompt({
          prompt,
          databasePath,
          mode: 'plan',
        });
        const ok = validate(section.kind, prompt, result);
        const s = summary(result);
        if (ok) {
          passed += 1;
          console.log(`PASS | ${prompt}`);
        } else {
          failed += 1;
          failures.push({ prompt, section: section.name, summary: s });
          console.log(`WARN | ${prompt}`);
        }
        console.log(`  -> metric=${s.selectedMetric || '-'} dim=${s.selectedDimension || '-'} action=${s.action || '-'} allCategories=${s.allCategoryComparison ? 'yes' : 'no'} all=${s.allMeasureComparison ? 'yes' : 'no'} series=${s.seriesCount} comps=${s.components.join(',') || '-'}`);
      } catch (error) {
        if (expectsClarification(section.kind, prompt, error)) {
          passed += 1;
          console.log(`PASS | ${prompt}`);
          console.log(`  -> clarification=${error.promptHelp?.title || error.message}`);
        } else {
          failed += 1;
          failures.push({ prompt, section: section.name, error: error.message });
          console.log(`FAIL | ${prompt}`);
          console.log(`  -> ${error.message}`);
        }
      }
    }
  }

  console.log('\n## Summary');
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  if (failures.length) {
    console.log('\n## Failures');
    console.log(JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
