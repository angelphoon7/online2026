import 'server-only';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWalletClient, defineChain, encodeFunctionData, http, keccak256, parseEventLogs, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import deployment from '@/deployments/arc-testnet.json';
import { abi, chainConfig } from './chain';

export class DemoTicketError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
type Mint = { raw: Hex; hash: Hex; tokenId?: string };
type Claim = { date: string; session: number; row: number; mints: Mint[] };
type Journal = { claims: Record<string, Claim> };
const directory = join(process.cwd(), '.data', 'demo-tickets');
const filename = join(directory, `${deployment.contracts.TicketNFT.toLowerCase()}.json`);
const network = defineChain({ id: 5042002, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpc] } } });

export function demoTicketConfig() {
  if (process.env.DEMO_TICKETS_ENABLED === 'false' || (process.env.NODE_ENV !== 'development' && process.env.DEMO_TICKETS_ENABLED !== 'true')) {
    throw new DemoTicketError('Demo tickets are disabled on this server. Enable DEMO_TICKETS_ENABLED with a funded testnet issuer.');
  }
  const key = process.env.DEMO_ISSUER_PRIVATE_KEY || process.env.PRIVATE_KEY;
  if (!key || !/^0x[\da-f]{64}$/i.test(key)) throw new DemoTicketError('The server needs its demo issuer key to issue tickets.');
  const config = chainConfig();
  if (config.addresses.TicketNFT.toLowerCase() !== deployment.contracts.TicketNFT.toLowerCase()) throw new DemoTicketError('Demo tickets are restricted to the configured Arc Testnet deployment.');
  return { ...config, account: privateKeyToAccount(key as Hex) };
}

export async function checkDemoIssuer() {
  const config = demoTicketConfig();
  if (await config.client.getChainId() !== network.id) throw new DemoTicketError('The demo issuer RPC must use Arc Testnet.');
  const registered = await config.client.readContract({ address: config.addresses.TicketNFT, abi: abi('TicketNFT'), functionName: 'registeredIssuers', args: [config.account.address] });
  if (!registered) throw new DemoTicketError('The configured server wallet is not a registered ticket issuer.');
  return config;
}

async function loadJournal(): Promise<Journal> {
  try { return JSON.parse(await readFile(filename, 'utf8')); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { claims: {} }; throw error; }
}
async function saveJournal(journal: Journal) {
  await writeFile(`${filename}.tmp`, JSON.stringify(journal), { mode: 0o600 });
  await rename(`${filename}.tmp`, filename);
}

export async function issueDemoTickets(recipient: Address) {
  const { client, account, addresses } = await checkDemoIssuer();
  await mkdir(directory, { recursive: true });
  // Serialize issuer nonces and claims across requests/workers sharing this disk.
  const lock = await open(join(directory, 'issuer.lock'), 'wx').catch(() => { throw new DemoTicketError('Another demo claim is being processed. Retry shortly.', 409); });
  try {
    const journal = await loadJournal();
    const key = recipient.toLowerCase();
    let claim = journal.claims[key];
    if (!claim) {
      const date = new Date().toISOString().slice(0, 10);
      if (Object.values(journal.claims).filter(c => c.date === date).length >= 20) throw new DemoTicketError('The demo ticket allowance for today has been used. Try tomorrow.', 429);
      const nextId = await client.readContract({ address: addresses.TicketNFT, abi: abi('TicketNFT'), functionName: 'nextTokenId' }) as bigint;
      if (nextId > 998n) throw new DemoTicketError('The demo ticket discovery limit has been reached.');
      claim = { date, session: Number(nextId / 2n % 2n), row: 1000 + Number(nextId), mints: [] };
      journal.claims[key] = claim;
      await saveJournal(journal);
    }
    const wallet = createWalletClient({ account, chain: network, transport: http(process.env.ARC_RPC!, { retryCount: 0 }) });
    for (let index = 0; index < 2; index++) {
      let mint = claim.mints[index];
      if (mint?.tokenId !== undefined) continue;
      if (!mint) {
        const args = [recipient, 1, claim.session, 0, claim.row, index + 1];
        await client.simulateContract({ account, address: addresses.TicketNFT, abi: abi('TicketNFT'), functionName: 'mint', args, gas: 1000000n });
        const request = await wallet.prepareTransactionRequest({ account, to: addresses.TicketNFT, data: encodeFunctionData({ abi: abi('TicketNFT'), functionName: 'mint', args }), gas: 1000000n });
        if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) > parseEther('0.1')) throw new DemoTicketError('The current mint gas fee exceeds the demo issuer limit. Retry later.');
        const raw = await wallet.signTransaction(request);
        mint = { raw, hash: keccak256(raw) };
        claim.mints[index] = mint;
        // Persist the signed transaction before broadcast. Retries send the same
        // bytes/nonce, including after a timeout or server restart, never a duplicate mint.
        await saveJournal(journal);
      }
      let receipt = await client.getTransactionReceipt({ hash: mint.hash }).catch(() => null);
      if (!receipt) {
        await client.sendRawTransaction({ serializedTransaction: mint.raw }).catch(() => {});
        receipt = await client.waitForTransactionReceipt({ hash: mint.hash, timeout: 45000 });
      }
      if (receipt.status !== 'success') throw new DemoTicketError('A demo mint reverted. Ask the demo operator to inspect its recorded transaction.');
      const events = parseEventLogs({ abi: abi('TicketNFT'), logs: receipt.logs, eventName: 'TicketMinted' });
      const event = events.find(e => e.address.toLowerCase() === addresses.TicketNFT.toLowerCase());
      const values = event?.args as { tokenId?: bigint; to?: string; eventId?: number; sessionId?: number; sectionId?: number; row?: number; seat?: number } | undefined;
      if (values?.to?.toLowerCase() !== key || values.eventId !== 1 || values.sessionId !== claim.session || values.sectionId !== 0 || values.row !== claim.row || values.seat !== index + 1 || values.tokenId === undefined) throw new DemoTicketError('The demo mint receipt could not be verified.');
      mint.tokenId = values.tokenId.toString();
      await saveJournal(journal);
    }
    return { tokenIds: claim.mints.map(m => m.tokenId!), hashes: claim.mints.map(m => m.hash) };
  } finally {
    await lock.close();
    await unlink(join(directory, 'issuer.lock'));
  }
}
