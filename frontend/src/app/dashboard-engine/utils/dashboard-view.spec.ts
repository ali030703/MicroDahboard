import { describe, expect, it } from 'vitest';
import { buildDashboardGenerationSummary } from './dashboard-view';

describe('buildDashboardGenerationSummary', () => {
  it('describes the actual rendered component mix instead of a single chart fallback', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart', 'chart', 'table'],
      selectedMetric: 'Area',
      mentionedMeasureColumns: ['Volume'],
      microorganismNames: ['Bacillus'],
    });

    expect(summary).toContain('2 charts');
    expect(summary).toContain('table');
    expect(summary).toContain('Area');
    expect(summary).toContain('Bacillus');
  });

  it('deduplicates repeated metrics while preserving intended summary wording', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart', 'table'],
      selectedMetric: 'Perimeter',
      mentionedMeasureColumns: ['Perimeter', ' perimeter ', 'PERIMETER'],
      microorganismNames: ['Volvox', 'Yeast'],
    });

    expect(summary).toBe('Built a 1 chart and 1 table showing Perimeter for Volvox and Yeast.');
  });

  it('uses explicit chart type wording when chart template is provided', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart', 'table'],
      chartTemplate: 'line',
      selectedMetric: 'Perimeter',
      mentionedMeasureColumns: ['Perimeter'],
      microorganismNames: ['Yeast', 'Volvox'],
    });

    expect(summary).toBe('Built a line chart showing Perimeter for Yeast and Volvox.');
  });

  it('includes the resolved filter in a single-request summary', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart', 'table'],
      chartTemplate: 'line',
      selectedMetric: 'Area',
      filters: [{ column: 'solidity', operator: '<', value: 7 }],
    });

    expect(summary).toContain('where solidity < 7');
  });

  it('uses the resolved microorganism name instead of its filter id', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart'],
      chartTemplate: 'bar',
      filters: [{
        column: 'microorganism_id',
        operator: '=',
        value: 3,
        semanticRole: 'microorganism',
        label: 'Yeast',
      }],
    });

    expect(summary).toContain('where Microorganism: Yeast');
    expect(summary).not.toContain('microorganism_id');
    expect(summary).not.toContain('3');
  });

  it('does not repeat a microorganism already named in the summary', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart'],
      chartTemplate: 'bar',
      selectedMetric: 'Area',
      mentionedMeasureColumns: ['Perimeter'],
      microorganismNames: ['Diatom'],
      filters: [
        { column: 'solidity', operator: '>', value: 1 },
        {
          column: 'microorganism_id',
          operator: '=',
          value: 3,
          semanticRole: 'microorganism',
          label: 'Diatom',
        },
      ],
    });

    expect(summary).toBe('Built a bar chart showing Area and Perimeter for Diatom where solidity > 1.');
  });

  it('does not repeat a grouped microorganism filter', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart'],
      chartTemplate: 'doughnut',
      selectedMetric: 'Area',
      mentionedMeasureColumns: ['Perimeter'],
      microorganismNames: ['Volvox', 'Diatom', 'Yeast'],
      filters: [{
        column: 'microorganism_id',
        operator: 'in',
        value: [1, 2, 3],
        semanticRole: 'microorganism',
        label: 'Volvox, Diatom, Yeast',
      }],
    });

    expect(summary).toBe('Built a doughnut chart showing Area and Perimeter for Volvox, Diatom, and Yeast.');
  });

  it('describes each requested visual clause in multi-chart prompts', () => {
    const summary = buildDashboardGenerationSummary({
      componentKinds: ['chart', 'chart'],
      visualRequests: [
        {
          chartTemplate: 'line',
          semanticMetricKeys: ['area', 'perimeter', 'microorganisms'],
          resolvedMeasureColumns: ['area', 'perimeter'],
          rawPrompt: 'line chart of area and perimeter of microorganism',
        },
        {
          chartTemplate: 'bar',
          semanticMetricKeys: ['area'],
          resolvedMeasureColumns: ['area'],
          microorganismNames: ['Yeast', 'Volvox'],
        },
      ],
    });

    expect(summary).toBe('Built a line chart showing Area and Perimeter of microorganism and a bar chart showing Area for Yeast and Volvox.');
  });
});
