// @ts-nocheck
import { describe, expect, it } from 'vitest';
import { buildPromptBasedIterationLabel } from './iteration-label';

describe('buildPromptBasedIterationLabel', () => {
  it('keeps comparison prompts concise and prompt-aligned', () => {
    expect(buildPromptBasedIterationLabel('Compare Area and Perimeter')).toBe('Compare Area and Perimeter');
  });

  it('removes generic lead-in words for distribution prompts', () => {
    expect(buildPromptBasedIterationLabel('Show distribution of Area')).toBe('Distribution of Area');
  });

  it('avoids internal labels like balanced or organism in the generated label', () => {
    expect(buildPromptBasedIterationLabel('Show the average area for organisms')).toBe('Average area for organisms');
  });
});
