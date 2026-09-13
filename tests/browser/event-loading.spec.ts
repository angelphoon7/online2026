// API fixtures only. Exercise the loading lifecycle without wallets, providers or writes.
import { test, expect, type Page } from '@playwright/test';
import deployment from '../../deployments/public/arc-testnet.json';

async function fixture(page: Page, statuses: number[], retryAfter = '1') {
  await page.clock.install();
  const control = { reads: 0, responses: 0 };
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/market') {
      const status = statuses[Math.min(control.reads++, statuses.length - 1)];
      await route.fulfill(status === 200 ? { json: {
        blockNumber: '100', timestamp: '1789232809', source: 'graph',
        tickets: [], intents: [], settlements: [], defaultHashes: [], hashMismatched: [],
      } } : { status, headers: { 'Retry-After': retryAfter }, json: {
        error: status === 429 ? 'SubgraphRateLimited: private provider diagnostic' : 'Temporary provider failure',
      } });
      control.responses++;
      return;
    }
    if (path === '/api/demo/reset' || path === '/api/demo/session') return route.fulfill({ json: { enabled: false, authenticated: false } });
    return route.fulfill({ status: 500, json: { error: `Unexpected fixture request: ${path}` } });
  });
  await page.goto('/#events');
  await expect.poll(() => control.responses).toBe(1);
  await page.locator('.poster-live').click();
  const dialog = page.getByRole('dialog', { name: 'Loading…', exact: true });
  await expect(dialog).toBeVisible();
  return { control, dialog };
}

test('event keeps its quarter-ring loading state through failures and opens automatically on recovery', async ({ page }) => {
  const { control, dialog } = await fixture(page, [503, 503, 200]);
  const spinner = dialog.locator('span[aria-hidden="true"]');
  await expect(spinner).toBeVisible();
  expect(await spinner.evaluate(element => getComputedStyle(element).animationName)).toBe('loading-ui-quarter-ring-rotation');
  await expect(dialog.getByText('Unable to load event')).toHaveCount(0);
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog.getByRole('button', { name: 'Retry loading' })).toHaveCount(0);
  await expect(dialog.getByText(/keep trying automatically/)).toBeVisible();
  await page.screenshot({ path: '.data/browser-tests/event-loading.png' });
  await expect.poll(async () => { await page.clock.runFor(500); return control.responses; }).toBe(2);
  await expect(dialog).toBeVisible();
  await expect(spinner).toBeVisible();
  await expect.poll(async () => { await page.clock.runFor(500); return control.responses; }).toBe(3);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.locator('body')).not.toHaveCSS('overflow', 'hidden');
  await page.clock.runFor(15000);
  expect(control.reads, 'Successful loading cancels the dialog retry loop').toBe(3);
});

test('loading waits through Retry-After and recovers without exposing provider errors', async ({ page }) => {
  const { control, dialog } = await fixture(page, [429, 200], '60');
  await expect(dialog.getByText(/SubgraphRateLimited|private provider/)).toHaveCount(0);
  // Initial-load retries must obey the provider cooldown.
  await page.clock.runFor(55000);
  expect(control.reads).toBe(1);
  await expect(dialog).toBeVisible();
  await expect.poll(async () => { await page.clock.runFor(1000); return control.responses; }, { timeout: 10000 }).toBe(2);
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#workspace')).toBeVisible();
});

test('leaving the loading dialog cancels its retries and allows reopening', async ({ page }) => {
  const { control, dialog } = await fixture(page, [503]);
  await dialog.getByRole('button', { name: 'Back to Events' }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#events')).toBeVisible();
  await page.clock.runFor(120000);
  expect(control.reads, 'Leaving cancels loading retries and no periodic refresh runs').toBe(1);
  await page.locator('.poster-live').click();
  await expect(dialog).toBeVisible();
  await expect.poll(async () => { await page.clock.runFor(500); return control.responses; }).toBe(2);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.locator('#events')).toBeVisible();
});

test('saved transaction block opens RPC fallback without contacting the exhausted Graph', async ({ page }) => {
  const floorKey = `reshuffle:read-floor:${deployment.chainId}:${deployment.contracts.IntentRegistry.toLowerCase()}`;
  await page.addInitScript(key => sessionStorage.setItem(key, '100'), floorKey);
  let graphCalls = 0, marketCalls = 0;
  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/graph') { graphCalls++; return route.fulfill({ status: 429, json: { error: 'Daily Graph quota exhausted' } }); }
    if (url.pathname === '/api/market') {
      marketCalls++; expect(url.searchParams.get('minBlock')).toBe('100');
      return route.fulfill({ json: { blockNumber: '101', timestamp: '1789232809', source: 'rpc',
        tickets: [], intents: [], settlements: [], defaultHashes: [], hashMismatched: [] } });
    }
    if (url.pathname === '/api/demo/reset' || url.pathname === '/api/demo/session') return route.fulfill({ json: { enabled: false, authenticated: false } });
    return route.fulfill({ status: 500, json: { error: 'Unexpected fixture request' } });
  });
  await page.goto('/#workspace');
  await expect(page.locator('#workspace')).toBeVisible();
  await expect(page.getByText('VIA DIRECT RPC READS', { exact: false })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Loading', exact: false })).toHaveCount(0);
  expect(marketCalls).toBe(1); expect(graphCalls).toBe(0);
  expect(await page.evaluate(key => sessionStorage.getItem(key), floorKey)).toBe('100');
});
