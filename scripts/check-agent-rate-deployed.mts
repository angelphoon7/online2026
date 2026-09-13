import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname } from 'node:path';

// Send invalid inputs through the PUBLIC ingress: no Graph/model calls or transactions.
// Never treat a spoofed forwarding header as a second real client IP.
const args = process.argv.slice(2), options = new Map<string, string>();
for (let i = 0; i < args.length; i += 2) {
  if (!['--url', '--phase', '--baseline', '--output'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--') || options.has(args[i])) throw new Error('Use --url https://APP --phase quota|independent|recovery [--baseline report.json] [--output report.json]');
  options.set(args[i], args[i + 1]);
}
const url = new URL(options.get('--url') ?? ''), phase = options.get('--phase') ?? 'quota';
if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('--url must be the HTTPS origin of your deployment');
if (!['quota', 'independent', 'recovery'].includes(phase)) throw new Error('Unknown phase');
const output = options.get('--output') ?? `.data/agent-rate-deployed-${phase}.json`;
const startedAt = Date.now();
const results: unknown[] = [];
const report = { checkedAt: new Date(startedAt).toISOString(), startedAt, completedAt: 0, origin: url.origin, phase, passed: false, publicIngressTested: true, multipleInstancesVerified: false, results, error: '' };
type Baseline = { origin: string; phase: string; passed: boolean; startedAt: number; completedAt: number };
const policies = [['ask', 12], ['diagnose', 30]] as const;
async function send(route: 'ask' | 'diagnose', i = 0) {
  const spoof = `198.51.100.${i + 1}`;
  const response = await fetch(new URL(route === 'ask' ? '/api/agent/ask' : '/api/agent/diagnose/rate-limit-check', url), {
    method: route === 'ask' ? 'POST' : 'GET', redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': spoof, 'x-vercel-forwarded-for': spoof, 'x-real-ip': spoof, forwarded: `for=${spoof}` },
    ...(route === 'ask' ? { body: '{}' } : {}),
  });
  const body = await response.json();
  assert.equal(response.headers.get('X-Agent-RateLimit-Store'), 'redis', `HTTP ${response.status}: shared Redis admission was not reached`);
  const source = response.headers.get('X-Agent-IP-Source');
  assert.ok(source === 'vercel' || source === 'trusted-proxy', 'Production must identify clients through its trusted ingress');
  assert.match(response.headers.get('Cache-Control') ?? '', /no-store/);
  const retry = Number(response.headers.get('Retry-After'));
  if (response.status === 429) {
    assert.equal(body.code, 'AgentRateLimited');
    assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 60);
    assert.equal(body.retryAfterSeconds, retry);
  }
  return { status: response.status, retry, source };
}
try {
  let baseline: Baseline | undefined;
  if (phase !== 'quota') {
    if (!options.has('--baseline')) throw new Error('This phase requires the successful quota report from the original network');
    baseline = JSON.parse(fs.readFileSync(options.get('--baseline')!, 'utf8')) as Baseline;
    assert.ok(baseline.passed && baseline.phase === 'quota' && baseline.origin === url.origin && Number.isFinite(baseline.startedAt) && Number.isFinite(baseline.completedAt), 'Invalid quota baseline');
    if (phase === 'independent') assert.ok(startedAt >= baseline.completedAt && startedAt < baseline.startedAt + 50_000, 'Run from a DIFFERENT real network while the original quota is still active; baseline is stale');
    if (phase === 'recovery') assert.ok(startedAt >= baseline.completedAt + 60_000, 'Wait 60 seconds after quota completion, then run from the ORIGINAL network');
  }
  if (phase === 'quota') {
    for (const [route, maximum] of policies) {
      const replies = await Promise.all(Array.from({ length: maximum + 8 }, (_, i) => send(route, i)));
      const allowed = replies.filter(r => r.status === 400).length, blocked = replies.filter(r => r.status === 429).length;
      results.push({ route, allowed, blocked, replies });
      assert.equal(allowed, maximum, 'Start after 60 seconds without Agent traffic from this public IP; only the configured quota may reach validation');
      assert.equal(blocked, 8, 'Changing forwarding headers must not reset the real client quota');
    }
    assert.ok(Date.now() < startedAt + 50_000, 'Quota checks took too long to prove one active window');
  } else {
    for (const [route] of policies) {
      const reply = await send(route); results.push({ route, ...reply });
      assert.equal(reply.status, 400, phase === 'independent' ? 'The second real public IP must have its own allowance' : 'The original IP must recover after the window expires');
    }
    if (phase === 'independent') assert.ok(Date.now() < baseline!.startedAt + 50_000, 'Original window expired during the independence check');
  }
  report.passed = true;
  console.log(`PASS ${phase}: save ${output}. ${phase === 'quota' ? 'Now run independent from a different real network within the original window.' : 'Keep this report with the quota report; multi-process Redis acceptance is a separate check.'}`);
} catch (error) {
  report.error = error instanceof Error ? error.message : 'Public ingress acceptance failed';
  console.error(report.error); process.exitCode = 1;
} finally {
  report.completedAt = Date.now();
  fs.mkdirSync(dirname(output), { recursive: true });
  fs.writeFileSync(output, JSON.stringify(report, null, 2) + '\n');
}
