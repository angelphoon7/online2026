// Requires a running Next dev server. Override WALLET_TEST_URL if its port differs.
// This isolated browser uses a mock provider; it never connects a real wallet.
import { spawn } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeFunctionResult, toFunctionSelector } from 'viem';
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
  const abis = JSON.parse(await readFile('server/abis.json', 'utf8'));
  const record = JSON.parse(await readFile('deployments/act-one.json', 'utf8'));
  const evidence = {...record.evidence, transactionHash: undefined, receipt: undefined};
  const demo = {blockNumber:'61301567',intents:evidence.proposal.intents.map((i,index)=>({...i, hash:evidence.proposal.legs[index].intentHash,state:1,expired:false}))};
  const owner = '0x1111111111111111111111111111111111111111';
  const outputs = {};
  for (const [contract, name, result] of [['TicketNFT','nextTokenId',1n],['TicketNFT','meta',[1,0,0,5,2,0]],['TicketNFT','ownerOf',owner],['Escrow','depositor',owner]]) {
    const abi = abis[contract];
    outputs[toFunctionSelector(abi.find(i=>i.type==='function' && i.name===name))] = encodeFunctionResult({abi,functionName:name,result});
  }
  await call('Page.addScriptToEvaluateOnNewDocument', {source:`
    const outputs=${JSON.stringify(outputs)}, demo=${JSON.stringify(demo)}, evidence=${JSON.stringify(evidence)};
    const nativeFetch=window.fetch.bind(window);
    window.fetch=async (url,init)=>{
      const reply=data=>Promise.resolve(new Response(JSON.stringify(data),{headers:{'Content-Type':'application/json'}}));
      if(url==='/api/demo') return reply(demo);
      if(url==='/api/solve') return reply(evidence);
      if(url==='/api/rpc') {
        const body=JSON.parse(init.body);
        let result;
        if(body.method==='eth_call') result=outputs[body.params[0].data.slice(0,10)];
        else if(body.method==='eth_chainId') result='0x4cef52';
        else if(body.method==='eth_blockNumber') result='0x3a7699f';
        else if(body.method==='eth_getLogs') result=[];
        else if(body.method==='eth_getBalance') result='0xde0b6b3a7640000';
        else throw Error('Unexpected public method '+body.method);
        return reply({jsonrpc:'2.0',id:body.id,result});
      }
      return nativeFetch(url,init);
    };
    window.testWallet={calls:[], connected:false,chain:'0x1',cancel:false};
    window.ethereum={on(){},removeListener(){},async request({method,params}){
      const state=window.testWallet; state.calls.push(method);
      if(method==='eth_accounts') return state.connected?['${owner}']:[];
      if(method==='eth_chainId') return state.chain;
      if(method==='eth_requestAccounts') {
        if(state.cancel) throw {code:4001};
        state.connected=true; return ['${owner}'];
      }
      if(method==='wallet_switchEthereumChain') {if(state.cancelSwitch) throw {code:4001};state.chain=params[0].chainId;return null;}
      if(method==='eth_signTypedData_v4'||method==='eth_sendTransaction') throw Object.assign(Error('Test intentionally cancelled'),{code:4001});
      throw Error('Unexpected wallet method '+method);
    }};
  `});
  const navigate=async()=>{
    await call('Page.navigate',{url:base+'/demo'});
    await waitFor(`document.body.innerText.includes('Row 5, Seat 2') && document.body.innerText.includes('Propose and settle')`);
    const calls=await evaluate('window.testWallet.calls');
    if(calls.some(m=>m==='eth_requestAccounts'||m==='wallet_switchEthereumChain')) throw Error('Upfront wallet prompt');
    if(!(await evaluate(`document.body.innerText.includes('Past settlements') && document.body.innerText.includes('Participant 1')`))) throw Error('Public panels missing');
    if(await evaluate(`document.body.innerText.includes('Connect Wallet')`)) throw Error('Wallet gate visible');
  };
  const click=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);};
  for(const action of ['Sign & Commit','Deposit 1','Withdraw 1','Propose and settle']) {
    await navigate();
    if(action==='Sign & Commit') {await click('+ Create Intent');}
    else if(action!=='Propose and settle') {await click('Row 5, Seat 2');}
    await click(action);
    await waitFor(`window.testWallet.calls.includes('${action==='Sign & Commit'?'eth_signTypedData_v4':'eth_sendTransaction'}')`);
    const calls=await evaluate('window.testWallet.calls');
    if(calls.filter(m=>m==='eth_requestAccounts').length!==1 || calls.filter(m=>m==='wallet_switchEthereumChain').length!==1) throw Error(JSON.stringify(calls));
    if(!(await evaluate(`document.querySelector('header').innerText.includes('0x1111')`))) throw Error('Header account missing');
    console.log('PASS one-click connect, switch, then '+action+'; signing/broadcast cancelled by mock.');
  }
  await navigate();await click('+ Create Intent');
  await evaluate('window.testWallet.cancel=true');await click('Sign & Commit');
  await waitFor(`document.body.innerText.includes('cancelled')`);
  if(await evaluate(`window.testWallet.calls.includes('eth_signTypedData_v4')`)) throw Error('Signed after cancellation');
  await evaluate('window.testWallet.cancel=false');await click('Sign & Commit');
  await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  console.log('PASS cancellation preserves intent builder and retry continues. No real wallet or transactions used.');
  await navigate();await click('+ Create Intent');
  await evaluate('window.testWallet.cancelSwitch=true');await click('Sign & Commit');
  await waitFor(`document.body.innerText.includes('cancelled')`);
  if(await evaluate(`window.testWallet.calls.includes('eth_signTypedData_v4')`)) throw Error('Signed on wrong network');
  console.log('PASS rejected network switch prevents signing.');
  await navigate();
  await evaluate('delete window.ethereum');
  if(!(await evaluate(`document.body.innerText.includes('Row 5, Seat 2') && document.body.innerText.includes('Past settlements')`))) throw Error('Public data disappeared without provider');
  await click('+ Create Intent');await click('Sign & Commit');
  await waitFor(`document.body.innerText.includes('No wallet detected')`);
  console.log('PASS missing extension leaves public demo readable and reports error only on action.');

} finally {socket?.close();browser.kill();}
