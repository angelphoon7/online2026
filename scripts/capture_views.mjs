import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const folder = path.resolve('.tools/screenshots');
await mkdir(folder, { recursive: true });
const profile = `${folder}/profile-${Date.now()}`;
const chromePath = process.platform === 'darwin' ? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' : 'google-chrome';

const browser = spawn(chromePath, [
  '--headless=new',
  '--remote-debugging-port=0',
  `--user-data-dir=${profile}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--window-size=1440,1080',
  'about:blank'
], { windowsHide: true, stdio: 'ignore' });

const delay = ms => new Promise(res => setTimeout(res, ms));

try {
  let port;
  for (let i = 0; i < 40; i++) {
    try {
      port = (await readFile(`${profile}/DevToolsActivePort`, 'utf8')).split('\n')[0];
      break;
    } catch {
      await delay(250);
    }
  }
  if (!port) throw new Error('Browser did not start');

  const tabs = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const socket = new WebSocket(tabs.find(tab => tab.type === 'page').webSocketDebuggerUrl);
  await new Promise((res, rej) => { socket.onopen = res; socket.onerror = rej; });

  let id = 0;
  const pending = new Map();
  socket.onmessage = event => {
    const msg = JSON.parse(event.data);
    if (msg.id) {
      const entry = pending.get(msg.id);
      if (entry) {
        pending.delete(msg.id);
        if (msg.error) entry.reject(msg.error);
        else entry.resolve(msg.result);
      }
    }
  };

  const call = (method, params = {}) => new Promise((res, rej) => {
    const next = ++id;
    pending.set(next, { resolve: res, reject: rej });
    socket.send(JSON.stringify({ id: next, method, params }));
  });

  await call('Page.enable');
  await call('Runtime.enable');

  // 0. Visit home
  await call('Page.navigate', { url: 'http://localhost:3000/' });
  await delay(2000);
  const homeShot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(folder, 'home_hero_view.png'), Buffer.from(homeShot.data, 'base64'));
  console.log('Saved home_hero_view.png');

  // 1. Visit #tickets
  await call('Runtime.evaluate', { expression: `window.location.hash = '#tickets'` });
  await delay(1200);
  const ticketsShot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(folder, 'tickets_view.png'), Buffer.from(ticketsShot.data, 'base64'));
  console.log('Saved tickets_view.png');

  // 2. Visit #events
  await call('Runtime.evaluate', { expression: `window.location.hash = '#events'` });
  await delay(1200);
  const eventsShot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(folder, 'events_view.png'), Buffer.from(eventsShot.data, 'base64'));
  console.log('Saved events_view.png');

  // 3. Visit #workspace
  await call('Page.navigate', { url: 'http://localhost:3000/#workspace' });
  await delay(1500);
  const workspaceShot = await call('Page.captureScreenshot', { format: 'png' });
  await writeFile(path.join(folder, 'workspace_view.png'), Buffer.from(workspaceShot.data, 'base64'));
  console.log('Saved workspace_view.png');

  socket.close();
} finally {
  browser.kill();
}
