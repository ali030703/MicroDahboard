// Purpose: Defines TypeScript models for dashboard definitions, datasets, widgets, and UI state.
// === FILE DESCRIPTION ===
// Defines the data structure for the dashboard engine.
// Main types are declared here (DashboardTemplate, Widget, Dataset).
// Charting separates visual configuration from data binding.

export interface DashboardStats {
  total: number;
  avgArea: number;
  avgPerimeter: number;
  avgEccentricity: number;
  avgSolidity: number;
  avgRadius: number;
}

export interface MicrobeTypeCount {
  microorganisms: string | null;
  count: number;
}

export interface MicroorganismCategory {
  microorganism_id: number;
  microorganism_name: string;
}

export interface SizeDistributionRow {
  sizeGroup: string;
  count: number;
}

export interface ScatterPointRow {
  Area: number;
  Eccentricity: number;
  microorganisms: string | null;
}

export interface MicrobeRow {
  [key: string]: string | number | null | undefined;
}

export interface MicrobeComparisonRow {
  microorganism_id: number;
  microorganism_name: string;
  count: number;
  avgArea: number;
  avgPerimeter: number;
  avgEccentricity: number;
  avgSolidity: number;
  avgRadius: number;
}

export interface DashboardApiBundle {
  stats: DashboardStats;
  categoryCounts: Array<Record<string, unknown>>;
  byType: MicrobeTypeCount[];
  sizes: SizeDistributionRow[];
  scatter: ScatterPointRow[];
  microbes: MicrobeRow[];
}

export type DashboardDatasetValue = Record<string, unknown> | Array<Record<string, unknown>> | unknown[];

export interface DashboardDatasets {
  dataset: Record<string, DashboardDatasetValue>;
}

export interface DashboardDataPoint {
  label: string;
  value: string | number;
  series?: DashboardSeriesDataPoint[];
}

export interface DashboardSeriesDataPoint {
  label: string;
  value: number;
}

export interface ChartPointSelection {
  componentId: string;
  componentTitle: string;
  chartTemplate: DashboardChartConfig['template'];
  pointLabel: string;
  pointValue: number;
  pointIndex: number;
  datasetIndex: number;
  datasetLabel: string | null;
}

export interface DashboardDataBinding {
  source: string;
  transform: DashboardTransformDefinition;
  category_id?: number | null;
  measure_category_id?: number | null;
  category_ids?: number[];
}

export interface DashboardChartConfig {
  template: 'bar' | 'bar-horizontal' | 'line' | 'doughnut' | 'polar';
  seriesLabel?: string | null;
}

export interface DashboardTableColumn {
  key: string;
  label: string;
  category_id?: number | null;
}

export interface DashboardTableRow {
  [key: string]: string | number | null | undefined;
}

export interface ChartWidgetModel {
  id: string;
  type: 'chart';
  title: string;
  description?: string;
  chart: DashboardChartConfig;
  data: DashboardDataPoint[];
}

export interface StatsWidgetModel {
  id: string;
  type: 'stats';
  title: string;
  description?: string;
  data: DashboardDataPoint[];
}

export interface TableWidgetModel {
  id: string;
  type: 'table';
  title: string;
  description?: string;
  columns: DashboardTableColumn[];
  rows: DashboardTableRow[];
}

export interface DashboardModel {
  id: string;
  title: string;
  description?: string;
  components: (ChartWidgetModel | StatsWidgetModel | TableWidgetModel)[];
  datasets: DashboardDatasets;
}

export interface DashboardBindingField {
  label: string;
  path: string;
  format?: 'integer' | 'decimal';
}

export interface DashboardCollectionTransformDefinition {
  type: 'collection';
  labelField: string;
  valueField: string;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
  limit?: number;
  emptyLabel?: string;
  labelMaxLength?: number;
}

export interface DashboardKeyValueTransformDefinition {
  type: 'keyValue';
  fields: DashboardBindingField[];
}

export interface DashboardTableTransformDefinition {
  type: 'table';
  columns?: DashboardTableColumn[];
  limit?: number;
}

export type DashboardTransformDefinition =
  | DashboardCollectionTransformDefinition
  | DashboardKeyValueTransformDefinition
  | DashboardTableTransformDefinition;

export interface DashboardTemplateBaseComponent {
  id: string;
  title: string;
  description?: string;
  type: 'chart' | 'stats' | 'table';
  data: DashboardDataBinding;
}

export interface DashboardTemplateChartComponent extends DashboardTemplateBaseComponent {
  type: 'chart';
  chart: DashboardChartConfig;
  widget: 'chart-widget';
}

export interface DashboardTemplateStatsComponent extends DashboardTemplateBaseComponent {
  type: 'stats';
  widget: 'stats-widget';
}

export interface DashboardTemplateTableComponent extends DashboardTemplateBaseComponent {
  type: 'table';
  widget: 'table-widget';
}

export type DashboardTemplateComponent =
  | DashboardTemplateChartComponent
  | DashboardTemplateStatsComponent
  | DashboardTemplateTableComponent;

export interface DashboardTemplate {
  schemaVersion: string;
  id: string;
  slug?: string;
  status?: 'draft' | 'published';
  createdAt?: string;
  updatedAt?: string;
  publishedAt?: string | null;
  title: string;
  description?: string;
  components: DashboardTemplateComponent[];
}

export type DashboardTemplateRegistry = Record<string, DashboardTemplate>;

export type DashboardTemplateFamily = 'compact' | 'balanced' | 'analytical' | 'visual';

export interface DashboardSchemaColumnMetadata {
  name: string;
  type: string;
}

export interface DashboardSchemaTableMetadata {
  name: string;
  columns: DashboardSchemaColumnMetadata[];
}

export interface DashboardPromptIntentMetadata {
  rawPrompt: string;
  chartTemplate: DashboardChartConfig['template'] | null;
  filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;
  visualRequests?: Array<{
    chartTemplate?: DashboardChartConfig['template'] | null;
    semanticMetricKey?: string | null;
    semanticMetricKeys?: string[];
    resolvedMeasureColumns?: string[];
    microorganismNames?: string[];
    filters?: Array<{ column?: string; operator?: string; value?: unknown; label?: string; semanticRole?: string }>;
    rawPrompt?: string;
  }>;
  topLimit: number | null;
  includeTable: boolean | null;
  includeStats: boolean | null;
  prefersTrend: boolean;
  mentionedTables: string[];
  mentionedColumns: string[];
}

export interface DashboardDataBindingsMetadata {
  table: string;
  dimensionColumn: string | null;
  measureColumn: string | null;
  aggregation?: string | null;
  categoryLimit: number;
  filters?: Array<Record<string, unknown>>;
}

export interface DashboardGenerationExplanation {
  strategyVersion: string;
  selectedTemplateFamily: DashboardTemplateFamily;
  requestedTemplateFamily: DashboardTemplateFamily | null;
  promptConfidence?: {
    score: number;
    percentage: number;
    label: 'High' | 'Medium' | 'Low' | string;
    positiveSignals: string[];
    uncertaintySignals: string[];
  };
  promptIntent: DashboardPromptIntentMetadata;
  selectedDataBindings: DashboardDataBindingsMetadata;
  renderedComponentKinds: string[];
  adaptationRules: string[];
  howToChangeDashboard: string[];
}

export type DashboardGenerationMode = 'incremental' | 'stateless';

export interface DashboardGenerationSessionMetadata {
  sessionId: string;
  turnId: string;
  turnCount: number;
  mode: DashboardGenerationMode;
  continuedFromTurnId: string | null;
}

export interface DashboardGenerationMetadata {
  databasePath: string;
  sourceType: 'db' | 'sql' | 'json' | 'chatbot' | 'backend' | 'manual' | string;
  sourcePath: string | null;
  databaseDefinition?: unknown;
  selectedTable: string;
  resolvedTable: string;
  selectedTemplateFamily: DashboardTemplateFamily;
  executedQueries: Record<string, string | null>;
  schema: DashboardSchemaTableMetadata[];
  semanticCatalog?: unknown;
  warnings?: string[];
  validated?: boolean;
  promptStructure?: unknown;
  generation: DashboardGenerationExplanation;
  session?: DashboardGenerationSessionMetadata;
}

export interface DashboardGenerationResponse {
  dashboardDefinition: DashboardTemplate;
  datasets: DashboardDatasets;
  metadata: DashboardGenerationMetadata;
}

export interface DashboardIterationSnapshot {
  id: string;
  parentIterationId: string | null;
  rootIterationId?: string;
  prompt: string;
  templateFamily: DashboardTemplateFamily | '';
  databasePath: string;
  createdAt: string;
  summary: string;
  response: DashboardGenerationResponse;
}

export interface DashboardIterationGroup {
  rootIterationId: string;
  rootIteration: DashboardIterationSnapshot;
  selectedIterationId: string;
  versions: DashboardIterationSnapshot[];
}

export type DashboardChatRole = 'user' | 'engine';

export interface DashboardChatMessage {
  id: string;
  role: DashboardChatRole;
  text: string;
  meta?: string;
  createdAt: string;
}

export interface DashboardSessionSnapshot {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  turnCount: number;
  turns: DashboardIterationSnapshot[];
  chatMessages: DashboardChatMessage[];
  latestResponse: DashboardGenerationResponse | null;
}
