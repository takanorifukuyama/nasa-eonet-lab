/** NASA EONET v3 data types and defensive normalization. */
export type Status = 'all' | 'open' | 'closed';

type Geometry = { type?: string; coordinates?: unknown; date?: string };
type Source = { id?: string; url?: string };
export type EonetEvent = {
  id?: string;
  title?: string;
  description?: string;
  link?: string;
  closed?: string | null;
  categories?: { id?: string; title?: string }[];
  geometry?: Geometry[];
  sources?: Source[];
};
export type EonetResponse = { events?: EonetEvent[] };
export type EventRow = {
  id: string;
  title: string;
  category: string;
  category_id: string;
  event_date: string | null;
  latitude: number | null;
  longitude: number | null;
  status: 'open' | 'closed';
  source_count: number;
  observations: number;
  description: string;
  sourceUrl: string | null;
  sourceName: string;
};

const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() ? value.trim() : null;

const safeUrl = (candidate: unknown): string | null => {
  if (typeof candidate !== 'string') return null;
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' && !url.username && !url.password ? url.href : null;
  } catch {
    return null;
  }
};

/** Preserve one UTC date across the list, map, and daily summaries. */
function observationDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const input = value.trim();
  const parts = /^(\d{4})-(\d{2})-(\d{2})(?:T|$)/.exec(input);
  if (!parts) return null;
  const [, year, month, day] = parts.map(Number);
  if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;
  const timestamp = Date.parse(input.includes('T') && !/(?:Z|[+-]\d{2}:?\d{2})$/i.test(input) ? `${input}Z` : input);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

const lonlat = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  const [lng, lat] = value;
  return typeof lng === 'number' && typeof lat === 'number' &&
    Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
    ? [lng, lat] : null;
};

const averageRing = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value)) return null;
  const ring = value.map(lonlat).filter((point): point is [number, number] => point !== null);
  // The closing coordinate repeats the first vertex and must not bias the mean.
  if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
  if (ring.length < 3) return null;
  const reference = ring[0][0];
  const [lng, lat] = ring.reduce(([x, y], [longitude, latitude]) => [
    x + reference + ((longitude - reference + 540) % 360) - 180,
    y + latitude,
  ], [0, 0]);
  // Unwrap around the first vertex so a shape crossing the dateline stays there.
  return [((lng / ring.length + 540) % 360) - 180, lat / ring.length];
};

function representativePoint(geometry: Record<string, unknown>): [number, number] | null {
  const coords = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': return lonlat(coords);
    case 'LineString':
      return Array.isArray(coords) ? [...coords].reverse().map(lonlat).find(point => point !== null) ?? null : null;
    case 'Polygon': return Array.isArray(coords) ? averageRing(coords[0]) : null;
    case 'MultiPolygon':
      return Array.isArray(coords)
        ? coords.map(polygon => Array.isArray(polygon) ? averageRing(polygon[0]) : null).find(point => point !== null) ?? null
        : null;
    default: return null;
  }
}

export function normalize(data: unknown): EventRow[] {
  if (!record(data) || !Array.isArray(data.events)) {
    throw new Error('データを読み込めませんでした。時間をおいて、もう一度お試しください。');
  }
  const events = new Map<string, EventRow>();
  for (const event of data.events) {
    if (!record(event)) continue;
    const id = nonEmptyString(event.id);
    if (!id) continue;
    const observations = Array.isArray(event.geometry) ? event.geometry.filter(record) : [];
    const ordered = observations.map((geometry, index) => ({
      geometry,
      date: observationDate(geometry.date),
      index,
    })).sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || b.index - a.index);
    // Do not label an older location with a newer observation's date.
    const latest = ordered.find(item => item.date !== null) ??
      ordered.find(item => representativePoint(item.geometry) !== null) ?? ordered[0];
    const point = latest ? representativePoint(latest.geometry) : null;
    const categories = Array.isArray(event.categories) ? event.categories.filter(record) : [];
    const category = categories.find(item => nonEmptyString(item.id) || nonEmptyString(item.title));
    const sources = Array.isArray(event.sources) ? event.sources.filter(record) : [];
    const source = sources.find(item => safeUrl(item.url) !== null);
    const row: EventRow = {
      id,
      title: nonEmptyString(event.title) ?? '名称未登録のイベント',
      category: nonEmptyString(category?.title) ?? 'Uncategorized',
      category_id: nonEmptyString(category?.id) ?? 'other',
      event_date: latest?.date ?? null,
      latitude: point?.[1] ?? null,
      longitude: point?.[0] ?? null,
      status: nonEmptyString(event.closed) ? 'closed' : 'open',
      source_count: sources.length,
      observations: observations.length,
      description: typeof event.description === 'string' ? event.description : '',
      sourceUrl: safeUrl(source?.url) ?? safeUrl(event.link),
      sourceName: source ? nonEmptyString(source.id) ?? '出典' : 'EONET',
    };
    const previous = events.get(id);
    if (!previous || (row.event_date ?? '') > (previous.event_date ?? '')) events.set(id, row);
  }
  return [...events.values()].sort((a, b) => (b.event_date ?? '').localeCompare(a.event_date ?? '') || a.id.localeCompare(b.id));
}

const CATEGORY_LABELS: Record<string, string> = {
  wildfires: '山火事', severeStorms: '暴風雨', volcanoes: '火山活動', floods: '洪水',
  earthquakes: '地震', landslides: '地すべり', drought: '干ばつ', seaLakeIce: '海氷・湖氷',
  snow: '雪', dustHaze: '砂じん・煙霧', tempExtremes: '異常気温', manmade: '人為的な現象', other: 'その他',
};
export const categoryLabel = (id: string, fallback?: string): string =>
  CATEGORY_LABELS[id] ?? nonEmptyString(fallback) ?? 'その他';

export const colorFor = (id: string): string => ({
  wildfires: '#f4a261', severeStorms: '#77bdf5', volcanoes: '#fc858f', floods: '#72d6d5',
  earthquakes: '#d6abff', landslides: '#edd587', drought: '#d9ba72', seaLakeIce: '#b1dfff',
  snow: '#c8e7fb', dustHaze: '#d4b8a0', tempExtremes: '#f3bb74',
} as Record<string, string>)[id] ?? '#a7c0d8';

const dateFormatter = new Intl.DateTimeFormat('ja-JP', {
  year: 'numeric', month: 'numeric', day: 'numeric', timeZone: 'UTC',
});
export const dateLabel = (value: string | null): string => {
  const date = observationDate(value);
  return date ? dateFormatter.format(new Date(date)) : '日付不明';
};
export const API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
