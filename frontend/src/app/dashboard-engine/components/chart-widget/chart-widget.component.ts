// Purpose: Wraps Chart.js rendering, chart template selection, and chart point events.
import { Component, EventEmitter, Input, Output, OnInit } from '@angular/core';
import { Chart, registerables } from 'chart.js';
import { provideCharts, withDefaultRegisterables } from 'ng2-charts';
import { ChartPointSelection, ChartWidgetModel } from '../../models/dashboard.model';

@Component({
  selector: 'app-chart-widget',
  standalone: false,
  providers: [provideCharts(withDefaultRegisterables())],
  templateUrl: './chart-widget.component.html',
  styleUrls: ['./chart-widget.component.css'],
})
export class ChartWidgetComponent implements OnInit {
  @Input({ required: true }) chart!: ChartWidgetModel;
  @Input({ required: true }) componentId!: string;
  @Output() pointSelected = new EventEmitter<ChartPointSelection>();

  // Lab-green palette, matching the --lab-accent design tokens used across
  // the rest of the UI (style.css / app.css / chart-widget.css), replacing
  // the previous blue palette. Same 8-tone, dark-to-light structure, so all
  // existing index-based lookups (`% this.chartColors.length`) keep working
  // unchanged.
  protected readonly chartColors = [
    '#175646',
    '#1f6f5c',
    '#2f8a72',
    '#5fae95',
    '#0f3f33',
    '#3f9c82',
    '#0a2c24',
    '#8ec7b5',
  ];

  private readonly chartFontFamily = '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';

  protected readonly baseOptions: any = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      y: {
        beginAtZero: true,
        ticks: { color: '#4b5760', font: { family: this.chartFontFamily } }
      },
      x: {
        ticks: { color: '#4b5760', font: { family: this.chartFontFamily } }
      }
    },
    plugins: {
      legend: {
        display: true,
        labels: {
          color: '#12181f',
          font: { family: this.chartFontFamily },
        },
      },
      tooltip: {
        backgroundColor: 'rgba(18, 24, 31, 0.92)',
        titleColor: '#f5f7f6',
        bodyColor: '#f5f7f6',
        borderColor: '#1f6f5c',
        borderWidth: 1,
        padding: 12,
        displayColors: true,
        callbacks: {
          label: (context: any) => {
            const label = context.dataset.label || '';
            const value = context.parsed?.r ?? context.parsed?.y ?? context.parsed;
            return `${label}: ${Number(value).toLocaleString()}`;
          }
        }
      },
    },
  };

  ngOnInit() {
    Chart.register(...registerables);
  }

  get chartType(): 'bar' | 'line' | 'doughnut' | 'polarArea' {
    const template = this.chart?.chart?.template;
    if (template === 'line') return 'line';
    if (template === 'doughnut') return 'doughnut';
    if (template === 'polar') return 'polarArea';
    return 'bar';
  }

  get templateLabel(): string {
    const labels: Record<string, string> = {
      bar: 'Bar chart',
      'bar-horizontal': 'Horizontal bar',
      line: 'Line chart',
      doughnut: 'Doughnut chart',
      polar: 'Polar area',
    };
    return labels[this.chart?.chart?.template] || 'Bar chart';
  }

  get chartOptions() {
    const options = JSON.parse(JSON.stringify(this.baseOptions));
    
    if (this.chart.chart.template === 'bar-horizontal' && !this.hasSeriesData) {
      options.indexAxis = 'y';
      options.plugins.legend.display = false;
    }

    if (this.chart.chart.template === 'line') {
      options.elements = { line: { tension: 0.35 } };
    }

    // Enhanced polar chart configuration
    if (this.chart.chart.template === 'polar') {
      delete options.scales;
      options.scales = {
        r: {
          beginAtZero: true,
          ticks: {
            color: '#4b5760',
            backdropColor: 'rgba(245, 247, 246, 0.92)',
            font: { size: 11, family: this.chartFontFamily },
            stepSize: undefined, // Auto-calculate for better distribution
          },
          grid: {
            color: 'rgba(75, 87, 96, 0.2)',
            lineWidth: 1,
          },
          pointLabels: {
            color: '#12181f',
            font: { size: 12, weight: '600', family: this.chartFontFamily },
            padding: 8,
          },
          angleLines: {
            color: 'rgba(75, 87, 96, 0.25)',
            lineWidth: 1,
          },
        },
      };
      
      options.plugins.legend.position = 'bottom';
      options.plugins.legend.labels.padding = 15;
      options.plugins.legend.labels.usePointStyle = true;
      options.plugins.legend.labels.pointStyle = 'circle';
      options.plugins.legend.labels.font = { size: 12, family: this.chartFontFamily };
    }

    // Doughnut configuration
    if (this.chart.chart.template === 'doughnut') {
      delete options.scales;
      options.plugins.legend.position = 'right';
      options.plugins.legend.labels.padding = 12;
      options.plugins.legend.labels.usePointStyle = true;
      options.plugins.legend.labels.pointStyle = 'circle';
    }

    return options;
  }

  get chartData() {
    const rawData = this.chart?.data || [];
    const seriesMode = rawData.some((item) => Array.isArray(item.series) && item.series.length > 0);
    const requestedSeriesLabel = String(this.chart?.chart?.seriesLabel ?? '').trim();

    if (seriesMode) {
      const labels = rawData.map((item) => String(item.label || 'Unknown'));
      const seriesLabels = Array.from(new Set(rawData.flatMap((item) => (Array.isArray(item.series) ? item.series.map((entry) => String(entry.label || 'Series')) : []))));
      const filteredSeriesLabels = requestedSeriesLabel
        ? seriesLabels.filter((label) => label === requestedSeriesLabel)
        : seriesLabels;
      const activeSeriesLabels = filteredSeriesLabels.length ? filteredSeriesLabels : seriesLabels;

      return {
        labels,
        datasets: activeSeriesLabels.map((seriesLabel, seriesIndex) => ({
          label: seriesLabel,
          data: rawData.map((item) => {
            const matchingSeries = Array.isArray(item.series)
              ? item.series.find((entry) => String(entry.label || 'Series') === seriesLabel)
              : null;

            return Number(matchingSeries?.value ?? 0);
          }),
          backgroundColor: ['doughnut', 'polar'].includes(this.chart?.chart?.template)
            ? labels.map((_, index) => this.getColorWithOpacity(this.chartColors[index % this.chartColors.length], 0.7))
            : this.chartColors[seriesIndex % this.chartColors.length],
          borderColor: ['polar'].includes(this.chart?.chart?.template)
            ? labels.map((_, index) => this.chartColors[index % this.chartColors.length])
            : this.chartColors[seriesIndex % this.chartColors.length],
          borderWidth: this.chart?.chart?.template === 'polar' ? 2 : 1,
        })),
      };
    }

    const labels = rawData.map((item) => String(item.label || 'Unknown'));
    const values = rawData.map((item) => {
      const val = Number(item.value);
      return isNaN(val) ? 0 : val;
    });

    const isLine = this.chart?.chart?.template === 'line';
    const isPolar = this.chart?.chart?.template === 'polar';

    return {
      labels: labels,
      datasets: [
        {
          label: this.chart.title || 'Dataset',
          data: values,
          backgroundColor: isLine 
            ? this.chartColors[0] + '44'
            : isPolar
            ? labels.map((_, i) => this.getColorWithOpacity(this.chartColors[i % this.chartColors.length], 0.7))
            : labels.map((_, i) => this.chartColors[i % this.chartColors.length]),
          borderColor: isPolar 
            ? labels.map((_, i) => this.chartColors[i % this.chartColors.length])
            : isLine 
            ? this.chartColors[0] 
            : '#f8fafc',
          borderWidth: isPolar ? 2 : isLine ? 2 : 1,
          pointRadius: isLine ? 4 : 0,
          fill: isLine,
        },
      ],
    };
  }

  get hasSeriesData() {
    return (this.chart?.data || []).some((item) => Array.isArray(item.series) && item.series.length > 0);
  }

  // Helper method to add opacity to hex colors
  private getColorWithOpacity(hexColor: string, opacity: number): string {
    const hex = hexColor.replace('#', '');
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${opacity})`;
  }

  onChartClick(event: any) {
    const activePoints = event.active;
    if (!activePoints || activePoints.length === 0) return;

    const index = activePoints[0].index;
    const datasetIndex = activePoints[0].datasetIndex;
    const dataPoint = this.chart.data[index];
    const datasetLabel = this.chartData.datasets?.[datasetIndex]?.label ?? this.chart.title;
    const pointValue = this.hasSeriesData
      ? Number(this.chartData.datasets?.[datasetIndex]?.data?.[index] ?? 0)
      : Number(dataPoint?.value);

    if (dataPoint) {
      this.pointSelected.emit({
        componentId: this.componentId,
        componentTitle: this.chart.title,
        chartTemplate: this.chart.chart.template,
        pointLabel: String(dataPoint.label),
        pointValue,
        pointIndex: index,
        datasetIndex: datasetIndex,
        datasetLabel: datasetLabel ?? null,
      });
    }
  }
}