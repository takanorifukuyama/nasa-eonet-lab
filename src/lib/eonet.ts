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

const safeUrl = (candidate: unknown): string | null => {
  if (typeof candidate !== 'string') return null;
  try { const url = new URL(candidate); return url.protocol === 'https:' ? url.href : null; }
  catch { return null; }
};
const lonlat = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value) || value.length < 2) return null;
  if (typeof value[0] !== 'number' || typeof value[1] !== 'number') return null;
  const [lng, lat] = value as number[];
  return Number.isFinite(lng) && Number.isFinite(lat) && lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 ? [lng, lat] : null;
};
const averageRing = (value: unknown): [number, number] | null => {
  if (!Array.isArray(value)) return null;
  const ring = value.map(lonlat).filter((p): p is [number, number] => p !== null);
  if (!ring.length) return null;
  const [lng, lat] = ring.reduce(([a, b], [x, y]) => [a + x, b + y], [0, 0]);
  return [lng / ring.length, lat / ring.length];
};
function representativePoint(geometry: Geometry): [number, number] | null {
  const coords = geometry.coordinates;
  switch (geometry.type) {
    case 'Point': return lonlat(coords);
    case 'LineString': return Array.isArray(coords) ? lonlat(coords[coords.length - 1]) : null;
    case 'Polygon': return Array.isArray(coords) ? averageRing(coords[0]) : null;
    case 'MultiPolygon': return Array.isArray(coords) && Array.isArray(coords[0]) ? averageRing(coords[0][0]) : null;
    default: return null;
  }
}
export function normalize(data: EonetResponse): EventRow[] {
  if (!Array.isArray(data.events)) throw new Error('NASA API: events 配列がありません');
  return data.events.map(event => {
    const observations = Array.isArray(event.geometry) ? event.geometry : [];
    const latest = [...observations].reverse().find(geometry => representativePoint(geometry) !== null);
    const point = latest ? representativePoint(latest) : null;
    const category = event.categories?.[0];
    const status: EventRow['status'] = event.closed ? 'closed' : 'open';
    return {
      id: String(event.id ?? ''),
      title: String(event.title ?? 'Untitled'),
      category: String(category?.title ?? 'Uncategorized'),
      category_id: String(category?.id ?? 'other'),
      event_date: latest?.date ?? null,
      latitude: point?.[1] ?? null,
      longitude: point?.[0] ?? null,
      status,
      source_count: event.sources?.length ?? 0,
      observations: observations.length,
      description: String(event.description ?? ''),
      sourceUrl: safeUrl(event.sources?.[0]?.url) ?? safeUrl(event.link),
      sourceName: String(event.sources?.[0]?.id ?? 'EONET')
    };
  }).filter(event => event.id !== '');
}
export const colorFor = (id: string): string => ({
  wildfires:'#f4a261', severeStorms:'#77bdf5', volcanoes:'#fc858f', floods:'#72d6d5',
  earthquakes:'#d6abff', landslides:'#edd587', drought:'#d9ba72', seaLakeIce:'#b1dfff',
  snow:'#c8e7fb', dustHaze:'#d4b8a0', tempExtremes:'#f3bb74'
} as Record<string,string>)[id] ?? '#a7c0d8';
export const dateLabel = (value: string | null) => value ? new Date(value).toLocaleDateString('ja-JP') : '日付不明';
export const API_URL = 'https://eonet.gsfc.nasa.gov/api/v3/events';
