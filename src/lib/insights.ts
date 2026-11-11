import { categoryLabel, colorFor, dateLabel } from './eonet';

export type InsightView = 'category' | 'daily' | 'hemisphere';
export type InsightDatum = { key: string; label: string; count: number; color: string };

export const INSIGHT_QUERIES: Record<InsightView, string> = {
  category: `SELECT category_id AS key, MIN(category) AS label, COUNT(*) AS events
    FROM events GROUP BY category_id ORDER BY events DESC, category_id`,
  daily: `SELECT COALESCE(SUBSTR(event_date, 1, 10), 'unknown') AS key, COUNT(*) AS events
    FROM events GROUP BY key ORDER BY key DESC`,
  hemisphere: `SELECT CASE WHEN latitude IS NULL THEN 'unknown'
      WHEN latitude > 0 THEN 'north' WHEN latitude < 0 THEN 'south' ELSE 'equator' END AS key,
      COUNT(*) AS events
    FROM events GROUP BY key ORDER BY events DESC, key`
};

const hemisphereLabels: Record<string, string> = {
  north: '北半球', south: '南半球', equator: '赤道上', unknown: '位置情報なし'
};
const hemisphereColors: Record<string, string> = {
  north: '#8ab9f1', south: '#6ac8b5', equator: '#dab77c', unknown: '#708393'
};
const DAILY_VISIBLE_DATES = 7;

/** Preserve totals while keeping a long observation period readable. */
export function insightData(
  view: InsightView,
  rows: Record<string, string>[]
): InsightDatum[] {
  if (view === 'category') {
    return rows.map(row => ({
      key: row.key,
      label: categoryLabel(row.key, row.label),
      count: Number(row.events),
      color: colorFor(row.key)
    }));
  }

  if (view === 'hemisphere') {
    return rows.map(row => ({
      key: row.key,
      label: hemisphereLabels[row.key] ?? '位置情報なし',
      count: Number(row.events),
      color: hemisphereColors[row.key] ?? '#708393'
    }));
  }

  const dates = rows.filter(row => row.key !== 'unknown')
    .sort((a, b) => b.key.localeCompare(a.key));
  const visible = dates.slice(0, DAILY_VISIBLE_DATES).map(row => ({
    key: row.key,
    label: dateLabel(`${row.key}T00:00:00Z`),
    count: Number(row.events),
    color: '#8ab9f1'
  }));
  const earlier = dates.slice(DAILY_VISIBLE_DATES).reduce((sum, row) => sum + Number(row.events), 0);
  if (earlier) visible.push({ key: 'earlier', label: 'それ以前', count: earlier, color: '#7393b3' });
  const unknown = rows.find(row => row.key === 'unknown');
  if (unknown) {
    visible.push({ key: 'unknown', label: '観測日不明', count: Number(unknown.events), color: '#708393' });
  }
  return visible;
}
