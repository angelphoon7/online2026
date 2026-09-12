// The single source of truth for deployed addresses, start blocks and the subgraph endpoint.
//
// Step 1 of docs/RESHUFFLE_GRAPH_PLAN.md calls for scripts/export-deployment.ts, which parses
// Foundry's broadcast/run-latest.json. That does not apply here: the Arc Testnet deployment was
// made by a custom script, not `forge script --broadcast`, so broadcast/ holds only the local
// 31337 run. deployments/<network>.json is already the record. See docs/graph-audit.txt, C6.
//
// The file keeps `contracts.<Name>` as a bare address string, because ~30 call sites across
// app/, server/ and scripts/ already read it that way. Per-contract start blocks are derived
// here from the `transactions` journal instead of being stored a second time — one fact, one
// place. Nothing downstream should read deployments/*.json directly.

import fs from 'node:fs';
import path from 'node:path';

export const CONTRACT_NAMES = ['TicketNFT', 'Escrow', 'IntentRegistry', 'Settlement'];

// lib/config.ts reads these names; scripts assert them against the deployment file.
export const ENV_BY_CONTRACT = {
  TicketNFT: 'NEXT_PUBLIC_TICKET_NFT',
  Escrow: 'NEXT_PUBLIC_ESCROW',
  IntentRegistry: 'NEXT_PUBLIC_INTENT_REGISTRY',
  Settlement: 'NEXT_PUBLIC_SETTLEMENT',
};

export const sameAddress = (a, b) =>
  typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();

/** Resolve which deployment to act on. DEPLOYMENT wins; arc-testnet is the demo default. */
export function deploymentName(explicit) {
  return explicit ?? process.env.DEPLOYMENT ?? 'arc-testnet';
}

/**
 * Load deployments/<network>.json and normalise it.
 *
 * Returns per-contract { address, startBlock, deployTx }. startBlock comes from the
 * `deploy:<Name>` entry in `transactions`; when that entry is absent the deployment-wide
 * startBlock is used, which only ever indexes from earlier, never later.
 */
export function loadDeployment(network = deploymentName()) {
  const file = path.join('deployments', `${network}.json`);
  if (!fs.existsSync(file)) throw new Error(`No deployment record at ${file}`);
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));

  if (!raw.chainId) throw new Error(`${file}: missing chainId`);
  const fallbackBlock = raw.startBlock;
  if (fallbackBlock === undefined) throw new Error(`${file}: missing startBlock`);

  const byLabel = new Map((raw.transactions ?? []).map((tx) => [tx.label, tx]));
  const contracts = {};
  for (const name of CONTRACT_NAMES) {
    const address = raw.contracts?.[name];
    if (!address) throw new Error(`${file}: missing contracts.${name}`);

    const tx = byLabel.get(`deploy:${name}`);
    if (tx && !sameAddress(tx.contractAddress, address)) {
      throw new Error(`${file}: deploy:${name} created ${tx.contractAddress}, not ${address}`);
    }
    contracts[name] = {
      address,
      startBlock: Number(tx?.blockNumber ?? fallbackBlock),
      deployTx: tx?.hash ?? null,
    };
  }

  // Earliest contract block: safe floor for any whole-deployment scan.
  const startBlock = Math.min(...CONTRACT_NAMES.map((n) => contracts[n].startBlock));

  return {
    network,
    file,
    chainId: Number(raw.chainId),
    rpc: raw.rpc ?? null,
    usdc: raw.usdc ?? null,
    deployer: raw.deployer ?? null,
    contracts,
    startBlock,
    // Filled in after `graph deploy` (step 3-G). Env overrides so a redeploy of the subgraph
    // does not require a commit.
    subgraphUrl: process.env.SUBGRAPH_URL || raw.subgraphUrl || '',
    seed: raw.seed ?? null,
    raw,
  };
}

/**
 * The EIP-712 domain. Derived, never hand-written: the domain binds signatures to this
 * chainId and this IntentRegistry, so a redeploy or a chain change invalidates every
 * committed intent. See AGENTS.md.
 */
export function eip712Domain(deployment) {
  return {
    name: 'RESHUFFLE',
    version: '1',
    chainId: deployment.chainId,
    verifyingContract: deployment.contracts.IntentRegistry.address,
  };
}

export const addressOf = (deployment, name) => deployment.contracts[name].address;
