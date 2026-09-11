import type { SettlementProposal } from './solve-api';

export function settlementShape(proposal: SettlementProposal): string {
  const owners = [...new Set(proposal.intents.map(i => i.owner.toLowerCase()))];
  const source = new Map(proposal.intents.flatMap(i => i.offered.map(id => [String(id), i.owner.toLowerCase()] as const)));
  const edges = new Map(owners.map(owner => [owner, new Set<string>()]));
  for (const leg of proposal.legs) for (const id of leg.receives) {
    const from = source.get(String(id));
    const to = leg.owner.toLowerCase();
    if (from && from !== to) edges.get(from)?.add(to);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const cycle = (owner: string): boolean => {
    if (visiting.has(owner)) return true;
    if (visited.has(owner)) return false;
    visiting.add(owner);
    for (const next of edges.get(owner) ?? []) if (cycle(next)) return true;
    visiting.delete(owner); visited.add(owner); return false;
  };
  const hasCycle = owners.some(cycle);
  const reached = new Set<string>();
  let cursor: string | undefined = owners[0];
  while (cursor && !reached.has(cursor)) { reached.add(cursor); cursor = [...(edges.get(cursor) ?? [])][0]; }
  if (hasCycle && reached.size === owners.length && owners.every(o => edges.get(o)?.size === 1)) return `${owners.length}-party cycle`;
  if (!hasCycle && proposal.intents.some(i => i.offered.length === 0) && proposal.intents.some(i => i.exactCount === 0)) return 'Open chain — no cycle';
  return `${owners.length}-party reshuffle`;
}
