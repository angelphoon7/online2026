// Browser regression fixtures only: every API request is intercepted. No chain writes,
// wallet connection or model calls. Real-chain timing is recorded separately in docs/checks.
import { test, expect, type Page, type Route } from '@playwright/test';

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const A = hash('1'), B = hash('2'), NEW = hash('3'), REVOKE = hash('a'), COMMIT = hash('b');
const owner = (digit: string) => `0x${digit.repeat(40)}`;
const intent = (id: string, who: string, state = 1) => ({ hash: id, owner: who, offered: [], eventId: 1, sessionMask: '1', sectionMask: '1', exactCount: 2, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: '1000000', deadline: '2000000000', nonce: '1', commitTx: hash('c'), state, expired: false });
const diagnosis = (id: string, block: number) => ({ block: String(block), intent: id, status: 'SETTLEABLE', relaxations: [], bounds: { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000, budgetCapUsdc: 40 }, counterpartyTx: {}, runtimeMs: 1 });

async function fixture(page: Page, partial = false) {
  const control = { block: 100, graphBlock: 100, graphError: false, changed: false, staleMarket: false, holdMarket: false, holdAsk: false, oldMarket: null as Route | null, oldAsk: null as Route | null, reads: [] as string[] };
  const market = (block = control.block) => ({ blockNumber: String(block), timestamp: '1789232809', source: 'graph', tickets: [], intents: [intent(A, owner('1'), control.changed ? 2 : 1), intent(B, owner('2')), ...(control.changed && !partial ? [intent(NEW, owner('1'))] : [])], settlements: [], defaultHashes: [], hashMismatched: [] });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    control.reads.push(`${request.method()} ${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/market') {
      if (control.holdMarket) { control.holdMarket = false; control.oldMarket = route; return; }
      return json(market(control.staleMarket ? 199 : control.block));
    }
    if (path === '/api/demo/reset') return json({ enabled: false, state: 'idle' });
    if (path === '/api/demo/budget') {
      if (request.method() === 'GET') return json({ enabled: true, snapshotBlock: String(control.block), intents: market().intents.filter(i => i.state === 1).map(i => ({ ...i, maxNetPayUsdc: 1 })) });
      control.changed = true; control.graphError = true;
      if (partial) return json({ error: 'Revoke confirmed; replacement was not confirmed.', confirmed: { blockNumber: '200', hashes: [REVOKE] } }, 502);
      return json({ oldHash: A, newHash: NEW, revokeTx: REVOKE, commitTx: COMMIT, commitBlock: '200' });
    }
    if (path === '/api/graph') return json({ data: { _meta: { block: { number: control.graphBlock, timestamp: '1789232809' }, hasIndexingErrors: control.graphError, deployment: 'browser-fixture' } } });
    if (path.startsWith('/api/agent/diagnose/')) return json(diagnosis(path.split('/').at(-1)!, control.block));
    if (path === '/api/agent/ask') {
      if (control.holdAsk) { control.holdAsk = false; control.oldAsk = route; return; }
      const body = request.postDataJSON();
      expect(BigInt(body.minBlock)).toBeGreaterThanOrEqual(control.changed ? 200n : 100n);
      return json({ answer: `At Arc Testnet block #${control.block}: current answer.`, block: String(control.block), guardFallback: true, model: null, evidence: [{ tool: 'diagnose_intent', input: {}, output: diagnosis(body.intentHash, control.block) }] });
    }
    if (path === '/api/solve/pool' || path === '/api/solve') return json({ id: 'fixture', proposal: null, source: { kind: 'subgraph', blockNumber: String(control.block), snapshotBlock: String(control.block) }, candidatesFound: 0, candidatesExcluded: [], intentsConsidered: 2, chosen: null });
    if (path === '/api/rpc') { const body = request.postDataJSON(); return json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x4cef52' : '0xc8' }); }
    return json({ error: `Unexpected API request in browser fixture: ${path}` }, 500);
  });
  await page.goto('/#workspace');
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 100/)).toBeVisible();
  return { control, market };
}

async function applyBudget(page: Page) {
  await page.getByText('Judge controls / change a signed condition', { exact: true }).click();
  await page.getByLabel('Participant intent', { exact: true }).selectOption(A);
  await page.getByLabel('New signed limit (USDC)', { exact: true }).fill('2');
  await page.getByRole('button', { name: 'Apply budget', exact: true }).click();
}

test('receipt floor survives errors, stale responses, agent hash changes and reload', async ({ page }) => {
  const { control, market } = await fixture(page);
  control.holdMarket = true;
  await page.getByRole('button', { name: /Refresh public state/ }).click();
  await expect.poll(() => !!control.oldMarket).toBe(true);
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  control.holdAsk = true;
  await drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true }).click();
  await expect.poll(() => !!control.oldAsk).toBe(true);
  await applyBudget(page);
  await expect(drawer.getByText('Indexing block #200…', { exact: true })).toBeVisible();
  await expect(drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true })).toBeDisabled();
  await expect(page.locator('.workspace-stack')).toBeHidden();
  await expect(page.getByText(/SubgraphIndexingError:/).first()).toBeVisible();
  await expect(page.locator(`.activity a[href$="${REVOKE}"]`).first()).toBeVisible();
  await expect(page.locator(`.activity a[href$="${COMMIT}"]`).first()).toBeVisible();
  await control.oldMarket!.fulfill({ json: market(100) });
  await control.oldAsk!.fulfill({ json: { answer: 'STALE ANSWER', block: '100', evidence: [] } }).catch(() => {});
  await expect(drawer.getByText('STALE ANSWER')).toHaveCount(0);
  await expect(page.locator('.workspace-stack')).toBeHidden();
  control.graphError = false; control.graphBlock = 200; control.block = 200; control.staleMarket = true;
  await drawer.getByRole('button', { name: 'Retry indexing' }).click();
  await expect(drawer.getByText(/SnapshotTooOld:/)).toBeVisible();
  await expect(drawer.getByRole('button', { name: 'Ask', exact: true })).toBeDisabled();
  control.staleMarket = false;
  await drawer.getByRole('button', { name: 'Retry indexing' }).click();
  await expect(page.locator('.workspace-stack')).toBeVisible();
  await expect(drawer.getByText(/BLOCK #200/)).toBeVisible();
  await expect.poll(() => control.reads.some(url => url.includes(`/diagnose/${NEW}?minBlock=200`))).toBe(true);
  await drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true }).click();
  await expect(drawer.getByText('At Arc Testnet block #200: current answer.', { exact: true })).toBeVisible();
  control.reads.length = 0;
  await page.reload();
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 200/)).toBeVisible();
  expect(control.reads.filter(url => url.startsWith('GET /api/market'))).not.toHaveLength(0);
  expect(control.reads.filter(url => url.startsWith('GET /api/market')).every(url => url.includes('minBlock=200'))).toBe(true);
});

test('partial budget failure retains revoke receipt and waits before showing the pool', async ({ page }) => {
  const { control } = await fixture(page, true);
  await applyBudget(page);
  await expect(page.locator('.workspace-stack')).toBeHidden();
  await expect(page.locator('.workspace-section').getByText('Indexing block #200…', { exact: true }).first()).toBeVisible();
  await expect(page.locator(`.activity a[href$="${REVOKE}"]`).first()).toBeVisible();
  control.graphError = false; control.graphBlock = 200; control.block = 200;
  await page.getByRole('button', { name: 'Retry indexing' }).first().click();
  await expect(page.locator('.workspace-stack')).toBeVisible();
  await page.getByRole('button', { name: /Intent pool \(/ }).click();
  await expect(page.locator(`.pool-list a[href$="${intent(A, owner('1')).commitTx}"]`)).toHaveCount(1); // only B remains live
});
