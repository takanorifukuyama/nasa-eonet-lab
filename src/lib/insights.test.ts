import { describe, expect, it } from 'vitest';
import { insightData } from './insights';

describe('insightData', () => {
  it('keeps every event when rolling older observation dates into a single bar', () => {
    const rows = Array.from({ length: 110 }, (_, i) => ({
      key: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
      events: String(i + 1)
    }));
    rows.push({ key: 'unknown', events: '3' });
    const result = insightData('daily', rows);
    expect(result).toHaveLength(9);
    expect(result[0].key).toBe('2026-04-20');
    expect(result[7].label).toBe('それ以前');
    expect(result[8]).toMatchObject({ key: 'unknown', label: '観測日不明', count: 3 });
    expect(result.reduce((sum, item) => sum + item.count, 0)).toBe(6108);
  });

  it('counts the equator and events without a location separately', () => {
    const result = insightData('hemisphere', [
      { key: 'north', events: '8' }, { key: 'south', events: '4' },
      { key: 'equator', events: '2' }, { key: 'unknown', events: '3' }
    ]);
    expect(result.map(item => item.label)).toEqual(['北半球', '南半球', '赤道上', '位置情報なし']);
    expect(result.reduce((sum, item) => sum + item.count, 0)).toBe(17);
  });

  it('uses Japanese category names while preserving an unknown category name', () => {
    const result = insightData('category', [
      { key: 'wildfires', label: 'Wildfires', events: '12' },
      { key: 'new-category', label: 'A new observation', events: '2' }
    ]);
    expect(result[0]).toMatchObject({ key: 'wildfires', label: '山火事', count: 12 });
    expect(result[1]).toMatchObject({ key: 'new-category', label: 'A new observation', count: 2 });
  });

  it('returns an empty chart without inventing zero-count categories', () => {
    expect(insightData('category', [])).toEqual([]);
    expect(insightData('daily', [])).toEqual([]);
    expect(insightData('hemisphere', [])).toEqual([]);
  });
});
