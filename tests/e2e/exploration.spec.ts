import { expect, test } from '@playwright/test';
import type { Page, TestInfo } from '@playwright/test';
import { API_ROUTE, TILE_ROUTE, fixtureEvents, mockEvents, mockMapTiles, paginationEvents } from './fixtures';

const technicalTerms = /DuckDB|WebView|\bRust\b|\bTauri\b|\bSQL\b|\bAPI\b|\bWasm\b/i;
const displayedCount = (page: Page) => page.locator('.summary-item').nth(0).locator('.summary-value');
const mappedCount = (page: Page) => page.locator('.summary-item').nth(1).locator('.summary-value');
const events = (page: Page) => page.locator('.event-card');

async function openFixture(page: Page, count = fixtureEvents.length) {
  await page.goto('/');
  await expect(displayedCount(page)).toHaveText(String(count));
  await expect(events(page)).toHaveCount(Math.min(count, 40));
}

async function expectInsights(page: Page, total: number) {
  await expect(page.locator('.insights-count')).toHaveText(`${total}件を集計`);
  if (!total) return;
  await expect(page.locator('.insights-bars')).toBeVisible({ timeout: 30_000 });
  await expect.poll(async () => {
    const labels = await page.locator('.insight-count').allTextContents();
    return labels.reduce((sum, label) => sum + Number(label.replace(/[^0-9]/g, '')), 0);
  }).toBe(total);
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true, animations: 'disabled' });
  await testInfo.attach(name, { path, contentType: 'image/png' });
}

test.beforeEach(async ({ page }) => {
  await mockMapTiles(page);
  await mockEvents(page);
});

test('fixture data: desktop loads, summarizes events and hides implementation details', async ({ page }, testInfo) => {
  const pageErrors: string[] = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await openFixture(page);
  await expect(mappedCount(page)).toHaveText('9');
  await expectInsights(page, 10);
  await expect(page.locator('body')).not.toContainText(technicalTerms);
  await expect(page.getByRole('button', { name: 'データを更新', exact: true })).toBeEnabled();
  expect(pageErrors).toEqual([]);
  // Fixture events; transparent placeholder map tiles, not a live-data capture.
  await attachScreenshot(page, testInfo, 'fixture-desktop.png');
});

test('category and search keep the list, map counts and insights in sync', async ({ page }) => {
  await openFixture(page);
  await page.getByRole('button', { name: /^山火事/ }).click();
  await expect(displayedCount(page)).toHaveText('3');
  await expect(mappedCount(page)).toHaveText('3');
  await expect(events(page)).toHaveCount(3);
  await expectInsights(page, 3);

  await page.getByRole('searchbox', { name: 'イベントを検索' }).fill('Cedar');
  await expect(displayedCount(page)).toHaveText('1');
  await expect(mappedCount(page)).toHaveText('1');
  await expect(events(page)).toHaveCount(1);
  await expect(events(page).first()).toContainText('Fixture Cedar Fire');
  await expectInsights(page, 1);

  await page.getByRole('button', { name: '検索をクリア', exact: true }).click();
  await expect(displayedCount(page)).toHaveText('3');
  await page.getByRole('button', { name: /^すべて/ }).click();
  await expect(displayedCount(page)).toHaveText('10');
  await expectInsights(page, 10);
});

test('event selection opens accessible details and clears when filtered out', async ({ page }) => {
  await openFixture(page);
  const cedar = events(page).filter({ hasText: 'Fixture Cedar Fire' });
  await cedar.click();
  const detail = page.getByRole('region', { name: 'イベントの詳細', exact: true });
  await expect(detail).toBeVisible();
  await expect(detail).toContainText('Fixture Cedar Fire');
  await expect(cedar).toHaveAttribute('aria-pressed', 'true');
  await page.keyboard.press('Escape');
  await expect(detail).toBeHidden();
  await expect(cedar).toHaveAttribute('aria-pressed', 'false');

  await cedar.click();
  await page.getByRole('button', { name: /^暴風雨/ }).click();
  await expect(detail).toBeHidden();
  await expect(page.locator('.event-card[aria-pressed="true"]')).toHaveCount(0);
  await expect(displayedCount(page)).toHaveText('2');
});

test('empty search can be reset without downloading the events again', async ({ page }) => {
  let requests = 0;
  page.on('request', request => {
    if (request.url().startsWith('https://eonet.gsfc.nasa.gov/api/v3/events')) requests += 1;
  });
  await openFixture(page);
  const beforeSearch = requests;
  await page.getByRole('searchbox', { name: 'イベントを検索' }).fill('no-such-fixture-event');
  await expect(displayedCount(page)).toHaveText('0');
  await expect(mappedCount(page)).toHaveText('0');
  await expect(events(page)).toHaveCount(0);
  await expect(page.locator('.insights-count')).toHaveText('0件を集計');
  await page.getByRole('button', { name: '絞り込みを解除', exact: true }).first().click();
  await expect(page.getByRole('searchbox', { name: 'イベントを検索' })).toHaveValue('');
  await expect(displayedCount(page)).toHaveText('10');
  expect(requests).toBe(beforeSearch);
});

test('sort order is independent of filtering and covers events without positions', async ({ page }) => {
  await openFixture(page);
  await expect(events(page).first()).toContainText('Fixture Cedar Fire');
  await page.getByLabel('並び順', { exact: true }).selectOption('oldest');
  await expect(events(page).first()).toContainText('Fixture Location Pending');
  await page.getByLabel('並び順', { exact: true }).selectOption('name');
  await expect(events(page).first()).toContainText('Fixture Alpine Fire');
  await expect(displayedCount(page)).toHaveText('10');
});

test('initial download failure gives a readable retry and recovers', async ({ page }) => {
  await page.route(API_ROUTE, route => route.fulfill({ status: 503, body: 'upstream fixture failure' }));
  await page.goto('/');
  await expect(page.locator('.error-notice')).toBeVisible();
  await expect(page.locator('body')).not.toContainText(technicalTerms);
  await expect(page.locator('body')).not.toContainText('upstream fixture failure');
  await mockEvents(page);
  await page.getByRole('button', { name: 'もう一度読み込む', exact: true }).click();
  await expect(displayedCount(page)).toHaveText('10');
  await expect(page.locator('.error-notice')).toBeHidden();
  await expectInsights(page, 10);
});

test('failed refresh preserves visible data and the conditions actually loaded', async ({ page }) => {
  await openFixture(page);
  await expect(page.locator('.scope-label strong')).toHaveText('過去90日 · すべて');
  await page.getByLabel('対象期間', { exact: true }).selectOption('30');
  await page.getByLabel('記録の状態', { exact: true }).selectOption('open');
  await page.route(API_ROUTE, route => route.fulfill({ status: 503, body: 'upstream fixture failure' }));

  const request = page.waitForRequest(request => {
    if (!request.url().startsWith('https://eonet.gsfc.nasa.gov/api/v3/events')) return false;
    const url = new URL(request.url());
    return url.searchParams.get('days') === '30' && url.searchParams.get('status') === 'open';
  });
  await page.getByRole('button', { name: '条件を適用', exact: true }).click();
  await request;
  await expect(page.locator('.error-notice')).toContainText('前回のデータを表示しています');
  await expect(page.locator('.error-notice')).toContainText('表示中の条件：過去90日 · すべて');
  await expect(page.locator('.scope-label strong')).toHaveText('過去90日 · すべて');
  await expect(displayedCount(page)).toHaveText('10');
  await expect(events(page)).toHaveCount(10);
  await expectInsights(page, 10);
});

test('more than 200 fixture events remain reachable through pagination and search', async ({ page }) => {
  await mockEvents(page, paginationEvents(205));
  await openFixture(page, 205);
  for (const count of [80, 120, 160, 200, 205]) {
    await page.getByRole('button', { name: /^さらに\d+件を表示/ }).click();
    await expect(events(page)).toHaveCount(count);
  }
  await expect(page.getByRole('button', { name: /^さらに\d+件を表示/ })).toHaveCount(0);
  await page.getByRole('searchbox', { name: 'イベントを検索' }).fill('Fixture event 204');
  await expect(events(page)).toHaveCount(1);
  await expect(events(page).first()).toContainText('Fixture event 204');
  await expect(displayedCount(page)).toHaveText('1');
});

test('all insight views preserve event totals and support arrow-key navigation', async ({ page }) => {
  await openFixture(page);
  await expectInsights(page, 10);
  const categories = page.getByRole('tab', { name: '種類別', exact: true });
  await categories.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '観測日別', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: '観測日別', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expectInsights(page, 10);
  await expect(page.locator('.insight-label', { hasText: 'それ以前' })).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: '南北半球別', exact: true })).toBeFocused();
  await expectInsights(page, 10);
  await expect(page.locator('.insight-label', { hasText: '位置情報なし' })).toBeVisible();
});

test('map background failure is isolated and its retry recovers', async ({ page }) => {
  const failTile = async (route: import('@playwright/test').Route) => { await route.abort('failed'); };
  await page.route(TILE_ROUTE, failTile);
  await openFixture(page);
  await expect(page.locator('.map-tile-notice')).toContainText('背景地図を読み込めませんでした');
  await expect(events(page)).toHaveCount(10);
  await page.unroute(TILE_ROUTE, failTile);
  await page.getByRole('button', { name: '再読み込み', exact: true }).click();
  await expect(page.locator('.map-tile-notice')).toBeHidden();
});

test('analysis initialization failure leaves map and list usable without exposing internals', async ({ page }) => {
  await page.route(/duckdb-.*\.wasm(?:\?.*)?$/, route => route.abort('failed'));
  await openFixture(page);
  await expect(page.locator('.insights-state')).toContainText('傾向を表示できませんでした', { timeout: 30_000 });
  await expect(page.locator('body')).not.toContainText(technicalTerms);
  await page.getByRole('button', { name: /^山火事/ }).click();
  await expect(displayedCount(page)).toHaveText('3');
  await expect(mappedCount(page)).toHaveText('3');
  await expect(events(page)).toHaveCount(3);
  await events(page).first().click();
  await expect(page.getByRole('region', { name: 'イベントの詳細', exact: true })).toBeVisible();
});

test('data notes dialog opens and returns keyboard focus when dismissed', async ({ page }) => {
  await openFixture(page);
  const trigger = page.getByRole('button', { name: 'データについて', exact: true });
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: 'データについて', exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog).not.toContainText(technicalTerms);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();
});

test.describe('mobile', () => {
  test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });

  test('fixture data: narrow layout has no horizontal overflow and selected details remain reachable', async ({ page }, testInfo) => {
    await page.goto('/');
    await expect(displayedCount(page)).toHaveText('10');
    await page.getByRole('button', { name: /^一覧(?:\s|$)/ }).click();
    await page.getByRole('searchbox', { name: 'イベントを検索' }).fill('Cedar');
    await events(page).first().click();
    const detail = page.getByRole('region', { name: 'イベントの詳細', exact: true });
    await expect(detail).toBeVisible();
    await expect(detail).toContainText('Fixture Cedar Fire');
    await expectInsights(page, 1);
    await detail.scrollIntoViewIfNeeded();
    await expect(detail).toBeInViewport();
    const hasHorizontalOverflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    expect(hasHorizontalOverflow).toBe(false);
    await expect(page.locator('body')).not.toContainText(technicalTerms);
    // Fixture events; transparent placeholder map tiles, not a live-data capture.
    await attachScreenshot(page, testInfo, 'fixture-mobile.png');
    await page.getByRole('button', { name: '詳細を閉じる', exact: true }).click();
    await page.getByRole('button', { name: /^一覧(?:\s|$)/ }).click();
    await expect(page.getByRole('searchbox', { name: 'イベントを検索' })).toBeVisible();
  });
});
