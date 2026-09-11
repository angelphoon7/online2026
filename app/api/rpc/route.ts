// Same-origin, read-only Arc transport. Wallet signing/broadcast stays in MetaMask.
import { chainConfig } from '@/server/chain';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const methods = new Set([
  'eth_chainId', 'eth_blockNumber', 'eth_call', 'eth_getBalance',
  'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBlockByNumber',
  'eth_getLogs', 'eth_getCode', 'eth_getTransactionCount',
]);
const headers = { 'Cache-Control': 'no-store' };

export async function POST(request: Request) {
  let id: string | number | null = null;
  try {
    const text = await request.text();
    if (text.length > 16384) return Response.json({ error: 'RPC request too large' }, { status: 413, headers });
    const body = JSON.parse(text);
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || !Array.isArray(body.params ?? [])) throw new Error('Invalid request');
    if (typeof body.id === 'string' || typeof body.id === 'number') id = body.id;
    if (!methods.has(body.method)) return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Only supported read methods are allowed' } }, { status: 400, headers });
    const { addresses, usdc } = chainConfig();
    const allowed = new Set([...Object.values(addresses), usdc].map(a => a.toLowerCase()));
    if (body.method === 'eth_call' || body.method === 'eth_getLogs') {
      const target = body.params?.[0];
      const address = body.method === 'eth_call' ? target?.to : target?.address;
      if (typeof address !== 'string' || !allowed.has(address.toLowerCase())) throw new Error('Unsupported contract');
      if (body.method === 'eth_call' && (body.params.length > 2 || (target.value && BigInt(target.value) !== 0n))) throw new Error('Unsupported call');
      if (body.method === 'eth_getLogs') {
        if (!/^0x[0-9a-f]+$/i.test(target.fromBlock) || !/^0x[0-9a-f]+$/i.test(target.toBlock)) throw new Error('Explicit log range required');
        const span = BigInt(target.toBlock) - BigInt(target.fromBlock);
        if (span < 0n || span >= 10000n) throw new Error('Log range exceeds 10000 blocks');
      }
    }
    const upstream = await fetch(process.env.ARC_RPC!, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method: body.method, params: body.params ?? [] }),
      signal: AbortSignal.timeout(15000), cache: 'no-store',
    });
    if (!upstream.ok) return Response.json({ jsonrpc: '2.0', id, error: { code: -32000, message: 'Arc RPC is temporarily unavailable. Retry shortly.' } }, { status: 502, headers });
    const result = await upstream.json();
    if (result.error) return Response.json({ jsonrpc: '2.0', id, error: {
      code: typeof result.error.code === 'number' ? result.error.code : -32000,
      message: 'Arc rejected the read request',
      ...(typeof result.error.data === 'string' && /^0x[0-9a-f]*$/i.test(result.error.data) ? { data: result.error.data } : {}),
    } }, { headers });
    if (!('result' in result)) throw new Error('Invalid RPC response');
    return Response.json({ jsonrpc: '2.0', id, result: result.result }, { headers });
  } catch (error) {
    const transport = error instanceof TypeError || (error instanceof Error && ['TimeoutError', 'AbortError'].includes(error.name));
    return Response.json({ jsonrpc: '2.0', id, error: { code: transport ? -32000 : -32602, message: transport ? 'Arc RPC could not be reached. Retry shortly.' : 'Invalid read request or Arc configuration' } }, { status: transport ? 502 : 400, headers });
  }
}
