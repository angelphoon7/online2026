import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Local, fixed-intent test-wallet harness. This is deliberately not a public
// signing API or an injected wallet extension. Private keys never enter Chrome.
export async function participantBrowser() {
  const token = randomBytes(32).toString('hex');
  const entries = [];
  let active;
  const server = createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method === 'POST' && req.url === '/authorize') {
      if (req.headers['x-demo-token'] !== token || !active || active.busy) {
        res.writeHead(403); res.end(); return;
      }
      const action = active;
      action.busy = true;
      try {
        const result = await action.sign();
        entries.push({ owner: action.intent.owner, intentHash: action.intent.hash, transactionHash: result.transactionHash });
        active = undefined;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(result));
      } catch {
        res.writeHead(500); res.end('Authorization failed; inspect the local journal.');
      }
      return;
    }
    if (req.method !== 'GET' || !/^\/(?:\?view=\d+)?$/.test(req.url)) { res.writeHead(404); res.end(); return; }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>RESHUFFLE · Sign and leave</title>
      <style>body{background:#090e1b;color:#e8edf7;font:18px system-ui;max-width:1100px;margin:50px auto;padding:24px}h1{font-size:42px}article{padding:20px;border:1px solid #30405b;border-radius:12px;margin:16px 0;overflow-wrap:anywhere}button{background:#9aecd0;padding:15px;border:0;border-radius:8px;font-size:18px}small{color:#a7b4cc}code{font-size:14px}#result{color:#9aecd0}</style>
      <small>RESHUFFLE / Arc Testnet / Controlled test wallet</small><h1>Sign the outcome. Then leave.</h1>
      <p>This local test wallet signs the displayed intent and relays its commitment. No private key is sent to this page.</p>
      ${entries.map(e => `<article><strong>Committed on Arc</strong><p>${e.owner}</p><code>${e.transactionHash}</code></article>`).join('')}
      ${active ? `<article><strong>Next authorization</strong><p>${active.intent.owner}</p><p>Offer tickets ${active.intent.offered.join(', ')}. Receive exactly ${active.intent.exactCount}, adjacent in the same session, section and row.</p><p>Session mask ${active.intent.sessionMask}; section mask ${active.intent.sectionMask}; maximum net payment ${Number(active.intent.maxNetPay) / 1e6} USDC.</p><p>Deadline ${new Date(Number(active.intent.deadline) * 1000).toISOString()}; nonce ${active.intent.nonce}.</p><code>${active.intent.hash}</code></article><button id="authorize">Sign and commit this intent</button>` : '<p>All displayed commitments are confirmed. This browser will now close before the solver starts.</p>'}
      <p id="result" role="status"></p><script>document.querySelector('#authorize')?.addEventListener('click',async function(){this.disabled=true;try{const r=await fetch('/authorize',{method:'POST',headers:{'X-Demo-Token':'${token}'}});if(!r.ok)throw Error('Authorization failed');const v=await r.json();document.querySelector('#result').textContent='Confirmed: '+v.transactionHash;document.body.dataset.authorized='yes'}catch(e){document.querySelector('#result').textContent=e.message;document.body.dataset.authorized='failed'}});</script></html>`);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  const profile = path.resolve(`.tools/offline-browser/profile-${Date.now()}`);
  await fs.mkdir(profile, { recursive: true });
  const executable = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const browser = spawn(executable, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,1400', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
  let exitInfo;
  const exited = new Promise((resolve, reject) => {
    browser.once('error', reject);
    browser.once('exit', (code, signal) => { exitInfo = { code, signal, at: new Date().toISOString() }; resolve(exitInfo); });
  });
  // Observe startup failure without an unhandled rejection during discovery.
  void exited.catch(() => {});
  let socket;
  try {
    let port;
    for (let i = 0; i < 60; i++) {
      try { port = (await fs.readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0]; break; }
      catch { if (exitInfo) throw new Error('Chrome exited before startup'); await delay(250); }
    }
    assert(port, 'Chrome did not start; set CHROME_PATH to a Chrome/Chromium executable');
    const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
    await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
    let id = 0;
    const pending = new Map();
    socket.onmessage = event => {
      const message = JSON.parse(event.data);
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id); clearTimeout(entry.timer);
        if (message.error) entry.reject(new Error(message.error.message));
        else entry.resolve(message.result);
      }
    };
    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const next = ++id;
      const timer = setTimeout(() => { pending.delete(next); reject(new Error(`Chrome timeout: ${method}`)); }, 20000);
      pending.set(next, { resolve, reject, timer });
      socket.send(JSON.stringify({ id: next, method, params }));
    });
    const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true })).result.value;
    let view = 0;
    const navigate = async () => {
      const destination = `${url}?view=${++view}`;
      await call('Page.navigate', { url: destination });
      for (let i = 0; i < 100; i++) {
        if (await evaluate(`location.href === ${JSON.stringify(destination)} && document.readyState === "complete" && document.title.includes("RESHUFFLE")`)) return;
        await delay(100);
      }
      throw new Error('Participant page did not load');
    };
    await call('Page.enable'); await call('Runtime.enable');
    return {
      async authorize(intent, sign) {
        active = { intent, sign, busy: false };
        await navigate();
        await evaluate('document.querySelector("#authorize").click()');
        for (let i = 0; i < 480; i++) {
          const result = await evaluate('document.body.dataset.authorized');
          if (result === 'yes') return;
          if (result === 'failed') throw new Error('Participant authorization failed; journal retained');
          await delay(500);
        }
        throw new Error('Participant authorization timed out');
      },
      async close() {
        await navigate();
        const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
        await fs.mkdir('docs/diagrams', { recursive: true });
        await fs.writeFile('docs/diagrams/offline-authorized.png', Buffer.from(shot.data, 'base64'));
        const requestedAt = new Date().toISOString();
        await call('Browser.close');
        let timer;
        const result = await Promise.race([exited, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Browser did not exit')), 15000); })]).finally(() => clearTimeout(timer));
        assert.equal(result.code, 0, 'Browser did not close cleanly');
        socket.close();
        await new Promise(resolve => server.close(resolve));
        return { source: 'local Chrome CDP harness; not a chain attestation', mode: 'headless controlled test wallet', browserPid: browser.pid, requestedAt, exitedAt: result.at, exitCode: result.code, signingServerClosedAt: new Date().toISOString(), authorizations: entries };
      },
      dispose() { socket.close(); browser.kill(); server.closeAllConnections(); server.close(); },
    };
  } catch (error) { socket?.close(); browser.kill(); server.closeAllConnections(); server.close(); throw error; }
}
