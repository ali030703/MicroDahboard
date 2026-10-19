// Purpose: Transforms dashboard definitions and datasets into frontend renderable dashboard models.
// === FILE DESCRIPTION ===
// Transforms API data into the final dashboard model.
// Applies required transformations for charts, KPIs, and other widgets.
// Keeps data logic separate from rendering.
import {
  DashboardApiBundle,
  DashboardDataPoint,
  DashboardDatasets,
  DashboardModel,
  DashboardTableColumn,
  DashboardTableRow,
  DashboardTemplate,
  DashboardTemplateChartComponent,
  DashboardTemplateComponent,
  DashboardTemplateStatsComponent,
  DashboardTemplateTableComponent,
  DashboardCollectionTransformDefinition,
  DashboardTransformDefinition,
  DashboardSeriesDataPoint,
} from '../models/dashboard.model';

const sizeOrder = [
  'Very Small (<0.5)',
  'Small (0.5-1)',
  'Medium (1-3)',
  'Large (>=3)',
];

const CATEGORY_DISPLAY_NAME_MAP: Record<string, string> = {
  area: 'Area',
  perimeter: 'Perimeter',
  eccentricity: 'Eccentricity',
  solidity: 'Solidity',
  raddi: 'Radius',
  radius: 'Radius',
  equivdiameter: 'Equivalent Diameter',
  equivalentdiameter: 'Equivalent Diameter',
  extrema: 'Extrema',
  filledarea: 'Filled Area',
  extent: 'Extent',
  orientation: 'Orientation',
  eulernumber: 'Euler Number',
  boundingbox1: 'Bounding Box 1',
  boundingbox2: 'Bounding Box 2',
  boundingbox3: 'Bounding Box 3',
  boundingbox4: 'Bounding Box 4',
  convexhull1: 'Convex Hull 1',
  convexhull2: 'Convex Hull 2',
  convexhull3: 'Convex Hull 3',
  convexhull4: 'Convex Hull 4',
  majoraxislength: 'Major Axis Length',
  minoraxislength: 'Minor Axis Length',
  convexarea: 'Convex Area',
  centroid1: 'Centroid X',
  centroidx: 'Centroid X',
  centroid2: 'Centroid Y',
  centroidy: 'Centroid Y',
  microorganisms: 'Microorganism',
  microorganismid: 'Microorganism ID',
  microorganismname: 'Microorganism',
  recordcount: 'Rows',
};

function normalizeCategoryKey(value: unknown) {
  return String(value ?? '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
}

function prettifyGeneratedLabel(value: string) {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function displayCategoryLabel(value: unknown, preferredLabel?: unknown) {
  const supplied = String(preferredLabel ?? '').trim();

  if (supplied) {
    return supplied;
  }

  const raw = String(value ?? '').trim();
  if (!raw) {
    return raw;
  }

  return CATEGORY_DISPLAY_NAME_MAP[normalizeCategoryKey(raw)] ?? prettifyGeneratedLabel(raw);
}

function getPreferredRowLabel(row: Record<string, unknown>, field: string) {
  const candidates = [
    `${field}Label`,
    `${field}_label`,
    `${field}Display`,
    `${field}_display`,
    'displayLabel',
    'labelText',
  ].filter((candidate) => candidate !== field);

  for (const candidate of candidates) {
    const value = row[candidate];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return undefined;
}

function shortenLabel(value: string, maxLength = 24) {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}...` : value;
}

function formatMetric(value: unknown, format?: 'integer' | 'decimal') {
  if (value === null || value === undefined || value === '') {
    return '—';
  }

  if (typeof value !== 'number') {
    return String(value);
  }

  if (format === 'integer') {
    return Math.round(value).toString();
  }

  if (format === 'decimal') {
    return value.toFixed(2);
  }

  return value;
}

function formatTableCell(value: unknown): DashboardTableRow[string] {
  if (typeof value !== 'number') {
    return value as DashboardTableRow[string];
  }

  if (!Number.isFinite(value)) {
    return String(value);
  }

  if (Number.isInteger(value)) {
    return value;
  }

  return value.toFixed(2).replace(/\.?0+$/, '');
}

function resolvePath(target: unknown, path: string): unknown {
  if (!path) {
    return target;
  }

  return path.split('.').reduce<unknown>((current, segment) => {
    if (!current || typeof current !== 'object') {
      return undefined;
    }

    return (current as Record<string, unknown>)[segment];
  }, target);
}

function toCollection(source: unknown) {
  return Array.isArray(source) ? (source as Array<Record<string, unknown>>) : [];
}

function toRecord(source: unknown) {
  return source && typeof source === 'object' && !Array.isArray(source)
    ? (source as Record<string, unknown>)
    : {};
}

function normalizeGeneratedTitle(title: string) {
  return displayCategoryLabel(String(title || '').replace(/\bFeature\s+[A-Z0-9]+\b/gi, 'Metric'));
}

function orderCollection(rows: Array<Record<string, unknown>>, sortBy?: string, sortDirection: 'asc' | 'desc' = 'asc') {
  if (!sortBy) {
    return rows;
  }

  return [...rows].sort((left, right) => {
    const leftValue = left[sortBy];
    const rightValue = right[sortBy];

    if (sortBy === 'sizeGroup') {
      return sizeOrder.indexOf(String(leftValue)) - sizeOrder.indexOf(String(rightValue));
    }

    if (typeof leftValue === 'number' && typeof rightValue === 'number') {
      return sortDirection === 'desc' ? rightValue - leftValue : leftValue - rightValue;
    }

    const comparison = String(leftValue ?? '').localeCompare(String(rightValue ?? ''));
    return sortDirection === 'desc' ? comparison * -1 : comparison;
  });
}

function buildChartData(source: unknown, transform: DashboardTransformDefinition): DashboardDataPoint[] {
  if (transform.type !== 'collection') {
    return [];
  }

  const orderedRows = orderCollection(
    toCollection(source),
    transform.sortBy ?? (transform.labelField === 'sizeGroup' ? 'sizeGroup' : undefined),
    transform.sortDirection,
  );

  const limitedRows = transform.limit ? orderedRows.slice(0, transform.limit) : orderedRows;

  const hasSeries = limitedRows.some((row) => Array.isArray(row['series']));

  if (hasSeries) {
    return limitedRows.map((row) => {
      const series = Array.isArray(row['series'])
        ? row['series'].map((entry) => ({
          label: displayCategoryLabel(entry?.label ?? 'Series', (entry as Record<string, unknown>)?.['displayLabel']),
          value: Number(entry?.value ?? 0),
        }))
        : [];

      return {
        label: transform.labelMaxLength ? shortenLabel(normalizedLabelFromRow(row, transform), transform.labelMaxLength) : normalizedLabelFromRow(row, transform),
        value: series.reduce((sum, entry) => sum + Number(entry.value ?? 0), 0),
        series,
      };
    });
  }

  return limitedRows.map((row) => {
    const rawLabel = row[transform.labelField];
    const rawValue = row[transform.valueField];
    const normalizedLabel = rawLabel === null || rawLabel === undefined || rawLabel === ''
      ? (transform.emptyLabel ?? 'N/A')
      : displayCategoryLabel(rawLabel, getPreferredRowLabel(row, transform.labelField));

    return {
      label: transform.labelMaxLength ? shortenLabel(normalizedLabel, transform.labelMaxLength) : normalizedLabel,
      value: typeof rawValue === 'number' ? rawValue : Number(rawValue ?? 0),
    };
  });
}

function normalizedLabelFromRow(row: Record<string, unknown>, transform: DashboardCollectionTransformDefinition) {
  const rawLabel = row[transform.labelField];
  return rawLabel === null || rawLabel === undefined || rawLabel === ''
    ? (transform.emptyLabel ?? 'N/A')
    : displayCategoryLabel(rawLabel, getPreferredRowLabel(row, transform.labelField));
}

function buildStatsData(source: unknown, transform: DashboardTransformDefinition): DashboardDataPoint[] {
  if (transform.type !== 'keyValue') {
    return [];
  }

  const record = toRecord(source);

  return transform.fields.map((field) => ({
    label: field.label,
    value: formatMetric(resolvePath(record, field.path), field.format),
  }));
}

function buildTableModel(source: unknown, transform: DashboardTransformDefinition) {
  if (transform.type !== 'table') {
    return { columns: [], rows: [] };
  }

  const rows = toCollection(source);
  const limitedRows = transform.limit ? rows.slice(0, transform.limit) : rows;
  const columns = transform.columns?.length
    ? transform.columns
    : Object.keys(limitedRows[0] ?? {}).map((key) => ({ key, label: key }));
  const displayColumns = columns.map((column) => ({
    ...column,
    label: displayCategoryLabel(column.key, column.label),
  }));

  const normalizedRows = limitedRows.map((row) =>
    Object.fromEntries(displayColumns.map((column) => [column.key, formatTableCell(row[column.key])])),
  );

  return {
    columns: displayColumns,
    rows: normalizedRows,
  };
}

type TransformResolver<T> = (source: unknown, transform: T) => unknown;

const transformResolvers: Record<DashboardTransformDefinition['type'], TransformResolver<DashboardTransformDefinition>> = {
  collection: (source, transform) => buildChartData(source, transform),
  keyValue: (source, transform) => buildStatsData(source, transform),
  table: (source, transform) => buildTableModel(source, transform),
};

function buildChartComponent(datasets: DashboardDatasets, component: DashboardTemplateChartComponent): DashboardModel['components'][number] {
  const source = resolvePath(datasets, component.data.source);
  const transformType = component.data.transform.type;
  const chartData = transformResolvers[transformType](source, component.data.transform) as DashboardDataPoint[];

  return {
    id: component.id,
    type: 'chart',
    chart: component.chart,
    title: normalizeGeneratedTitle(component.title),
    description: component.description,
    data: chartData,
  };
}

function buildStatsComponent(datasets: DashboardDatasets, component: DashboardTemplateStatsComponent): DashboardModel['components'][number] {
  const source = resolvePath(datasets, component.data.source);

  return {
    id: component.id,
    type: 'stats',
    title: component.title,
    description: component.description,
    data: transformResolvers[component.data.transform.type](source, component.data.transform) as DashboardDataPoint[],
  };
}

function buildTableComponent(datasets: DashboardDatasets, component: DashboardTemplateTableComponent): DashboardModel['components'][number] {
  const source = resolvePath(datasets, component.data.source);
  const table = transformResolvers[component.data.transform.type](source, component.data.transform) as {
    columns: DashboardTableColumn[];
    rows: DashboardTableRow[];
  };

  return {
    id: component.id,
    type: 'table',
    title: component.title,
    description: component.description,
    columns: table.columns as DashboardTableColumn[],
    rows: table.rows,
  };
}

function buildComponent(datasets: DashboardDatasets, component: DashboardTemplateComponent): DashboardModel['components'][number] {
  if (component.type === 'chart') {
    return buildChartComponent(datasets, component);
  }

  if (component.type === 'stats') {
    return buildStatsComponent(datasets, component);
  }

  return buildTableComponent(datasets, component);
}

export function buildDashboardDatasets(bundle: DashboardApiBundle): DashboardDatasets {
  // Support both legacy bundle keys and generator canonical keys
  const stats = (bundle as any).stats ?? (bundle as any).overview ?? {};
  const categoryCounts = (bundle as any).categoryCounts ?? [];
  const categoryMetrics = (bundle as any).categoryMetrics ?? [];
  const byType = (bundle as any).byType ?? (bundle as any).measureByDimension ?? [];
  const sizes = (bundle as any).sizes ?? (bundle as any).categoryCounts ?? [];
  const scatter = (bundle as any).scatter ?? [];
  const microbes = (bundle as any).microbes ?? (bundle as any).preview ?? [];

  return {
    dataset: {
      stats: stats as unknown as Record<string, unknown>,
      categoryCounts: categoryCounts as unknown as Array<Record<string, unknown>>,
      categoryMetrics: categoryMetrics as unknown as Array<Record<string, unknown>>,
      byType: byType as unknown as Array<Record<string, unknown>>,
      sizes: sizes as unknown as Array<Record<string, unknown>>,
      scatter: scatter as unknown as Array<Record<string, unknown>>,
      microbes: microbes as unknown as Array<Record<string, unknown>>,
    },
  };
}

export function buildDashboardModel(
  datasets: DashboardDatasets,
  template: DashboardTemplate,
): DashboardModel {
  return {
    id: template.id,
    title: template.title,
    description: template.description,
    components: template.components.map((component) => buildComponent(datasets, component)),
    datasets,
  };
}
