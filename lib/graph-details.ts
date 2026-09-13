import { gql, SubgraphIndexingError, SubgraphLagError } from '@/shared/graph/client';
import { fromGraph, hashIntent, type GraphIntent } from '@/shared/intent';

export type GraphSelection = { kind: 'intent' | 'settlement'; hash: string; minBlock: string };
export type GraphDetail = {
  _meta: { deployment: string; hasIndexingErrors: boolean; block: { number: number; hash: string; timestamp: number } };
  intent?: (GraphIntent & { committedTx: string; state: string }) | null;
  settlements?: { id: string; txHash: string; participantCount: string; intents: { id: string }[] }[];
};
const meta = '_meta(block: $at) { deployment hasIndexingErrors block { number hash timestamp } }';
const intentQuery = `query IntentDetails($id: ID!, $at: Block_height!) {
  ${meta}
  intent(id: $id, block: $at) {
    id owner eventId offered sessionMask sectionMask exactCount
    mustShareSession mustShareSection mustBeAdjacent maxNetPay deadline nonce
    state committedTx committedAtBlock closedTx closedAtBlock
    settlement { id txHash blockNumber participantCount }
  }
}`;
const settlementQuery = `query SettlementDetails($hash: Bytes!, $at: Block_height!) {
  ${meta}
  settlements(first: 1000, where: { txHash: $hash }, block: $at) {
    id txHash proposer blockNumber timestamp participantCount intents(first: 1000) { id }
  }
}`;

export async function readGraphDetails(selection: GraphSelection, signal?: AbortSignal): Promise<GraphDetail> {
  if (!/^0x[0-9a-f]{64}$/i.test(selection.hash) || !/^\d+$/.test(selection.minBlock)
    || BigInt(selection.minBlock) > 2147483647n) throw new Error('Invalid Graph record or block.');
  const hash = selection.hash.toLowerCase();
  const result = await gql<GraphDetail>(selection.kind === 'intent' ? intentQuery : settlementQuery, {
    ...(selection.kind === 'intent' ? { id: hash } : { hash }), at: { number_gte: Number(selection.minBlock) },
  }, { signal, url: '/api/graph' });
  if (result._meta?.hasIndexingErrors) throw new SubgraphIndexingError();
  if (!Number.isSafeInteger(result._meta?.block.number) || !result._meta.deployment) throw new Error('Graph response is missing its source block.');
  if (BigInt(result._meta.block.number) < BigInt(selection.minBlock)) throw new SubgraphLagError('The Graph has not indexed this record’s block yet.', BigInt(result._meta.block.number));
  if (selection.kind === 'intent') {
    if (!result.intent) throw new Error('This intent was not found in the indexed subgraph.');
    if (result.intent.id.toLowerCase() !== hash || hashIntent(fromGraph(result.intent)).toLowerCase() !== hash) throw new Error('Indexed intent fields do not match the selected hash.');
  } else {
    if (!result.settlements?.length) throw new Error('This settlement was not found in the indexed subgraph.');
    if (result.settlements.length >= 1000 || result.settlements.some(row => row.txHash.toLowerCase() !== hash
      || row.intents.length >= 1000 || BigInt(row.participantCount) !== BigInt(row.intents.length))) throw new Error('Graph settlement details are incomplete or belong to another transaction.');
  }
  return result;
}

export function subgraphStudioLink(queryUrl: string): string | null {
  try {
    const url = new URL(queryUrl);
    const match = url.pathname.match(/^\/query\/\d+\/([a-z0-9-]+)\/[^/]+\/?$/i);
    return url.protocol === 'https:' && url.hostname === 'api.studio.thegraph.com' && match
      ? `https://thegraph.com/studio/subgraph/${match[1]}/` : null;
  } catch { return null; }
}

export const graphManifestLink = (cid: string) => /^[a-zA-Z0-9]+$/.test(cid) ? `https://ipfs.io/ipfs/${cid}` : null;
