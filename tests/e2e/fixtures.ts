import type { Page } from '@playwright/test';
import type { EonetEvent } from '../../src/lib/eonet';

export const API_ROUTE = 'https://eonet.gsfc.nasa.gov/api/v3/events*';
export const TILE_ROUTE = /^https:\/\/[a-d]\.basemaps\.cartocdn\.com\//;

// Synthetic events and transparent map tiles keep these regression checks
// independent of NASA/CARTO uptime. None are used by the production application.
export const fixtureEvents: EonetEvent[] = [
  ['WF-CEDAR', 'Fixture Cedar Fire', 'wildfires', 'Wildfires', 10, -123, 44, false],
  ['WF-ALPINE', 'Fixture Alpine Fire', 'wildfires', 'Wildfires', 8, -110, 40, true],
  ['WF-COAST', 'Fixture Coastal Fire', 'wildfires', 'Wildfires', 5, 151, -33, false],
  ['ST-DELTA', 'Fixture Delta Storm', 'severeStorms', 'Severe Storms', 9, -80, 22, false],
  ['ST-PACIFIC', 'Fixture Pacific Storm', 'severeStorms', 'Severe Storms', 7, -170, -15, true],
  ['VO-ISLAND', 'Fixture Island Volcano', 'volcanoes', 'Volcanoes', 6, -92, 15, false],
  ['VO-NORTH', 'Fixture Northern Volcano', 'volcanoes', 'Volcanoes', 4, -17, 64, false],
  ['FL-RIVER', 'Fixture River Flood', 'floods', 'Floods', 3, 20, 5, true],
  ['ICE-SOUTH', 'Fixture Antarctic Ice', 'seaLakeIce', 'Sea and Lake Ice', 2, 40, -72, false],
  ['NO-LOCATION', 'Fixture Location Pending', 'dustHaze', 'Dust and Haze', 1, null, null, true],
].map(([id, title, category, categoryTitle, day, longitude, latitude, closed]) => ({
  id: String(id),
  title: String(title),
  description: `Synthetic regression fixture for ${String(title)}.`,
  link: `https://eonet.gsfc.nasa.gov/api/v3/events/${String(id)}`,
  closed: closed ? '2026-11-11T00:00:00Z' : null,
  categories: [{ id: String(category), title: String(categoryTitle) }],
  geometry: [{
    date: `2026-11-${String(day).padStart(2, '0')}T12:00:00Z`,
    type: 'Point',
    coordinates: longitude === null ? [] : [longitude, latitude],
  }],
  sources: [{ id: 'Fixture source', url: 'https://example.org/fixture-source' }],
}));

export function paginationEvents(count: number): EonetEvent[] {
  return Array.from({ length: count }, (_, index) => ({
    ...fixtureEvents[index % fixtureEvents.length],
    id: `FIXTURE-${index}`,
    title: `Fixture event ${String(index).padStart(3, '0')}`,
  }));
}

export async function mockMapTiles(page: Page) {
  const transparentPixel = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await page.route(TILE_ROUTE, route => route.fulfill({ status: 200, contentType: 'image/png', body: transparentPixel }));
}

export async function mockEvents(page: Page, events: EonetEvent[] = fixtureEvents) {
  await page.route(API_ROUTE, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    headers: { 'Access-Control-Allow-Origin': '*' },
    body: JSON.stringify({ title: 'Synthetic regression fixture', events }),
  }));
}
