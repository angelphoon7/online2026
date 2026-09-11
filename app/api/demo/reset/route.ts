import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { verifyMessage, type Hex, type Address } from 'viem';
import deployment from '@/deployments/arc-testnet.json';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const challenges = new Map<string, number>();
let state: 'idle' | 'running' | 'complete' | 'failed' = 'idle';
function local(request: Request) {
  const url = new URL(request.url);
  return process.env.NODE_ENV === 'development' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
}
export async function GET(request: Request) {
  if (!local(request)) return Response.json({ enabled: false, state: 'idle' });
  for (const [message, expiry] of challenges) if (expiry < Date.now()) challenges.delete(message);
  if (challenges.size > 20) challenges.clear();
  const message = `RESHUFFLE: prepare the Arc Testnet demo using the local operator script. This can spend test USDC and revoke/recommit demo intents.\nSettlement: ${deployment.contracts.Settlement}\nChallenge: ${randomUUID()}`;
  challenges.set(message, Date.now() + 120000);
  return Response.json({ enabled: true, state, operator: deployment.deployer, message }, { headers: { 'Cache-Control': 'no-store' } });
}
export async function POST(request: Request) {
  if (!local(request) || request.headers.get('origin') !== new URL(request.url).origin) return Response.json({ error: 'Reset is available only from the local development app.' }, { status: 403 });
  if (state === 'running') return Response.json({ error: 'Reset already running' }, { status: 409 });
  try {
    const text = await request.text();
    if (text.length > 2048) throw new Error();
    const { message, signature } = JSON.parse(text);
    const expiry = challenges.get(message);
    challenges.delete(message);
    if (!expiry || expiry < Date.now() || !await verifyMessage({ address: deployment.deployer as Address, message, signature: signature as Hex })) throw new Error();
    state = 'running';
    // No caller-controlled command/arguments, no private keys or script logs in responses.
    const child = spawn(process.execPath, ['scripts/prepare-demo.mjs'], { cwd: process.cwd(), shell: false, windowsHide: true, stdio: 'ignore' });
    child.on('error', () => { state = 'failed'; });
    child.on('exit', code => { state = code === 0 ? 'complete' : 'failed'; });
    return Response.json({ state }, { status: 202 });
  } catch { return Response.json({ error: 'Reset requires a fresh signature from the configured demo operator.' }, { status: 403 }); }
}
