import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createWalletClient, defineChain, encodeFunctionData, http, parseEventLogs, parseEther, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import deployment from '@/deployments/arc-testnet.json';
import { abi, chainConfig } from './chain';
import { consumeQuota, storageMode } from './durable-store';
import { signingJob } from './signing-job';

export class DemoTicketError extends Error {
  status: number;
  constructor(message: string, status = 503) { super(message); this.status = status; }
}
type Mint = { raw: Hex; hash: Hex; tokenId?: string };
type Claim = { date: string; session: number; row: number; mints: Mint[] };
type Journal = { claims: Record<string, Claim> };
const directory = join(process.cwd(), '.data', 'demo-tickets');
const filename = join(directory, `${deployment.contracts.TicketNFT.toLowerCase()}.json`);
const network = defineChain({ id: deployment.chainId, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [deployment.rpc] } } });

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
export async function issueDemoTickets(recipient: Address) {
  const { client, account, addresses } = await checkDemoIssuer();
  const key = recipient.toLowerCase();
  const id = `claim:${addresses.TicketNFT.toLowerCase()}:${key}`;
  return signingJob<Claim, { tokenIds: string[]; hashes: Hex[] }>(`${network.id}:${account.address}`, id, async () => {
    // Local claims made before shared storage remain resumable, including signed pending mints.
    const legacy = storageMode() === 'file' ? await loadJournal() : { claims: {} };
    const old = legacy.claims[key];
    if (old) return old;
    const nextId = await client.readContract({ address: addresses.TicketNFT, abi: abi('TicketNFT'), functionName: 'nextTokenId' }) as bigint;
    if (nextId > 998n) throw new DemoTicketError('The demo ticket discovery limit has been reached.');
    const date = new Date().toISOString().slice(0, 10);
    const legacyToday = Object.values(legacy.claims).filter(c => c.date === date).length;
    if (!await consumeQuota(`claims:${addresses.TicketNFT.toLowerCase()}`, Math.max(0, 20 - legacyToday), 86_400_000)) throw new DemoTicketError('The demo ticket allowance for today has been used. Try tomorrow.', 429);
    return { date, session: Number(nextId / 2n % 2n), row: 1000 + Number(nextId), mints: [] };
  }, async (claim, transaction) => {
    const wallet = createWalletClient({ account, chain: network, transport: http(process.env.ARC_RPC!, { retryCount: 0 }) });
    const tokenIds: string[] = [], hashes: Hex[] = [];
    for (let index = 0; index < 2; index++) {
      const receipt = await transaction(`mint-${index}`, {
        prepare: async () => {
        if (claim.mints[index]) return claim.mints[index].raw;
        const args = [recipient, 1, claim.session, 0, claim.row, index + 1];
        await client.simulateContract({ account, address: addresses.TicketNFT, abi: abi('TicketNFT'), functionName: 'mint', args, gas: 1000000n });
        const request = await wallet.prepareTransactionRequest({ account, to: addresses.TicketNFT, data: encodeFunctionData({ abi: abi('TicketNFT'), functionName: 'mint', args }), gas: 1000000n });
        if (request.gas * (request.maxFeePerGas ?? request.gasPrice ?? 0n) > parseEther('0.1')) throw new DemoTicketError('The current mint gas fee exceeds the demo issuer limit. Retry later.');
        return wallet.signTransaction(request);
        },
        receipt: hash => client.getTransactionReceipt({ hash }).catch(() => null),
        broadcast: raw => client.sendRawTransaction({ serializedTransaction: raw }),
        wait: hash => client.waitForTransactionReceipt({ hash, timeout: 40_000 }),
      });
      const events = parseEventLogs({ abi: abi('TicketNFT'), logs: receipt.logs, eventName: 'TicketMinted' });
      const event = events.find(e => e.address.toLowerCase() === addresses.TicketNFT.toLowerCase());
      const values = event?.args as { tokenId?: bigint; to?: string; eventId?: number; sessionId?: number; sectionId?: number; row?: number; seat?: number } | undefined;
      if (values?.to?.toLowerCase() !== key || values.eventId !== 1 || values.sessionId !== claim.session || values.sectionId !== 0 || values.row !== claim.row || values.seat !== index + 1 || values.tokenId === undefined) throw new DemoTicketError('The demo mint receipt could not be verified.');
      tokenIds.push(values.tokenId.toString()); hashes.push(receipt.transactionHash);
    }
    return { tokenIds, hashes };
  });
}
