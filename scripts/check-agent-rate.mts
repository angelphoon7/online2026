import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fork, type ChildProcess } from 'node:child_process';
import { createServer, request as httpRequest, type OutgoingHttpHeaders } from 'node:http';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { loadEnvFile } from 'node:process';

// --credentials reads a PRIVATE {url,token} test file, not signing credentials.
const args = process.argv.slice(2);
const credentialsAt = args.indexOf('--credentials');
const outputAt = args.indexOf('--output');
if (args.some((arg, i) => ![credentialsAt, credentialsAt + 1, outputAt, outputAt + 1].filter(n => n >= 0).includes(i)) || credentialsAt >= 0 && !args[credentialsAt + 1] || outputAt >= 0 && !args[outputAt + 1]) throw new Error('Use npm run agent:check:rate -- [--credentials PRIVATE.json] [--output report.json]');
let credentials: { url: string; token: string };
if (credentialsAt >= 0) credentials = JSON.parse(fs.readFileSync(args[credentialsAt + 1], 'utf8'));
else {
  for (const file of ['.env.local', '.env']) if (fs.existsSync(file)) loadEnvFile(file);
  credentials = { url: process.env.REDIS_REST_URL ?? '', token: process.env.REDIS_REST_TOKEN ?? '' };
}
if (!credentials.url || !credentials.token) throw new Error('Configure Redis REST credentials first. This check does not accept in-memory Redis substitutes.');
const output = outputAt >= 0 ? args[outputAt + 1] : '.data/agent-rate-limit.json';
const workerFile = fileURLToPath(new URL('./lib/agent-rate-worker.mts', import.meta.url));
const namespace = 'rate-acceptance-' + randomUUID();
const children = new Set<ChildProcess>();
type Worker = { child: ChildProcess; port: number; pid: number };
async function worker(source: 'trusted-proxy' | 'vercel'): Promise<Worker> {
  // Signing/model secrets are not needed and are deliberately excluded from child configuration.
  const base = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/PRIVATE_KEY|API_KEY|REDIS|JUDGE_ACCESS_CODE/.test(k)));
  const child = fork(workerFile, [], { execArgv: ['--import', 'tsx', '--conditions=react-server'], env: { ...base, NODE_ENV: 'production', VERCEL: source === 'vercel' ? '1' : '', AGENT_IP_SOURCE: 'auto', AGENT_TRUST_PROXY: source === 'trusted-proxy' ? 'true' : 'false', AGENT_RATE_LIMIT_STORE: 'redis', REDIS_REST_URL: credentials.url, REDIS_REST_TOKEN: credentials.token, STORAGE_NAMESPACE: namespace + '-' + source }, silent: true });
  children.add(child);
  return await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { child.kill(); reject(new Error('Acceptance worker did not start')); }, 20_000);
    child.once('message', message => { clearTimeout(timeout); const ready = message as { port: number; pid: number }; resolve({ child, ...ready }); });
    child.once('exit', () => { clearTimeout(timeout); reject(new Error('Acceptance worker exited before startup')); });
  });
}
const report: Record<string, unknown> = { checkedAt: new Date().toISOString(), backend: 'real Redis REST; atomic Lua with Redis server time', topology: 'two independent Node processes using actual Agent route handlers behind a socket-IP-overwriting loopback proxy', namespace, actualVercelIngressVerified: false, graphModelOrChainCalls: 0, modes: [] };
try {
  for (const source of ['trusted-proxy', 'vercel'] as const) {
    let workers = await Promise.all([worker(source), worker(source)]), next = 0;
    const seen = new Set<string>();
    const proxy = createServer((incoming, outgoing) => {
      const target = workers[next++ % workers.length];
      const headers: OutgoingHttpHeaders = { ...incoming.headers, 'x-forwarded-for': incoming.socket.remoteAddress!, 'x-vercel-forwarded-for': incoming.socket.remoteAddress! };
      delete headers['x-real-ip']; delete headers.forwarded;
      const upstream = httpRequest({ hostname: '127.0.0.1', port: target.port, path: incoming.url, method: incoming.method, headers }, response => {
        outgoing.writeHead(response.statusCode!, response.headers); response.pipe(outgoing);
      });
      upstream.on('error', () => { outgoing.writeHead(502); outgoing.end('Worker unavailable'); });
      incoming.pipe(upstream);
    });
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as { port: number }).port;
    const send = (route: 'ask' | 'diagnose', client: 'a' | 'b', spoof = '198.51.100.7') => new Promise<{ status: number; retry: number }>((resolve, reject) => {
      const call = httpRequest({ hostname: '127.0.0.1', port, localAddress: client === 'a' ? '127.0.0.2' : '127.0.0.3', path: route === 'ask' ? '/api/agent/ask' : '/api/agent/diagnose/rate-limit-check', method: route === 'ask' ? 'POST' : 'GET', headers: { 'x-forwarded-for': spoof, 'x-vercel-forwarded-for': spoof, 'x-real-ip': spoof, forwarded: 'for=' + spoof, ...(route === 'ask' ? { 'content-type': 'application/json', 'content-length': '2' } : {}) } }, response => {
        response.resume();
        response.on('end', () => {
          try {
            assert.equal(response.headers['x-agent-ratelimit-store'], 'redis');
            assert.equal(response.headers['x-agent-ip-source'], source);
            seen.add(String(response.headers['x-test-worker']));
            resolve({ status: response.statusCode!, retry: Number(response.headers['retry-after'] ?? 0) });
          } catch (error) { reject(error); }
        });
      });
      call.on('error', reject); call.setTimeout(20_000, () => call.destroy(new Error('Acceptance request timed out')));
      call.end(route === 'ask' ? '{}' : undefined);
    });
    try {
      const routeResults = [];
      for (const [route, maximum] of [['ask', 12], ['diagnose', 30]] as const) {
        const replies = await Promise.all(Array.from({ length: maximum + 8 }, (_, i) => send(route, 'a', '198.51.100.' + (i + 1))));
        assert.equal(replies.filter(r => r.status === 400).length, maximum, 'Exactly the shared allowance must reach input validation');
        assert.equal(replies.filter(r => r.status === 429).length, 8, 'Other requests must be denied across both workers');
        assert.ok(replies.filter(r => r.status === 429).every(r => r.retry > 0 && r.retry <= 60));
        assert.equal((await send(route, 'b')).status, 400, 'Another socket IP must retain its independent allowance');
        routeResults.push({ route, allowed: maximum, blocked: 8, secondIpAllowed: true });
      }
      assert.equal(seen.size, 2, 'Both independent processes must serve the requests');
      const oldPids = workers.map(w => w.pid);
      for (const w of workers) w.child.kill();
      workers = await Promise.all([worker(source), worker(source)]);
      assert.ok(workers.every(w => !oldPids.includes(w.pid)));
      assert.equal((await send('ask', 'a')).status, 429, 'Restart must not clear the ask quota');
      const blocked = await send('diagnose', 'a'); assert.equal(blocked.status, 429, 'Restart must not clear the diagnosis quota');
      console.log('PASS ' + source + ': separate IPs, shared concurrent quotas, header spoof resistance, both workers restarted');
      // The wait verifies real expiry without changing the production window or Redis clock.
      await new Promise(r => setTimeout(r, blocked.retry * 1000 + 100));
      assert.equal((await send('ask', 'a')).status, 400);
      assert.equal((await send('diagnose', 'a')).status, 400);
      (report.modes as unknown[]).push({ source, routes: routeResults, independentWorkers: 2, spoofedHeadersDidNotResetQuota: true, restartPreservedQuota: true, expiredWindowRecovered: true, pass: true });
      console.log('PASS ' + source + ': actual 60-second window recovered');
    } finally { proxy.closeAllConnections(); await new Promise<void>(resolve => proxy.close(() => resolve())); for (const w of workers) w.child.kill(); }
  }
  fs.mkdirSync(fileURLToPath(new URL('../.data/', import.meta.url)), { recursive: true });
  fs.writeFileSync(output, JSON.stringify({ ...report, passed: true }, null, 2) + '\n');
  console.log('PASS: report saved to ' + output + '. This does not certify an undeployed Vercel ingress.');
} catch (error) {
  console.error(error instanceof Error ? error.message.replaceAll(credentials.token, '[redacted]').replaceAll(credentials.url, '[Redis endpoint]') : 'Rate-limit acceptance failed');
  process.exitCode = 1;
} finally { for (const child of children) child.kill(); }
