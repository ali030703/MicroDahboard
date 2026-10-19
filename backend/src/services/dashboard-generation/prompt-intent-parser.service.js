const { SCHEMA, resolveEntity, resolveMetric, resolveDimension, resolveSemanticQuery } = require('../../config/schema');
const { normalizeColumnKey } = require('../dashboard-schema-profile.service');
const { normalizePromptText, tokenizePromptText, buildPromptTokenSet, matchesPromptConcept, findPromptMatchIndex, escapeRegExp } = require('./prompt-text.util');
const { DEFAULT_CATEGORY_LIMIT, SUPPORTED_CHART_TEMPLATES, TEMPLATE_FAMILIES, normalizeAggregation, parseOptionalTopLimit } = require('./format.util');
const { ALL_CATEGORY_METRIC_KEYS } = require('./column-resolution.service');
const { extractNumericFilters } = require('./numeric-filter-parser.service');
const { metricMentionedBeforeFilterClause } = require('./semantic-catalog-matcher.service');

const MICROORGANISM_SCHEMA = SCHEMA.microorganism;

function parsePromptIntent(prompt) {
  const normalizedPrompt = normalizePromptText(prompt);
  const promptTokens = buildPromptTokenSet(normalizedPrompt);
  const biologicalConcepts = resolveBiologicalConcepts(normalizedPrompt, promptTokens);
  const conceptTokens = buildBiologicalConceptTokenSet(biologicalConcepts);
  const schemaTokens = new Set([...promptTokens, ...conceptTokens]);
  
  const topLimit = parseTopLimit(normalizedPrompt);
  const metric = detectMetricInstruction(normalizedPrompt);
  const chartTemplate = detectChartTemplate(normalizedPrompt);
  const requestedFamily = detectTemplateFamily(normalizedPrompt);
  const instructionSort = detectSortInstruction(normalizedPrompt);
  const broadMicrobeView = biologicalConcepts.broadMicrobeView;
  const filters = [];

  const semanticMetricKeys = collectSemanticMetricKeysFromPrompt(normalizedPrompt, schemaTokens)
    .filter((key) => resolveMetric(key, MICROORGANISM_SCHEMA)?.kind !== 'categorical');

  // Build token usage map (will be filled later) to allow a token to act as
  // a filter, a category, or a comparison measure depending on prompt cues.
  const tokenUsage = {}; // metricKey -> { asFilter, asCategory, explicitCompare }

  // Resolve candidate numeric filter columns from semantic metrics only.
  const allNumericColumns = Object.keys(MICROORGANISM_SCHEMA.metrics || {})
    .map((metricKey) => {
      const query = resolveSemanticQuery(
        {
          selectedEntity: 'organism',
          selectedMetric: metricKey,
          selectedDimension: 'species',
        },
        MICROORGANISM_SCHEMA,
      );

      const column = query?.columns?.metric;
      if (!column) {
        return null;
      }

      return {
        table: query.table,
        column,
        type: 'REAL',
      };
    })
    .filter(Boolean)
    .filter((entry, index, list) => list.findIndex((x) => normalizeColumnKey(x.column) === normalizeColumnKey(entry.column)) === index);
  
  // Parse numeric filters - these are columns used with comparison operators.
  // Resolve the filter column from the closest column mention to avoid binding
  // prompts like "solidity > 0.8" to a generic fallback measure such as area.
  const numericFilters = extractNumericFilters(prompt, allNumericColumns);

  // Helper: detect if a token is mentioned with category cues like "by X", "per X", "group by X".
  function isMentionedAsCategory(text, token) {
    if (!token) return false;
    const t = escapeRegExp(String(token));
    const pattern1 = new RegExp(`\\b(?:by|per|for each|group by)\\s+${t}\\b`, 'i');
    const pattern2 = new RegExp(`\\b${t}\\s+(?:by|per)\\b`, 'i');
    return pattern1.test(text) || pattern2.test(text);
  }

  // Populate tokenUsage based on prompt cues and numericFilters
  for (const metricKey of semanticMetricKeys) {
    tokenUsage[metricKey] = { asFilter: false, asCategory: false, explicitCompare: false };
    const resolved = resolveSemanticQuery({ selectedMetric: metricKey, selectedEntity: 'organism', selectedDimension: 'species' }, MICROORGANISM_SCHEMA);
    const col = resolved?.columns?.metric || resolved?.physical?.measureColumn;

    if (col && Array.isArray(numericFilters) && numericFilters.some(f => normalizeColumnKey(f.column) === normalizeColumnKey(col))) {
      tokenUsage[metricKey].asFilter = true;
    }

    if (isMentionedAsCategory(normalizedPrompt, metricKey) || isMentionedAsCategory(normalizedPrompt, resolved?.columns?.metric) || isMentionedAsCategory(normalizedPrompt, resolved?.physical?.measureColumn)) {
      tokenUsage[metricKey].asCategory = true;
    }

    // If the prompt explicitly pairs the word 'compare' with the token, mark it as explicitCompare
    try {
      const tokenEsc = escapeRegExp(String(metricKey));
      const comparePattern = new RegExp(`\\bcompare\\b.*\\b${tokenEsc}\\b|\\b${tokenEsc}\\b.*\\bcompare\\b`, 'i');
      if (comparePattern.test(normalizedPrompt)) tokenUsage[metricKey].explicitCompare = true;
    } catch (e) {
      // ignore regex errors for odd token strings
    }
  }

  const semanticDisplayMetricKeys = semanticMetricKeys.filter((metricKey) => {
    const usage = tokenUsage[metricKey];
    return !usage?.asFilter
      || usage.asCategory
      || metricMentionedBeforeFilterClause(normalizedPrompt, metricKey)
      || (usage.explicitCompare && !usage.asFilter);
  });

  const semanticComparisonQuery = semanticDisplayMetricKeys.length >= 2
    ? {
      type: 'comparison',
      measures: semanticDisplayMetricKeys.map((metricKey) => ({ semanticMetric: metricKey, column: metricKey })),
    }
    : null;

  const disableTablePatterns = [/without\s+table/i, /no\s+table/i, /charts\s+only/i];
  const enableTablePatterns = [/table/i, /rows/i, /preview/i, /data\s+details/i, /list/i];
  const disableStatsPatterns = [/no\s+stats/i, /no\s+kpi/i, /charts\s+only/i];
  const enableStatsPatterns = [/stats/i, /kpi/i, /metrics/i, /overview/i, /summary/i];

  const includeTable = hasAny(normalizedPrompt, disableTablePatterns) ? false : hasAny(normalizedPrompt, enableTablePatterns) ? true : null;
  const includeStats = hasAny(normalizedPrompt, disableStatsPatterns) ? false : hasAny(normalizedPrompt, enableStatsPatterns) ? true : null;

  const prefersTrend = hasAny(normalizedPrompt, [/trend/i, /time\s+series/i, /line/i, /over\s+time/i, /progression/i, /evolution/i]);

  const mentionedTables = [];
  const mentionedColumns = [];

  

  const measureColumnCandidates = [];
  const dimensionColumnCandidates = [];

  const concept = {
    primary: biologicalConcepts.primaryConcept,
    broad: broadMicrobeView,
    groups: biologicalConcepts.concepts.map((entry) => ({
      key: entry.key,
      meaning: entry.meaning,
      members: Array.isArray(entry.members) ? entry.members : [],
      expandsTo: Array.isArray(entry.expandsTo) ? entry.expandsTo : [],
    })),
  };

  const instruction = {
    chartType: chartTemplate,
    limit: topLimit,
    sort: instructionSort,
    metric,
  };
  const usesCategoryAsMicroorganismCount = promptRequestsMicroorganismCategoryCount(normalizedPrompt);
  const allCategoryComparison = false;
  const allMeasureComparison = !usesCategoryAsMicroorganismCount && promptRequestsAllMorphologyFeatures(normalizedPrompt)
    || /\b(?:show|display|compare|comparison|comparisons)\b.*\bmicroorganism(?:s)?\b.*\b(?:comparison|comparisons|compare)\b/i.test(normalizedPrompt)
    || /\bmicroorganism(?:s)?\b.*\b(?:comparison|comparisons|compare)\b/i.test(normalizedPrompt);
  const explicitlyRequestsChartSurface = /\b(chart|graph|plot|bar|line|doughnut|donut|polar)\b/i.test(normalizedPrompt);
  const prefersComparisonTable = allMeasureComparison && !allCategoryComparison && !explicitlyRequestsChartSurface;

  // Add numeric filters into intent filters
  filters.push(...numericFilters);
  
  const filterColumns = new Set((numericFilters || []).map(f => normalizeColumnKey(f.column)));
  let mergedComparisonQuery = semanticComparisonQuery;
  if (mergedComparisonQuery && Array.isArray(mergedComparisonQuery.measures)) {
    const measures = mergedComparisonQuery.measures.filter((m) => {
      const resolved = resolveSemanticQuery({ selectedMetric: m.semanticMetric, selectedEntity: 'organism', selectedDimension: 'species' }, MICROORGANISM_SCHEMA);
      const col = resolved?.columns?.metric || resolved?.physical?.measureColumn;
      const metricKey = m.semanticMetric;
      if (metricMentionedBeforeFilterClause(normalizedPrompt, metricKey)) return true;
      if (tokenUsage[metricKey]?.explicitCompare && !tokenUsage[metricKey]?.asFilter) return true;
      return !col || !filterColumns.has(normalizeColumnKey(col));
    });

    mergedComparisonQuery = measures.length >= 2 ? { type: 'comparison', measures } : null;
  }

  // Semantic resolution: try to resolve entity/metric/dimension from prompt tokens
  let selectedEntity = null;
  let selectedMetric = null;
  let selectedDimension = null;

  for (const token of schemaTokens) {
    if (!selectedEntity) {
      const e = resolveEntity(token);
      if (e) selectedEntity = e;
    }

    if (!selectedMetric) {
      const m = resolveMetric(token);
      if (m) selectedMetric = m;
    }

    if (!selectedDimension) {
      const d = resolveDimension(token);
      if (d) selectedDimension = d;
    }

    if (selectedEntity && selectedMetric && selectedDimension) break;
  }

  if (!selectedEntity) {
    selectedEntity = resolveEntity('organism');
  }

  if (!selectedDimension) {
    selectedDimension = resolveDimension('species');
  }

  if (!selectedMetric) {
    if (metric === 'count') {
      selectedMetric = resolveMetric('count');
    } else if (semanticDisplayMetricKeys.length > 0) {
      selectedMetric = chooseSemanticMetricForPrompt(semanticDisplayMetricKeys, semanticDisplayMetricKeys[0]);
    }

    selectedMetric = selectedMetric || resolveMetric('count');
  }

  if (semanticDisplayMetricKeys.length > 0) {
    selectedMetric = chooseSemanticMetricForPrompt(semanticDisplayMetricKeys, selectedMetric?.key) || selectedMetric;
  } else if (semanticMetricKeys.length > 0 && numericFilters.length > 0) {
    selectedMetric = resolveMetric('count');
  } else if (selectedMetric?.kind !== 'quantitative' || selectedMetric?.key === 'count') {
    selectedMetric = chooseSemanticMetricForPrompt(semanticDisplayMetricKeys, selectedMetric?.key) || selectedMetric;
  }

  const hasNumericFilter = numericFilters.length > 0;
  const selectedMetricIsDisplayLabel = selectedMetric?.kind === 'categorical' && selectedMetric?.key !== 'count';
  const hasDisplayMeasureMetric = semanticDisplayMetricKeys.some((metricKey) => {
    const metricDefinition = resolveMetric(metricKey);
    return metricDefinition?.kind === 'quantitative' && metricDefinition.key !== 'count';
  });

  if (hasNumericFilter && selectedMetricIsDisplayLabel && !hasDisplayMeasureMetric && !semanticComparisonQuery) {
    selectedMetric = resolveMetric('count');
  }

  const semanticIntent = {
    action: detectSemanticAction(normalizedPrompt),
    entity: selectedEntity?.key || 'organism',
    metric: selectedMetric?.key || 'count',
    dimension: selectedDimension?.key || 'species',
  };

  const semanticQuery = resolveSemanticQuery(
    {
      selectedEntity,
      selectedMetric,
      selectedDimension,
      semanticIntent,
      aggregation: metric,
      prefersTrend,
    },
    MICROORGANISM_SCHEMA,
  );
  const visualRequests = extractVisualRequests(normalizedPrompt, chartTemplate, allNumericColumns);
  const hasExplicitVisualRequests = Array.isArray(visualRequests) && visualRequests.length >= 2;
  const primaryVisualRequestFilters = hasExplicitVisualRequests
    ? []
    : (Array.isArray(visualRequests?.[0]?.filters)
      ? visualRequests[0].filters
      : numericFilters);

  return {
    rawPrompt: String(prompt || ''),
    normalizedPrompt,
    requestedFamily,
    chartTemplate,
    topLimit,
    includeTable,
    includeStats,
    prefersTrend,
    mentionedTables,
    mentionedColumns,
    concept,
    filters: primaryVisualRequestFilters,
    instruction,
    biologicalConcepts: biologicalConcepts.concepts.map((item) => item.key),
    microbeConcept: biologicalConcepts.primaryConcept,
    broadMicrobeView,
    sortBy: instructionSort.by,
    sortDirection: instructionSort.direction,
    aggregation: metric || (allMeasureComparison ? 'avg' : semanticQuery?.aggregations?.metric) || 'count',
    comparisonQuery: mergedComparisonQuery,
    allCategoryComparison,
    allMeasureComparison,
    prefersComparisonTable,
    selectedEntity,
    selectedMetric,
    selectedDimension,
    semanticIntent,
    semanticQuery,
    visualRequests,
  };
}

function parseTopLimit(normalizedPrompt) {
  const numericPatterns = [
    /\b(?:top|limit|first|last|show(?:\s+only)?|show\s+top|want)\s+(\d{1,3})\b/i,
    /\b(?:how\s+many|how\s+much)\s+(\d{1,3})\b/i,
    /\b(?:maximum|max|at\s+most)\s+(\d{1,3})\s+(?:rows|records|items|categories|microorganisms|charts|bars|results)\b/i,
  ];

  for (const pattern of numericPatterns) {
    const match = normalizedPrompt.match(pattern);
    if (match) {
      return Number(match[1]);
    }
  }

  const numberWords = {
    one: 1,
    two: 2,
    three: 3,
    four: 4,
    five: 5,
    six: 6,
    seven: 7,
    eight: 8,
    nine: 9,
    ten: 10,
    eleven: 11,
    twelve: 12,
    thirteen: 13,
    fourteen: 14,
    fifteen: 15,
    sixteen: 16,
    seventeen: 17,
    eighteen: 18,
    nineteen: 19,
    twenty: 20,
    thirty: 30,
    forty: 40,
    fifty: 50,
    sixty: 60,
    seventy: 70,
    eighty: 80,
    ninety: 90,
    hundred: 100,
  };

  const wordMatch = normalizedPrompt.match(
    /(?:top|limit|show(?:\s+only)?|first|last|how\s+many|how\s+much|up\s+to|maximum|max|want)\s+([a-z]+)/i,
  );

  if (!wordMatch) {
    return null;
  }

  return numberWords[wordMatch[1]] ?? null;
}

function detectChartTemplate(normalizedPrompt) {
  if (!normalizedPrompt) return null;
  if (/\b(?:bar\s+horizontal|horizontal)\b/i.test(normalizedPrompt)) return 'bar-horizontal';
  if (/\b(?:doughnut|donut|pie|ring|circle)\b/i.test(normalizedPrompt)) return 'doughnut';
  if (/\b(?:polar|radar|circular\s+radar)\b/i.test(normalizedPrompt)) return 'polar';
  if (/\b(?:line|trend|time\s+series|over\s+time|progression|evolution)\b/i.test(normalizedPrompt)) return 'line';
  if (/\b(?:bar|histogram|columns|comparison|column)\b/i.test(normalizedPrompt)) return 'bar';
  return null;
}

function extractVisualRequests(normalizedPrompt, fallbackChartTemplate, numericColumns = []) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return [];
  }

  // A request can combine charts and tables.  Treat each requested output as
  // its own clause so a filter or a set of fields in a table does not leak
  // into an adjacent chart (and vice versa).
  const outputPattern = /\b(?:bar\s+horizontal|horizontal\s+bar|bar\s+chart|line\s+chart|doughnut|donut|pie|polar|radar|bar|line|table)\b/gi;
  const occurrences = [];
  let match;

  while ((match = outputPattern.exec(text)) !== null) {
    const isTable = /^table$/i.test(match[0]);
    occurrences.push({
      index: match.index,
      kind: isTable ? 'table' : 'chart',
      template: isTable ? null : (detectChartTemplate(match[0]) || fallbackChartTemplate || null),
      length: match[0].length,
    });
  }

  if (occurrences.length < 2) {
    return [];
  }

  // Metrics are often stated once up front and shared across every chart
  // mentioned later (e.g. "compare solidity and area ... a bar chart and a
  // line chart"), so per-clause misses fall back to this prompt-wide pool.
  const promptWideTokens = buildPromptTokenSet(text);
  const promptWideMetricKeys = collectSemanticMetricKeysFromPrompt(text, promptWideTokens)
    .filter((key) => resolveMetric(key, MICROORGANISM_SCHEMA)?.kind !== 'categorical');

  const requests = [];

  for (let index = 0; index < occurrences.length; index += 1) {
    const current = occurrences[index];
    const next = occurrences[index + 1];
    // The first output's metric may be named at the end of its clause
    // ("average Area ... as a bar chart"), so only the very first clause's
    // scope starts at the beginning of the prompt. Every other clause -
    // chart or table alike - must start at its own keyword's position;
    // starting it after the *previous* clause's keyword instead (as the
    // earlier version of this code did) re-includes everything already
    // claimed by the previous clause, so its metrics/entities leak into
    // this one too.
    const clauseStart = index === 0 ? 0 : current.index;
    const clauseText = text
      .slice(clauseStart, next?.index ?? text.length)
      .replace(/^\s*(?:and|then|also|plus|,)+\s*/i, '')
      .replace(/\s*(?:and|then|also|plus|,)+\s*$/i, '')
      .trim();

    if (!clauseText) {
      continue;
    }

    const clauseTokens = buildPromptTokenSet(clauseText);
    const clauseMetrics = collectSemanticMetricKeysFromPrompt(clauseText, clauseTokens)
      .filter((key) => resolveMetric(key, MICROORGANISM_SCHEMA)?.kind !== 'categorical');
    const aggregation = detectMetricInstruction(clauseText);
    const clauseNumericFilters = Array.isArray(numericColumns) && numericColumns.length
      ? extractNumericFilters(clauseText, numericColumns)
      : [];

    // Separate display metrics from filter-only metrics within this clause.
    // A metric that appears only in a filter condition (e.g. "when solidity < 0.4")
    // should not be treated as something to show on the chart.
    const clauseFilterColumnKeys = new Set(
      clauseNumericFilters.map((f) => normalizeColumnKey(f.column)).filter(Boolean)
    );
    const displayMetricKeys = clauseMetrics.filter((mk) => {
      if (!clauseFilterColumnKeys.size) return true;
      const resolved = resolveSemanticQuery(
        { selectedMetric: mk, selectedEntity: 'organism', selectedDimension: 'species' },
        MICROORGANISM_SCHEMA
      );
      const col = resolved?.columns?.metric || resolved?.physical?.measureColumn;
      const isFilterCol = col && clauseFilterColumnKeys.has(normalizeColumnKey(col));
      if (!isFilterCol) return true;
      // Keep it if it's explicitly mentioned before the filter clause word
      return metricMentionedBeforeFilterClause(clauseText, mk);
    });

    // No metric mentioned in a chart clause: fall back to the shared prompt-wide
    // metrics. When their count matches the number of charts, pair them up
    // one-to-one in the order both were mentioned; otherwise share them all.
    if (current.kind === 'chart' && !displayMetricKeys.length && promptWideMetricKeys.length) {
      if (promptWideMetricKeys.length === occurrences.length) {
        displayMetricKeys.push(promptWideMetricKeys[index]);
      } else {
        displayMetricKeys.push(...promptWideMetricKeys);
      }
    }

    const metricKey = displayMetricKeys[0] ?? null;
    const metricKeys = displayMetricKeys.filter(Boolean);

    requests.push({
      chartKind: current.kind === 'table' ? 'table' : (metricKey ? 'measureChart' : 'categoryChart'),
      chartTemplate: current.template || fallbackChartTemplate || null,
      semanticMetricKey: metricKey,
      semanticMetricKeys: metricKeys,
      aggregation: aggregation || null,
      filters: clauseNumericFilters,
      rawPrompt: clauseText,
    });
  }

  return requests.length >= 2 ? requests : [];
}

function detectSortInstruction(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return { by: null, direction: null };
  }

  if (/(ascending|asc|lowest|smallest|least|bottom|fewest|earliest)/i.test(text)) {
    return { by: 'value', direction: 'asc' };
  }

  if (/(descending|desc|highest|largest|most|top|greatest|latest)/i.test(text)) {
    return { by: 'value', direction: 'desc' };
  }

  if (/(alphabetical|alphabetic|label|name)/i.test(text)) {
    return { by: 'label', direction: /(descending|desc|reverse)/i.test(text) ? 'desc' : 'asc' };
  }

  return { by: null, direction: null };
}

function detectMetricInstruction(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return null;
  }

  if (/\b(count|counts|frequency|occurrence|total records|record count)\b/i.test(text) || /\bnumber\s+of\b/i.test(text)) {
    return 'count';
  }

  if (/\b(average|avg|mean|typical)\b/i.test(text)) {
    return 'avg';
  }

  if (/\b(sum|total|overall)\b/i.test(text)) {
    return 'sum';
  }

  if (/\b(minimum|lowest|min)\b/i.test(text)) {
    return 'min';
  }

  if (/\b(maximum|highest|max)\b/i.test(text)) {
    return 'max';
  }

  return null;
}

function detectSemanticAction(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return 'distribution';
  }

  if (/(trend|time\s+series|over\s+time|evolution|progression)/i.test(text)) {
    return 'trend';
  }

  if (/(compare|comparison|versus|vs)/i.test(text)) {
    return 'comparison';
  }

  if (/(top\s*\d+|top\b|highest|largest|most)/i.test(text)) {
    return 'top-n';
  }

  return 'distribution';
}

function resolveBiologicalConcepts(normalizedPrompt, promptTokens) {
  const tokens = promptTokens instanceof Set ? promptTokens : buildPromptTokenSet(normalizedPrompt);
  const hasFungi = tokens.has('fungi');
  const hasYeast = tokens.has('yeast');
  const hasMicrobeCollection = tokens.has('microorganism') || tokens.has('microbe') || tokens.has('category') || tokens.has('categories');
  const broadWords = /\b(others|other|all|everything|any|mixed|various|multiple|both|together)\b/i.test(normalizedPrompt);

  const concepts = [];

  if (hasFungi) {
    concepts.push({
      key: 'fungi',
      meaning: 'different organism group',
      members: getBiologicalConceptMembers('fungi'),
    });
  }

  if (hasYeast) {
    concepts.push({
      key: 'fungi',
      meaning: 'different organism group',
      parent: true,
    });
    concepts.push({
      key: 'yeast',
      meaning: 'subtype of fungi',
      members: getBiologicalConceptMembers('yeast'),
    });
  }

  if (hasMicrobeCollection) {
    concepts.push({
      key: 'microbes',
      meaning: 'collection of groups',
      expandsTo: ['fungi', 'yeast'],
    });
  }

  const uniqueGroupCount = [hasFungi, hasMicrobeCollection].filter(Boolean).length + (hasYeast ? 1 : 0);

  return {
    concepts,
    primaryConcept: hasFungi ? 'fungi' : hasYeast ? 'yeast' : hasMicrobeCollection ? 'microbes' : null,
    broadMicrobeView: broadWords || hasMicrobeCollection || uniqueGroupCount > 1,
  };
}

function buildBiologicalConceptTokenSet(conceptStructure) {
  const tokens = new Set();

  if (!conceptStructure || !Array.isArray(conceptStructure.concepts)) {
    return tokens;
  }

  for (const concept of conceptStructure.concepts) {
    if (concept?.key) {
      tokens.add(concept.key);
    }

    if (Array.isArray(concept?.members)) {
      for (const member of concept.members) {
        tokenizePromptText(member).forEach((token) => tokens.add(token));
      }
    }

    if (Array.isArray(concept?.expandsTo)) {
      concept.expandsTo.forEach((entry) => tokens.add(entry));
    }
  }

  if (conceptStructure.primaryConcept === 'microbes' || conceptStructure.broadMicrobeView) {
    tokens.add('microbe');
    tokens.add('microorganism');
    tokens.add(MICROORGANISM_SCHEMA.table);
  }

  return tokens;
}

function getBiologicalConceptMembers(group) {
  switch (group) {
    case 'fungi':
      return ['Yeast', 'Raizopus', 'Penicillum', 'Aspergillus sp'];
    case 'yeast':
      return ['Yeast'];
    default:
      return [];
  }
}

function isBroadMicrobePrompt(normalizedPrompt, promptTokens) {
  return resolveBiologicalConcepts(normalizedPrompt, promptTokens).broadMicrobeView;
}

function collectSemanticMetricKeysFromPrompt(normalizedPrompt, promptTokens) {
  const matches = [];
  const promptAliases = MICROORGANISM_SCHEMA.promptAliases || {};

  Object.entries(MICROORGANISM_SCHEMA.metrics || {}).forEach(([metricKey, metric]) => {
    const promptAliasCandidates = Object.entries(promptAliases)
      .filter(([, canonical]) => normalizeColumnKey(canonical) === normalizeColumnKey(metricKey))
      .map(([raw]) => raw);
    const candidates = [
      metricKey,
      metric?.label,
      ...(Array.isArray(metric?.aliases) ? metric.aliases : []),
      ...promptAliasCandidates,
    ]
      .map((value) => normalizePromptText(value))
      .filter(Boolean)
      .filter((value, index, list) => list.indexOf(value) === index);

    for (const candidate of candidates) {
      const pattern = new RegExp(`\\b${escapeRegExp(candidate)}\\b`, 'i');
      const match = normalizedPrompt.match(pattern);

      if (match?.index !== undefined) {
        matches.push({
          key: metricKey,
          start: match.index,
          end: match.index + candidate.length,
          length: candidate.length,
        });
      }
    }
  });

  matches.sort((left, right) => {
    if (left.start !== right.start) return left.start - right.start;
    return right.length - left.length;
  });

  const accepted = [];
  const occupiedRanges = [];
  const seen = new Set();

  for (const match of matches) {
    if (seen.has(match.key)) {
      continue;
    }

    const overlaps = occupiedRanges.some((range) => match.start < range.end && match.end > range.start);
    if (overlaps) {
      continue;
    }

    seen.add(match.key);
    occupiedRanges.push({ start: match.start, end: match.end });
    accepted.push(match.key);
  }

  return accepted;
}

function chooseSemanticMetricForPrompt(semanticMetricKeys, fallbackMetricKey) {
  const keys = Array.isArray(semanticMetricKeys) ? semanticMetricKeys : [];
  const quantitative = keys.find((metricKey) => {
    const metric = resolveMetric(metricKey, MICROORGANISM_SCHEMA);
    return metric?.kind === 'quantitative' && metric.key !== 'count';
  });

  if (quantitative) {
    return resolveMetric(quantitative, MICROORGANISM_SCHEMA);
  }

  const nonLabelMetric = keys.find((metricKey) => {
    const metric = resolveMetric(metricKey, MICROORGANISM_SCHEMA);
    return metric?.key && metric.key !== 'microorganisms';
  });

  if (nonLabelMetric) {
    return resolveMetric(nonLabelMetric, MICROORGANISM_SCHEMA);
  }

  return fallbackMetricKey ? resolveMetric(fallbackMetricKey, MICROORGANISM_SCHEMA) : null;
}

function promptRequestsAllProperties(value) {
  const text = normalizePromptText(value);

  if (!text) {
    return false;
  }

  const propertyTerms = '(?:propert(?:y|ies)|propriet(?:y|ies)|proprit(?:y|ies)|features?|metrics?|measures?|columns?|fields?|profile|details?|morpholog(?:y|ical)|geometric|shape)';
  const allTerms = '(?:all|complete|full|every|everything|overall)';

  return new RegExp(`\\b${allTerms}\\b.*\\b${propertyTerms}\\b`, 'i').test(text)
    || new RegExp(`\\b${propertyTerms}\\b.*\\b${allTerms}\\b`, 'i').test(text);
}

function promptRequestsAllCategories(normalizedPrompt) {
  normalizePromptText(normalizedPrompt);
  return false;
}

function promptRequestsMicroorganismCategoryCount(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return false;
  }

  return /\bcategories?\b/i.test(text);
}

function promptRequestsAllMorphologyFeatures(normalizedPrompt) {
  const text = normalizePromptText(normalizedPrompt);

  if (!text) {
    return false;
  }

  const requestsFeatureSet = promptRequestsAllProperties(text);

  const broadMorphologyAnalysis = /\b(?:morpholog(?:y|ical)|geometric|shape)\b.*\b(?:profile|summary|analysis|overview|comparison|compare|properties)\b/i.test(text);
  const featureAnalysis = /\b(?:correlation\s+matrix|morphology\s+comparison|shape\s+metrics|feature\s+space)\b/i.test(text)
    || /\bpolar\s+comparison\b.*\b(?:all|features?|metrics?|measures?|properties|morpholog(?:y|ical)|geometric|shape)\b/i.test(text)
    || /\b(?:all|features?|metrics?|measures?|properties|morpholog(?:y|ical)|geometric|shape)\b.*\bpolar\s+comparison\b/i.test(text)
    || /\b(?:correlation|relationship|patterns?|anomal(?:y|ies)|outliers?|cluster|group|structure)\b.*\b(?:features?|metrics?|measures?|properties|morpholog(?:y|ical)|geometric|shape|dataset)\b/i.test(text)
    || /\b(?:features?|metrics?|measures?|properties|morpholog(?:y|ical)|geometric|shape|dataset)\b.*\b(?:correlation|relationship|patterns?|anomal(?:y|ies)|outliers?|cluster|group|structure)\b/i.test(text);

  return requestsFeatureSet || broadMorphologyAnalysis || featureAnalysis;
}

function detectTemplateFamily(normalizedPrompt) {
  if (!normalizedPrompt) {
    return null;
  }

  if (/(compact|minimal|lean|fast|small|essential|lightweight)/i.test(normalizedPrompt)) {
    return 'compact';
  }

  if (/(analytical|detailed|deep|investigative|diagnostic)/i.test(normalizedPrompt)) {
    return 'analytical';
  }

  if (/(visual|charts\s+only|storytelling|visual\s+impact)/i.test(normalizedPrompt)) {
    return 'visual';
  }

  if (/(balanced|standard|executive|managerial)/i.test(normalizedPrompt)) {
    return 'balanced';
  }

  return null;
}

function normalizeTemplateFamily(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return TEMPLATE_FAMILIES.includes(normalized) ? normalized : null;
}

function hasAny(text, patterns) {
  return patterns.some((pattern) => pattern.test(text));
}

module.exports = {
  parsePromptIntent,
  parseTopLimit,
  detectChartTemplate,
  detectSortInstruction,
  detectMetricInstruction,
  detectSemanticAction,
  resolveBiologicalConcepts,
  buildBiologicalConceptTokenSet,
  getBiologicalConceptMembers,
  isBroadMicrobePrompt,
  collectSemanticMetricKeysFromPrompt,
  chooseSemanticMetricForPrompt,
  promptRequestsAllProperties,
  promptRequestsAllCategories,
  promptRequestsAllMorphologyFeatures,
  detectTemplateFamily,
  normalizeTemplateFamily,
  hasAny,
};