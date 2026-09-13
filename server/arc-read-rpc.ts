import 'server-only';
import { retryAfterSeconds } from '@/shared/retry-after';

type Read = { jsonrpc: '2.0'; id: string | number | null; method: string; params: unknown[] };
type Upstream = { status: number; headers: Headers; body: { result?: unknown; error?: { code?: number; data?: unknown } } | null };
const headers = { 'Cache-Control': 'no-store' };
const cooldowns = new Map<string, number>();
const verified = new Map<string, number>();
const pending = new Map<string, Promise<Upstream>>();

function endpoints(primary: string, chainId: number) {
  // These are providers for the same Arc Testnet, not a network/domain migration.
  // Keep custom/private endpoints exclusive. Source: https://docs.arc.io/arc/references/rpc-endpoints
  if (chainId !== 5042002 || !['https://rpc.testnet.arc.io', 'https://rpc.testnet.arc.network'].includes(primary.replace(/\/$/, ''))) return [primary];
  return [primary, 'https://rpc.drpc.testnet.arc.io', 'https://rpc.quicknode.testnet.arc.io'];
}

function request(url: string, read: Read): Promise<Upstream> {
  // Share only requests currently in flight. Never reuse an earlier state read after a write.
  const key = JSON.stringify([url, read.method, read.params]);
  const existing = pending.get(key);
  if (existing) return existing;
  const result = (async () => {
    const response = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(read),
      signal: AbortSignal.timeout(2500), cache: 'no-store',
    });
    return { status: response.status, headers: response.headers, body: await response.json().catch(() => null) };
  })().finally(() => { if (pending.get(key) === result) pending.delete(key); });
  pending.set(key, result);
  return result;
}

function throttle(url: string, response: Upstream) {
  if (response.status !== 429 && response.body?.error?.code !== -32005 && response.body?.error?.code !== 429) return false;
  const seconds = retryAfterSeconds(response.headers.get('Retry-After') ?? '1');
  if (cooldowns.size >= 16) cooldowns.delete(cooldowns.keys().next().value!);
  cooldowns.set(url, Math.max(cooldowns.get(url) ?? 0, Date.now() + seconds * 1000));
  return true;
}

function unavailable(id: Read['id'], code = -32603) {
  return Response.json({ jsonrpc: '2.0', id, error: { code, message: 'Arc RPC is temporarily unavailable. Retry shortly.' } }, { status: 502, headers });
}

export async function readArcRpc(read: Read, primary: string, chainId: number) {
  const providers = endpoints(primary, chainId);
  for (const url of providers) {
    if ((cooldowns.get(url) ?? 0) > Date.now()) continue;
    try {
      const verificationKey = `${chainId}:${url}`;
      if (url !== primary && (verified.get(verificationKey) ?? 0) <= Date.now()) {
        const probe = await request(url, { ...read, method: 'eth_chainId', params: [] });
        if (throttle(url, probe)) continue;
        if (probe.status !== 200 || probe.body?.error || typeof probe.body?.result !== 'string' || BigInt(probe.body.result) !== BigInt(chainId)) continue;
        // Cache network identity only. Balances, allowances, nonces and receipts remain fresh.
        verified.set(verificationKey, Date.now() + 60_000);
      }
      const response = await request(url, read);
      if (throttle(url, response)) continue;
      if (response.status >= 500 || response.status === 408) continue;
      if (response.status < 200 || response.status >= 300) return unavailable(read.id, -32000);
      const body = response.body;
      if (body?.error) return Response.json({ jsonrpc: '2.0', id: read.id, error: {
        code: typeof body.error.code === 'number' ? body.error.code : -32000,
        message: 'Arc rejected the read request',
        ...(typeof body.error.data === 'string' && /^0x[0-9a-f]*$/i.test(body.error.data) ? { data: body.error.data } : {}),
      } }, { headers });
      if (body && 'result' in body) return Response.json({ jsonrpc: '2.0', id: read.id, result: body.result }, { headers });
    } catch { /* A failed read can try the next provider; no wallet writes reach this path. */ }
  }
  const waits = providers.map(url => (cooldowns.get(url) ?? 0) - Date.now()).filter(wait => wait > 0);
  if (waits.length) {
    const seconds = Math.max(1, Math.ceil(Math.min(...waits) / 1000));
    return Response.json({ jsonrpc: '2.0', id: read.id, error: {
      code: -32005, message: `Arc RPC is rate-limited. Wait ${seconds} second${seconds === 1 ? '' : 's'}, then retry.`,
    } }, { status: 429, headers: { ...headers, 'Retry-After': String(seconds) } });
  }
  return unavailable(read.id);
}
