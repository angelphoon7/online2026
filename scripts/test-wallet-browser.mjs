// Requires a running Next dev server. Override WALLET_TEST_URL if its port differs.
// This isolated browser uses a mock provider; it never connects a real wallet.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
const folder = path.resolve('.tools/wallet-browser');
const base = process.env.WALLET_TEST_URL ?? 'http://localhost:3001';
await mkdir(folder, { recursive: true });
const profile = `${folder}/profile-${Date.now()}`;
const browser = spawn('C:/Program Files/Google/Chrome/Application/chrome.exe', ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--window-size=1440,1400', 'about:blank'], { windowsHide: true, stdio: 'ignore' });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let socket;
try {
  let port;
  for (let i = 0; i < 40; i++) {
    try { port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0]; break; } catch { await delay(250); }
  }
  if (!port) throw new Error('Browser did not start');
  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const pending = new Map();
  const errors = [];
  socket.onmessage = event => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const entry = pending.get(message.id);
      if (entry) {
        pending.delete(message.id);
        if (message.error) entry.reject(message.error);
        else entry.resolve(message.result);
      }
    } else if (message.method === 'Runtime.exceptionThrown') errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
    else if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') errors.push(message.params.args.map(a => a.value ?? a.description ?? '').join(' '));
  };
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; pending.set(next, { resolve, reject }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => (await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })).result.value;
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(expression)) return; await delay(500); }
    throw new Error(`Timed out: ${await evaluate('document.body.innerText')}`);
  };
  await call('Page.enable'); await call('Runtime.enable');
  await call('Page.addScriptToEvaluateOnNewDocument', { source: `
    const mode = new URL(location.href).searchParams.get('walletCase');
    const observer = new MutationObserver(() => {
      if (!document.body) return;
      document.body.setAttribute('data-new-gr-c-s-check-loaded', '14.1328.0');
      document.body.setAttribute('data-gr-ext-installed', '');
      if (mode === 'childMismatch') {
        const child = document.querySelector('h1');
        if (!child) return;
        child.setAttribute('data-unexpected-child', 'yes');
      }
      observer.disconnect();
    });
    observer.observe(document, { childList: true, subtree: true });
    const listeners = new Map();
    window.__walletTest = { mode, calls: [], emit(event, value) { for (const fn of listeners.get(event) ?? []) fn(value); } };
    if (mode !== 'missing') window.ethereum = {
      on(event, fn) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event).add(fn); },
      removeListener(event, fn) { listeners.get(event)?.delete(fn); },
      request({ method }) {
        const state = window.__walletTest;
        state.calls.push(method);
        if (state.mode === 'syncInit') throw Error('Failed to connect to MetaMask');
        if (method === 'eth_accounts') return Promise.resolve([]);
        if (method === 'eth_chainId' && state.mode === 'hangChain') return new Promise(resolve => { state.finish = () => resolve('0x' + (5042002).toString(16)); });
        if (method === 'eth_chainId') return Promise.resolve('0x' + (5042002).toString(16));
        if (method !== 'eth_requestAccounts') return Promise.reject(Error('Unexpected wallet request'));
        if (state.mode === 'syncClick') throw Error('Failed to connect to MetaMask');
        if (state.mode === 'empty') return Promise.resolve([]);
        if (state.mode === 'hangChain') return Promise.resolve(['0x1111111111111111111111111111111111111111']);
        if (state.mode === 'success' || state.mode === 'hangAccounts') return new Promise(resolve => { state.finish = () => resolve(['0x1111111111111111111111111111111111111111']); });
        return Promise.reject(Object.assign(Error('Failed to connect to MetaMask'), { code: Number(state.mode) }));
      }
    };
  ` });
  const navigate = async (route, mode) => {
    errors.length = 0;
    await call('Page.navigate', { url: `${base}${route}?walletCase=${mode}` });
    await waitFor(`location.search === '?walletCase=${mode}' && document.readyState === 'complete' && document.body.hasAttribute('data-gr-ext-installed')`);
    await delay(500);
  };
  // Both the landing page and wallet screen hydrate with extension body attrs.
  await navigate('/', 'missing');
  await delay(1000);
  if (errors.length) throw new Error(`Home hydration errors: ${JSON.stringify(errors)}`);
  for (const [mode, message] of [
    ['missing', 'No wallet detected'], ['4001', 'Connection cancelled'],
    ['-32002', 'already pending'], ['4900', 'disconnected from the network'],
    ['4100', 'not authorized'], ['unknown', 'Could not reach your wallet'],
    ['syncClick', 'Could not reach your wallet'], ['empty', 'No account was shared'],
    ['hangAccounts', 'did not respond in time'], ['hangChain', 'did not respond in time'],
  ]) {
    await navigate('/reshuffle', mode);
    await waitFor("[...document.querySelectorAll('button')].some(b => b.textContent === 'Connect Wallet')");
    await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Connect Wallet').click()");
    await waitFor(`document.querySelector('[role=alert]')?.textContent.includes(${JSON.stringify(message)})`);
    if (await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Connect Wallet')?.disabled")) throw new Error('Failed connection left button disabled');
    if (errors.length) throw new Error(`Unhandled ${mode} error: ${JSON.stringify(errors)}`);
    if (mode.startsWith('hang')) {
      await evaluate('window.__walletTest.finish()');
      await delay(300);
      if (await evaluate("document.body.innerText.includes('0x1111...1111')")) throw new Error('Late wallet response changed a timed-out connection');
    }
  }
  await navigate('/reshuffle', 'syncInit');
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('Could not reach your wallet')");
  if (errors.length) throw new Error(`Startup exception escaped: ${JSON.stringify(errors)}`);
  // Recover without a page reload, block duplicate clicks, and read chain after approval.
  await evaluate("window.__walletTest.mode = 'success'; [...document.querySelectorAll('button')].find(b => b.textContent === 'Connect Wallet').click()");
  await waitFor("!!window.__walletTest.finish");
  await evaluate("[...document.querySelectorAll('button')].find(b => b.textContent === 'Connecting...').click()");
  if (await evaluate("window.__walletTest.calls.filter(m => m === 'eth_requestAccounts').length") !== 1) throw new Error('Duplicate account request');
  await evaluate('window.__walletTest.finish()');
  await waitFor("document.body.innerText.includes('0x1111...1111')");
  if (await evaluate("!!document.querySelector('[role=alert]')")) throw new Error('Stale connection error after success');
  await evaluate("window.__walletTest.emit('disconnect', {code:4900})");
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('disconnected from the network') && document.body.innerText.includes('Connect Wallet')");
  if (errors.length) throw new Error(`Recovery/disconnect exception: ${JSON.stringify(errors)}`);
  const shot = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(`${folder}/wallet-error.png`, Buffer.from(shot.data, 'base64'));
  // Negative control: body suppression must not hide mismatches on descendants.
  await navigate('/', 'childMismatch');
  for (let i = 0; i < 40 && !errors.some(e => /hydrated|hydration/i.test(e)); i++) await delay(250);
  if (!errors.some(e => /hydrated|hydration/i.test(e))) throw new Error('Expected child hydration mismatch was hidden; run against a Next dev server');
  console.log('PASS: body hydration; wallet failures; hung account and chain requests time out and ignore late replies; recovery; duplicate-click guard; disconnect state; descendant hydration warnings preserved. Mock provider only, no signatures or transactions.');
  await call('Browser.close');
} finally { socket?.close(); browser.kill(); }
