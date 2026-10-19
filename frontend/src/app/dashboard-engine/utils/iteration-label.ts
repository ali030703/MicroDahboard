export function buildPromptBasedIterationLabel(prompt: string | null | undefined): string {
  const normalizedPrompt = (prompt || '').trim();

  if (!normalizedPrompt) {
    return 'New view';
  }

  const withoutLeadIn = normalizedPrompt
    .replace(/\s+/g, ' ')
    .replace(/^(show|display|create|generate|make|plot|visualize|analyze|give me|give|find|identify|summarize|describe)\s+/i, '')
    .trim();

  const cleaned = withoutLeadIn
    .replace(/\b(the|a|an)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned) {
    return 'New view';
  }

  const chartType = extractChartType(cleaned);
  const metricOrCategory = extractMetricOrCategory(cleaned);
  const microorganism = extractMicroorganism(cleaned);

  const parts = [chartType, metricOrCategory, microorganism].filter(Boolean);

  if (!parts.length) {
    return cleaned;
  }

  return parts.join(' · ');
}

function extractChartType(text: string): string | null {
  const chartPatterns = [
    { regex: /\bbar chart\b/i, label: 'Bar chart' },
    { regex: /\bline chart\b/i, label: 'Line chart' },
    { regex: /\bscatter plot\b/i, label: 'Scatter plot' },
    { regex: /\bdoughnut chart\b/i, label: 'Doughnut chart' },
    { regex: /\bpolar chart\b/i, label: 'Polar chart' },
    { regex: /\btable\b/i, label: 'Table' },
    { regex: /\bdashboard\b/i, label: 'Dashboard' },
    { regex: /\bchart\b/i, label: 'Chart' },
  ];

  for (const pattern of chartPatterns) {
    if (pattern.regex.test(text)) {
      return pattern.label;
    }
  }

  return null;
}

function extractMetricOrCategory(text: string): string | null {
  const withoutChart = text
    .replace(/\bbar chart\b/gi, '')
    .replace(/\bline chart\b/gi, '')
    .replace(/\bscatter plot\b/gi, '')
    .replace(/\bdoughnut chart\b/gi, '')
    .replace(/\bpolar chart\b/gi, '')
    .replace(/\btable\b/gi, '')
    .replace(/\bdashboard\b/gi, '')
    .replace(/\bchart\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!withoutChart) {
    return null;
  }

  const phrasePatterns = [
    /\bdistribution of\s+(.+)/i,
    /\brelationship between\s+(.+)/i,
    /\bcorrelation between\s+(.+)/i,
    /\bcompare\s+(.+)/i,
    /\bcomparison of\s+(.+)/i,
    /\btop\s+\d+\s+(.+)/i,
    /\baverage\s+(.+)/i,
    /\bshow\s+(.+)/i,
  ];

  for (const pattern of phrasePatterns) {
    const match = withoutChart.match(pattern);
    if (match?.[1]) {
      return normalizeLabel(match[1]);
    }
  }

  return normalizeLabel(withoutChart);
}

function extractMicroorganism(text: string): string | null {
  const microorganismMatch = text.match(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b/i);

  if (!microorganismMatch) {
    return null;
  }

  const candidate = microorganismMatch[1];
  const lower = candidate.toLowerCase();

  if (['area', 'perimeter', 'solidity', 'eccentricity', 'convexarea', 'filledarea', 'extent', 'majoraxislength', 'minoraxislength', 'equivdiameter', 'orientation', 'eulernumber', 'boundingbox1', 'boundingbox2', 'boundingbox3', 'boundingbox4', 'convexhull1', 'convexhull2', 'convexhull3', 'convexhull4', 'centroid1', 'centroid2', 'microorganisms', 'microorganism'].includes(lower)) {
    return null;
  }

  return normalizeLabel(candidate);
}

function normalizeLabel(value: string): string {
  return value
    .replace(/\bdistribution of\b/gi, 'Distribution of')
    .replace(/\brelationship between\b/gi, 'Relationship between')
    .replace(/\bcorrelation between\b/gi, 'Correlation between')
    .replace(/\btop\s+(\d+)\b/gi, 'Top $1')
    .replace(/\baverage\b/gi, 'Average')
    .replace(/\bavg\b/gi, 'Average')
    .replace(/\borganisms?\b/gi, 'organisms')
    .replace(/\bmicroorganisms?\b/gi, 'microorganisms')
    .replace(/\b(all|every)\s+microorganisms?\b/gi, '')
    .replace(/\ball\b/gi, '')
    .replace(/\bevery\b/gi, '')
    .replace(/\bbalanced\b/gi, '')
    .replace(/\borganism\b/gi, '')
    .replace(/\bmicrobes?\b/gi, '')
    .replace(/\bfor\b/gi, '')
    .replace(/\bwith\b/gi, '')
    .replace(/\bwhere\b/gi, '')
    .replace(/\band\b/gi, '')
    .replace(/\bof\b/gi, '')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}
