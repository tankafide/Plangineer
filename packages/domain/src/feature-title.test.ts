import { describe, expect, it } from 'vitest';
import { featureTitle } from './feature-title.ts';

describe('featureTitle', () => {
  it('takes the first non-blank line, trimmed', () => {
    expect(featureTitle('\n  \r\n  Export plans as PDF  \nMore detail')).toBe(
      'Export plans as PDF',
    );
  });

  it('collapses whitespace runs to one space', () => {
    expect(featureTitle('Export \t plans   as PDF')).toBe('Export plans as PDF');
  });

  it('keeps a title of exactly 80 characters', () => {
    expect(featureTitle('x'.repeat(80))).toBe('x'.repeat(80));
  });

  it('cuts a longer line to 80 characters with an ellipsis', () => {
    expect(featureTitle('x'.repeat(81))).toBe(`${'x'.repeat(80)}…`);
  });
});
