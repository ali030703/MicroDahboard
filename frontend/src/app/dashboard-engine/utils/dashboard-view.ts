// Purpose: Builds display labels, summaries, and descriptors for dashboard metadata and UI panels.
import { ChartData } from 'chart.js';
import {
  DashboardGenerationMetadata,
  DashboardModel,
  DashboardTemplate,
  MicrobeComparisonRow,
} from '../models/dashboard.model';
import { ComparisonMetricConfig, ComparisonMetricKey } from '../config/dashboard-ui.config';

type DashboardComponent = DashboardModel['components'][number] | null;

export function buildDashboardStatusLabel(
  dashboardDefinition: DashboardTemplate | null,
  generationMetadata: DashboardGenerationMetadata | null,
) {
  if (!dashboardDefinition) {
    return '';
  }

  const status = (dashboardDefinition.status ?? 'draft').toUpperCase();
  const selectedFamily = generationMetadata?.selectedTemplateFamily ?? 'balanced';
  const confidence = generationMetadata?.generation.promptConfidence;
  const confidenceLabel = confidence
    ? `Confidence: ${confidence.label} ${confidence.percentage}%`
    : null;

  return [status, selectedFamily, confidenceLabel].filter(Boolean).join(' · ');
}

export function buildPromptConfidenceLabel(generationMetadata: DashboardGenerationMetadata | null) {
  const confidence = generationMetadata?.generation.promptConfidence;

  if (!confidence) {
    return '';
  }

  return `Prompt confidence: ${confidence.label} (${confidence.percentage}%)`;
}

export function buildSelectedComponentKindLabel(component: DashboardComponent) {
  if (!component) {
    return 'No selection';
  }

  if (component.type === 'chart') {
    return 'Chart';
  }

  if (component.type === 'table') {
    return 'Table';
  }

  return 'Stats';
}

export function buildSelectedComponentHint(component: DashboardComponent) {
  if (!component) {
    return 'Select a dashboard panel to apply focused changes.';
  }

  if (component.type === 'chart') {
    return 'Adjust the selected chart without regenerating the full dashboard.';
  }

  if (component.type === 'table') {
    return 'Adjust the selected table without regenerating the full dashboard.';
  }

  return 'Adjust the selected metrics without regenerating the full dashboard.';
}

export function buildSelectedBindingsLabel(generationMetadata: DashboardGenerationMetadata | null) {
  if (!generationMetadata) {
    return '';
  }

  const bindings = generationMetadata.generation.selectedDataBindings;
  const labels = [`Table: ${bindings.table}`, `Top categories: ${bindings.categoryLimit}`];

  if (bindings.dimensionColumn) {
    labels.push(`Dimension: ${bindings.dimensionColumn}`);
  }

  if (bindings.measureColumn) {
    labels.push(`Measure: ${bindings.measureColumn}`);
  }

  return labels.join(' · ');
}

export function buildSourceDescriptor(generationMetadata: DashboardGenerationMetadata | null) {
  if (!generationMetadata) {
    return '';
  }

  const sourceLabel = generationMetadata.sourceType === 'sql'
    ? 'Temporary SQL'
    : generationMetadata.sourceType === 'json'
      ? 'JSON dataset'
      : generationMetadata.sourceType === 'chatbot'
        ? 'Chatbot payload'
        : generationMetadata.sourceType === 'manual'
          ? 'Manual payload'
          : 'SQLite';
  const sourcePath = generationMetadata.sourcePath ?? generationMetadata.databasePath;

  return `${sourceLabel} · ${sourcePath}`;
}

export function buildPromptIntentSummary(generationMetadata: DashboardGenerationMetadata | null) {
  if (!generationMetadata) {
    return 'No intent available';
  }

  const promptIntent = generationMetadata.generation.promptIntent;
  const parts: string[] = [];

  if (promptIntent.chartTemplate) {
    parts.push(`Chart: ${promptIntent.chartTemplate}`);
  }

  if (promptIntent.topLimit) {
    parts.push(`Top: ${promptIntent.topLimit}`);
  }

  if (promptIntent.includeTable === false) {
    parts.push('Without table');
  }

  if (promptIntent.includeStats === false) {
    parts.push('Without stats');
  }

  if (promptIntent.prefersTrend) {
    parts.push('Trend preference');
  }

  return parts.length ? parts.join(' · ') : 'Standard analysis request';
}

export interface DashboardGenerationSummaryInput {
  componentKinds: Array<string | null | undefined>;
  chartTemplate?: string | null;
  filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;
  visualRequests?: Array<{
    chartTemplate?: string | null;
    semanticMetricKey?: string | null;
    semanticMetricKeys?: string[];
    resolvedMeasureColumns?: string[];
    microorganismNames?: string[];
    filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;
    rawPrompt?: string;
  }>;
  selectedMetric?: string | null;
  mentionedMeasureColumns?: Array<string | null | undefined>;
  microorganismNames?: Array<string | null | undefined>;
}

export function buildDashboardGenerationSummary({
  componentKinds,
  chartTemplate,
  filters,
  visualRequests,
  selectedMetric,
  mentionedMeasureColumns,
  microorganismNames,
}: DashboardGenerationSummaryInput): string {
  const visualRequestSummary = buildVisualRequestSummary(visualRequests);
  if (visualRequestSummary) {
    return visualRequestSummary;
  }

  const kindCounts = new Map<string, number>();

  for (const kind of componentKinds ?? []) {
    const normalizedKind = (kind ?? '').trim().toLowerCase();

    if (!normalizedKind) {
      continue;
    }

    kindCounts.set(normalizedKind, (kindCounts.get(normalizedKind) ?? 0) + 1);
  }

  const componentParts: string[] = [];

  if (kindCounts.get('chart')) {
    const count = kindCounts.get('chart') ?? 0;
    componentParts.push(count > 1 ? `${count} charts` : 'chart');
  }

  if (kindCounts.get('table')) {
    const count = kindCounts.get('table') ?? 0;
    componentParts.push(count > 1 ? `${count} tables` : 'table');
  }

  if (kindCounts.get('stats')) {
    const count = kindCounts.get('stats') ?? 0;
    componentParts.push(count > 1 ? `${count} stats panels` : 'stats panel');
  }

  const hasKnownChartTemplate = Boolean(String(chartTemplate ?? '').trim());
  const componentSummary = hasKnownChartTemplate
    ? formatChartTemplateSummary(chartTemplate)
    : componentParts.length
      ? componentParts.join(' and ')
      : 'chart view';

  const metricLabels = [selectedMetric, ...(mentionedMeasureColumns ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeDashboardSummaryValue(value));

  const uniqueMetricLabels: string[] = [];
  const seenMetricLabels = new Set<string>();

  for (const label of metricLabels) {
    const key = label.toLowerCase();

    if (!label || seenMetricLabels.has(key)) {
      continue;
    }

    seenMetricLabels.add(key);
    uniqueMetricLabels.push(label);
  }

  const metricLabel = formatDashboardSummaryList(uniqueMetricLabels);
  const microorganismLabels = (microorganismNames ?? [])
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => value.trim());

  const uniqueMicroorganismLabels: string[] = [];
  const seenMicroorganismLabels = new Set<string>();

  for (const name of microorganismLabels) {
    const key = name.toLowerCase();

    if (!name || seenMicroorganismLabels.has(key)) {
      continue;
    }

    seenMicroorganismLabels.add(key);
    uniqueMicroorganismLabels.push(name);
  }

  const microorganismLabel = formatDashboardSummaryList(uniqueMicroorganismLabels);
  const filterClause = buildVisualRequestFilterSummary(
    removeRedundantMicroorganismFilters(filters, uniqueMicroorganismLabels),
  );

  const article = /^[aeiou]/i.test(componentSummary) ? 'an' : 'a';
  const parts: string[] = [`Built ${componentParts.length === 1 || hasKnownChartTemplate ? article : 'a'} ${componentSummary}`];

  if (metricLabel) {
    parts.push(microorganismLabel ? `showing ${metricLabel} for ${microorganismLabel}` : `showing ${metricLabel}`);
  } else if (microorganismLabel) {
    parts.push(`for ${microorganismLabel}`);
  }

  if (filterClause) {
    parts.push(`where ${filterClause}`);
  }

  return `${parts.join(' ')}.`;
}

function buildVisualRequestSummary(visualRequests?: Array<{
  chartTemplate?: string | null;
  semanticMetricKey?: string | null;
  semanticMetricKeys?: string[];
  resolvedMeasureColumns?: string[];
  microorganismNames?: string[];
  filters?: Array<{ column?: string; operator?: string; value?: unknown }>;
  rawPrompt?: string;
}>): string | null {
  const requests = Array.isArray(visualRequests) ? visualRequests.filter(Boolean) : [];

  if (requests.length < 2) {
    return null;
  }

  const clauses = requests
    .map((request) => {
      const chartSummary = formatChartTemplateSummary(request?.chartTemplate);
      const resolvedMeasureColumns = Array.isArray(request?.resolvedMeasureColumns)
        ? request.resolvedMeasureColumns.filter(Boolean)
        : [];
      const metricLabels = dedupeNormalizedLabels([
        ...resolvedMeasureColumns,
        ...(resolvedMeasureColumns.length
          ? []
          : [
            ...(Array.isArray(request?.semanticMetricKeys) ? request.semanticMetricKeys : []),
            request?.semanticMetricKey,
          ]),
      ]);
      const microorganismLabels = dedupeRawLabels(Array.isArray(request?.microorganismNames) ? request.microorganismNames : []);
      const metricLabel = formatDashboardSummaryList(metricLabels);
      const microorganismLabel = formatDashboardSummaryList(microorganismLabels);
      const mentionsMicroorganismScope = /\b(?:of|by|for)\s+microorganisms?\b/i.test(String(request?.rawPrompt || ''));
      const filterClause = buildVisualRequestFilterSummary(
        removeRedundantMicroorganismFilters(request?.filters, microorganismLabels),
      );

      const clauseParts = [`a ${chartSummary}`];

      if (metricLabel) {
        clauseParts.push(`showing ${metricLabel}`);
      }

      if (microorganismLabel) {
        clauseParts.push(`for ${microorganismLabel}`);
      } else if (mentionsMicroorganismScope) {
        clauseParts.push('of microorganism');
      }

      if (filterClause) {
        clauseParts.push(`where ${filterClause}`);
      }

      return clauseParts.join(' ');
    })
    .filter(Boolean);

  if (!clauses.length) {
    return null;
  }

  return `Built ${formatDashboardSummaryList(clauses)}.`;
}

function buildVisualRequestFilterSummary(filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>): string {
  if (!Array.isArray(filters) || !filters.length) return '';

  return filters.slice(0, 3).map((f) => {
    if (f?.semanticRole === 'microorganism' && f?.label) {
      return String(f.operator ?? '').toLowerCase() === 'in'
        ? `Microorganisms: ${f.label}`
        : `Microorganism: ${f.label}`;
    }

    const col = String(f?.column ?? '').trim();
    const op = String(f?.operator ?? '').trim();
    const val = f?.value;
    if (!col || !op) return '';
    const valStr = Array.isArray(val) ? `${val[0]} and ${val[1]}` : String(val ?? '');
    const opLabel: Record<string, string> = {
      '<': '<', '>': '>', '<=': '≤', '>=': '≥', '=': '=', 'between': 'between',
    };
    return `${col} ${opLabel[op] ?? op} ${valStr}`;
  }).filter(Boolean).join(', ');
}

function removeRedundantMicroorganismFilters(
  filters: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }> | undefined,
  microorganismLabels: string[],
) {
  const knownLabels = new Set(microorganismLabels.map((label) => label.trim().toLowerCase()));

  return (filters ?? []).filter((filter) => {
    if (filter?.semanticRole !== 'microorganism' || !filter.label) {
      return true;
    }

    const filterLabels = filter.label
      .split(',')
      .map((label) => label.trim().toLowerCase())
      .filter(Boolean);

    return !filterLabels.length || !filterLabels.every((label) => knownLabels.has(label));
  });
}

function dedupeNormalizedLabels(values: Array<string | null | undefined>): string[] {
  const normalized = values
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map((value) => normalizeDashboardSummaryValue(value));

  const uniqueValues: string[] = [];
  const seenValues = new Set<string>();

  for (const value of normalized) {
    const key = value.toLowerCase();

    if (!value || seenValues.has(key) || isMicroorganismLabel(value)) {
      continue;
    }

    seenValues.add(key);
    uniqueValues.push(value);
  }

  return uniqueValues;
}

function isMicroorganismLabel(value: string): boolean {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === 'microorganism'
    || normalized === 'microorganisms'
    || normalized === 'microbe'
    || normalized === 'microbes'
    || normalized === 'organism'
    || normalized === 'organisms'
    || normalized === 'species';
}

function dedupeRawLabels(values: Array<string | null | undefined>): string[] {
  const uniqueValues: string[] = [];
  const seenValues = new Set<string>();

  for (const value of values) {
    if (typeof value !== 'string' || !value.trim()) {
      continue;
    }

    const normalized = value.trim();
    const key = normalized.toLowerCase();

    if (seenValues.has(key)) {
      continue;
    }

    seenValues.add(key);
    uniqueValues.push(normalized);
  }

  return uniqueValues;
}

function formatChartTemplateSummary(chartTemplate?: string | null): string {
  const normalizedTemplate = String(chartTemplate ?? '').trim().toLowerCase();

  if (!normalizedTemplate) {
    return 'chart';
  }

  const templateLabels: Record<string, string> = {
    bar: 'bar chart',
    'bar-horizontal': 'horizontal bar chart',
    line: 'line chart',
    doughnut: 'doughnut chart',
    polar: 'polar chart',
  };

  return templateLabels[normalizedTemplate] ?? `${normalizedTemplate} chart`;
}

function normalizeDashboardSummaryValue(value: string): string {
  const trimmed = value.trim().replace(/\s+/g, ' ');

  if (!trimmed) {
    return '';
  }

  const withSpaces = trimmed
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return withSpaces
    .split(' ')
    .map((part) => part.toLowerCase() === 'and' ? 'and' : part)
    .join(' ')
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

function formatDashboardSummaryList(values: string[]): string | null {
  const normalizedValues = values
    .map((value) => value.trim())
    .filter((value) => value.length > 0);

  if (!normalizedValues.length) {
    return null;
  }

  if (normalizedValues.length === 1) {
    return normalizedValues[0];
  }

  if (normalizedValues.length === 2) {
    return `${normalizedValues[0]} and ${normalizedValues[1]}`;
  }

  return `${normalizedValues.slice(0, -1).join(', ')}, and ${normalizedValues[normalizedValues.length - 1]}`;
}

export function getComparisonRow(rows: MicrobeComparisonRow[], id: number) {
  return rows.find((row) => row.microorganism_id === id);
}

export function toComparisonMetricValue(row: MicrobeComparisonRow, key: ComparisonMetricKey) {
  const value = row[key];
  return typeof value === 'number' ? value : Number(value ?? 0);
}

export function buildComparisonChartData(
  leftRow: MicrobeComparisonRow | undefined,
  rightRow: MicrobeComparisonRow | undefined,
  metrics: ComparisonMetricConfig[],
): ChartData<'bar'> {
  if (!leftRow || !rightRow) {
    return {
      labels: metrics.map((metric) => metric.label),
      datasets: [],
    };
  }

  return {
    labels: metrics.map((metric) => metric.label),
    datasets: [
      {
        label: leftRow.microorganism_name,
        data: metrics.map((metric) => toComparisonMetricValue(leftRow, metric.key)),
        backgroundColor: 'rgba(30, 58, 95, 0.78)',
        borderRadius: 8,
      },
      {
        label: rightRow.microorganism_name,
        data: metrics.map((metric) => toComparisonMetricValue(rightRow, metric.key)),
        backgroundColor: 'rgba(74, 122, 181, 0.78)',
        borderRadius: 8,
      },
    ],
  };
}

export function buildComparisonInsights(
  leftRow: MicrobeComparisonRow | undefined,
  rightRow: MicrobeComparisonRow | undefined,
  metrics: ComparisonMetricConfig[],
) {
  if (!leftRow || !rightRow) {
    return [];
  }

  const insights: string[] = [];

  for (const metric of metrics) {
    const leftValue = toComparisonMetricValue(leftRow, metric.key);
    const rightValue = toComparisonMetricValue(rightRow, metric.key);

    if (leftValue === rightValue) {
      continue;
    }

    const winner = leftValue > rightValue ? leftRow.microorganism_name : rightRow.microorganism_name;
    const gap = Math.abs(leftValue - rightValue).toFixed(metric.digits);
    insights.push(`${winner} has a higher value for ${metric.label} (delta ${gap}).`);
  }

  if (!insights.length) {
    insights.push('The two microorganisms are very similar across available metrics.');
  }

  return insights.slice(0, 3);
}
