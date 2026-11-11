import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

// Optional CI evidence from the actual public feed. No routes, fixtures, or
// injected application state: failures are recorded rather than concealed.
const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'test-results');
const url = 'http://127.0.0.1:1422';
const started = Date.now();
const deadline = started + 110_000;
const metadata = {
  source: 'https://eonet.gsfc.nasa.gov/api/v3/events',
  usesFixtures: false,
  startedAt: new Date(started).toISOString(),
  completedAt: null,
  success: false,
  visibleCount: null,
  nasaError: null,
  nasaRequests: [],
  backgroundTileErrorCount: 0,
  backgroundTileErrors: [],
  pageErrors: [],
  insight: { busy: false, error: null },
  screenshots: [],
  warnings: [],
  failureReasons: [],
};
let server;
let browser;
let serverLog = '';
let stoppingServer;

function timeoutFor(limit) {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error('Preview capture exceeded its 110-second work budget.');
  return Math.max(1, Math.min(limit, remaining));
}

function describe(error) {
  return error instanceof Error ? error.message : String(error);
}

function fail(reason) {
  if (!metadata.failureReasons.includes(reason)) metadata.failureReasons.push(reason);
}

function tileFailure(details) {
  metadata.backgroundTileErrorCount += 1;
  if (metadata.backgroundTileErrors.length < 20) metadata.backgroundTileErrors.push(details);
}

function stopServer() {
  if (stoppingServer) return stoppingServer;
  stoppingServer = (async () => {
    if (!server?.pid || server.exitCode !== null) return;
    const terminate = signal => {
      try {
        if (process.platform === 'win32') server.kill(signal);
        else process.kill(-server.pid, signal);
      } catch { /* The process may already have exited. */ }
    };
    terminate('SIGTERM');
    await Promise.race([
      new Promise(resolve => server.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]);
    if (server.exitCode === null) terminate('SIGKILL');
  })();
  return stoppingServer;
}

async function waitForServer() {
  const startupDeadline = Math.min(deadline, Date.now() + 20_000);
  while (Date.now() < startupDeadline) {
    if (server.exitCode !== null) throw new Error(`Preview server exited (${server.exitCode}). ${serverLog}`);
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch { /* Vite has not started listening yet. */ }
    await new Promise(resolve => setTimeout(resolve, 150));
  }
  throw new Error(`Preview server did not start in time. ${serverLog}`);
}

async function readState(page) {
  return page.evaluate(() => {
    const text = selector => document.querySelector(selector)?.textContent?.trim() ?? null;
    const count = text('.summary-item .summary-value');
    const numericCount = count && /^\d[\d,]*$/.test(count) ? Number(count.replaceAll(',', '')) : null;
    const insight = document.querySelector('.insights-body');
    return {
      visibleCount: numericCount,
      nasaError: text('.error-notice'),
      tileNotice: text('.map-tile-notice'),
      insight: {
        busy: insight?.getAttribute('aria-busy') === 'true',
        error: text('.insights-state[role="alert"]'),
        label: text('.insights-count'),
      },
      tileImages: [...document.querySelectorAll('.leaflet-tile')].map(image => ({
        loaded: image.complete && image.naturalWidth > 0,
      })),
      selectedTitle: text('.map-detail h2'),
      horizontalOverflow: document.documentElement.scrollWidth > window.innerWidth + 1,
    };
  });
}

async function waitForTiles(page) {
  try {
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll('.leaflet-tile')];
      return images.length > 0 && images.every(image => image.complete);
    }, undefined, { timeout: timeoutFor(8_000) });
  } catch (error) {
    metadata.warnings.push(`Background tiles did not settle: ${describe(error)}`);
  }
}

async function capture(page, name) {
  await waitForTiles(page);
  const state = await readState(page);
  const filename = `live-preview-${name}.png`;
  await page.screenshot({
    path: path.join(output, filename),
    fullPage: true,
    animations: 'disabled',
    timeout: timeoutFor(10_000),
  });
  metadata.screenshots.push({ file: filename, viewport: page.viewportSize(), capturedAt: new Date().toISOString(), ...state });
  if (state.tileNotice || !state.tileImages.length || state.tileImages.some(image => !image.loaded)) {
    fail(`Background map was not fully available in the ${name} capture.`);
  }
  if (state.insight.busy || state.insight.error) fail(`Insights were not ready in the ${name} capture.`);
  if (state.horizontalOverflow) fail(`Horizontal overflow was detected in the ${name} capture.`);
  metadata.visibleCount = state.visibleCount;
  metadata.nasaError = state.nasaError;
  metadata.insight = state.insight;
}

await mkdir(output, { recursive: true });
// A last-resort deadline also covers unexpected browser/transport hangs.
const watchdog = setTimeout(() => {
  fail('Capture exceeded the overall 115-second deadline.');
  void browser?.close().catch(() => undefined);
  void stopServer();
}, 115_000);

try {
  server = spawn(process.execPath, [path.join(root, 'node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', '1422', '--strictPort'], {
    cwd: root,
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
  });
  for (const stream of [server.stdout, server.stderr]) {
    stream.on('data', chunk => { serverLog = (serverLog + String(chunk)).slice(-2_000); });
  }
  server.on('error', error => { serverLog += `\n${describe(error)}`; });
  await waitForServer();

  browser = await chromium.launch({ timeout: timeoutFor(20_000) });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1060 },
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    reducedMotion: 'reduce',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(10_000);
  page.on('pageerror', error => metadata.pageErrors.push(describe(error)));
  page.on('requestfailed', request => {
    const destination = new URL(request.url());
    if (destination.hostname.endsWith('.basemaps.cartocdn.com')) {
      tileFailure({ url: request.url(), error: request.failure()?.errorText ?? 'Request failed' });
    }
    if (destination.hostname === 'eonet.gsfc.nasa.gov') {
      metadata.nasaRequests.push({ url: request.url(), error: request.failure()?.errorText ?? 'Request failed' });
    }
  });
  page.on('response', response => {
    const destination = new URL(response.url());
    if (destination.hostname === 'eonet.gsfc.nasa.gov') metadata.nasaRequests.push({ url: response.url(), status: response.status() });
    if (destination.hostname.endsWith('.basemaps.cartocdn.com') && response.status() >= 400) {
      tileFailure({ url: response.url(), status: response.status() });
    }
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutFor(20_000) });
  try {
    await page.waitForFunction(() => {
      const count = document.querySelector('.summary-item .summary-value')?.textContent?.trim() ?? '';
      const update = document.querySelector('.source-controls .primary');
      return Boolean(document.querySelector('.error-notice')) || (/^\d[\d,]*$/.test(count) && update && !update.disabled);
    }, undefined, { timeout: timeoutFor(38_000) });
  } catch (error) {
    fail(`NASA data did not reach a visible outcome: ${describe(error)}`);
  }
  let state = await readState(page);
  metadata.visibleCount = state.visibleCount;
  metadata.nasaError = state.nasaError;
  if (state.visibleCount === null || state.nasaError) fail('The actual NASA feed could not be loaded.');

  if (state.visibleCount !== null) {
    try {
      await page.waitForFunction(() => document.querySelector('.insights-body')?.getAttribute('aria-busy') === 'false', undefined, { timeout: timeoutFor(30_000) });
    } catch (error) {
      fail(`Insights did not finish: ${describe(error)}`);
    }
  }
  await capture(page, 'desktop');

  const firstEvent = page.locator('.event-card').first();
  if (await firstEvent.count()) {
    await firstEvent.click({ timeout: timeoutFor(8_000) });
    await page.getByRole('region', { name: 'イベントの詳細', exact: true }).waitFor({ state: 'visible', timeout: timeoutFor(5_000) });
    await capture(page, 'detail');
    await page.getByRole('button', { name: '詳細を閉じる', exact: true }).click({ timeout: timeoutFor(5_000) });
  } else {
    metadata.warnings.push('No event was available for a detail capture.');
  }

  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '地図と傾向', exact: true }).click({ timeout: timeoutFor(5_000) });
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await capture(page, 'mobile');
  state = await readState(page);
  metadata.insight = state.insight;
} catch (error) {
  fail(describe(error));
} finally {
  if (metadata.backgroundTileErrorCount) fail('One or more background-map requests failed.');
  if (metadata.pageErrors.length) fail('One or more browser page errors occurred.');
  if (metadata.insight.busy || metadata.insight.error) fail('Event insights were not available.');
  try { await browser?.close(); } catch (error) { metadata.warnings.push(`Browser cleanup: ${describe(error)}`); }
  await stopServer();
  clearTimeout(watchdog);
  metadata.completedAt = new Date().toISOString();
  metadata.elapsedMs = Date.now() - started;
  metadata.success = metadata.failureReasons.length === 0;
  await writeFile(path.join(output, 'live-preview-metadata.json'), `${JSON.stringify(metadata, null, 2)}\n`);
  console.log(JSON.stringify({ success: metadata.success, visibleCount: metadata.visibleCount, screenshots: metadata.screenshots.map(item => item.file), failures: metadata.failureReasons, metadata: 'test-results/live-preview-metadata.json' }, null, 2));
  if (!metadata.success) process.exitCode = 1;
}
