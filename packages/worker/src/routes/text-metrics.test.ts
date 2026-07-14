import { describe, expect, it } from 'vitest';
import { formatTokenCount, normalizeTokenUnit } from './text-metrics.js';

describe('text token metrics', () => {
  it('formats token counts with English compact units by default', () => {
    expect(formatTokenCount(987)).toBe('987');
    expect(formatTokenCount(12_340)).toBe('12.3K');
    expect(formatTokenCount(12_345_678)).toBe('12.3M');
    expect(formatTokenCount(8_621_971_144)).toBe('8.6B');
  });

  it('formats token counts with Chinese compact units', () => {
    expect(formatTokenCount(9_876, 'zh')).toBe('9876');
    expect(formatTokenCount(12_345, 'zh')).toBe('1.2万');
    expect(formatTokenCount(862_197_114, 'zh')).toBe('8.6亿');
  });

  it('can return the raw integer token count', () => {
    expect(formatTokenCount(8_621_971_144, 'raw')).toBe('8621971144');
  });

  it('normalizes supported unit parameters', () => {
    expect(normalizeTokenUnit(null)).toBe('auto');
    expect(normalizeTokenUnit('ZH')).toBe('zh');
    expect(normalizeTokenUnit('raw')).toBe('raw');
    expect(normalizeTokenUnit('gb')).toBeNull();
  });
});
