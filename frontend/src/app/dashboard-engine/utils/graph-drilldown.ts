// Purpose: Builds graph drilldown prompt groups, selections, and preview text.
import {
  ChartPointSelection,
  ChartWidgetModel,
  DashboardChartConfig,
  DashboardDataPoint,
} from '../models/dashboard.model';

export type GraphDrilldownGroupKey = 'focus' | 'shape' | 'scope' | 'order';

export interface GraphDrilldownOption {
  label: string;
  value: string;
}

export interface GraphDrilldownGroup {
  key: GraphDrilldownGroupKey;
  title: string;
  subtitle: string;
  options: GraphDrilldownOption[];
}

export type GraphDrilldownSelections = Record<GraphDrilldownGroupKey, string>;

export const DEFAULT_GRAPH_DRILLDOWN_SELECTIONS: GraphDrilldownSelections = {
  focus: 'selected-point',
  shape: 'bar',
  scope: '5',
  order: 'keep',
};

function getShapeLabel(template: DashboardChartConfig['template']) {
  if (template === 'bar-horizontal') {
    return 'horizontal bar chart';
  }

  if (template === 'line') {
    return 'line chart';
  }

  if (template === 'doughnut') {
    return 'doughnut chart';
  }

  if (template === 'polar') {
    return 'polar chart';
  }

  return 'bar chart';
}

function toChartTemplate(shape: string): DashboardChartConfig['template'] {
  if (shape === 'bar-horizontal' || shape === 'line' || shape === 'doughnut' || shape === 'polar') {
    return shape;
  }

  return 'bar';
}

function toScopeLimit(value: string) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function toNumericValue(item: DashboardDataPoint) {
  return typeof item.value === 'number' ? item.value : Number(item.value ?? 0);
}

function sortByChoice(items: DashboardDataPoint[], order: string) {
  if (order === 'asc') {
    return [...items].sort((left, right) => toNumericValue(left) - toNumericValue(right));
  }

  if (order === 'desc') {
    return [...items].sort((left, right) => toNumericValue(right) - toNumericValue(left));
  }

  return [...items];
}

function selectClosestPoints(items: DashboardDataPoint[], selection: ChartPointSelection, limit: number) {
  const targetValue = selection.pointValue;

  return [...items]
    .map((item, index) => ({
      item,
      index,
      distance: Math.abs(toNumericValue(item) - targetValue),
    }))
    .sort((left, right) => left.distance - right.distance || left.index - right.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function selectTopPoints(items: DashboardDataPoint[], limit: number) {
  return [...items]
    .sort((left, right) => toNumericValue(right) - toNumericValue(left))
    .slice(0, limit);
}

function keepSelectedPointFirst(items: DashboardDataPoint[], selection: ChartPointSelection) {
  const selectedPoint = items.find((item) => item.label === selection.pointLabel);

  if (!selectedPoint) {
    return items;
  }

  return [
    selectedPoint,
    ...items.filter((item) => item.label !== selection.pointLabel),
  ];
}

export function createGraphDrilldownSelections(selection: ChartPointSelection): GraphDrilldownSelections {
  return {
    ...DEFAULT_GRAPH_DRILLDOWN_SELECTIONS,
    shape: selection.chartTemplate,
  };
}

export function buildGraphDrilldownGroups(selection: ChartPointSelection): GraphDrilldownGroup[] {
  const pointLabel = selection.pointLabel;

  return [
    {
      key: 'focus',
      title: 'Drilldown focus',
      subtitle: 'Define the subset for the derived view.',
      options: [
        { label: `Selected point: ${pointLabel}`, value: 'selected-point' },
        { label: 'Closest values', value: 'closest-values' },
        { label: 'Top values', value: 'top-values' },
        { label: 'Full series', value: 'full-series' },
      ],
    },
    {
      key: 'shape',
      title: 'Preview format',
      subtitle: 'Select the chart style for the derived view.',
      options: [
        { label: 'Bar', value: 'bar' },
        { label: 'Bar horizontal', value: 'bar-horizontal' },
        { label: 'Line', value: 'line' },
        { label: 'Doughnut', value: 'doughnut' },
        { label: 'Polar', value: 'polar' },
      ],
    },
    {
      key: 'scope',
      title: 'Scope',
      subtitle: 'Set how many points remain in the preview.',
      options: [
        { label: 'Top 5', value: '5' },
        { label: 'Top 8', value: '8' },
        { label: 'Top 10', value: '10' },
        { label: 'Top 12', value: '12' },
      ],
    },
    {
      key: 'order',
      title: 'Order',
      subtitle: 'Select the preview sort order.',
      options: [
        { label: 'Keep order', value: 'keep' },
        { label: 'Ascending', value: 'asc' },
        { label: 'Descending', value: 'desc' },
      ],
    },
  ];
}

export function buildGraphDrilldownText(selection: ChartPointSelection, choices: GraphDrilldownSelections) {
  return [
    `Drilldown for ${selection.componentTitle}`,
    `focused on ${selection.pointLabel}`,
    choices.focus.replace(/-/g, ' '),
    getShapeLabel(toChartTemplate(choices.shape)),
    `top ${choices.scope}`,
    choices.order,
  ].filter(Boolean).join(' · ');
}

export function buildGraphDrilldownPreview(
  sourceChart: ChartWidgetModel | null,
  selection: ChartPointSelection | null,
  choices: GraphDrilldownSelections,
): ChartWidgetModel | null {
  if (!sourceChart || !selection) {
    return null;
  }

  const sourceData = [...sourceChart.data];
  const scopeLimit = toScopeLimit(choices.scope);
  let derivedData = sourceData;

  if (choices.focus === 'selected-point') {
    derivedData = sourceData.filter((item) => item.label === selection.pointLabel);
  } else if (choices.focus === 'closest-values') {
    derivedData = selectClosestPoints(sourceData, selection, scopeLimit ?? 5);
  } else if (choices.focus === 'top-values') {
    derivedData = selectTopPoints(sourceData, scopeLimit ?? 5);
  }

  if (choices.focus === 'full-series') {
    derivedData = sourceData;
  }

  if (choices.focus !== 'selected-point' && choices.focus !== 'full-series') {
    derivedData = keepSelectedPointFirst(derivedData, selection);
  }

  if (scopeLimit && choices.focus !== 'selected-point') {
    derivedData = derivedData.slice(0, scopeLimit);
  }

  derivedData = sortByChoice(derivedData, choices.order);

  if (choices.focus === 'selected-point' && !derivedData.length) {
    derivedData = sourceData.filter((item) => item.label === selection.pointLabel);
  }

  return {
    ...sourceChart,
    id: `${sourceChart.id}-drilldown`,
    title: `Drilldown: ${selection.pointLabel}`,
    description: buildGraphDrilldownText(selection, choices),
    chart: {
      ...sourceChart.chart,
      template: toChartTemplate(choices.shape),
    },
    data: derivedData,
  };
}
