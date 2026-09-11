import assert from 'node:assert/strict';
import { walletActionMessage } from '../lib/wallet-errors.ts';

assert.match(walletActionMessage({ code: -32002 }), /already pending/);
assert.match(walletActionMessage({ code: 'WALLET_TIMEOUT' }), /did not respond in time/);
assert.match(walletActionMessage({ code: 4001 }), /cancelled/);
assert.match(walletActionMessage({ code: 4100 }), /not authorized/);
assert.match(walletActionMessage({ code: 4900 }), /disconnected/);
assert.match(walletActionMessage(new Error('Request failed', { cause: { code: -32002 } })), /already pending/);
assert.match(walletActionMessage({ code: -32603, data: { originalError: { code: 4901 } } }), /disconnected/);
assert.equal(walletActionMessage({ code: -32603, message: 'RPC endpoint unavailable' }), 'RPC endpoint unavailable');
assert.equal(walletActionMessage(new Error('Deposit your offered ticket #1 before committing.')), 'Deposit your offered ticket #1 before committing.');
assert.equal(walletActionMessage('Wallet transport failed'), 'Wallet transport failed');
assert.doesNotMatch(walletActionMessage(undefined), /cancelled/);
const cyclic = { message: 'Provider failure' }; cyclic.cause = cyclic;
assert.equal(walletActionMessage(cyclic), 'Provider failure');
console.log('PASS wallet errors: pending, timeout, rejection, permissions, network, nested provider errors, unknown failures and cycles.');
