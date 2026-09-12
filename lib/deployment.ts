// The frontend's view of deployments/<network>.json — step 1-B of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Addresses used to arrive as NEXT_PUBLIC_* environment variables, which meant the deployment
// record and the running app were two separate copies of the same facts. They can disagree,
// and the disagreement is quiet: the EIP-712 domain contains verifyingContract, so a stale
// registry address does not throw — it produces signatures that do not recover to the owner,
// which reads like a wallet bug. The record is now the only source.
//
// Records are imported statically, not by computed path, because the client bundle is built
// ahead of time. Adding a network means adding it to DEPLOYMENTS below.
//
// These imports are the generated browser-facing slices, not the full records: the full
// deployments/<network>.json also carries the deploy journal and demo seed data — about 12 KB
// the browser has no use for — and JSON modules are NOT tree-shaken, not even through named
// imports (verified by grepping .next/static for a seed account address after a build).
// Regenerate with `npm run deployment:public`; the check script fails if they drift.
import arcTestnet from '@/deployments/public/arc-testnet.json';
import local from '@/deployments/public/local.json';

export type ContractName = 'TicketNFT' | 'Escrow' | 'IntentRegistry' | 'Settlement';

type DeploymentRecord = {
  network: string;
  chainId: number;
  rpc: string;
  subgraphUrl: string;
  usdc: string;
  contracts: Record<ContractName, string>;
  startBlock: string;
};

const DEPLOYMENTS: Record<string, DeploymentRecord> = {
  'arc-testnet': arcTestnet as DeploymentRecord,
  local: local as DeploymentRecord,
};

// Next.js inlines this at build time; it cannot be read from a variable.
const selected = process.env.NEXT_PUBLIC_DEPLOYMENT ?? 'arc-testnet';

const record = DEPLOYMENTS[selected];
if (!record) {
  throw new Error(
    `Unknown NEXT_PUBLIC_DEPLOYMENT "${selected}". Known: ${Object.keys(DEPLOYMENTS).join(', ')}`
  );
}

const address = (name: ContractName) => record.contracts[name].toLowerCase() as `0x${string}`;

/** Earliest block worth scanning for this deployment's events. */
export const DEPLOYMENT_BLOCK = BigInt(record.startBlock);

export const DEPLOYMENT = {
  network: record.network,
  chainId: record.chainId,
  rpc: record.rpc,
  subgraphUrl: record.subgraphUrl,
  startBlock: DEPLOYMENT_BLOCK,
  ticketNFT: address('TicketNFT'),
  escrow: address('Escrow'),
  intentRegistry: address('IntentRegistry'),
  settlement: address('Settlement'),
  usdc: record.usdc.toLowerCase() as `0x${string}`,
} as const;
