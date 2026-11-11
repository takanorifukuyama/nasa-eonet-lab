import { describe, expect, it } from 'vitest';
import { categoryLabel, dateLabel, normalize } from './eonet';

const point = (date: string, coordinates: unknown = [141.35, 43.06]) => ({ type: 'Point', date, coordinates });

describe('normalize', () => {
  it('selects the newest observation by its date, independent of source order', () => {
    const [event] = normalize({ events: [{ id: 'storm', geometry: [
      point('2026-11-12T01:00:00Z', [130, 30]),
      point('2026-11-09T01:00:00Z', [140, 40]),
      point('2026-11-10T01:00:00Z', [135, 35]),
    ] }] });
    expect(event.event_date).toBe('2026-11-12T01:00:00.000Z');
    expect([event.longitude, event.latitude]).toEqual([130, 30]);
  });

  it('retains a dated event with no location without mislabeling an older position', () => {
    const [event] = normalize({ events: [{ id: 'missing-position', geometry: [
      point('2026-11-09T01:00:00Z'),
      point('2026-11-12T01:00:00Z', [Infinity, 91]),
    ] }] });
    expect(event.event_date).toBe('2026-11-12T01:00:00.000Z');
    expect(event.latitude).toBeNull();
    expect(event.longitude).toBeNull();
    expect(event.observations).toBe(2);
  });

  it('ignores malformed records and preserves useful events with missing optional fields', () => {
    const rows = normalize({ events: [null, false, 'broken', {}, { id: 42 }, { id: '  ' }, {
      id: 'valid', title: { bad: true }, description: 12,
      categories: [null], sources: false, geometry: [null, 'broken', point('invalid')],
    }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: 'valid', title: '名称未登録のイベント', category_id: 'other',
      event_date: null, source_count: 0, description: '', observations: 1,
      latitude: 43.06, longitude: 141.35,
    });
  });

  it('deduplicates event IDs using the newest record and sorts newest first', () => {
    const rows = normalize({ events: [
      { id: 'same', title: 'old', geometry: [point('2026-10-01')] },
      { id: 'undated' },
      { id: 'same', title: 'new', geometry: [point('2026-11-12')] },
      { id: 'middle', geometry: [point('2026-11-01')] },
    ] });
    expect(rows.map(row => row.id)).toEqual(['same', 'middle', 'undated']);
    expect(rows[0].title).toBe('new');
  });

  it('uses the first safe source and its corresponding name', () => {
    const [event] = normalize({ events: [{ id: 'sources', sources: [
      { id: 'unsafe', url: 'javascript:alert(1)' },
      { id: 'credentialed', url: 'https://name:password@example.org/private' },
      { id: 'NASA', url: 'https://example.org/observations' },
    ] }] });
    expect(event.sourceUrl).toBe('https://example.org/observations');
    expect(event.sourceName).toBe('NASA');
  });

  it('falls back to the event link when sources are unsafe or missing', () => {
    const rows = normalize({ events: [
      { id: 'safe-fallback', link: 'https://eonet.gsfc.nasa.gov/api/v3/events/safe', sources: [{ url: 'http://example.org' }] },
      { id: 'unsafe-fallback', link: 'data:text/html,unsafe' },
    ] });
    expect(rows.find(row => row.id === 'safe-fallback')?.sourceUrl).toBe('https://eonet.gsfc.nasa.gov/api/v3/events/safe');
    expect(rows.find(row => row.id === 'unsafe-fallback')?.sourceUrl).toBeNull();
  });

  it('places a polygon spanning the dateline near the dateline', () => {
    const [event] = normalize({ events: [{ id: 'ice', geometry: [{
      type: 'Polygon', date: '2026-11-12',
      coordinates: [[[179, 10], [-179, 10], [-179, 12], [179, 12], [179, 10]]],
    }] }] });
    expect(Math.abs(event.longitude!)).toBe(180);
    expect(event.latitude).toBe(11);
  });

  it.each([null, {}, { events: null }, { events: {} }])('rejects an invalid feed envelope: %j', value => {
    expect(() => normalize(value)).toThrow('データを読み込めませんでした');
  });
});

describe('presentation helpers', () => {
  it('uses Japanese categories while preserving unknown future category labels', () => {
    expect(categoryLabel('wildfires', 'Wildfires')).toBe('山火事');
    expect(categoryLabel('new-category', 'New category')).toBe('New category');
    expect(categoryLabel('unknown')).toBe('その他');
  });

  it('renders dates consistently in UTC and never renders Invalid Date', () => {
    expect(dateLabel('2026-11-12T23:30:00Z')).toBe('2026/11/12');
    expect(dateLabel('2026-11-12T00:30:00')).toBe('2026/11/12');
    expect(dateLabel('2026-11-12T00:30:00+09:00')).toBe('2026/11/11');
    expect(dateLabel('not a date')).toBe('日付不明');
    expect(dateLabel('2026-02-30T01:00:00Z')).toBe('日付不明');
    expect(dateLabel(null)).toBe('日付不明');
  });
});
