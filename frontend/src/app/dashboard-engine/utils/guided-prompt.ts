// Purpose: Defines guided prompt groups and turns selected options into prompt text.
import { DashboardTemplateFamily } from '../models/dashboard.model';

export type GuidedPromptGroupKey = 'style' | 'intent' | 'chart' | 'volume' | 'elements';

export interface GuidedPromptOption {
  label: string;
  value: string;
  templateFamily?: DashboardTemplateFamily;
}

export interface GuidedPromptGroup {
  key: GuidedPromptGroupKey;
  title: string;
  subtitle: string;
  options: GuidedPromptOption[];
}

export type GuidedPromptSelections = Record<GuidedPromptGroupKey, string>;

export const DEFAULT_GUIDED_PROMPT_SELECTIONS: GuidedPromptSelections = {
  style: 'balanced',
  intent: 'overview',
  chart: 'bar',
  volume: 'top 10',
  elements: 'with table',
};

export const GUIDED_PROMPT_GROUPS: GuidedPromptGroup[] = [
  {
    key: 'style',
    title: 'Dashboard layout',
    subtitle: 'Select the dashboard density and emphasis.',
    options: [
      { label: 'Balanced', value: 'balanced', templateFamily: 'balanced' },
      { label: 'Analytical', value: 'analytical', templateFamily: 'analytical' },
      { label: 'Visual', value: 'visual', templateFamily: 'visual' },
      { label: 'Compact', value: 'compact', templateFamily: 'compact' },
    ],
  },
  {
    key: 'intent',
    title: 'Analysis goal',
    subtitle: 'Select the primary analytical objective.',
    options: [
      { label: 'Overview', value: 'overview' },
      { label: 'Trend', value: 'trend' },
      { label: 'Comparison', value: 'comparison' },
      { label: 'Detail', value: 'detail' },
    ],
  },
  {
    key: 'chart',
    title: 'Primary view',
    subtitle: 'Select the main visualization or table format.',
    options: [
      { label: 'Bar', value: 'bar' },
      { label: 'Bar horizontal', value: 'bar horizontal' },
      { label: 'Line', value: 'line' },
      { label: 'Doughnut', value: 'doughnut' },
      { label: 'Polar', value: 'polar' },
      { label: 'Table', value: 'table' },
    ],
  },
  {
    key: 'volume',
    title: 'Data volume',
    subtitle: 'Set the number of records shown in ranked views.',
    options: [
      { label: 'Top 5', value: 'top 5' },
      { label: 'Top 8', value: 'top 8' },
      { label: 'Top 10', value: 'top 10' },
      { label: 'Top 12', value: 'top 12' },
    ],
  },
  {
    key: 'elements',
    title: 'Included panels',
    subtitle: 'Select the supporting dashboard panels.',
    options: [
      { label: 'With table', value: 'with table' },
      { label: 'Without table', value: 'without table' },
      { label: 'With KPI', value: 'with kpi' },
      { label: 'Charts only', value: 'charts only' },
    ],
  },
];

export function buildGuidedPromptText(selection: GuidedPromptSelections) {
  return [
    `${selection.style} dashboard`,
    `for ${selection.intent}`,
    selection.chart === 'table' ? 'as table' : `with ${selection.chart}`,
    selection.volume,
    selection.elements,
  ].filter(Boolean).join(' ');
}

export const DEFAULT_GUIDED_PROMPT_TEXT = buildGuidedPromptText(DEFAULT_GUIDED_PROMPT_SELECTIONS);
