// Purpose: Stores frontend dashboard UI constants such as comparison metric labels and chart options.
import { ChartOptions } from 'chart.js';
import { DashboardTemplateFamily, MicrobeComparisonRow } from '../models/dashboard.model';

export type ComparisonMetricKey = keyof Pick<
  MicrobeComparisonRow,
  'count' | 'avgArea' | 'avgPerimeter' | 'avgEccentricity' | 'avgSolidity' | 'avgRadius'
>;

export interface ComparisonMetricConfig {
  key: ComparisonMetricKey;
  label: string;
  digits: number;
}

export const COMPARISON_METRICS: ComparisonMetricConfig[] = [
  { key: 'count', label: 'Samples', digits: 0 },
  { key: 'avgArea', label: 'Average area', digits: 2 },
  { key: 'avgPerimeter', label: 'Average perimeter', digits: 2 },
  { key: 'avgEccentricity', label: 'Average eccentricity', digits: 3 },
  { key: 'avgSolidity', label: 'Average solidity', digits: 3 },
  { key: 'avgRadius', label: 'Average radius', digits: 2 },
];

export const COMPARISON_CHART_OPTIONS: ChartOptions<'bar'> = {
  responsive: true,
  maintainAspectRatio: false,
  scales: {
    x: {
      ticks: {
        color: '#475569',
        font: {
          family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
      },
    },
    y: {
      beginAtZero: true,
      ticks: {
        color: '#475569',
        font: {
          family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        },
      },
    },
  },
  plugins: {
    legend: {
      labels: {
        color: '#1e293b',
        font: {
          family: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          weight: 600,
        },
      },
    },
  },
};