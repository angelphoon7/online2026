// Requires a running Next dev server. Override WALLET_TEST_URL if its port differs.
// This isolated browser uses a mock provider; it never connects a real wallet.
import { spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { decodeFunctionData, encodeFunctionResult, toFunctionSelector } from 'viem';
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
  const call = (method, params = {}) => new Promise((resolve, reject) => { const next = ++id; const timeout = setTimeout(() => { pending.delete(next); reject(Error(`Browser command timed out: ${method} ${params.expression ?? ''}`)); }, 20000); pending.set(next, { resolve: value => { clearTimeout(timeout); resolve(value); }, reject: error => { clearTimeout(timeout); reject(error); } }); socket.send(JSON.stringify({ id: next, method, params })); });
  const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text); return r.result.value; };
  const waitFor = async expression => {
    for (let i = 0; i < 100; i++) { if (await evaluate(`Boolean(${expression})`)) return; await delay(500); }
    throw new Error(`Timed out waiting for ${expression}: ${await evaluate('document.body.innerText')}`);
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
  outputs[toFunctionSelector('allowance(address,address)')]='0x'+(100000000000n).toString(16).padStart(64,'0');
  const receipt={hash:record.proof.transactionHash,blockNumber:record.proof.blockNumber,status:'success',proposer:evidence.proposal.intents[0].owner,independent:false,ticketTransfers:6,usdcTransfers:2,netSum:'0',rejection:null,participants:evidence.proposal.intents.map((i,n)=>({owner:i.owner,offered:i.offered,receives:evidence.proposal.legs[n].receives,netPayment:evidence.proposal.legs[n].netPayment}))};
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const market=${JSON.stringify(market)},evidence=${JSON.stringify(evidence)},outputs=${JSON.stringify(outputs)},receipt=${JSON.stringify(receipt)};
    window.testWallet={calls:[],solveCalls:[],connected:location.search.includes('connected'),account:location.search.includes('emptyWallet')?'0x1111111111111111111111111111111111111111':'${owner}',chain:'0x1',cancel:false,failSolver:false,marketReads:0};
    if(location.search.includes('largePool'))for(let n=0;n<3;n++)market.intents.push({...market.intents[0],owner:'0x'+'1'.repeat(40),hash:'0x'+String(n+7).repeat(64),nonce:String(n+20)});
    if(location.search.includes('batch'))for(const t of market.tickets.filter(t=>['101','103'].includes(t.tokenId))){t.owner=window.testWallet.account;t.depositor='0x'+'0'.repeat(40);}
    window.testWallet.depositFixture=id=>{const t=market.tickets.find(t=>t.tokenId===id);t.owner='${escrow}';t.depositor=window.testWallet.account;};
    window.testWallet.setAllIntentStates=state=>market.intents.forEach(i=>i.state=state);
    window.testWallet.setRequestState=(state,expired=false)=>{const i=market.intents.find(i=>i.owner.toLowerCase()===window.testWallet.account.toLowerCase());i.state=state;i.expired=expired;};
    const originalInterval=window.setInterval.bind(window);
    const originalClearInterval=window.clearInterval.bind(window),pollers=new Map();
    window.setInterval=(fn,ms,...args)=>{const id=originalInterval(fn,ms,...args);if(ms===30000)pollers.set(id,()=>fn(...args));return id;};
    window.clearInterval=id=>{pollers.delete(id);originalClearInterval(id);};
    window.testWallet.poll=()=>pollers.forEach(fn=>fn());
    const original=window.fetch.bind(window);
    window.fetch=async(url,init)=>{
      const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      if(String(url).startsWith('/api/market/receipt')) return reply(window.testWallet.revertSettlement?{...receipt,status:'reverted',participants:[],rejection:{name:'SeatsNotAdjacent',args:[]}}:receipt);
      if(String(url).startsWith('/api/market')) {
        window.testWallet.marketReads++;
        if(location.search.includes('preloadCheck') && !window.testWallet.released) await new Promise(resolve=>{window.releaseMarket=()=>{window.testWallet.released=true;resolve();};});
        return reply(market);
      }
      if(String(url).startsWith('/api/demo/tickets')) {
        if(init?.method==='POST') {
          if(window.testWallet.failDemo) return reply({error:'The demo issuer needs test USDC.'},503);
          if(!market.tickets.some(t=>t.tokenId==='200')) market.tickets.push(...[200,201].map((id,n)=>({...market.tickets[0],tokenId:String(id),owner:window.testWallet.account,depositor:'0x0000000000000000000000000000000000000000',row:1000,seat:n+1})));
          return reply({tokenIds:['200','201'],hashes:[receipt.hash,receipt.hash]});
        }
        return reply({message:'RESHUFFLE demo ticket claim'});
      }
      if(url==='/api/demo/reset') return reply({enabled:false});
      if(url==='/api/solve' || url==='/api/solve/pool') {
        if(window.testWallet.holdSolver)await new Promise(resolve=>{window.testWallet.releaseSolve=()=>{window.testWallet.holdSolver=false;delete window.testWallet.releaseSolve;resolve();};});
        if(url==='/api/solve/pool'){window.testWallet.poolCalls=(window.testWallet.poolCalls??0)+1;window.testWallet.solveCalls.push(market.intents.filter(i=>i.eventId===1&&i.state===1&&!i.expired).map(i=>i.hash).sort());}
        else window.testWallet.solveCalls.push(JSON.parse(init.body).intentHashes);
        if(window.testWallet.failSolver)return reply({error:'Offline'},503);
        if(window.testWallet.noMatch)return reply({...evidence,proposal:null,chosen:null,candidatesFound:0,simulationResult:undefined});
        if(window.testWallet.badSimulation)return reply({...evidence,simulationResult:{success:false,error:'InsufficientPaymentCapacity'}});
        if(window.testWallet.unrelated){const result=structuredClone(evidence);const keep=result.proposal.intents.map((i,n)=>i.owner.toLowerCase()!==window.testWallet.account.toLowerCase()?n:-1).filter(n=>n>=0);result.proposal.intents=keep.map(n=>evidence.proposal.intents[n]);result.proposal.legs=keep.map(n=>evidence.proposal.legs[n]);return reply(result);}
        return reply(url==='/api/solve/pool'?{...evidence,pool:{liveIntents:window.testWallet.solveCalls.at(-1).length,searchableIntents:window.testWallet.solveCalls.at(-1).length,excludedIntents:0},search:{termination:window.testWallet.budgetReached?'candidate-limit':'complete'}}:evidence);
      }
      if(url==='/api/rpc') {
        const body=JSON.parse(init.body);let result;
        if(body.method==='eth_call' && body.params[0].data.startsWith('${toFunctionSelector("ownerOf(uint256)")}')) result='0x'+(window.testWallet.staleOwner?'0x'+'3'.repeat(40):window.testWallet.account).slice(2).padStart(64,'0');
        else if(body.method==='eth_call' && location.search.includes('batch') && body.params[0].data.startsWith('${toFunctionSelector("depositor(uint256)")}'))result='0x'+market.tickets.find(t=>t.tokenId===BigInt('0x'+body.params[0].data.slice(10)).toString()).depositor.slice(2).padStart(64,'0');
        else if(body.method==='eth_call') result=location.search.includes('connected') && !window.testWallet.nftApproved && body.params[0].data.startsWith('${toFunctionSelector("isApprovedForAll(address,address)")}')?'0x'+'0'.repeat(64):outputs[body.params[0].data.slice(0,10)]??'0x';
        else if(body.method==='eth_chainId') result='0x4cef52';
        else if(body.method==='eth_getBalance') result='0xde0b6b3a7640000';
        else if(body.method==='eth_getBlockByNumber') result={number:'0x3a7653f',timestamp:'0x'+BigInt(window.testWallet.expiredRead?'1790050000':market.timestamp).toString(16),transactions:[]};
        else if(body.method==='eth_getTransactionReceipt')result={transactionHash:body.params[0],transactionIndex:'0x0',blockHash:'0x'+'aa'.repeat(32),blockNumber:'0x3a7653f',from:window.testWallet.account,to:'${escrow}',cumulativeGasUsed:'0x10000',gasUsed:'0x10000',effectiveGasPrice:'0x1',contractAddress:null,logs:[],logsBloom:'0x'+'00'.repeat(256),status:window.testWallet.revertSettlement?'0x0':'0x1',type:'0x2'};
        else throw Error('Unexpected RPC '+body.method);
        return reply({jsonrpc:'2.0',id:body.id,result});
      }
      return original(url,init);
    };
    const listeners=new Map();
    window.testWallet.changeAccount=account=>{window.testWallet.account=account;window.testWallet.connected=!!account;for(const handler of listeners.get('accountsChanged')??[])handler(account?[account]:[]);};
    window.ethereum={on(event,handler){if(!listeners.has(event))listeners.set(event,new Set());listeners.get(event).add(handler);},removeListener(event,handler){listeners.get(event)?.delete(handler);},async request({method,params}){
      const s=window.testWallet;s.calls.push(method);
      if(method==='eth_accounts'){if(s.failure)throw s.failure;return s.connected?[s.account]:[];}
      if(method==='eth_chainId')return s.chain;
      if(method==='wallet_revokePermissions'){s.revokeParams=params;if(s.revokeFailure)throw s.revokeFailure;s.connected=false;for(const handler of listeners.get('accountsChanged')??[])handler([]);return null;}
      if(method==='eth_requestAccounts'){if(s.cancel)throw {code:4001};s.connected=true;return ['${owner}'];}
      if(method==='wallet_switchEthereumChain'){s.chain=params[0].chainId;return null;}
      if(method==='wallet_watchAsset'){s.watches??=[];s.watches.push(params);if(s.watchUnsupported)throw {code:-32601,message:'NFT import unavailable'};return !s.watchDeclined;}
      if(method==='personal_sign'){if(s.cancel)throw {code:4001};return '0x'+'11'.repeat(65);}
      if(method==='eth_signTypedData_v4'){s.signed=JSON.parse(params[1]);if(s.completeCommit)return '0x'+'11'.repeat(65);throw Object.assign(Error('Test signature cancelled'),{code:4001});}
      if(method==='eth_sendTransaction'){
        if(s.completeSettlement){s.settlementTransaction=params[0];return receipt.hash;}
        if(location.search.includes('batch')){
          s.transactions??=[];s.transactions.push(params[0]);
          if(params[0].data.startsWith('${toFunctionSelector("setApprovalForAll(address,bool)")}')){if(s.cancelApproval)throw {code:4001};s.nftApproved=true;return '0x'+'dd'.repeat(32);}
          if(params[0].data.startsWith('${toFunctionSelector("deposit(uint256[])")}')){if(s.cancelDeposit)throw {code:4001};for(const word of params[0].data.slice(138).match(/.{64}/g))s.depositFixture(BigInt('0x'+word).toString());return '0x'+'ee'.repeat(32);}
          throw Error('Unexpected batch transaction');
        }
        if(s.completeCommit&&s.signed){const hash='0x'+'cc'.repeat(32);market.intents.push({...s.signed.message,eventId:Number(s.signed.message.eventId),exactCount:Number(s.signed.message.exactCount),hash,commitTx:'0x'+'bb'.repeat(32),state:1,expired:false});s.committedHash=hash;return '0x'+'bb'.repeat(32);}throw Object.assign(Error('Test transaction cancelled'),{code:4001});}
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
  const assert = async (expression, message) => { if (!await evaluate(expression)) throw Error(message); };
  const advance = async () => { await evaluate("document.querySelector('.step-continue').click()"); };
  const connectPositions=async()=>{if(await evaluate("!!document.querySelector('.connect-positions')")){await click('Connect wallet to see my tickets');await waitFor(`!document.querySelector('.connect-positions') && document.querySelector('.position')`);}};
  const offer = async () => { await advance(); await connectPositions(); await evaluate("document.querySelector('.position input').click()"); };
  await navigate();
  await assert("!document.querySelector('.intent-pool-dialog').open && !document.querySelector('.history').open && !!document.querySelector('.matching-panel .candidate')", 'Pool/history must start collapsed while the match stays visible');
  const callsBeforePool=await evaluate('window.testWallet.calls.length');
  await evaluate("document.querySelector('.pool-toggle').focus()");
  await click('Intent pool (');
  await waitFor(`document.querySelector('.intent-pool-dialog').open`);
  await assert("document.body.style.overflow==='hidden' && document.querySelector('.intent-pool-dialog').contains(document.activeElement) && document.querySelectorAll('.pool-row').length===3", 'Dialog must focus and display existing requests');
  await assert(`window.testWallet.calls.length===${callsBeforePool} && !document.querySelector('.wallet-details').open`, 'Browsing the pool prompted a wallet or exposed technical details upfront');
  const poolShot=await call('Page.captureScreenshot',{format:'png'});await writeFile('.tools/intent-pool-desktop.png',Buffer.from(poolShot.data,'base64'));
  for(const type of ['keyDown','keyUp'])await call('Input.dispatchKeyEvent',{type,key:'Escape',code:'Escape',windowsVirtualKeyCode:27});
  await waitFor(`!document.querySelector('.intent-pool-dialog').open && document.body.style.overflow!=='hidden'`);
  await assert("document.activeElement===document.querySelector('.pool-toggle')", 'Closing the dialog did not return focus to its button');
  console.log('PASS intent pool opens on demand without a wallet; Escape closes it and restores focus/scroll. History starts collapsed.');
  await evaluate("document.querySelectorAll('.matching-panel .search-details>summary').forEach(s=>s.click())");
  await waitFor(`Array.from(document.querySelectorAll('.matching-panel .search-details')).length===2 && Array.from(document.querySelectorAll('.matching-panel .search-details')).every(d=>d.open)`);
  await evaluate("window.testWallet.detailNodes=Array.from(document.querySelectorAll('.matching-panel .search-details'));window.testWallet.holdSolver=true");
  await click('Check all intents');
  await waitFor(`!!window.testWallet.releaseSolve && document.querySelector('.candidate')?.textContent.includes('Rechecking previous match')`);
  await assert("window.testWallet.detailNodes.every((node,n)=>node===document.querySelectorAll('.matching-panel .search-details')[n]&&node.open) && Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Propose and settle')).disabled", 'Refresh removed/collapsed the result or allowed settlement while checking');
  await evaluate('window.testWallet.releaseSolve()');
  await waitFor(`document.querySelector('.candidate')?.textContent.includes('Candidate found - awaiting settlement')`);
  await assert("window.testWallet.detailNodes.every(node=>node.isConnected&&node.open)", 'Manual check reset expanded details');
  await click('Intent pool (');await waitFor(`document.querySelector('.intent-pool-dialog').open`);
  await evaluate('window.testWallet.holdSolver=true;window.testWallet.poll()');
  await waitFor(`!!window.testWallet.releaseSolve`);
  await assert("document.querySelector('.intent-pool-dialog').open && window.testWallet.detailNodes.every(node=>node.isConnected&&node.open)", 'Automatic refresh closed the pool or details');
  await evaluate('window.testWallet.releaseSolve()');
  await waitFor(`document.querySelector('.candidate')?.textContent.includes('Candidate found - awaiting settlement')`);
  await evaluate("document.querySelector('[aria-label=\"Close intent pool\"]').click()");await waitFor(`!document.querySelector('.intent-pool-dialog').open`);
  await evaluate('window.testWallet.noMatch=true;window.testWallet.poll()');
  await waitFor(`!!document.querySelector('.matching-empty') && !document.querySelector('.candidate')`);
  await evaluate('window.testWallet.noMatch=false;window.testWallet.poll()');
  await waitFor(`!!document.querySelector('.candidate') && Array.from(document.querySelectorAll('.matching-panel .search-details')).every(d=>d.open)`);
  await evaluate("document.querySelectorAll('.matching-panel .search-details>summary').forEach(s=>s.click())");
  await waitFor(`Array.from(document.querySelectorAll('.matching-panel .search-details')).every(d=>!d.open)`);
  console.log('PASS manual/automatic searches preserve open details and popup, disable stale settlement during refresh and remove obsolete matches.');
  await assert("document.querySelectorAll('.step-content').length===1 && document.querySelector('.intent-step[data-step=\"1\"]').dataset.expanded==='true' && !document.querySelector('.position')", 'Wish must come first');
  await assert("document.querySelectorAll('[name=wanted-section]').length===4 && document.querySelectorAll('[name=wanted-section]:checked').length===1 && document.querySelectorAll('[name=wanted-session]:checked').length===1", 'Single selections or expanded sections missing');
  await assert("document.getElementById('valid-until').textContent==='2026-09-19 12:00 Malaysia (UTC+8)' && !document.querySelector('input[type=datetime-local]')", 'Fixed eight-hour cutoff missing');
  await evaluate("document.querySelector('[name=wanted-session][value=\"1\"]').click(); document.querySelector('[name=wanted-session][value=\"1\"]').click()");
  await assert("document.querySelectorAll('[name=wanted-session]:checked').length===1 && document.getElementById('valid-until').textContent.includes('2026-09-20 12:00')", 'Night change failed to update cutoff or deselected itself');
  await evaluate("document.querySelector('[name=wanted-session][value=\"0\"]').click(); document.querySelector('[name=wanted-section][value=\"3\"]').click(); document.querySelector('[name=wanted-section][value=\"3\"]').click()");
  await assert("document.querySelectorAll('[name=wanted-section]:checked').length===1 && document.querySelector('[name=wanted-section][value=\"3\"]').closest('label').textContent.includes('No tickets issued yet')", 'New section invents inventory or allows deselection');
  const wishClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
  const wishShot=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:wishClip});
  await writeFile('.tools/intent-wishlist-desktop.png',Buffer.from(wishShot.data,'base64'));
  await assert("!document.querySelector('.seat-map').open && !document.querySelector('.seat-map-content button,.seat-map-content input')", 'Map is not read-only');
  await assert("document.querySelectorAll('.illustration-seat').length===12", 'Missing adjacency illustration');
  const changeCount = async direction => evaluate(`document.querySelector('[aria-label="${direction} ticket count"]').click()`);
  await changeCount('Decrease');
  await assert("document.querySelector('.stepper output').textContent==='1' && !document.getElementById('adjacent-seats').checked && !document.querySelector('.adjacency-illustration')", 'One ticket must disable adjacency');
  for (const count of [2, 3, 4]) {
    await changeCount('Increase');
    await assert(`document.querySelector('.stepper output').textContent==='${count}' && document.getElementById('adjacent-seats').checked && !!document.querySelector('.adjacency-illustration')`, 'Increasing from one ticket must restore adjacency');
  }
  await evaluate("document.getElementById('adjacent-seats').click()");
  await changeCount('Decrease');
  await assert("!document.getElementById('adjacent-seats').checked && !document.querySelector('.adjacency-illustration')", 'Multi-ticket count change overwrites a manual opt-out');
  await changeCount('Decrease');await changeCount('Decrease');await changeCount('Increase');
  await assert("document.getElementById('adjacent-seats').checked && !!document.querySelector('.adjacency-illustration')", 'Repeated one-to-two transition fails to restore adjacency');
  const sectionOffered = section => `document.querySelector('[name="wanted-section"][value="${section}"]').closest('label').querySelector('.section-supply').dataset.offered`;
  await evaluate("document.querySelector('[name=wanted-session][value=\"0\"]').click()");
  await assert(`${sectionOffered(0)}==='2' && ${sectionOffered(1)}==='2' && ${sectionOffered(2)}==='0'`, 'Section supply includes merely issued/uncommitted tickets or wrong section');
  await evaluate("document.querySelector('[name=wanted-session][value=\"1\"]').click()");
  await assert(`${sectionOffered(0)}==='2' && ${sectionOffered(1)}==='0'`, 'Section supply did not follow the selected night');
  await evaluate('window.testWallet.setAllIntentStates(2);window.testWallet.poll()');
  await waitFor(`${sectionOffered(0)}==='0'`);
  await assert("document.querySelector('[name=wanted-section][value=\"0\"]').closest('label').textContent.includes('deposited /') && !document.querySelector('[name=wanted-section][value=\"2\"]').disabled", 'Revocation erased deposited inventory or disabled future wishlist sections');
  await evaluate('window.testWallet.setAllIntentStates(1);window.testWallet.poll()');
  await waitFor(`${sectionOffered(0)}==='2'`);
  await evaluate("document.querySelector('[name=wanted-session][value=\"0\"]').click()");
  console.log('PASS section cards show live offered supply by night/section and refresh after revocation; empty sections remain selectable.');
  console.log('PASS adjacency restores at two tickets and stays visible at three/four; manual opt-out remains available.');
  await evaluate("document.getElementById('adjacent-seats').click()");
  await assert("!document.querySelector('.adjacency-illustration')", 'Unchecked adjacency illustration visible');
  await evaluate("document.getElementById('adjacent-seats').click(); document.querySelector('[name=wanted-section][value=\"1\"]').click(); document.querySelector('.seat-map summary').click()");
  await assert("Array.from(document.querySelectorAll('.seat-map-content h3')).every(e=>e.textContent.endsWith('SECTION 1'))", 'Map ignores wishlist');
  await advance();
  await assert("document.querySelector('.sign-intent').disabled && !document.querySelector('.position') && !document.querySelector('.batch-deposit') && !!document.querySelector('.connect-positions')", 'Disconnected inventory exposes other wallets tickets');
  await assert("!window.testWallet.calls.includes('eth_requestAccounts')", 'Entering inventory prompts connection without a click');
  await connectPositions();
  await assert("document.querySelector('.sign-intent').disabled && document.querySelectorAll('.position').length>0 && !window.testWallet.calls.includes('eth_sendTransaction') && !window.testWallet.calls.includes('wallet_switchEthereumChain')", 'Viewing inventory deposited tickets or switched networks');
  await evaluate("document.querySelectorAll('.position input')[0].click(); document.querySelectorAll('.position input')[1].click()");
  await assert("document.querySelector('.budget-label').textContent==='I pay up to 1 USDC' && document.querySelector('.quote-lines').textContent.includes('3 USDC')", 'Two-ticket upgrade should suggest 1 USDC');
  const budgetKey = async key => {
    await evaluate("document.getElementById('net-budget').focus()");
    for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent',{type,key,code:key,windowsVirtualKeyCode:key==='Home'?36:35});
  };
  await assert("document.getElementById('net-budget').min==='-40' && document.getElementById('net-budget').max==='40'", 'Slider must span -40 to +40 USDC');
  await budgetKey('End');
  await assert("document.querySelector('.budget-label').textContent==='I pay up to 40 USDC'", 'Slider upper bound incorrect');
  await click('Use suggested limit');
  await assert("document.getElementById('net-budget').value==='1' && document.querySelector('.suggested-limit').textContent==='Suggested limit applied' && document.querySelector('.suggested-limit').disabled", 'Suggested limit must stay visible after restoring the quote');
  await budgetKey('End');
  await assert("document.querySelector('.suggested-limit').textContent==='Use suggested limit' && !document.querySelector('.suggested-limit').disabled", 'Adjusting the slider must re-enable the suggested-limit button');
  await assert("(()=>{const a=document.querySelector('.suggested-limit').getBoundingClientRect(),b=document.querySelector('.sign-intent').getBoundingClientRect();return b.left-a.right>=16 || b.top-a.bottom>=16;})()", 'Footer buttons lack spacing');
  const flowClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
  const desktopFlow=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:flowClip});
  await writeFile('.tools/intent-stepper-desktop.png',Buffer.from(desktopFlow.data,'base64'));
  await evaluate("document.getElementById('net-budget').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await waitFor(`document.querySelector('.budget-label').textContent.includes('must receive at least')`);
  await assert("document.querySelector('.signed-sentence').textContent.includes('sections 1;')", 'Review differs from wishlist');
  await assert("document.querySelectorAll('.intent-step').length===2 && document.querySelector('.step-marker').textContent==='step 2 of 2' && !!document.querySelector('.intent-step[data-step=\"2\"] .inline-intent-review .signed-sentence') && !document.querySelector('.step-continue')", 'Review must be inline in step two without another Continue');
  await evaluate("document.querySelector('[aria-label=\"Change What would you like instead?\"]').click()");
  await advance();
  await assert("document.getElementById('net-budget').value==='-40' && document.querySelectorAll('.position input:checked').length===2", 'Change lost the draft');
  await click('View signed struct'); await click('Sign and commit');
  await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  const signed=await evaluate('window.testWallet.signed');
  if(BigInt(signed.message.deadline)!==BigInt(Date.parse('2026-09-19T04:00:00Z')/1000)||BigInt(signed.message.sessionMask)!==1n||BigInt(signed.message.sectionMask)!==2n)throw Error('Signed selections or eight-hour cutoff differ from UI');
  if(Number(signed.domain.chainId)!==5042002||signed.message.owner.toLowerCase()!==owner.toLowerCase()||BigInt(signed.message.maxNetPay)!==-40000000n)throw Error('Wrong signed payload');
  await assert("JSON.stringify(JSON.parse(document.querySelector('.raw-struct').textContent).message).toLowerCase()===JSON.stringify(window.testWallet.signed.message).toLowerCase()", 'Review differs from wallet payload');
  console.log('PASS wish-first flow, section pricing, quote, manual budget, review equality and deferred signing.');
  await navigate();await offer();await evaluate('window.testWallet.expiredRead=true');await click('Sign and commit');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('closes eight hours')`);
  await assert("!window.testWallet.calls.includes('eth_signTypedData_v4') && !window.testWallet.calls.includes('eth_sendTransaction')", 'Expired draft reached signing or spending');
  console.log('PASS single night/section, four sections, signed cutoff and fresh-chain expiry protection.');
  for(const action of ['Deposit','Withdraw','Propose and settle']){
    await navigate(); if(action!=='Propose and settle'){await advance();await connectPositions();}
    await click(action); await waitFor(`window.testWallet.calls.includes('eth_sendTransaction')`);
    console.log('PASS '+action+' connects and continues; mock rejects transaction.');
  }
  await navigate();await offer();await evaluate('window.testWallet.cancel=true');await click('Sign and commit');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('cancelled')`);
  await assert("!window.testWallet.calls.includes('eth_sendTransaction')", 'Cancelled signature broadcast a transaction');
  await evaluate('window.testWallet.cancel=false');await click('Sign and commit');await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  await navigate();await evaluate('window.testWallet.failSolver=true');await click('Check all intents');
  await waitFor(`document.body.innerText.includes('Solver unreachable')`);
  await assert("!document.querySelector('.candidate') && !!document.querySelector('.seat-grid .seat')", 'Solver failure hides public reads or leaves stale candidate');
  await evaluate("document.querySelector('.history>summary').click();document.querySelector('.history-list button').click()");await waitFor(`!!document.querySelector('.receipt-section')`);
  await assert("document.querySelector('.receipt-section').innerText.includes('Submitted by a participant wallet')", 'False independent solver claim');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await click('Intent pool (');await waitFor(`document.querySelector('.intent-pool-dialog').open`);
  await assert("(()=>{const r=document.querySelector('.intent-pool-dialog').getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;})()", 'Pool dialog overflows the mobile viewport');
  const poolMobile=await call('Page.captureScreenshot',{format:'png'});await writeFile('.tools/intent-pool-mobile.png',Buffer.from(poolMobile.data,'base64'));
  await evaluate("document.querySelector('[aria-label=\"Close intent pool\"]').click()");await waitFor(`!document.querySelector('.intent-pool-dialog').open`);
  await assert("document.documentElement.scrollWidth<=window.innerWidth && document.querySelectorAll('[name=wanted-section]').length===4", 'Mobile wishlist overflows');
  const wishMobileClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:0,y:r.y+scrollY,width:390,height:r.height,scale:1};})()");
  const wishMobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:wishMobileClip});await writeFile('.tools/intent-wishlist-mobile.png',Buffer.from(wishMobile.data,'base64'));
  await advance(); await connectPositions(); await evaluate("document.querySelector('.position input').click()");
  await budgetKey('Home');
  await assert("document.querySelector('.sign-intent').getBoundingClientRect().top-document.querySelector('.suggested-limit').getBoundingClientRect().bottom>=16", 'Mobile footer buttons must stack with spacing');
  await assert("document.documentElement.scrollWidth<=window.innerWidth && !Array.from(document.querySelectorAll('.reshuffle-ui *')).some(e=>['auto','scroll'].includes(getComputedStyle(e).overflowY)&&e.scrollHeight>e.clientHeight)", 'Mobile overflow or nested scroll');
  const mobileClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:0,y:r.y+scrollY,width:390,height:r.height,scale:1};})()");
  const mobile=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:mobileClip});await writeFile('.tools/intent-stepper-mobile.png',Buffer.from(mobile.data,'base64'));
  console.log('PASS cancellation recovery, solver failure, receipt and mobile layout.');
  await call('Page.navigate',{url:base+'/?connected&emptyWallet'});
  await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');await advance();
  await waitFor(`document.querySelector('.step-content')?.innerText.includes('Approval does not create tickets')`);
  await assert("!Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Approve tickets')", 'Approval offered to empty wallet');
  await evaluate('window.testWallet.cancel=true'); await click('Get free tickets');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('cancelled')`);
  await assert("document.querySelectorAll('.position').length===0", 'Rejected claim added tickets');
  await evaluate('window.testWallet.cancel=false;window.testWallet.failDemo=true');await click('Get free tickets');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('issuer needs test USDC')`);
  await assert("document.querySelectorAll('.position').length===0", 'Failed mint added tickets');
  await evaluate('window.testWallet.failDemo=false;window.testWallet.watchUnsupported=true');await click('Get free tickets');
  await waitFor(`document.querySelector('.wallet-nft-import')?.textContent.includes('NFT import unavailable')`);
  await assert("document.querySelectorAll('.position').length===2 && !window.testWallet.calls.includes('eth_sendTransaction')", 'Mint/import incorrectly asks recipient to transact');
  await evaluate('window.testWallet.watchUnsupported=false');await click('Add to wallet');
  await waitFor(`document.querySelector('.wallet-nft-import')?.textContent.includes('accepted 2 NFT import requests')`);
  await assert("window.testWallet.watches.slice(-2).map(p=>p.options.tokenId).join(',')==='200,201' && window.testWallet.watches.every(p=>p.type==='ERC721'&&/^0x[0-9a-f]{40}$/i.test(p.options.address))", 'Wrong NFT import payload');
  await evaluate('window.testWallet.watchDeclined=true');await click('Add to wallet');
  await waitFor(`document.querySelector('.wallet-nft-import')?.textContent.includes('not confirmed')`);
  await assert("document.querySelectorAll('.position').length===2", 'Declining import removed issued tickets');
  await evaluate('window.testWallet.watchDeclined=false');await click('Get free tickets');
  await waitFor(`!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Get free tickets').disabled`);
  await assert("document.querySelectorAll('.position').length===2", 'Repeated claim minted duplicates');
  console.log('PASS free tickets: signature, issuer failure, automatic NFT import, unsupported/declined fallback, retry and repeat claim.');
  await call('Page.navigate',{url:base+'/?connected'});
  await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');await advance();
  await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent==='Approve tickets')`);
  for(const [failure,expected] of [[{code:-32002},'already pending'],[{code:-32603,message:'RPC endpoint unavailable'},'RPC endpoint unavailable'],[{code:4001},'cancelled']]){
    await evaluate(`window.testWallet.failure=${JSON.stringify(failure)}`);await click('Approve tickets');
    await waitFor(`document.querySelector('.activity')?.textContent.includes(${JSON.stringify(expected)})`);
    await assert("!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Approve tickets').disabled", 'Failure left approval stuck');
  }
  await call('Page.navigate',{url:base+'/?connected'});
  await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Match found - awaiting settlement'`);
  console.log('PASS personal candidate status after connecting.');
  await assert("!document.querySelector('.receipt-section') && !window.testWallet.calls.includes('eth_sendTransaction')", 'Candidate falsely marked settled or automatically broadcast');
  await evaluate('window.testWallet.noMatch=true;window.testWallet.poll()');
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Waiting for a match'`);
  await assert("!document.querySelector('.candidate') && !document.querySelector('.receipt-section')", 'No-match response retained success UI');
  console.log('PASS automatic no-match retry displays waiting.');
  await evaluate('window.testWallet.noMatch=false;window.testWallet.unrelated=true;window.testWallet.poll()');
  await waitFor(`!!document.querySelector('.candidate') && document.querySelector('.matching-status h2')?.textContent==='Waiting for a match'`);
  await evaluate('window.testWallet.unrelated=false;window.testWallet.badSimulation=true;window.testWallet.poll()');
  await waitFor(`document.querySelector('.candidate')?.textContent.includes('Candidate needs rechecking')`);
  await assert("document.querySelector('.matching-status h2').textContent==='Waiting for a match' && Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Propose and settle')).disabled", 'Failed simulation offered settlement');
  await evaluate('window.testWallet.badSimulation=false;window.testWallet.failSolver=true;window.testWallet.poll()');
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Matching temporarily unavailable'`);
  await evaluate('window.testWallet.failSolver=false;window.testWallet.poll()');
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Match found - awaiting settlement'`);
  await click('Intent pool (');await waitFor(`document.querySelector('.intent-pool-dialog').open`);
  await evaluate("document.querySelector('.pool-row input').click()");
  console.log('CHECK manual matching controls.');
  await assert("document.querySelector('.matching-status').textContent.includes('Automatic retries are paused')", 'Manual selection did not pause auto matching');
  await evaluate("Array.from(document.querySelectorAll('.pool-dialog-actions button')).find(b=>b.textContent==='Resume automatic matching').click()");
  await waitFor(`!document.querySelector('.intent-pool-dialog').open`);
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Match found - awaiting settlement'`);
  for(const [state,expired,title] of [[2,false,'Request revoked'],[1,true,'Request expired'],[3,false,'Swap confirmed']]){
    await evaluate(`window.testWallet.setRequestState(${state},${expired});window.testWallet.poll()`);
    await waitFor(`document.querySelector('.matching-status h2')?.textContent===${JSON.stringify(title)}`);
  }
  console.log('PASS automatic retries, personal match inclusion, no-match waiting, simulation failure, outage recovery and on-chain terminal states.');
  await call('Page.navigate',{url:base+'/?connected'});
  await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');
  await offer();
  await evaluate('window.testWallet.completeCommit=true;window.testWallet.noMatch=true');
  await click('Sign and commit');
  await waitFor(`window.testWallet.committedHash && window.testWallet.solveCalls.some(hashes=>hashes.includes(window.testWallet.committedHash)) && document.querySelector('.matching-status h2')?.textContent==='Waiting for a match'`);
  await assert("window.testWallet.solveCalls.at(-1).includes(window.testWallet.committedHash) && window.testWallet.poolCalls>0 && !document.querySelector('.receipt-section')", 'New committed request was not included in the automatic pool search');
  console.log('PASS confirmed intent submission automatically searches the new request without pool selection or another click.');
  const openBatch = async () => {
    await call('Page.navigate',{url:base+'/?connected&batch'});
    await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');await advance();
    await assert("document.querySelector('.batch-deposit button').disabled", 'Empty selection allows a deposit');
    await evaluate("document.querySelector('[aria-label=\"Offer ticket 101\"]').click();document.querySelector('[aria-label=\"Offer ticket 103\"]').click()");
    await assert("document.querySelector('.batch-deposit button').textContent==='Deposit 2 selected tickets' && document.querySelector('.sign-intent').disabled && document.querySelector('.inline-intent-review').textContent.includes('Deposit your selected tickets above before signing')", 'Batch count or signing custody gate incorrect');
  };
  await openBatch();
  await evaluate('window.testWallet.cancelApproval=true');await click('Deposit 2 selected tickets');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('cancelled') && !document.querySelector('.batch-deposit button').disabled`);
  await assert(`!window.testWallet.transactions.some(t=>t.data.startsWith('${toFunctionSelector('deposit(uint256[])')}'))`, 'Cancelled approval continued to deposit');
  await evaluate('window.testWallet.cancelApproval=false');await click('Deposit 2 selected tickets');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('Deposited 2 tickets together') && document.querySelector('.batch-deposit button').disabled`);
  await assert("!document.querySelector('.sign-intent').disabled && !!document.querySelector('.signed-sentence') && !document.querySelector('.step-continue')", 'Batch deposit did not enable inline signing');
  const transactions=await evaluate('window.testWallet.transactions');
  const deposits=transactions.filter(t=>t.data.startsWith(toFunctionSelector('deposit(uint256[])')));
  if(deposits.length!==1||decodeFunctionData({abi:abis.Escrow,data:deposits[0].data}).args[0].join(',')!=='101,103')throw Error('Batch did not send both selected IDs in one deposit');
  await assert("document.querySelectorAll('.position input:checked').length===2 && document.querySelector('.batch-deposit button').textContent==='Selected tickets deposited'", 'Deposit lost selection or did not refresh custody');
  await openBatch();
  await evaluate("window.testWallet.nftApproved=true;window.testWallet.depositFixture('103');window.testWallet.poll()");
  await waitFor(`document.querySelector('.batch-deposit button').textContent==='Deposit 1 selected ticket'`);
  await click('Deposit 1 selected ticket');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('Deposited 1 ticket together') && document.querySelector('.batch-deposit button').disabled`);
  const mixed=await evaluate('window.testWallet.transactions');
  if(mixed.length!==1||decodeFunctionData({abi:abis.Escrow,data:mixed[0].data}).args[0].join(',')!=='101')throw Error('Mixed selection re-deposited escrowed tickets or repeated approval');
  await openBatch();await evaluate('window.testWallet.staleOwner=true');await click('Deposit 2 selected tickets');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('no longer held by this wallet')`);
  await assert("!window.testWallet.calls.includes('eth_sendTransaction')", 'Changed owner still requested spending');
  console.log('PASS selected batch deposit: one transaction for two IDs, approval cancellation/retry, mixed custody, selection retention and fresh ownership checks.');
  await call('Page.navigate',{url:base+'/?largePool'});
  await waitFor(`document.querySelector('.poster-live')?.innerText.includes('6 live intents')`);await click('AFTER');
  await waitFor(`window.testWallet.poolCalls>0 && !!document.querySelector('.candidate')`);
  await assert("window.testWallet.solveCalls[0].length===6 && document.querySelectorAll('.pool-row input:checked').length===6 && Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Check all intents')&&!b.disabled)", 'Automatic matching still truncates or blocks pools larger than four');
  await evaluate('window.testWallet.budgetReached=true;window.testWallet.poll()');
  await waitFor(`document.body.innerText.includes('Search budget reached')`);
  await click('Propose and settle');
  await waitFor(`window.testWallet.calls.includes('eth_sendTransaction')`);
  await assert("window.testWallet.solveCalls.some(hashes=>hashes.length===3)", 'Settlement did not revalidate only the chosen candidate');
  await evaluate('window.testWallet.setRequestState(3);window.testWallet.poll()');
  await waitFor(`document.querySelector('.matching-status h2')?.textContent==='Swap confirmed' && window.testWallet.solveCalls.at(-1).length===5`);
  console.log('PASS six-intent pool automatically searched, budget reported, chosen three-intent settlement revalidated, and remaining pool continues after personal settlement.');
  const openSettlement = async (query='') => {
    await call('Page.navigate',{url:base+'/?connected&'+query});
    await waitFor(`document.querySelector('.poster-live')?.innerText.includes('3 live intents')`);await click('AFTER');
    await waitFor(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.includes('Propose and settle')&&!b.disabled)`);
    await evaluate('window.testWallet.completeSettlement=true');
  };
  const receivedIds=[...new Set(receipt.participants.filter(p=>p.owner.toLowerCase()===owner.toLowerCase()).flatMap(p=>p.receives))];
  await openSettlement();await click('Propose and settle');
  await waitFor(`document.querySelector('.swap-nft-import')?.textContent.includes('accepted ${receivedIds.length} NFT import')`);
  const imports=await evaluate('window.testWallet.watches');
  if(JSON.stringify(imports.map(p=>p.options.tokenId))!==JSON.stringify(receivedIds)||imports.some(p=>p.type!=='ERC721'||p.options.address.toLowerCase()!==record.proof.ticketNFT.toLowerCase()))throw Error('Settlement imported anything other than the receiving wallet replacement NFTs');
  await assert("document.querySelector('.receipt-section').textContent.includes('Settlement confirmed') && window.testWallet.calls.filter(m=>m==='eth_sendTransaction').length===1", 'NFT display triggered an extra transaction or lost confirmed settlement');
  await openSettlement();await evaluate('window.testWallet.watchDeclined=true');await click('Propose and settle');
  await waitFor(`document.querySelector('.swap-nft-import')?.textContent.includes('not confirmed')`);
  await waitFor(`!document.querySelector('.swap-nft-import button').disabled`);
  await assert("document.querySelector('.receipt-section').textContent.includes('Settlement confirmed')", 'Declined import erased successful swap');
  await evaluate("window.testWallet.watchDeclined=false;document.querySelector('.swap-nft-import button').click()");
  await waitFor(`document.querySelector('.swap-nft-import')?.textContent.includes('accepted ${receivedIds.length} NFT import')`);
  await openSettlement();await evaluate('window.testWallet.watchUnsupported=true');await click('Propose and settle');
  await waitFor(`document.querySelector('.swap-nft-import')?.textContent.includes('NFT import unavailable')`);
  await assert("document.querySelector('.receipt-section').textContent.includes('Settlement confirmed') && document.querySelector('.swap-nft-import').textContent.includes('NFT contract:')", 'Unsupported wallet hid successful swap/manual import details');
  await openSettlement('emptyWallet');await click('Propose and settle');
  await waitFor(`document.querySelector('.receipt-section') && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Propose and settle'))?.disabled`);
  await assert("!window.testWallet.calls.includes('wallet_watchAsset') && !document.querySelector('.swap-nft-import')", 'Independent proposer was asked to import another participant tickets');
  await openSettlement();await evaluate('window.testWallet.revertSettlement=true');await click('Propose and settle');
  await waitFor(`document.body.textContent.includes('SeatsNotAdjacent') && !Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('Propose and settle'))?.disabled`);
  await assert("!window.testWallet.calls.includes('wallet_watchAsset') && !document.querySelector('.receipt-section')", 'Reverted settlement imported tickets or showed success');
  await openSettlement();await evaluate('window.testWallet.staleOwner=true');await click('Propose and settle');
  await waitFor(`document.querySelector('.swap-nft-import')?.textContent.includes('no longer held')`);
  await assert("!window.testWallet.calls.includes('wallet_watchAsset')", 'Transferred-away replacement was still imported');
  await navigate();await offer();
  await evaluate("window.testWallet.changeAccount('0x1111111111111111111111111111111111111111')");
  await waitFor(`document.querySelector('.intent-step[data-step="2"][data-expanded=true]') && !document.querySelector('.position')`);
  await assert("document.querySelector('.sign-intent').disabled && !document.querySelector('.batch-deposit') && !document.querySelector('.quote-lines') && document.querySelector('.step-content').textContent.includes('no tickets')", 'Empty wallet retained another wallet selection, quote or deposit controls');
  await evaluate(`window.testWallet.changeAccount('${owner}')`);
  await waitFor(`!!document.querySelector('.position')`);
  await assert("document.querySelectorAll('.position input:checked').length===0 && document.querySelector('.sign-intent').disabled && document.querySelector('[name=wanted-section]')===null", 'Account change restored stale selected tickets or reset the current step');
  await evaluate('window.testWallet.changeAccount(null)');
  await waitFor(`!!document.querySelector('.connect-positions') && !document.querySelector('.position')`);
  console.log('PASS disconnected inventory stays private; explicit read-only connect shows own tickets; empty wallet/account changes/disconnect clear selections and deposit controls.');
  console.log('PASS confirmed swap imports only received NFTs; declined/unsupported imports retain success with retry; no imports for another proposer, reverted settlement or changed ownership.');
  await navigate();await offer();
  await evaluate("window.testWallet.revokeFailure={code:-32601,message:'Disconnect unavailable'}");await click('Start over');
  await waitFor(`document.querySelector('[role=alert]')?.textContent.includes('disconnect this site in MetaMask')`);
  await assert("!!document.querySelector('.signed-sentence') && !!document.querySelector('.wallet-meta')", 'Failed disconnect erased the draft or claimed a reset');
  await evaluate('window.testWallet.revokeFailure=null');
  const writesBeforeReset=await evaluate("window.testWallet.calls.filter(m=>['eth_sendTransaction','personal_sign','eth_signTypedData_v4'].includes(m)).length");
  await click('Start over');
  await waitFor(`document.getElementById('workspace')?.hidden && !document.querySelector('.wallet-meta') && document.querySelector('.poster-live')?.textContent.includes('3 live intents')`);
  await assert("JSON.stringify(window.testWallet.revokeParams)===JSON.stringify([{eth_accounts:{}}]) && !document.querySelector('.receipt-section') && !document.querySelector('.intent-pool-dialog').open", 'Start over failed to reset connection/receipt/popup');
  await assert(`window.testWallet.calls.filter(m=>['eth_sendTransaction','personal_sign','eth_signTypedData_v4'].includes(m)).length===${writesBeforeReset}`, 'Start over issued a signature or transaction');
  await click('AFTER');
  await assert("document.querySelector('.intent-step[data-step=\"1\"]').dataset.expanded==='true' && document.querySelector('.stepper output').textContent==='2'", 'Start over retained the old step or draft');
  await advance();
  await assert("!!document.querySelector('.connect-positions') && !document.querySelector('.position')", 'Reset automatically reconnected the wallet');
  await connectPositions();
  await assert("!!document.querySelector('.position') && !document.querySelector('.position input:checked')", 'Reconnect failed or restored previous offered tickets');
  console.log('PASS Start over disconnects the origin, resets local UI, retains public chain state and reconnects cleanly; unsupported disconnect preserves the draft with manual guidance.');
  if(errors.some(e=>/hydration|uncaught|TypeError/i.test(e)))throw Error(errors.join('\n'));
  console.log('PASS wallet errors and no hydration/runtime errors. Fixtures only; no real transactions sent.');
}finally{socket?.close();browser.kill();}
