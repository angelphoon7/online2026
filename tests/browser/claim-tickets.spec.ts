// All APIs and wallet requests are intercepted. No real wallet or transaction is used.
import { test, expect, type Page } from '@playwright/test';
import { toFunctionSelector } from 'viem';
import record from '../../deployments/act-one.json';
import deployment from '../../deployments/public/arc-testnet.json';
import type { ChainReceipt } from '../../lib/market-types';

const owner = record.evidence.proposal.intents[0].owner;
const outsider = '0x1111111111111111111111111111111111111111';
type WalletRequest = { method: string; params?: unknown[] | Record<string, unknown> };

async function fixture(page: Page, options: { disconnected?: boolean; outsider?: boolean; reverted?: boolean; seller?: boolean; settle?: boolean; duplicateOwner?: boolean; searchOnly?: boolean; unchanged?: boolean; paymentAmounts?: string[]; missingPaymentProof?: boolean } = {}) {
  const proposal = record.evidence.proposal;
  const receipt = {
    hash: record.proof.transactionHash, blockNumber: '101', status: options.reverted ? 'reverted' : 'success',
    proposer: outsider, independent: true, ticketTransfers: record.proof.ticketTransferCount,
    usdcTransfers: 2, netSum: '0', rejection: null,
    payments: null as ChainReceipt['payments'],
    participants: proposal.intents.map((intent, i) => ({ owner: intent.owner, offered: intent.offered,
      receives: options.seller && i === 0 ? [] : proposal.legs[i].receives, netPayment: options.paymentAmounts?.[i] ?? proposal.legs[i].netPayment })),
  };
  if (options.unchanged) receipt.participants = receipt.participants.slice(1).map(row => ({ ...row, owner: outsider, receives: row.offered }));
  if (options.duplicateOwner) receipt.participants.push({ ...receipt.participants[0], owner: owner.toUpperCase().replace('0X', '0x') });
  if (!options.missingPaymentProof && !options.reverted) {
    const net = new Map<string, bigint>();
    for (const row of receipt.participants) net.set(row.owner.toLowerCase(), (net.get(row.owner.toLowerCase()) ?? 0n) + BigInt(row.netPayment));
    const wallets = [...net].map(([owner, amount]) => ({ owner: owner as `0x${string}`, paid: String(amount > 0n ? amount : 0n), received: String(amount < 0n ? -amount : 0n) }));
    receipt.payments = { totalTransferred: String(wallets.reduce((sum, wallet) => sum + BigInt(wallet.paid), 0n)), wallets };
    receipt.usdcTransfers = wallets.filter(wallet => wallet.paid !== '0' || wallet.received !== '0').length;
  }
  const market = {
    source: 'rpc', blockNumber: '101', timestamp: '1789160000',
    tickets: record.proof.tickets.map(ticket => ({ ...ticket.meta, tokenId: ticket.tokenId,
      owner: record.proof.escrow, depositor: ticket.previousParticipant })),
    intents: proposal.intents.map((intent, i) => ({ ...intent, hash: proposal.legs[i].intentHash,
      commitTx: receipt.hash, state: 1, expired: false })),
    settlements: [{ hash: receipt.hash, block: '101', participants: '3' }], defaultHashes: [], hashMismatched: [],
  };
  const control = {
    connected: !options.disconnected, account: options.outsider ? outsider : owner, chain: '0x1',
    calls: [] as WalletRequest[], imports: [] as Record<string, unknown>[],
    mode: 'accept' as 'accept' | 'decline' | 'unsupported' | 'cancel' | 'hold', releaseImport: null as (() => void) | null,
    noLongerOwner: false, holdOwner: false, releaseOwner: null as (() => void) | null,
    unrelated: false, noMatch: false, unchangedMatch: false, holdSearch: false, releaseSearch: null as (() => void) | null,
    searches: [] as { mustInclude?: string; minBlock?: string }[],
  };
  await page.exposeFunction('claimWalletRequest', async (request: WalletRequest) => {
    control.calls.push(request);
    if (request.method === 'eth_accounts') return control.connected ? [control.account] : [];
    if (request.method === 'eth_requestAccounts') { control.connected = true; return [control.account]; }
    if (request.method === 'eth_chainId') return control.chain;
    if (request.method === 'wallet_switchEthereumChain') { control.chain = '0x4cef52'; return null; }
    if (request.method === 'eth_sendTransaction' && options.settle) return receipt.hash;
    if (request.method === 'wallet_watchAsset') {
      control.imports.push(request.params as Record<string, unknown>);
      if (control.mode === 'hold') await new Promise<void>(resolve => { control.releaseImport = resolve; });
      if (control.mode === 'unsupported') throw Object.assign(new Error('NFT import unavailable'), { code: -32601 });
      if (control.mode === 'cancel') throw Object.assign(new Error('User rejected import'), { code: 4001 });
      return control.mode !== 'decline';
    }
    throw new Error(`Unexpected wallet method: ${request.method}`);
  });
  await page.addInitScript(() => {
    const bridge = window as unknown as { claimWalletRequest: (request: WalletRequest) => Promise<unknown>; changeTicketAccount: (address: string) => void };
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();
    bridge.changeTicketAccount = address => listeners.get('accountsChanged')?.forEach(handler => handler([address]));
    Object.defineProperty(window, 'ethereum', { value: {
      on(event: string, handler: (...args: unknown[]) => void) { listeners.set(event, [...(listeners.get(event) ?? []), handler]); },
      removeListener(event: string, handler: (...args: unknown[]) => void) { listeners.set(event, (listeners.get(event) ?? []).filter(item => item !== handler)); },
      request: (request: WalletRequest) => bridge.claimWalletRequest(request),
    } });
  });
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown) => route.fulfill({ json: body });
    if (path === '/api/market') return json(market);
    if (path === '/api/market/receipt') return json(receipt);
    if (path === '/api/demo/reset' || path === '/api/demo/session') return json({ enabled: false, authenticated: false });
    if (path === '/api/solve/pool') {
      control.searches.push(route.request().postDataJSON());
      if (control.holdSearch) await new Promise<void>(resolve => { control.releaseSearch = resolve; });
      const resultProposal = control.noMatch ? null : control.unrelated
        ? { intents: proposal.intents.slice(1), legs: proposal.legs.slice(1) }
        : control.unchangedMatch ? { intents: proposal.intents, legs: proposal.legs.map((leg, i) => ({ ...leg, receives: proposal.intents[i].offered })) } : proposal;
      return json({ ...record.evidence, transactionHash: undefined, receipt: undefined, proposal: resultProposal,
        source: { kind: 'rpc', blockNumber: '101', subgraphEndpoint: null }, simulationResult: { success: true } });
    }
    if (path === '/api/rpc') {
      const body = route.request().postDataJSON();
      const rpc = (result: unknown) => json({ jsonrpc: '2.0', id: body.id, result });
      if (body.method === 'eth_chainId') return rpc('0x4cef52');
      if (body.method === 'eth_getBalance') return rpc('0xde0b6b3a7640000');
      if (body.method === 'eth_getTransactionReceipt') return rpc({ transactionHash: receipt.hash, transactionIndex: '0x0',
        blockHash: `0x${'ab'.repeat(32)}`, blockNumber: '0x65', from: owner, to: deployment.contracts.Settlement,
        cumulativeGasUsed: '0x10000', gasUsed: '0x10000', effectiveGasPrice: '0x1', contractAddress: null,
        logs: [], logsBloom: `0x${'00'.repeat(256)}`, status: '0x1', type: '0x2' });
      if (body.method === 'eth_call') {
        const data = body.params[0].data as string;
        if (data.startsWith(toFunctionSelector('ownerOf(uint256)'))) {
          if (control.holdOwner) await new Promise<void>(resolve => { control.releaseOwner = resolve; });
          return rpc(`0x${(control.noLongerOwner ? outsider : owner).slice(2).padStart(64, '0')}`);
        }
        if (data.startsWith(toFunctionSelector('isApprovedForAll(address,address)'))) return rpc(`0x${'0'.repeat(63)}1`);
        if (options.settle) return rpc('0x');
      }
    }
    throw new Error(`Unexpected API request: ${path}`);
  });
  await page.goto('/#workspace');
  await expect(page.locator('#workspace')).toBeVisible();
  if (options.searchOnly) {
    // The test controls when the matching request begins.
  } else if (options.settle) {
    await page.getByRole('button', { name: 'Intent Pool', exact: false }).click();
    await page.getByRole('button', { name: /Check all intents/ }).click();
    await page.getByRole('button', { name: 'Propose and settle', exact: false }).click();
  } else {
    await page.getByRole('button', { name: 'Past Settlements', exact: false }).click();
    await page.getByRole('button', { name: 'Open receipt', exact: false }).click();
  }
  if (!options.reverted && !options.searchOnly) await expect(page.locator('.receipt-section')).toBeVisible();
  const search = async () => {
    await page.getByRole('button', { name: 'Intent Pool', exact: false }).click();
    await page.getByRole('button', { name: /Check all intents/ }).click();
  };
  return { control, receipt, market, search, claim: page.getByRole('region', { name: 'Claim your tickets', exact: true }) };
}

test('confirmed swap waits for Claim, imports only received NFTs, and sends no second transaction', async ({ page }) => {
  const { control, receipt, claim } = await fixture(page, { settle: true, duplicateOwner: true });
  await expect(page.getByRole('heading', { name: 'Your swap confirmed.', exact: true })).toBeVisible();
  expect(control.searches[0]).toMatchObject({ mustInclude: record.evidence.proposal.legs[0].intentHash, minBlock: '101' });
  expect(control.imports).toHaveLength(0);
  await expect(claim.getByRole('button', { name: 'Claim my tickets' })).toBeEnabled();
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  const ids = receipt.participants[0].receives;
  await expect(claim.getByRole('status')).toContainText(`accepted ${ids.length} NFT import`);
  expect(control.imports).toEqual(ids.map(tokenId => ({ type: 'ERC721', options: { address: deployment.contracts.TicketNFT, tokenId } })));
  expect(control.calls.filter(call => call.method === 'eth_sendTransaction')).toHaveLength(1);
  expect(control.calls.some(call => /sign/i.test(call.method))).toBe(false);
  await page.locator('.receipt-section').screenshot({ path: '.data/browser-tests/claim-tickets-desktop.png' });
});

test('claim connects a disconnected recipient and switches to Arc Testnet on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { control, claim } = await fixture(page, { disconnected: true });
  await expect(claim).toContainText('Connect the wallet that received tickets');
  expect(control.calls.some(call => call.method === 'eth_requestAccounts')).toBe(false);
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  await expect(claim.getByRole('status')).toContainText('accepted 2 NFT import requests');
  expect(control.calls.some(call => call.method === 'eth_requestAccounts')).toBe(true);
  expect(control.calls.some(call => call.method === 'wallet_switchEthereumChain')).toBe(true);
  expect(control.calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  await claim.getByText('Tickets not showing?', { exact: true }).click();
  await expect(claim).toContainText(deployment.contracts.TicketNFT);
  await expect(claim).toContainText('Token IDs:');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.locator('.receipt-section').screenshot({ path: '.data/browser-tests/claim-tickets-mobile.png' });
});

for (const mode of ['decline', 'unsupported', 'cancel'] as const) {
  test(`${mode} leaves the swap confirmed and lets the recipient retry claiming`, async ({ page }) => {
    const { control, claim } = await fixture(page);
    control.mode = mode;
    await claim.getByRole('button', { name: 'Claim my tickets' }).click();
    await expect(claim.getByRole('status')).toContainText('retry Claim my tickets');
    await expect(page.getByRole('heading', { name: 'Your swap confirmed.', exact: true })).toBeVisible();
    control.mode = 'accept';
    await claim.getByRole('button', { name: 'Claim my tickets' }).click();
    await expect(claim.getByRole('status')).toContainText('accepted 2 NFT import requests');
    expect(control.calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  });
}

test('pending wallet confirmation disables duplicate claims', async ({ page }) => {
  const { control, claim } = await fixture(page);
  control.mode = 'hold';
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  await expect.poll(() => !!control.releaseImport).toBe(true);
  await expect(claim.getByRole('button', { name: 'Open your wallet' })).toBeDisabled();
  expect(control.imports).toHaveLength(1);
  control.mode = 'accept'; control.releaseImport!();
  await expect(claim.getByRole('status')).toContainText('accepted 2 NFT import requests');
});

test('an independent proposer sees no personal claim for another wallet receipt', async ({ page }) => {
  const { control, claim } = await fixture(page, { outsider: true });
  await expect(claim).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Settlement confirmed.', exact: true })).toBeVisible();
  await expect(page.locator('.receipt-section')).toContainText('This settlement did not include your wallet or settle your request.');
  expect(control.imports).toHaveLength(0);
  control.account = owner;
  await page.evaluate(address => (window as unknown as { changeTicketAccount: (address: string) => void }).changeTicketAccount(address), owner);
  await expect(claim.getByRole('status')).toHaveCount(0);
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  await expect(claim.getByRole('status')).toContainText('accepted 2 NFT import requests');
});

test('transferred or redeposited tickets are not imported from an old receipt', async ({ page }) => {
  const { control, claim } = await fixture(page);
  control.noLongerOwner = true;
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  await expect(claim.getByRole('status')).toContainText('no longer held directly');
  expect(control.imports).toHaveLength(0);
});

test('switching accounts during the ownership read cannot import into the new account', async ({ page }) => {
  const { control, claim } = await fixture(page);
  control.holdOwner = true;
  await claim.getByRole('button', { name: 'Claim my tickets' }).click();
  await expect.poll(() => !!control.releaseOwner).toBe(true);
  control.account = outsider;
  await page.evaluate(address => (window as unknown as { changeTicketAccount: (address: string) => void }).changeTicketAccount(address), outsider);
  control.holdOwner = false; control.releaseOwner!();
  await expect(claim).toHaveCount(0);
  await expect.poll(() => control.calls.filter(call => call.method === 'eth_chainId').length).toBeGreaterThan(2);
  expect(control.imports).toHaveLength(0);
});

test('a pure seller is not offered a ticket claim', async ({ page }) => {
  const { claim, control } = await fixture(page, { seller: true });
  await expect(claim).toContainText('Your sale is complete');
  await expect(claim.getByRole('button')).toHaveCount(0);
  expect(control.imports).toHaveLength(0);
});

test('a reverted receipt never offers a claim or shows a successful swap', async ({ page }) => {
  const { control } = await fixture(page, { reverted: true });
  await expect(page.locator('.receipt-section')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Claim my tickets' })).toHaveCount(0);
  expect(control.imports).toHaveLength(0);
});

test('same-owner returns have one wallet row and are never called a personal swap', async ({ page }) => {
  const { control, claim } = await fixture(page, { unchanged: true });
  await expect(page.getByRole('heading', { name: 'Tickets returned.', exact: true })).toBeVisible();
  await expect(page.locator('.receipt-table tbody tr')).toHaveCount(1);
  await expect(page.locator('.receipt-section')).toContainText('Ticket ownership did not change.');
  await expect(claim).toHaveCount(0);
  expect(control.imports).toHaveLength(0);
});

for (const returned of ['unrelated', 'unchangedMatch'] as const) {
  test(`a ${returned} solver response cannot enable Propose and settle`, async ({ page }) => {
    const { control, search } = await fixture(page, { searchOnly: true });
    control[returned] = true;
    await search();
    await expect(page.locator('.matching-panel').getByRole('alert')).toContainText('does not swap your requested tickets');
    await expect(page.getByRole('button', { name: 'Propose and settle', exact: false })).toBeDisabled();
    await expect(page.locator('.candidate')).toHaveCount(0);
    expect(control.searches[0].mustInclude).toBe(record.evidence.proposal.legs[0].intentHash);
    expect(control.calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
  });
}

test('no personal match shows waiting without substituting another pool result', async ({ page }) => {
  const { control, search } = await fixture(page, { searchOnly: true });
  control.noMatch = true;
  await search();
  await expect(page.locator('.matching-panel')).toContainText('Waiting for a match');
  await expect(page.getByRole('button', { name: 'Propose and settle', exact: false })).toBeDisabled();
  await expect(page.locator('.candidate')).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Your swap request' })).toContainText('Your offered tickets: #12, #13');
});

test('the highest nonce request is required and an older candidate is rejected', async ({ page }) => {
  const { control, market, search } = await fixture(page, { searchOnly: true });
  const newer = { ...market.intents[0], hash: `0x${'b'.repeat(64)}`, nonce: '99' };
  market.intents.push(newer);
  await page.reload();
  await search();
  await expect(page.locator('.matching-panel').getByRole('alert')).toContainText('does not swap your requested tickets');
  expect(control.searches[0].mustInclude).toBe(newer.hash);
  await expect(page.getByRole('button', { name: 'Propose and settle', exact: false })).toBeDisabled();
});

test('a search completed after an account switch cannot restore the old account candidate', async ({ page }) => {
  const { control, search } = await fixture(page, { searchOnly: true });
  control.holdSearch = true;
  await search();
  await expect.poll(() => !!control.releaseSearch).toBe(true);
  control.account = outsider;
  await page.evaluate(address => (window as unknown as { changeTicketAccount: (address: string) => void }).changeTicketAccount(address), outsider);
  control.holdSearch = false; control.releaseSearch!();
  await expect(page.getByRole('button', { name: 'Propose and settle', exact: false })).toBeDisabled();
  await expect(page.locator('.candidate')).toHaveCount(0);
  expect(control.calls.some(call => call.method === 'eth_sendTransaction')).toBe(false);
});

test('the receipt shows USDC amount transferred and each payer and recipient, not event count or net sum', async ({ page }) => {
  const { claim } = await fixture(page, { paymentAmounts: ['60000', '-60000', '0'] });
  await expect(claim).not.toContainText('Your tickets were delivered');
  await expect(page.locator('.receipt-count')).toContainText('0.06 USDC transferred');
  await expect(page.locator('.receipt-count')).not.toContainText('2 USDC');
  const rows = page.locator('.receipt-table tbody tr');
  await expect(rows.nth(0)).toContainText('Paid 0.06 USDC');
  await expect(rows.nth(1)).toContainText('Received 0.06 USDC');
  await expect(page.locator('.receipt-table tfoot')).toHaveText('Total transferred0.06 USDC');
  await page.locator('.receipt-section').screenshot({ path: '.data/browser-tests/receipt-usdc-amount.png' });
});

test('a zero-payment receipt never substitutes an approved upgrade limit for an actual payment', async ({ page }) => {
  await fixture(page, { paymentAmounts: ['0', '0', '0'] });
  await expect(page.locator('.receipt-count')).toContainText('0 USDC transferred');
  await expect(page.locator('.receipt-table tfoot')).toHaveText('Total transferred0 USDC');
  await expect(page.locator('.receipt-table')).not.toContainText('Paid');
});

test('a receipt without payment proof shows unavailable instead of inventing a zero amount', async ({ page }) => {
  await fixture(page, { missingPaymentProof: true });
  await expect(page.locator('.receipt-count')).toContainText('USDC amount unavailable');
  await expect(page.locator('.receipt-table tfoot')).toHaveText('Total transferredUnavailable');
});
