// Every API and wallet request is intercepted; no real transactions are sent.
import { test, expect, type Page, type Route } from '@playwright/test';
import { encodeErrorResult, parseAbi, toFunctionSelector, type Hex } from 'viem';
import record from '../../deployments/act-one.json';
const rejectionAbi = parseAbi(['error IntentExpired(bytes32 intentHash, uint64 deadline)']);

type WalletRequest = { method: string; params?: unknown[] };
type Transaction = { data: Hex };

async function fixture(page: Page, options: { noMatch?: boolean; solverBlock?: number } = {}) {
  await page.clock.install();
  const proposal = record.evidence.proposal;
  const owner = proposal.intents[0].owner;
  const market = {
    blockNumber: '100', timestamp: '1789160000', source: 'graph',
    tickets: record.proof.tickets.map(ticket => ({ ...ticket.meta, tokenId: ticket.tokenId, owner: record.proof.escrow, depositor: ticket.previousParticipant })),
    intents: proposal.intents.map((intent, index) => ({ ...intent, hash: proposal.legs[index].intentHash, commitTx: record.proof.transactionHash, state: 1, expired: false })),
    settlements: [], defaultHashes: [], hashMismatched: [],
  };
  const control = {
    noMatch: options.noMatch ?? false, solverBlock: options.solverBlock ?? 100,
    marketReads: 0, poolCalls: 0, selectedCalls: 0, readFailure: false,
    holdRead: false, pendingRead: null as Route | null,
    holdSearch: false, pendingSearch: null as Route | null,
    rejectSimulation: false, holdSimulation: false, pendingSimulation: null as Route | null,
    simulations: [] as Transaction[], transactions: [] as Transaction[],
  };
  const solveResult = () => ({
    ...record.evidence, transactionHash: undefined, receipt: undefined,
    source: { kind: 'subgraph', blockNumber: String(control.solverBlock), subgraphEndpoint: null },
    proposal: control.noMatch ? null : proposal,
    chosen: control.noMatch ? null : record.evidence.chosen,
    candidatesFound: control.noMatch ? 0 : record.evidence.candidatesFound,
    simulationResult: control.noMatch ? undefined : { success: true },
    pool: { liveIntents: 3, searchableIntents: 3, excludedIntents: 0 },
    search: { termination: 'complete' },
  });
  await page.exposeFunction('reviewWalletRequest', async ({ method, params = [] }: WalletRequest) => {
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_sendTransaction') {
      control.transactions.push(params[0] as Transaction);
      throw Object.assign(new Error('User rejected transaction'), { code: 4001 });
    }
    throw new Error(`Unexpected wallet request: ${method}`);
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as { reviewWalletRequest: (request: WalletRequest) => Promise<unknown> };
    Object.defineProperty(window, 'ethereum', { value: { on() {}, removeListener() {}, request: (request: WalletRequest) => bridge.reviewWalletRequest(request) } });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/market') {
      control.marketReads++;
      if (control.holdRead) { control.pendingRead = route; return; }
      if (control.readFailure) return route.fulfill({ status: 503, json: { error: 'Temporary read failure' } });
      return json(market);
    }
    if (path === '/api/demo/reset' || path === '/api/demo/session') return json({ enabled: false, authenticated: false });
    if (path === '/api/solve' || path === '/api/solve/pool') {
      if (path === '/api/solve') control.selectedCalls++;
      else control.poolCalls++;
      if (control.holdSearch) { control.pendingSearch = route; return; }
      return json(solveResult());
    }
    if (path === '/api/rpc') {
      const body = route.request().postDataJSON();
      if (body.method === 'eth_chainId') return json({ jsonrpc: '2.0', id: body.id, result: '0x4cef52' });
      if (body.method === 'eth_getBalance') return json({ jsonrpc: '2.0', id: body.id, result: '0xde0b6b3a7640000' });
      if (body.method === 'eth_call') {
        const transaction = body.params[0] as Transaction;
        if (transaction.data.startsWith(toFunctionSelector('isApprovedForAll(address,address)'))) return json({ jsonrpc: '2.0', id: body.id, result: `0x${'0'.repeat(63)}1` });
        control.simulations.push(transaction);
        if (control.holdSimulation) { control.pendingSimulation = route; return; }
        if (control.rejectSimulation) return json({ jsonrpc: '2.0', id: body.id, error: { code: 3, message: 'execution reverted', data: encodeErrorResult({ abi: rejectionAbi, errorName: 'IntentExpired', args: [proposal.legs[0].intentHash as Hex, BigInt(proposal.intents[0].deadline)] }) } });
        return json({ jsonrpc: '2.0', id: body.id, result: '0x' });
      }
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected fixture API: ${path}` } });
  });
  await page.goto('/#workspace');
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 100/)).toBeVisible();
  await expect(page.getByRole('button', { name: /Check all intents/ })).toBeEnabled();
  return { control, market, solveResult };
}

test('ready match stays stable through background reads and submits exactly the reviewed candidate', async ({ page }) => {
  const { control, market } = await fixture(page);
  const candidate = page.locator('.candidate');
  const settle = page.getByRole('button', { name: 'Propose and settle' });
  await expect(settle).toBeEnabled();
  await candidate.getByText('Why this match?', { exact: true }).click();
  const reviewed = await candidate.innerText();
  control.holdRead = true;
  await page.clock.fastForward(30_000);
  await expect.poll(() => !!control.pendingRead).toBe(true);
  await expect(settle).toBeEnabled();
  await expect(page.getByText('Reading and searching', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your swap request' })).toContainText('Match found - awaiting settlement');
  expect(await candidate.innerText()).toBe(reviewed);

  // A wallet action can begin while a public read is still pending.
  control.holdSimulation = true;
  await settle.click();
  await expect.poll(() => !!control.pendingSimulation).toBe(true);
  control.holdRead = false;
  market.blockNumber = '101';
  await control.pendingRead!.fulfill({ json: market });
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 101/)).toBeVisible();
  const simulation = control.pendingSimulation!;
  await simulation.fulfill({ json: { jsonrpc: '2.0', id: simulation.request().postDataJSON().id, result: '0x' } });
  await expect.poll(() => control.transactions.length).toBe(1);
  expect(control.transactions[0].data).toBe(control.simulations[0].data);
  expect(control.selectedCalls).toBe(0);
  await expect(settle).toBeEnabled(); // cancelling the wallet preserves the review
  expect(await candidate.innerText()).toBe(reviewed);

  for (const block of ['102', '103']) {
    market.blockNumber = block;
    await page.clock.fastForward(30_000);
    await expect(page.locator('.workspace-section').getByText(new RegExp(`ARC BLOCK ${block}`))).toBeVisible();
    await expect(settle).toBeEnabled();
  }
  expect(control.poolCalls).toBe(1);
  expect(await candidate.innerText()).toBe(reviewed);
});

test('temporary public read failure does not replace a ready match with an error or restart the solver', async ({ page }) => {
  const { control } = await fixture(page);
  control.readFailure = true;
  const reads = control.marketReads;
  await page.clock.fastForward(30_000);
  await expect.poll(() => control.marketReads).toBeGreaterThan(reads);
  await expect(page.getByRole('button', { name: 'Propose and settle' })).toBeEnabled();
  await expect(page.getByRole('region', { name: 'Your swap request' })).toContainText('Match found - awaiting settlement');
  await expect(page.locator('.matching-panel')).not.toContainText('Reading and searching');
  expect(control.poolCalls).toBe(1);
});

for (const change of ['revoked', 'settled', 'expired', 'withdrawn', 'redeemed'] as const) {
  test(`${change} candidate resumes matching after a newer public snapshot`, async ({ page }) => {
    const { control, market, solveResult } = await fixture(page);
    if (change === 'revoked') market.intents[0].state = 2;
    if (change === 'settled') market.intents[0].state = 3;
    if (change === 'expired') market.timestamp = String(BigInt(market.intents[0].deadline) + 1n);
    if (change === 'withdrawn') market.tickets[0].depositor = `0x${'0'.repeat(40)}`;
    if (change === 'redeemed') market.tickets[0].status = 1;
    market.blockNumber = '101'; control.solverBlock = 101;
    control.noMatch = true; control.holdSearch = true;
    await page.clock.fastForward(30_000);
    await expect.poll(() => !!control.pendingSearch).toBe(true);
    await expect(page.getByRole('button', { name: 'Propose and settle' })).toBeDisabled();
    await expect(page.locator('.candidate')).toHaveCount(0);
    await expect(page.getByText('Checking current intents and ticket availability...', { exact: true })).toBeVisible();
    await control.pendingSearch!.fulfill({ json: solveResult() });
    await expect(page.getByRole('heading', { name: 'Waiting for a match', exact: true }).last()).toBeVisible();
    expect(control.poolCalls).toBe(2);
  });
}

test('a lagging snapshot cannot discard a newer solver result', async ({ page }) => {
  const { market, control } = await fixture(page, { solverBlock: 102 });
  market.blockNumber = '101';
  market.intents[0].state = 2;
  await page.clock.fastForward(30_000);
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 101/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Propose and settle' })).toBeEnabled();
  expect(control.poolCalls).toBe(1);
});

test('unmatched requests keep retrying and stop repeat searches once a match appears', async ({ page }) => {
  const { control, market } = await fixture(page, { noMatch: true });
  await expect(page.locator('.matching-empty')).toBeVisible();
  control.noMatch = false; market.blockNumber = '101'; control.solverBlock = 101;
  await page.clock.fastForward(30_000);
  await expect(page.getByRole('button', { name: 'Propose and settle' })).toBeEnabled();
  expect(control.poolCalls).toBe(2);
  market.blockNumber = '102';
  await page.clock.fastForward(30_000);
  await expect(page.locator('.workspace-section').getByText(/ARC BLOCK 102/)).toBeVisible();
  expect(control.poolCalls).toBe(2);
});

test('live simulation rejection discards the candidate without submitting a transaction', async ({ page }) => {
  const { control } = await fixture(page);
  control.rejectSimulation = true; control.noMatch = true;
  await page.getByRole('button', { name: 'Propose and settle' }).click();
  await expect(page.locator('.matching-empty')).toBeVisible();
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Propose and settle' })).toBeDisabled();
  expect(control.simulations.length).toBeGreaterThan(0);
  expect(control.transactions).toHaveLength(0);
  expect(control.selectedCalls).toBe(0);
});
