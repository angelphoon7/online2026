// Requires a running Next dev server. Override WALLET_TEST_URL if its port differs.
// This isolated browser uses a mock provider; it never connects a real wallet.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { encodeFunctionResult, toFunctionSelector } from 'viem';
const folder = path.resolve('.tools/wallet-browser');
const base = process.env.WALLET_TEST_URL ?? 'http://localhost:3101';
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
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(500); }
    throw new Error(`Timed out: ${await evaluate('document.body.innerText')}`);
  };
  await call('Page.enable'); await call('Runtime.enable');
  const abis=JSON.parse(await readFile('server/abis.json','utf8'));
  const record=JSON.parse(await readFile('deployments/act-one.json','utf8'));
  const evidence={...record.evidence,receipt:undefined,transactionHash:undefined};
  const owner=record.proof.tickets[0].previousParticipant;
  const escrow=record.proof.escrow;
  const tickets=record.proof.tickets.map(t=>({...t.meta,tokenId:t.tokenId,owner:escrow,depositor:t.previousParticipant}));
  tickets.push({...tickets.find(t=>t.sessionId===0&&t.sectionId===0),tokenId:'100',seat:3});
  tickets.push({...tickets[0],tokenId:'101',owner,depositor:'0x0000000000000000000000000000000000000000'});
  tickets.push({...tickets[0],tokenId:'102',seat:8}, {...tickets[0],tokenId:'103',seat:9});
  const market={blockNumber:'61301567',timestamp:'1789160000',tickets,
    intents:evidence.proposal.intents.map((i,n)=>({...i,hash:evidence.proposal.legs[n].intentHash,commitTx:record.proof.transactionHash,state:1,expired:false})),
    defaultHashes:evidence.proposal.legs.map(l=>l.intentHash),settlements:[{hash:record.proof.transactionHash,block:'61301567',participants:'3'}]};
  const outputs={};
  for(const [contract,name,result] of [['TicketNFT','isApprovedForAll',true],['Escrow','depositor',owner],['IntentRegistry','usedNonce',false]]) {
    const abi=abis[contract];outputs[toFunctionSelector(abi.find(i=>i.type==='function'&&i.name===name))]=encodeFunctionResult({abi,functionName:name,result});
  }
  const receipt={hash:record.proof.transactionHash,blockNumber:record.proof.blockNumber,status:'success',proposer:evidence.proposal.intents[0].owner,independent:false,ticketTransfers:6,usdcTransfers:2,netSum:'0',rejection:null,participants:evidence.proposal.intents.map((i,n)=>({owner:i.owner,offered:i.offered,receives:evidence.proposal.legs[n].receives,netPayment:evidence.proposal.legs[n].netPayment}))};
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const market=${JSON.stringify(market)},evidence=${JSON.stringify(evidence)},outputs=${JSON.stringify(outputs)},receipt=${JSON.stringify(receipt)};
    window.testWallet={calls:[],connected:false,chain:'0x1',cancel:false,failSolver:false,marketReads:0};
    const original=window.fetch.bind(window);
    window.fetch=async(url,init)=>{
      const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      if(String(url).startsWith('/api/market/receipt')) return reply(receipt);
      if(String(url).startsWith('/api/market')) {
        window.testWallet.marketReads++;
        if(location.search.includes('preloadCheck') && !window.testWallet.released) await new Promise(resolve=>{window.releaseMarket=()=>{window.testWallet.released=true;resolve();};});
        return reply(market);
      }
      if(url==='/api/demo/reset') return reply({enabled:false});
      if(url==='/api/solve') return window.testWallet.failSolver?reply({error:'Offline'},503):reply(evidence);
      if(url==='/api/rpc') {
        const body=JSON.parse(init.body);let result;
        if(body.method==='eth_call') result=outputs[body.params[0].data.slice(0,10)]??'0x';
        else if(body.method==='eth_chainId') result='0x4cef52';
        else if(body.method==='eth_getBalance') result='0xde0b6b3a7640000';
        else throw Error('Unexpected RPC '+body.method);
        return reply({jsonrpc:'2.0',id:body.id,result});
      }
      return original(url,init);
    };
    window.ethereum={on(){},removeListener(){},async request({method,params}){
      const s=window.testWallet;s.calls.push(method);
      if(method==='eth_accounts')return s.connected?['${owner}']:[];
      if(method==='eth_chainId')return s.chain;
      if(method==='eth_requestAccounts'){if(s.cancel)throw {code:4001};s.connected=true;return ['${owner}'];}
      if(method==='wallet_switchEthereumChain'){s.chain=params[0].chainId;return null;}
      if(method==='eth_signTypedData_v4'){s.signed=JSON.parse(params[1]);throw Object.assign(Error('Test signature cancelled'),{code:4001});}
      if(method==='eth_sendTransaction')throw Object.assign(Error('Test transaction cancelled'),{code:4001});
      throw Error('Unexpected wallet method '+method);
    }};
  `});
  const click=async text=>{await evaluate(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes(${JSON.stringify(text)})).click()`);};
  const navigate=async()=>{
    await call('Page.navigate',{url:base+'/'});
    await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);
    if((await evaluate('window.testWallet.calls')).some(m=>m==='eth_requestAccounts'||m==='wallet_switchEthereumChain'))throw Error('Upfront prompt');
    await click('AFTER');
    await waitFor(`document.querySelector('.intent-step[data-expanded=true]') && document.querySelector('.candidate')`);
    if(await evaluate(`location.pathname !== '/' || location.hash !== ''`))throw Error('Navigation changed URL');
    if(await evaluate(`document.querySelector('header').innerText.includes('USDC')`))throw Error('Disconnected balance shown');
  };
  await call('Page.navigate',{url:base+'/?preloadCheck=1'});
  await waitFor(`window.testWallet?.marketReads === 1 && !!document.querySelector('.poster-live')`);
  if(!(await evaluate(`document.querySelector('.poster-live').disabled`)))throw Error('Poster opens before public data is ready');
  if((await evaluate('window.testWallet.calls')).includes('eth_requestAccounts'))throw Error('Preloading asked for a wallet');
  await evaluate('window.releaseMarket()');
  await waitFor(`!document.querySelector('.poster-live').disabled && !!document.querySelector('.candidate')`);
  if(!(await evaluate(`document.getElementById('workspace').hidden`)))throw Error('Workspace opened during preload');
  const readsBeforeOpen=await evaluate('window.testWallet.marketReads');
  await click('AFTER');
  await waitFor(`!document.getElementById('workspace').hidden`);
  if(await evaluate('window.testWallet.marketReads')!==readsBeforeOpen)throw Error('Opening a poster starts another read');
  if(await evaluate(`document.getElementById('workspace').innerText.includes('Reading public ticket positions')`))throw Error('Workspace still waits on its initial public read');
  console.log('PASS all public positions and commitments preload before poster click; opening reuses ready data without another fetch.');
  await navigate();
  const hero=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
  await writeFile('.tools/market-desktop.png',Buffer.from(hero.data,'base64'));
  const assert = async (expression, message) => { if (!await evaluate(expression)) throw Error(message); };
  const advance = async () => { await evaluate("document.querySelector('.step-continue').click()"); };
  const offer = async () => { await evaluate("document.querySelector('.position input').click()"); await advance(); };
  await assert("document.querySelectorAll('.step-content').length===1 && document.querySelector('.step-continue').disabled", 'Initial steps not gated');
  await assert("document.querySelectorAll('.position-list .position').length===8 && document.querySelector('.more-tickets summary').textContent==='+2 more'", 'Ticket disclosure missing');
  await assert("!document.querySelector('.seat-map').open && !document.querySelector('.seat-map-content button,.seat-map-content input,.seat-map-content a')", 'Seat map must be closed and read-only');
  await offer();
  const flowClip = await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
  const desktopFlow=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:flowClip});
  await writeFile('.tools/intent-stepper-desktop.png',Buffer.from(desktopFlow.data,'base64'));
  await assert("document.querySelectorAll('.step-content').length===1 && document.querySelector('.intent-step[data-step=\"2\"]').dataset.expanded==='true'", 'Step did not advance');
  await evaluate("document.querySelector('.intent-step[data-step=\"1\"] button').click()");
  await assert("document.querySelector('.position input').checked", 'Change lost offered ticket');
  await evaluate("document.querySelector('.position input').click()");
  await assert("document.querySelector('.step-continue').disabled && document.querySelectorAll('.is-future button').length===0", 'Empty selection permits skipping offering step');
  await offer();
  await assert("document.querySelectorAll('[aria-labelledby=sections-label] button').length===2 && document.querySelectorAll('[aria-labelledby=sections-label] button[aria-pressed=true]').length===2", 'Phantom section or duplicate controls');
  await assert("document.querySelectorAll('.illustration-seat').length===12", 'Adjacency illustration missing');
  await evaluate("document.getElementById('adjacent-seats').click()");
  await assert("!document.querySelector('.adjacency-illustration')", 'Unchecked adjacency still illustrates');
  await evaluate("document.getElementById('adjacent-seats').click(); document.querySelector('[aria-labelledby=sections-label] button').click(); document.querySelector('.seat-map summary').click()");
  await assert("Array.from(document.querySelectorAll('.seat-map-content h3')).every(e=>e.textContent.endsWith('SECTION 1'))", 'Map ignored conditions');
  await evaluate("document.querySelector('[aria-labelledby=sections-label] button').click(); document.getElementById('net-budget').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await waitFor(`document.querySelector('.budget-label').textContent.includes('must receive at least')`);
  await advance();
  await assert("document.querySelector('.signed-sentence').textContent.includes('sections 0, 1;') && !document.querySelector('.signed-sentence').textContent.includes('sections 0, 1, 2')", 'Review mask mismatch');
  await evaluate("document.querySelector('.intent-step[data-step=\"2\"] button').click()");
  await assert("document.getElementById('net-budget').value==='-1000'", 'Change lost draft');
  await advance();
  await click('View signed struct');
  await click('Sign and commit');
  await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  const signed=await evaluate('window.testWallet.signed');
  if(Number(signed.domain.chainId)!==5042002||signed.message.owner.toLowerCase()!==owner.toLowerCase())throw Error('Wrong typed-data domain/account');
  if(BigInt(signed.message.maxNetPay)!==-1000000000n)throw Error('Signed credit floor did not use six-decimal USDC');
  await assert("JSON.stringify(JSON.parse(document.querySelector('.raw-struct').textContent).message).toLowerCase()===JSON.stringify(window.testWallet.signed.message).toLowerCase()", 'Review differs from wallet payload');
  console.log('PASS stepper, disclosure, masks, read-only map, adjacency illustration, preserved draft, exact wallet payload and deferred connection.');
  for(const action of ['Deposit','Withdraw','Propose and settle']){
    await navigate();await click(action);await waitFor(`window.testWallet.calls.includes('eth_sendTransaction')`);
    console.log('PASS '+action+' connects and continues; mock rejects transaction.');
  }
  await navigate();await offer();await advance();await evaluate('window.testWallet.cancel=true');await click('Sign and commit');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('cancelled')`);
  if(await evaluate(`window.testWallet.calls.includes('eth_signTypedData_v4')`))throw Error('Signed after rejected connection');
  await evaluate('window.testWallet.cancel=false');await click('Sign and commit');await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  console.log('PASS cancellation returns to usable builder.');
  await navigate();await evaluate('window.testWallet.failSolver=true');await click('Run solver');
  await waitFor(`document.body.innerText.includes('Solver unreachable')`);
  if(await evaluate(`!!document.querySelector('.candidate')`))throw Error('Stale candidate shown after failure');
  if(!(await evaluate(`!!document.querySelector('.seat-grid .seat')`)))throw Error('Public reads hidden by solver failure');
  await evaluate(`document.querySelector('.history-list button').click()`);await waitFor(`!!document.querySelector('.receipt-section')`);
  if(!(await evaluate(`document.querySelector('.receipt-section').innerText.includes('Submitted by a participant wallet')`)))throw Error('False independent solver claim');
  console.log('PASS solver failure clears allocation, public reads survive, inline receipt uses actual proposer relationship.');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await delay(200);
  if(await evaluate('document.documentElement.scrollWidth>window.innerWidth'))throw Error('Mobile horizontal overflow');
  await offer();
  await assert("!Array.from(document.querySelectorAll('.reshuffle-ui *')).some(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight)", 'Nested scroll region');
  if(await evaluate('document.documentElement.scrollWidth>window.innerWidth'))throw Error('Mobile stepper horizontal overflow');
  const mobileClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:0,y:r.y+scrollY,width:390,height:r.height,scale:1};})()");
  const mobileFlow=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:mobileClip});
  await writeFile('.tools/intent-stepper-mobile.png',Buffer.from(mobileFlow.data,'base64'));
  const mobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});await writeFile('.tools/market-mobile.png',Buffer.from(mobile.data,'base64'));
  if(errors.some(e=>/hydration|uncaught|TypeError/i.test(e)))throw Error(errors.join('\n'));
  console.log('PASS mobile layout and no hydration/runtime errors. All public responses were fixtures; no real transaction sent.');
}finally{socket?.close();browser.kill();}
