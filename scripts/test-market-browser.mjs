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
  outputs[toFunctionSelector('allowance(address,address)')]='0x'+(100000000000n).toString(16).padStart(64,'0');
  const receipt={hash:record.proof.transactionHash,blockNumber:record.proof.blockNumber,status:'success',proposer:evidence.proposal.intents[0].owner,independent:false,ticketTransfers:6,usdcTransfers:2,netSum:'0',rejection:null,participants:evidence.proposal.intents.map((i,n)=>({owner:i.owner,offered:i.offered,receives:evidence.proposal.legs[n].receives,netPayment:evidence.proposal.legs[n].netPayment}))};
  await call('Page.addScriptToEvaluateOnNewDocument',{source:`
    const market=${JSON.stringify(market)},evidence=${JSON.stringify(evidence)},outputs=${JSON.stringify(outputs)},receipt=${JSON.stringify(receipt)};
    window.testWallet={calls:[],connected:location.search.includes('connected'),account:location.search.includes('emptyWallet')?'0x1111111111111111111111111111111111111111':'${owner}',chain:'0x1',cancel:false,failSolver:false,marketReads:0};
    const original=window.fetch.bind(window);
    window.fetch=async(url,init)=>{
      const reply=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
      if(String(url).startsWith('/api/market/receipt')) return reply(receipt);
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
      if(url==='/api/solve') return window.testWallet.failSolver?reply({error:'Offline'},503):reply(evidence);
      if(url==='/api/rpc') {
        const body=JSON.parse(init.body);let result;
        if(body.method==='eth_call' && body.params[0].data.startsWith('${toFunctionSelector("ownerOf(uint256)")}')) result='0x'+window.testWallet.account.slice(2).padStart(64,'0');
        else if(body.method==='eth_call') result=location.search.includes('connected') && body.params[0].data.startsWith('${toFunctionSelector("isApprovedForAll(address,address)")}')?'0x'+'0'.repeat(64):outputs[body.params[0].data.slice(0,10)]??'0x';
        else if(body.method==='eth_chainId') result='0x4cef52';
        else if(body.method==='eth_getBalance') result='0xde0b6b3a7640000';
        else throw Error('Unexpected RPC '+body.method);
        return reply({jsonrpc:'2.0',id:body.id,result});
      }
      return original(url,init);
    };
    window.ethereum={on(){},removeListener(){},async request({method,params}){
      const s=window.testWallet;s.calls.push(method);
      if(method==='eth_accounts'){if(s.failure)throw s.failure;return s.connected?[s.account]:[];}
      if(method==='eth_chainId')return s.chain;
      if(method==='eth_requestAccounts'){if(s.cancel)throw {code:4001};s.connected=true;return ['${owner}'];}
      if(method==='wallet_switchEthereumChain'){s.chain=params[0].chainId;return null;}
      if(method==='wallet_watchAsset'){s.watches??=[];s.watches.push(params);if(s.watchUnsupported)throw {code:-32601,message:'NFT import unavailable'};return !s.watchDeclined;}
      if(method==='personal_sign'){if(s.cancel)throw {code:4001};return '0x'+'11'.repeat(65);}
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
  const assert = async (expression, message) => { if (!await evaluate(expression)) throw Error(message); };
  const advance = async () => { await evaluate("document.querySelector('.step-continue').click()"); };
  const offer = async () => { await advance(); await evaluate("document.querySelector('.position input').click()"); };
  await navigate();
  await assert("document.querySelectorAll('.step-content').length===1 && document.querySelector('.intent-step[data-step=\"1\"]').dataset.expanded==='true' && !document.querySelector('.position')", 'Wish must come first');
  await assert("document.querySelectorAll('[aria-labelledby=sections-label] button').length===2", 'Duplicate sections or phantom class');
  await assert("!document.querySelector('.seat-map').open && !document.querySelector('.seat-map-content button,.seat-map-content input')", 'Map is not read-only');
  await assert("document.querySelectorAll('.illustration-seat').length===12", 'Missing adjacency illustration');
  await evaluate("document.getElementById('adjacent-seats').click()");
  await assert("!document.querySelector('.adjacency-illustration')", 'Unchecked adjacency illustration visible');
  await evaluate("document.getElementById('adjacent-seats').click(); document.querySelector('[aria-labelledby=sections-label] button').click(); document.querySelector('.seat-map summary').click()");
  await assert("Array.from(document.querySelectorAll('.seat-map-content h3')).every(e=>e.textContent.endsWith('SECTION 1'))", 'Map ignores wishlist');
  await advance();
  await assert("document.querySelector('.step-continue').disabled && document.querySelectorAll('.position-list .position').length===8 && document.querySelector('.more-tickets summary').textContent==='+2 more'", 'Offering gate or ticket disclosure missing');
  await evaluate("document.querySelectorAll('.position input')[0].click(); document.querySelectorAll('.position input')[1].click()");
  await assert("document.querySelector('.budget-label').textContent==='I pay up to 1 USDC' && document.querySelector('.quote-lines').textContent.includes('3 USDC')", 'Two-ticket upgrade should suggest 1 USDC');
  const flowClip=await evaluate("(()=>{const r=document.querySelector('.intent-flow').getBoundingClientRect();return {x:r.x,y:r.y+scrollY,width:r.width,height:r.height,scale:1};})()");
  const desktopFlow=await call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true,clip:flowClip});
  await writeFile('.tools/intent-stepper-desktop.png',Buffer.from(desktopFlow.data,'base64'));
  await evaluate("document.getElementById('net-budget').focus()");
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Home',code:'Home',windowsVirtualKeyCode:36});
  await waitFor(`document.querySelector('.budget-label').textContent.includes('must receive at least')`);
  await advance();
  await assert("document.querySelector('.signed-sentence').textContent.includes('sections 1;')", 'Review differs from wishlist');
  await evaluate("document.querySelector('.intent-step[data-step=\"2\"] button').click()");
  await assert("document.getElementById('net-budget').value==='-1000' && document.querySelectorAll('.position input:checked').length===2", 'Change lost the draft');
  await advance(); await click('View signed struct'); await click('Sign and commit');
  await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  const signed=await evaluate('window.testWallet.signed');
  if(Number(signed.domain.chainId)!==5042002||signed.message.owner.toLowerCase()!==owner.toLowerCase()||BigInt(signed.message.maxNetPay)!==-1000000000n)throw Error('Wrong signed payload');
  await assert("JSON.stringify(JSON.parse(document.querySelector('.raw-struct').textContent).message).toLowerCase()===JSON.stringify(window.testWallet.signed.message).toLowerCase()", 'Review differs from wallet payload');
  console.log('PASS wish-first flow, section pricing, quote, manual budget, review equality and deferred signing.');
  for(const action of ['Deposit','Withdraw','Propose and settle']){
    await navigate(); if(action!=='Propose and settle')await advance();
    await click(action); await waitFor(`window.testWallet.calls.includes('eth_sendTransaction')`);
    console.log('PASS '+action+' connects and continues; mock rejects transaction.');
  }
  await navigate();await offer();await advance();await evaluate('window.testWallet.cancel=true');await click('Sign and commit');
  await waitFor(`document.querySelector('.activity')?.textContent.includes('cancelled')`);
  await assert("!window.testWallet.calls.includes('eth_signTypedData_v4')", 'Signed after rejected connection');
  await evaluate('window.testWallet.cancel=false');await click('Sign and commit');await waitFor(`window.testWallet.calls.includes('eth_signTypedData_v4')`);
  await navigate();await evaluate('window.testWallet.failSolver=true');await click('Run solver');
  await waitFor(`document.body.innerText.includes('Solver unreachable')`);
  await assert("!document.querySelector('.candidate') && !!document.querySelector('.seat-grid .seat')", 'Solver failure hides public reads or leaves stale candidate');
  await evaluate("document.querySelector('.history-list button').click()");await waitFor(`!!document.querySelector('.receipt-section')`);
  await assert("document.querySelector('.receipt-section').innerText.includes('Submitted by a participant wallet')", 'False independent solver claim');
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
  await advance(); await evaluate("document.querySelector('.position input').click()");
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
  if(errors.some(e=>/hydration|uncaught|TypeError/i.test(e)))throw Error(errors.join('\n'));
  console.log('PASS wallet errors and no hydration/runtime errors. Fixtures only; no real transactions sent.');
}finally{socket?.close();browser.kill();}
