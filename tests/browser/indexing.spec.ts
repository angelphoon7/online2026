// Browser regression fixtures only: every API request is intercepted. No chain writes,
// wallet connection or model calls. Real-chain timing is recorded separately in docs/checks.
import { test, expect, type Page, type Route } from '@playwright/test';

const hash = (digit: string) => `0x${digit.repeat(64)}`;
const A = hash('1'), B = hash('2'), NEW = hash('3'), REVOKE = hash('a'), COMMIT = hash('b');
const owner = (digit: string) => `0x${digit.repeat(40)}`;
const intent = (id: string, who: string, state = 1) => ({ hash: id, owner: who, offered: [], eventId: 1, sessionMask: '1', sectionMask: '1', exactCount: 2, mustShareSession: true, mustShareSection: true, mustBeAdjacent: true, maxNetPay: '1000000', deadline: '2000000000', nonce: '1', commitTx: hash('c'), state, expired: false });
const diagnosis = (id: string, block: number) => ({ block: String(block), intent: id, status: 'SETTLEABLE', relaxations: [], bounds: { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000, budgetCapUsdc: 40 }, counterpartyIntents: [], runtimeMs: 1 });
const hypothetical = (over = {}) => ({ block: '100', intent: A, submittable: false, found: true,
  changes: { maxNetPayUsdc: -0.000001, mustBeAdjacent: false, addSections: [0, 3] },
  bounds: { maxParticipants: 4, maxCandidates: 100, timeoutMs: 2000 }, participantCount: 2, targetNetPay: '-1',
  counterparties: [owner('2')], receives: ['41', '42'],
  counterpartyIntents: [{ intentHash: hash('6'), owner: owner('2'), committedTx: hash('d') }], ...over });
const overview = (over = {}) => ({ block: '100', liveIntents: 3, escrowedTickets: 6, pureBuyers: 0, pureSellers: 1,
  bySession: [{ sessionId: 0, tickets: 4 }, { sessionId: 1, tickets: 2 }],
  bySection: [{ sectionId: 2, tickets: 6 }], excludedByReason: { EXPIRED: 2 }, ...over });
const toolAnswer = (evidence: unknown[]) => ({ block: '100', model: 'fixture', guardFallback: false,
  answer: 'At Arc Testnet block #100: tool evidence for this question.', evidence });

async function fixture(page: Page, partial = false) {
  const control = { block: 100, graphBlock: 100, graphError: false, changed: false, staleMarket: false, holdMarket: false, holdAsk: false, extraIntents: [] as ReturnType<typeof intent>[], oldMarket: null as Route | null, oldAsk: null as Route | null, reads: [] as string[] };
  const market = (block = control.block) => ({ blockNumber: String(block), timestamp: '1789232809', source: 'graph', tickets: [], intents: [intent(A, owner('1'), control.changed ? 2 : 1), intent(B, owner('2')), ...(control.changed && !partial ? [intent(NEW, owner('1'))] : []), ...control.extraIntents], settlements: [], defaultHashes: [], hashMismatched: [] });
  await page.route('**/api/**', async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    control.reads.push(`${request.method()} ${path}${url.search}`);
    const json = (body: unknown, status = 200) => route.fulfill({ status, json: body });
    if (path === '/api/market') {
      if (control.holdMarket) { control.holdMarket = false; control.oldMarket = route; return; }
      return json(market(control.staleMarket ? 199 : control.block));
    }
    if (path === '/api/demo/reset') return json({ enabled: false, state: 'idle' });
    // Judge controls now read access before listing intents; this suite mocks an existing
    // authorized fixture session and never signs in to the actual server.
    if (path === '/api/demo/session') return json({ enabled: true, configured: true, authenticated: true });
    if (path === '/api/demo/scenarios') return json({ batch: 'fixture', snapshotBlock: String(control.block), lagSeconds: 0, groups: [] });
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
  await page.getByRole('button', { name: 'Transaction confirmed. View activity details', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Activity details' });
  await expect(activity.locator(`a[href$="${REVOKE}"]`)).toBeVisible();
  await expect(activity.locator(`a[href$="${COMMIT}"]`)).toBeVisible();
  await activity.getByRole('button', { name: 'Close activity details' }).click();
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
  await page.getByRole('button', { name: 'Transaction confirmed. View activity details', exact: true }).click();
  const activity = page.getByRole('dialog', { name: 'Activity details' });
  await expect(activity.locator(`a[href$="${REVOKE}"]`)).toBeVisible();
  await activity.getByRole('button', { name: 'Close activity details' }).click();
  control.graphError = false; control.graphBlock = 200; control.block = 200;
  await page.getByRole('button', { name: 'Retry indexing' }).first().click();
  await expect(page.locator('.workspace-stack')).toBeVisible();
  await page.getByRole('button', { name: /Intent pool \(/ }).click();
  await expect(page.locator(`.pool-list a[href$="${intent(A, owner('1')).commitTx}"]`)).toHaveCount(1); // only B remains live
});

test('drawer shows the selected intent, bounded grouping and separate commitments for one wallet', async ({ page }) => {
  await fixture(page);
  const refs = [
    { intentHash: hash('4'), owner: owner('2'), committedTx: hash('e') },
    { intentHash: hash('5'), owner: owner('2'), committedTx: hash('f') },
  ];
  await page.route('**/api/agent/ask', async route => route.fulfill({ json: {
    block: '100', model: 'fixture', guardFallback: false, answer: 'At Arc Testnet block #100, grouping searched a subset.',
    evidence: [
      { tool: 'diagnose_intent', output: { ...diagnosis(B, 100), status: 'EXCLUDED', exclusion: { reason: 'EXPIRED', detail: 'Another intent expired' } } },
      { tool: 'diagnose_intent', output: {
        ...diagnosis(A, 100), status: 'NOT_FOUND_WITHIN_BOUND', counterpartyIntents: refs,
        supply: { stages: [{ stage: 'cohesiveGroup', remaining: 1 }], firstZero: null, blockedAt: null, largestGroup: 1, need: 2, truncated: true, groupSearched: 40, groupCandidates: 42 },
        relaxations: [{ change: 'maxNetPay->cap', found: true, counterparties: refs.map(r => r.owner), counterpartyIntents: refs, participantCount: 3, targetNetPay: '2000000' }],
      } },
      { tool: 'what_if', output: hypothetical({ targetNetPay: '1000000' }) },
    ],
  } }));
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  await drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true }).click();
  await expect(drawer.getByText('At Arc Testnet block #100, grouping searched a subset.')).toBeVisible();
  await drawer.getByText('Evidence', { exact: true }).click();
  await expect(drawer.getByText('Largest group found in searched subset')).toBeVisible();
  await expect(drawer.getByText(/Grouping checked 40 of 42/)).toBeVisible();
  await expect(drawer.getByText('Another intent expired')).toHaveCount(0);
  for (const ref of refs) {
    const link = drawer.locator(`a[href$="${ref.committedTx}"]`);
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute('title', `Intent ${ref.intentHash} · owner ${ref.owner} · commit ${ref.committedTx}`);
  }
  await expect(drawer.getByRole('heading', { name: 'What-if result · call 3' })).toBeVisible();
  await expect(drawer.locator(`a[href$="${hash('d')}"]`)).toBeVisible();
  await expect(drawer.locator('.agent-parties a')).toHaveCount(3);
});

test('what-if-only answer displays every change, candidate and unsuccessful call without an old diagnosis', async ({ page }) => {
  await fixture(page);
  const miss = hypothetical({ changes: { mustShareSession: false }, found: false, participantCount: null, targetNetPay: null, counterparties: [], counterpartyIntents: [], receives: [] });
  await page.route('**/api/agent/ask', route => route.fulfill({ json: toolAnswer([
    { tool: 'what_if', input: { intentHash: A, changes: { mustBeAdjacent: false } }, output: hypothetical(), source: 'model' },
    { tool: 'what_if', output: miss },
    { tool: 'what_if', output: { ...miss, unavailable: 'NOT_LIVE_AT_THIS_BLOCK' } },
    { tool: 'what_if', input: { intentHash: A, changes: { owner: owner('3') } }, output: { code: 'WhatIfError', error: 'Unsupported change field: owner.', submittable: false } },
    { tool: 'what_if', output: hypothetical({ intent: B, receives: ['999'] }) },
  ]) }));
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  await drawer.getByText('Evidence', { exact: true }).click();
  await expect(drawer.getByRole('heading', { name: 'Diagnosis · Arc Testnet block #100' })).toBeVisible();
  await drawer.getByRole('button', { name: 'What if I drop the adjacency requirement?', exact: true }).click();
  await expect(drawer.locator('.agent-answer')).toBeVisible();
  const candidate = drawer.getByRole('region', { name: 'What-if tool result 1', exact: true });
  await expect(candidate).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /Diagnosis/ })).toHaveCount(0);
  await expect(candidate.getByRole('row', { name: 'Adjacent seats required No', exact: true })).toBeVisible();
  await expect(candidate.getByRole('row', { name: 'Additional accepted sections 0, 3', exact: true })).toBeVisible();
  await expect(candidate.getByText('Receive at least 0.000001 USDC', { exact: true })).toBeVisible();
  await expect(candidate.getByText('receives 0.000001 USDC', { exact: true })).toBeVisible();
  await expect(candidate.getByText('Ticket #41, Ticket #42', { exact: true })).toBeVisible();
  await expect(candidate.locator(`a[href$="${hash('d')}"]`)).toBeVisible();
  await expect(candidate.getByText('Search bound: 4 participants, 100 candidates, 2000ms.')).toBeVisible();
  await expect(drawer.getByRole('region', { name: 'What-if tool result 2', exact: true }).getByText(/^No candidate found within/)).toBeVisible();
  const skipped = drawer.getByRole('region', { name: 'What-if tool result 3', exact: true });
  await expect(skipped.getByText('Not evaluated: this intent is not live at this block.')).toBeVisible();
  await expect(skipped.getByText(/^Configured search bound \(search not run\)/)).toBeVisible();
  await expect(drawer.getByText('WhatIfError: Unsupported change field: owner.')).toBeVisible();
  await expect(drawer.getByText(/1 unrelated or unsupported tool result/)).toBeVisible();
  await expect(drawer.getByText('Ticket #999')).toHaveCount(0);
  await drawer.getByText('Tool inputs and outputs (JSON)', { exact: true }).click();
  const raw = drawer.locator('.agent-raw pre');
  await expect(raw).toBeVisible();
  await expect(raw).toContainText('"submittable": false');
  await expect(raw).toContainText('"source": "model"');
  await expect(raw).not.toContainText('999');
});

test('pool-only answers show totals, distributions and exclusions including empty pool results', async ({ page }) => {
  await fixture(page);
  let result = overview();
  await page.route('**/api/agent/ask', route => route.fulfill({ json: toolAnswer([{ tool: 'pool_overview', input: {}, output: result }]) }));
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  await drawer.getByLabel('Ask about this intent').fill('What is in the pool?');
  await drawer.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(drawer.locator('.agent-answer')).toBeVisible();
  await drawer.getByText('Evidence', { exact: true }).click();
  const pool = drawer.getByRole('region', { name: 'Pool overview tool result 1', exact: true });
  await expect(pool.getByRole('row', { name: 'Searchable live intents 3', exact: true })).toBeVisible();
  await expect(pool.getByRole('row', { name: 'Escrowed, unredeemed tickets 6', exact: true })).toBeVisible();
  await expect(pool.getByRole('row', { name: 'Pure buyers 0', exact: true })).toBeVisible();
  await expect(pool.getByRole('row', { name: 'Pure sellers 1', exact: true })).toBeVisible();
  await expect(pool.getByRole('table', { name: 'Tickets by session' }).getByRole('row', { name: 'Session 0 4' })).toBeVisible();
  await expect(pool.getByRole('table', { name: 'Tickets by session' }).getByRole('row', { name: 'Session 1 2' })).toBeVisible();
  await expect(pool.getByRole('table', { name: 'Tickets by section' }).getByRole('row', { name: 'Section 2 6' })).toBeVisible();
  await expect(pool.getByRole('table', { name: 'Exclusion reasons' }).getByRole('row', { name: 'EXPIRED 2' })).toBeVisible();
  await expect(drawer.getByRole('heading', { name: /Diagnosis/ })).toHaveCount(0);
  result = overview({ liveIntents: 0, escrowedTickets: 0, pureSellers: 0, bySession: [], bySection: [], excludedByReason: {} });
  await drawer.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(pool.getByRole('row', { name: 'Searchable live intents 0', exact: true })).toBeVisible();
  await expect(pool.getByText('No escrowed tickets by session at this block.')).toBeVisible();
  await expect(pool.getByText('No escrowed tickets by section at this block.')).toBeVisible();
  await expect(pool.getByText('No excluded intents at this block.')).toBeVisible();
  await expect(pool.getByRole('row', { name: 'EXPIRED 2' })).toHaveCount(0);
});

for (const [tool, output] of [
  ['diagnose_intent', diagnosis(A, 99)], ['what_if', hypothetical({ block: '99' })], ['pool_overview', overview({ block: '101' })],
] as const) test(`drawer rejects ${tool} evidence at another block and clears the earlier answer`, async ({ page }) => {
  await fixture(page);
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  await drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true }).click();
  await expect(drawer.locator('.agent-answer')).toBeVisible();
  await page.route('**/api/agent/ask', route => route.fulfill({ json: toolAnswer([
    { tool: 'diagnose_intent', output: diagnosis(A, 100) }, { tool, output },
  ]) }));
  await drawer.getByRole('button', { name: "Why can't this intent settle?", exact: true }).click();
  await expect(drawer.getByRole('alert')).toHaveText('The evidence does not match the selected intent and answer block. Retry the question.');
  await expect(drawer.locator('.agent-answer')).toHaveCount(0);
  await expect(drawer.locator('.agent-evidence')).toHaveCount(0);
});

test('judge sign-in unlocks controls and signing out hides editable intents', async ({ page }) => {
  await fixture(page);
  let authenticated = false;
  await page.route('**/api/demo/session', async route => {
    if (route.request().method() === 'POST') {
      if (route.request().postDataJSON().code !== 'fixture-code') return route.fulfill({ status: 401, json: { error: 'Incorrect judge access code.' } });
      authenticated = true;
    }
    if (route.request().method() === 'DELETE') authenticated = false;
    return route.fulfill({ json: { enabled: true, configured: true, authenticated } });
  });
  await page.reload();
  await page.getByText('Judge controls / access', { exact: true }).click();
  await page.getByLabel('Judge access code', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: 'Unlock judge controls' }).click();
  await expect(page.getByText('Incorrect judge access code.')).toBeVisible();
  await expect(page.getByLabel('Participant intent', { exact: true })).toHaveCount(0);
  await page.getByLabel('Judge access code', { exact: true }).fill('fixture-code');
  await page.getByRole('button', { name: 'Unlock judge controls' }).click();
  await expect(page.getByLabel('Participant intent', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Lock judge controls', exact: true }).click();
  await expect(page.getByLabel('Judge access code', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Participant intent', { exact: true })).toHaveCount(0);
});

test('judging guide sends the exact selected pair or triple and disables unavailable groups', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/demo/scenarios*', route => route.fulfill({ json: { batch: 'fixture', snapshotBlock: '100', lagSeconds: 0, groups: [
    { name: 'single-date', hashes: [A, B, NEW], available: true, issues: [], counts: [1, 1, 1], expiresAt: '2000000000' },
    { name: 'expired-group', hashes: [A, B, NEW], available: false, issues: [{ reason: 'EXPIRED' }], counts: [3, 3, 3], expiresAt: null },
  ] } }));
  await page.reload();
  await page.getByText('Start here / judge the live demo', { exact: true }).click();
  const guide = page.locator('.judging-guide'), group = guide.locator('.judge-result').filter({ hasText: 'single date' });
  await expect(guide.getByRole('link', { name: 'Circle faucet' })).toHaveAttribute('href', 'https://faucet.circle.com/');
  for (const [name, hashes] of [['Check A + B', [A, B]], ['Check A + C', [A, NEW]], ['Check B + C', [B, NEW]], ['Check A + B + C', [A, B, NEW]]] as const) {
    const received = page.waitForRequest(r => new URL(r.url()).pathname === '/api/solve');
    await group.getByRole('button', { name, exact: true }).click();
    expect((await received).postDataJSON().intentHashes).toEqual(hashes);
  }
  await expect(guide.locator('.judge-result').filter({ hasText: 'expired group' }).getByRole('button', { name: 'Check A + B + C', exact: true })).toBeDisabled();
});

test('direct diagnosis for another intent shows an error and no evidence', async ({ page }) => {
  await fixture(page);
  await page.route('**/api/agent/diagnose/**', route => route.fulfill({ json: { ...diagnosis(B, 100), status: 'EXCLUDED', exclusion: { reason: 'EXPIRED' } } }));
  await page.getByRole('button', { name: 'Ask the agent', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByRole('alert')).toHaveText('The evidence does not match the selected intent and answer block. Retry the question.');
  await expect(drawer.locator('.agent-evidence')).toHaveCount(0);
  await expect(drawer.getByText(/expired/i)).toHaveCount(0);
});

test('a market above 1000 intents exposes its final request and opens that exact diagnosis', async ({ page }) => {
  const { control } = await fixture(page);
  control.extraIntents = Array.from({ length: 1001 }, (_, n) => intent(`0x${(n + 1).toString(16).padStart(64, '0')}`, owner('3')));
  const last = control.extraIntents.at(-1)!;
  await page.getByRole('button', { name: /Refresh public state/ }).click();
  const openPool = page.getByRole('button', { name: 'Intent pool (1003)', exact: true });
  await expect(openPool).toBeVisible();
  await openPool.click();
  await expect(page.locator('.pool-list .pool-row')).toHaveCount(1003);
  const row = page.locator('.pool-list .pool-row').last();
  await expect(row.getByText('/ Request 1003', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: 'Why no match?', exact: true }).click();
  const drawer = page.getByRole('dialog', { name: 'Settlement agent' });
  await expect(drawer.getByText(/BLOCK #100/)).toBeVisible();
  await expect.poll(() => control.reads.some(call => call.includes(`/diagnose/${last.hash}?minBlock=`))).toBe(true);
  await drawer.getByText('Evidence', { exact: true }).click();
  await expect(drawer.getByText(`Intent ${last.hash} · settleable`, { exact: true })).toBeVisible();
});
