// Purpose: Applies parsed widget edit commands to dashboard models.
import { DashboardModel } from '../models/dashboard.model';
import { matchesWidgetLabel, normalizeWidgetLabel, WidgetCommandChartTemplate, WidgetCommandPlan } from './widget-command';

type DashboardComponent = DashboardModel['components'][number];
type ChartDashboardComponent = Extract<DashboardComponent, { type: 'chart' }>;
type StatsDashboardComponent = Extract<DashboardComponent, { type: 'stats' }>;
type TableDashboardComponent = Extract<DashboardComponent, { type: 'table' }>;

export interface WidgetCommandApplicationResult {
  dashboardModel: DashboardModel;
  changed: boolean;
  summary: string;
}

export function applyWidgetCommandPlanToDashboard(
  dashboardModel: DashboardModel,
  componentId: string,
  plan: WidgetCommandPlan,
): WidgetCommandApplicationResult {
  const selectedComponent = dashboardModel.components.find((component) => component.id === componentId);

  if (!selectedComponent) {
    return {
      dashboardModel,
      changed: false,
      summary: 'No panel selected.',
    };
  }

  if (selectedComponent.type === 'chart') {
    return applyChartCommand(dashboardModel, selectedComponent, plan);
  }

  if (selectedComponent.type === 'table') {
    return applyTableCommand(dashboardModel, selectedComponent, plan);
  }

  return applyStatsCommand(dashboardModel, selectedComponent, plan);
}

function applyChartCommand(
  dashboardModel: DashboardModel,
  component: ChartDashboardComponent,
  plan: WidgetCommandPlan,
): WidgetCommandApplicationResult {
  const chart = { ...component.chart };
  let data = [...component.data];
  const summaryParts: string[] = [];
  let changed = false;

  if (plan.chartTemplate && chart.template !== plan.chartTemplate) {
    chart.template = plan.chartTemplate;
    summaryParts.push(`chart type -> ${plan.chartTemplate}`);
    changed = true;
  }

  if (plan.filterTokens.length) {
    const filtered = data.filter((point) => matchesWidgetLabel(point.label, plan.filterTokens));

    if (filtered.length) {
      data = filtered;
      summaryParts.push(`filtered to ${plan.filterTokens.slice(0, 4).join(', ')}`);
      changed = true;
    }
  }

  if (plan.sortDirection) {
    const sortByLabel = chart.template === 'line';
    data = [...data].sort((left, right) => {
      if (sortByLabel) {
        const comparison = normalizeWidgetLabel(left.label).localeCompare(normalizeWidgetLabel(right.label));
        return plan.sortDirection === 'desc' ? comparison * -1 : comparison;
      }

      const leftValue = typeof left.value === 'number' ? left.value : Number(left.value ?? 0);
      const rightValue = typeof right.value === 'number' ? right.value : Number(right.value ?? 0);
      return plan.sortDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    });
    summaryParts.push(`sorted ${plan.sortDirection === 'asc' ? 'ascending' : 'descending'}`);
    changed = true;
  }

  if (plan.limit && plan.limit > 0 && data.length > plan.limit) {
    data = data.slice(0, plan.limit);
    summaryParts.push(`limited to top ${plan.limit}`);
    changed = true;
  }

  if (!summaryParts.length && !changed) {
    summaryParts.push('No local chart changes applied.');
  }

  return {
    dashboardModel: replaceComponent(dashboardModel, component.id, {
      ...component,
      chart,
      data,
    }),
    changed,
    summary: `Updated ${component.title}: ${summaryParts.join(' · ')}`,
  };
}

function applyTableCommand(
  dashboardModel: DashboardModel,
  component: TableDashboardComponent,
  plan: WidgetCommandPlan,
): WidgetCommandApplicationResult {
  if (plan.chartTemplate) {
    const chartComponent = convertTableToChartComponent(component, plan.chartTemplate);
    const chartResult = applyChartCommand(dashboardModel, chartComponent, plan);
    const chartSummary = chartResult.summary.replace(`Updated ${component.title}: `, '');
    const summaryParts = [`chart type -> ${plan.chartTemplate}`];

    if (chartSummary && chartSummary !== 'No local chart changes applied.') {
      summaryParts.push(chartSummary);
    }

    return {
      ...chartResult,
      changed: true,
      summary: `Updated ${component.title}: ${summaryParts.join(' · ')}`,
    };
  }

  let columns = [...component.columns];
  let rows = [...component.rows];
  const summaryParts: string[] = [];
  let changed = false;

  if (plan.filterTokens.length) {
    const matchingColumns = columns.filter((column) =>
      matchesWidgetLabel(column.label, plan.filterTokens) || matchesWidgetLabel(column.key, plan.filterTokens),
    );

    if (matchingColumns.length) {
      columns = matchingColumns;
      summaryParts.push(`showing columns ${matchingColumns.map((column) => column.label).join(', ')}`);
      changed = true;
    } else {
      const filteredRows = rows.filter((row) =>
        columns.some((column) => matchesWidgetLabel(String(row[column.key] ?? ''), plan.filterTokens)),
      );

      if (filteredRows.length) {
        rows = filteredRows;
        summaryParts.push(`filtered rows by ${plan.filterTokens.slice(0, 4).join(', ')}`);
        changed = true;
      }
    }
  }

  if (plan.sortDirection && columns.length) {
    const sortKey = columns[0].key;
    rows = [...rows].sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];

      if (typeof leftValue === 'number' && typeof rightValue === 'number') {
        return plan.sortDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }

      const comparison = normalizeWidgetLabel(String(leftValue ?? '')).localeCompare(normalizeWidgetLabel(String(rightValue ?? '')));
      return plan.sortDirection === 'desc' ? comparison * -1 : comparison;
    });
    summaryParts.push(`sorted ${plan.sortDirection === 'asc' ? 'ascending' : 'descending'}`);
    changed = true;
  }

  if (plan.limit && plan.limit > 0 && rows.length > plan.limit) {
    rows = rows.slice(0, plan.limit);
    summaryParts.push(`limited to top ${plan.limit} rows`);
    changed = true;
  }

  if (!summaryParts.length && !changed) {
    summaryParts.push('No local table changes applied.');
  }

  return {
    dashboardModel: replaceComponent(dashboardModel, component.id, {
      ...component,
      columns,
      rows,
    }),
    changed,
    summary: `Updated ${component.title}: ${summaryParts.join(' · ')}`,
  };
}

function convertTableToChartComponent(
  component: TableDashboardComponent,
  chartTemplate: WidgetCommandChartTemplate,
): ChartDashboardComponent {
  return {
    id: component.id,
    type: 'chart',
    title: component.title,
    description: component.description,
    chart: {
      template: chartTemplate,
    },
    data: buildChartDataFromTable(component),
  };
}

function buildChartDataFromTable(component: TableDashboardComponent) {
  if (!component.columns.length || !component.rows.length) {
    return [];
  }

  const labelColumn = component.columns[0];
  const valueColumn = pickBestChartValueColumn(component);

  return component.rows.map((row, index) => ({
    label: String(row[labelColumn.key] ?? `Row ${index + 1}`),
    value: toChartValue(row[valueColumn.key], index + 1),
  }));
}

function pickBestChartValueColumn(component: TableDashboardComponent) {
  const preferredColumns = component.columns.slice(1);

  for (const column of preferredColumns) {
    if (component.rows.some((row) => Number.isFinite(toChartValue(row[column.key], Number.NaN)))) {
      return column;
    }
  }

  return preferredColumns[0] ?? component.columns[0];
}

function toChartValue(value: string | number | null | undefined, fallback: number) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  const parsedValue = Number(String(value ?? '').replace(/,/g, '').trim());
  return Number.isFinite(parsedValue) ? parsedValue : fallback;
}

function applyStatsCommand(
  dashboardModel: DashboardModel,
  component: StatsDashboardComponent,
  plan: WidgetCommandPlan,
): WidgetCommandApplicationResult {
  let cards = [...component.data];
  const summaryParts: string[] = [];
  let changed = false;

  if (plan.filterTokens.length) {
    const filteredCards = cards.filter((card) => matchesWidgetLabel(card.label, plan.filterTokens));

    if (filteredCards.length) {
      cards = filteredCards;
      summaryParts.push(`filtered cards by ${plan.filterTokens.slice(0, 4).join(', ')}`);
      changed = true;
    }
  }

  if (plan.sortDirection) {
    cards = [...cards].sort((left, right) => {
      const leftValue = typeof left.value === 'number' ? left.value : Number(left.value ?? 0);
      const rightValue = typeof right.value === 'number' ? right.value : Number(right.value ?? 0);

      if (Number.isFinite(leftValue) && Number.isFinite(rightValue)) {
        return plan.sortDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
      }

      const comparison = normalizeWidgetLabel(left.label).localeCompare(normalizeWidgetLabel(right.label));
      return plan.sortDirection === 'desc' ? comparison * -1 : comparison;
    });
    summaryParts.push(`sorted ${plan.sortDirection === 'asc' ? 'ascending' : 'descending'}`);
    changed = true;
  }

  if (plan.limit && plan.limit > 0 && cards.length > plan.limit) {
    cards = cards.slice(0, plan.limit);
    summaryParts.push(`limited to top ${plan.limit}`);
    changed = true;
  }

  if (!summaryParts.length && !changed) {
    summaryParts.push('No local KPI changes applied.');
  }

  return {
    dashboardModel: replaceComponent(dashboardModel, component.id, {
      ...component,
      data: cards,
    }),
    changed,
    summary: `Updated ${component.title}: ${summaryParts.join(' · ')}`,
  };
}

function replaceComponent(
  dashboardModel: DashboardModel,
  componentId: string,
  updatedComponent: DashboardComponent,
) {
  return {
    ...dashboardModel,
    components: dashboardModel.components.map((component) =>
      component.id === componentId ? updatedComponent : component,
    ),
  };
}
