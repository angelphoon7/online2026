import 'server-only';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Hex } from 'viem';
import { DEPLOYMENT } from '@/lib/deployment';
import { consumeQuota, durableStore, encodeRecord, readRecord, type DurableStore } from './durable-store';

export class JudgeAccessError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export const SESSION_COOKIE = 'reshuffle_judge';
const TTL = 3_600_000;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function judgeControlsEnabled() {
  return process.env.JUDGE_CONTROLS_ENABLED === 'true' || (process.env.JUDGE_CONTROLS_ENABLED !== 'false' && process.env.NODE_ENV === 'development');
}
export function allowedRoots(): Set<string> {
  return new Set((process.env.JUDGE_ALLOWED_INTENT_HASHES ?? '').split(',').map(v => v.trim().toLowerCase()).filter(v => /^0x[0-9a-f]{64}$/.test(v)));
}
export function judgeAccessConfigured() { return (process.env.JUDGE_ACCESS_CODE?.length ?? 0) >= 24 && allowedRoots().size > 0; }
function requireConfiguration() {
  if (!judgeControlsEnabled()) throw new JudgeAccessError('Judge controls are disabled.', 403);
  if (!judgeAccessConfigured()) throw new JudgeAccessError('The operator must configure a judge access code and the editable demo intents.', 503);
}
export function requireSameOrigin(request: Request) {
  if (request.headers.get('origin') !== new URL(request.url).origin) throw new JudgeAccessError('Use judge controls from this app.', 403);
}
function tokenFrom(request: Request) {
  return request.headers.get('cookie')?.split(';').map(v => v.trim()).find(v => v.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1) ?? '';
}
export async function authenticated(request: Request, store: DurableStore = durableStore()) {
  if (!judgeControlsEnabled() || !judgeAccessConfigured()) return false;
  const token = tokenFrom(request);
  if (!/^[0-9a-f]{64}$/.test(token)) return false;
  const record = await readRecord<{ expires: number; version: string }>(`judge-session:${digest(token)}`, store);
  return !!record && record.expires > Date.now() && record.version === digest(process.env.JUDGE_ACCESS_CODE!);
}
export async function requireJudge(request: Request, mutate = false) {
  requireConfiguration();
  if (mutate) requireSameOrigin(request);
  if (!await authenticated(request)) throw new JudgeAccessError('Enter the judge access code to use these controls.', 401);
  if (mutate && !await consumeQuota('judge-actions', 12, 60_000)) throw new JudgeAccessError('Judge controls are busy. Retry in a minute.', 429);
}
export async function createJudgeSession(code: string, store: DurableStore = durableStore()) {
  requireConfiguration();
  if (!await consumeQuota('judge-login', 20, 60_000, store)) throw new JudgeAccessError('Too many access attempts. Retry in a minute.', 429);
  if (!timingSafeEqual(Buffer.from(digest(code), 'hex'), Buffer.from(digest(process.env.JUDGE_ACCESS_CODE!), 'hex'))) throw new JudgeAccessError('Incorrect judge access code.', 401);
  const token = randomBytes(32).toString('hex');
  if (!await store.compareAndSet(`judge-session:${digest(token)}`, null, encodeRecord({ expires: Date.now() + TTL, version: digest(code) }), { ttlMs: TTL })) throw new JudgeAccessError('Could not save the judge session. Retry sign-in.', 503);
  return token;
}
export async function deleteJudgeSession(request: Request) {
  const store = durableStore(), key = `judge-session:${digest(tokenFrom(request))}`, record = await store.get(key);
  if (record !== null) await store.compareAndSet(key, record, null);
}
const scopeKey = (hash: string) => `judge-scope:${DEPLOYMENT.chainId}:${DEPLOYMENT.intentRegistry}:${hash.toLowerCase()}`;
export async function allowedIntent(hash: string, store: DurableStore = durableStore()): Promise<string | null> {
  const roots = allowedRoots(), normalized = hash.toLowerCase();
  if (roots.has(normalized)) return normalized;
  const root = await store.get(scopeKey(normalized));
  return root && roots.has(root) ? root : null;
}
export async function requireAllowedIntent(hash: Hex) {
  const root = await allowedIntent(hash);
  if (!root) throw new JudgeAccessError('This intent is outside the configured judging demo.', 403);
  return root;
}
export async function allowReplacement(hash: Hex, root: string) {
  const store = durableStore(), key = scopeKey(hash), previous = await store.get(key);
  if (previous === root) return;
  if (previous !== null || !await store.compareAndSet(key, null, root)) throw new JudgeAccessError('Could not save the replacement demo permission. Retry the same budget change.', 503);
}
