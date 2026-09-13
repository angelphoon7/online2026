// All APIs and wallet requests are intercepted; these tests never send chain transactions.
import { test, expect, type Page } from '@playwright/test';
import { decodeFunctionData, erc20Abi, toFunctionSelector, type Hex } from 'viem';
import deployment from '../../deployments/public/arc-testnet.json';
import { intentRegistryAbi } from '../../lib/abi';

const owner = `0x${'1'.repeat(40)}`;
const zero = `0x${'0'.repeat(40)}`;
const txHash = `0x${'a'.repeat(64)}`;
const word = (value: bigint) => `0x${value.toString(16).padStart(64, '0')}`;
type Transaction = { to: string; data: Hex; value?: Hex };
type WalletRequest = { method: string; params?: unknown[] };

async function fixture(page: Page, options: { offeredSection?: number; allowance?: bigint; deposited?: boolean; cancelApproval?: boolean } = {}) {
  const control = { transactions: [] as Transaction[], calls: [] as string[], signed: null as { message: { maxNetPay: string; offered: string[] } } | null };
  const tickets = [1, 2].map(id => ({ tokenId: String(id), eventId: 1, sessionId: 0, sectionId: options.offeredSection ?? 0, row: 1, seat: id, status: 0,
    owner: options.deposited === false ? owner : deployment.contracts.Escrow, depositor: options.deposited === false ? zero : owner }));
  await page.exposeFunction('paymentWalletRequest', async ({ method, params = [] }: WalletRequest) => {
    control.calls.push(method);
    if (method === 'eth_accounts' || method === 'eth_requestAccounts') return [owner];
    if (method === 'eth_chainId') return '0x4cef52';
    if (method === 'eth_signTypedData_v4') {
      control.signed = JSON.parse(params[1] as string);
      return `0x${'1'.repeat(130)}`;
    }
    if (method === 'eth_sendTransaction') {
      const transaction = params[0] as Transaction;
      control.transactions.push(transaction);
      if (transaction.to.toLowerCase() === deployment.usdc.toLowerCase() && options.cancelApproval) throw Object.assign(new Error('User rejected approval'), { code: 4001 });
      return txHash;
    }
    throw new Error(`Unexpected wallet method: ${method}`);
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as { paymentWalletRequest: (request: WalletRequest) => Promise<unknown> };
    Object.defineProperty(window, 'ethereum', { value: { on() {}, removeListener() {}, request: (request: WalletRequest) => bridge.paymentWalletRequest(request) } });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/market') return json({ blockNumber: '100', timestamp: '1789232809', source: 'graph', tickets, intents: [], settlements: [], defaultHashes: [], hashMismatched: [] });
    if (path === '/api/demo/reset' || path === '/api/demo/session') return json({ enabled: false, authenticated: false });
    if (path === '/api/demo/scenarios') return json({ batch: 'fixture', snapshotBlock: '100', lagSeconds: 0, groups: [] });
    if (path === '/api/graph') return json({ data: { _meta: { block: { number: 100, timestamp: '1789232809' }, hasIndexingErrors: false } } });
    if (path === '/api/solve/pool') return json({ id: 'fixture', proposal: null, source: { kind: 'subgraph', blockNumber: '100', snapshotBlock: '100' }, candidatesFound: 0, candidatesExcluded: [], intentsConsidered: 0, chosen: null });
    if (path === '/api/rpc') {
      const body = route.request().postDataJSON();
      let result: unknown;
      if (body.method === 'eth_chainId') result = '0x4cef52';
      else if (body.method === 'eth_blockNumber') result = '0x64';
      else if (body.method === 'eth_getBalance') result = '0xde0b6b3a7640000';
      else if (body.method === 'eth_getBlockByNumber') result = { number: '0x64', timestamp: `0x${BigInt('1789232809').toString(16)}`, transactions: [] };
      else if (body.method === 'eth_call') {
        const selector = body.params[0].data.slice(0, 10);
        if (selector === toFunctionSelector('isApprovedForAll(address,address)')) result = word(1n);
        else if (selector === toFunctionSelector('usedNonce(address,uint256)')) result = word(0n);
        else if (selector === toFunctionSelector('depositor(uint256)')) result = `0x${(options.deposited === false ? zero : owner).slice(2).padStart(64, '0')}`;
        else if (selector === toFunctionSelector('allowance(address,address)')) result = word(options.allowance ?? 0n);
        else throw new Error(`Unexpected contract read: ${selector}`);
      } else if (body.method === 'eth_getTransactionReceipt') result = { transactionHash: txHash, transactionIndex: '0x0', blockHash: `0x${'b'.repeat(64)}`, blockNumber: '0x64', from: owner, to: deployment.usdc,
        cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1', contractAddress: null, logs: [], logsBloom: `0x${'0'.repeat(512)}`, status: '0x1', type: '0x2' };
      else throw new Error(`Unexpected RPC: ${body.method}`);
      return json({ jsonrpc: '2.0', id: body.id, result });
    }
    return route.fulfill({ status: 500, json: { error: `Unexpected API: ${path}` } });
  });
  await page.goto('/#workspace');
  await expect(page.locator('.step-continue')).toBeVisible();
  return control;
}

async function selectTickets(page: Page, section: number) {
  await page.locator(`[name="wanted-section"][value="${section}"]`).check();
  await page.locator('.step-continue').click();
  await page.getByRole('checkbox', { name: 'Offer ticket 1', exact: true }).check();
  await page.getByRole('checkbox', { name: 'Offer ticket 2', exact: true }).check();
}

test('fixed upgrade difference is approved and included unchanged in the committed intent', async ({ page }) => {
  const control = await fixture(page);
  await selectTickets(page, 2);
  await expect(page.locator('.quote-total')).toHaveText('Upgrade payment2 USDC');
  await expect(page.locator('.intent-flow input[type="range"]')).toHaveCount(0);
  await expect(page.locator('.suggested-limit')).toHaveCount(0);
  await expect(page.locator('.price-comparison')).toContainText('USDC is charged only when the whole swap succeeds');
  await page.getByRole('button', { name: /View signed struct/ }).click();
  const preview = JSON.parse((await page.locator('.raw-struct').textContent())!);
  await page.getByRole('button', { name: /Approve 2 USDC & create intent/ }).click();
  await expect.poll(() => control.transactions.length).toBe(2);
  const [approval, commit] = control.transactions;
  expect(approval.to.toLowerCase()).toBe(deployment.usdc.toLowerCase());
  expect(BigInt(approval.value ?? '0x0')).toBe(0n);
  const payment = decodeFunctionData({ abi: erc20Abi, data: approval.data });
  expect(payment.functionName).toBe('approve');
  expect(payment.args).toEqual([expect.stringMatching(new RegExp(`^${deployment.contracts.Settlement}$`, 'i')), 2000000n]);
  expect(control.signed?.message).toEqual(preview.message);
  expect(BigInt(control.signed!.message.maxNetPay)).toBe(2000000n);
  expect(control.calls.indexOf('eth_sendTransaction')).toBeLessThan(control.calls.indexOf('eth_signTypedData_v4'));
  expect(commit.to.toLowerCase()).toBe(deployment.contracts.IntentRegistry.toLowerCase());
  const committed = decodeFunctionData({ abi: intentRegistryAbi, data: commit.data });
  expect(committed.functionName).toBe('commit');
  if (committed.functionName === 'commit') expect(committed.args[0].maxNetPay).toBe(2000000n);
});

for (const scenario of [
  { label: 'existing allowance', offeredSection: 0, wantedSection: 2, allowance: 2000000n, amount: 2000000n },
  { label: 'even swap', offeredSection: 0, wantedSection: 0, allowance: 0n, amount: 0n },
  { label: 'downgrade credit', offeredSection: 2, wantedSection: 0, allowance: 0n, amount: -2000000n },
]) test(`${scenario.label} commits without a USDC approval`, async ({ page }) => {
  const control = await fixture(page, scenario);
  await selectTickets(page, scenario.wantedSection);
  await page.locator('.sign-intent').click();
  await expect.poll(() => control.transactions.length).toBe(1);
  expect(control.transactions[0].to.toLowerCase()).toBe(deployment.contracts.IntentRegistry.toLowerCase());
  expect(BigInt(control.signed!.message.maxNetPay)).toBe(scenario.amount);
});

test('changing selections recalculates the payment and the mobile screen has no slider', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await selectTickets(page, 2);
  await page.getByRole('checkbox', { name: 'Offer ticket 2', exact: true }).uncheck();
  await expect(page.locator('.quote-total dd')).toHaveText('3 USDC');
  await page.getByRole('button', { name: 'Change What would you like instead?', exact: true }).click();
  await page.locator('[name="wanted-section"][value="1"]').check();
  await page.getByRole('button', { name: 'Increase ticket count', exact: true }).click();
  await page.locator('.step-continue').click();
  await expect(page.locator('.quote-total dd')).toHaveText('3.5 USDC');
  await expect(page.locator('.sign-intent')).toContainText('Approve 3.5 USDC & create intent');
  await expect(page.locator('.intent-flow input[type="range"]')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.price-comparison').screenshot({ path: testInfo.outputPath('fixed-payment-mobile.png') });
});

test('unpriced tickets and tickets awaiting deposit cannot create an intent', async ({ page }) => {
  const control = await fixture(page, { offeredSection: 4 });
  await selectTickets(page, 2);
  await expect(page.locator('.price-comparison')).toContainText('A payment amount is unavailable');
  await expect(page.locator('.sign-intent')).toBeDisabled();
  expect(control.transactions).toHaveLength(0);
});

test('payment approval stays disabled until selected tickets are deposited', async ({ page }) => {
  const control = await fixture(page, { deposited: false });
  await selectTickets(page, 2);
  await expect(page.locator('.quote-total dd')).toHaveText('2 USDC');
  await expect(page.locator('.sign-intent')).toBeDisabled();
  expect(control.transactions).toHaveLength(0);
});

test('cancelled USDC approval never signs or submits the intent', async ({ page }) => {
  const control = await fixture(page, { cancelApproval: true });
  await selectTickets(page, 2);
  await page.locator('.sign-intent').click();
  await expect(page.locator('.sign-intent')).toBeEnabled();
  await expect.poll(() => control.transactions.length).toBe(1);
  expect(control.signed).toBeNull();
  expect(control.calls).not.toContain('eth_signTypedData_v4');
});
