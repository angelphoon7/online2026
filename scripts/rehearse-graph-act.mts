// Pre-recording rehearsal for the Graph/Agent beat - step 10-A of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// Run with:  npx --yes tsx --conditions=react-server scripts/rehearse-graph-act.mts
//
// "Preloaded initial data is fine. Preloaded outcomes are not." This script never writes. It
// reads the live pool and asks whether the beat will actually land: is there an intent that
// settles NOW, and is there a budget it could be changed to that stops it from settling?
// Both answers come from the deterministic engine the agent itself uses, so a rehearsal that
// passes is the same computation the recording performs live.
//
// It does not broadcast the budget change. The candidate budgets are evaluated as
// hypotheticals - read-only and reversible - and the real revoke+commit happens on camera.
//
// The beat it looks for is a credit floor, not a debit ceiling. Every seeded intent in this
// pool settles at zero payment, so lowering a ceiling changes nothing; what bites is a
// participant demanding to be PAID more than anyone else in the pool has signed up to pay.

import { loadEnvFile } from 'node:process';
import fs from 'node:fs';

if (fs.existsSync('.env')) loadEnvFile('.env');
if (fs.existsSync('.env.local')) loadEnvFile('.env.local');

const { getPoolSnapshot } = await import('../shared/graph/index.js');
const { diagnose } = await import('../server/agent/diagnose.js');
const { solveHypothetical, readCapacity } = await import('../server/solve-hypothetical.js');
const { participantKeys } = await import('../server/judge-budget.js');
const { renderEvidence } = await import('../server/agent/template.js');

/** Credit floors to try, in USDC. The first one that stops the settlement is the beat. */
const FLOORS = [-1, -2, -3, -4, -5, -8, -12];
/** Calibrating every intent would take minutes; a handful is enough to choose one. */
const CALIBRATE = Number(process.env.REHEARSE_CALIBRATE ?? '5');

const usdc = (units: string | bigint | null) => (units === null ? 'n/a' : (Number(units) / 1e6).toFixed(2));

const snapshot = await getPoolSnapshot();
const held = participantKeys();

console.log(`pool source: subgraph @ block ${snapshot.block}`);
console.log(`  ${snapshot.intents.length} live intents, ${snapshot.ticketMeta.size} escrowed unredeemed tickets`);
console.log(`  ${snapshot.excluded.length} excluded, ${held.size} participant keys held by this operator`);

// Only intents this operator can change are demo candidates: the budget control is
// revoke()+commit() signed by the owner, and an intent whose key we do not hold cannot move.
const candidates = snapshot.intents.filter((i) => held.has(i.owner.toLowerCase() as `0x${string}`));
console.log(`  ${candidates.length} changeable from the judge controls`);

// What the pool is willing to pay bounds what any participant can demand. This is the number
// the beat turns on, and it comes from the signed intents, not from a guess.
const ceilings = snapshot.intents.map((i) => i.maxNetPay).filter((p) => p > 0n);
const deepest = ceilings.length ? ceilings.reduce((a, b) => (a > b ? a : b)) : 0n;
console.log(`  deepest signed willingness to pay in the pool: ${usdc(deepest)} USDC\n`);

const funds = await readCapacity(snapshot.intents.map((i) => i.owner));

type Beat = { hash: `0x${string}`; owner: string; settlesAt: number | null; breaksAt: number; participants: number | null };
const settleable: { hash: `0x${string}`; owner: string; participants: number | null; pays: string }[] = [];
let notFound = 0;
let excludedOrClosed = 0;

for (const intent of candidates) {
  const evidence = await diagnose(snapshot, intent.hash, funds);
  if (evidence.status === 'SETTLEABLE') {
    settleable.push({
      hash: intent.hash,
      owner: intent.owner,
      participants: evidence.settleable!.participantCount,
      pays: usdc(evidence.settleable!.targetNetPay),
    });
  } else if (evidence.status === 'NOT_FOUND_WITHIN_BOUND') notFound++;
  else excludedOrClosed++;
}

console.log(`status of the changeable intents at this block:`);
console.log(`  SETTLEABLE ${settleable.length} · NOT_FOUND_WITHIN_BOUND ${notFound} · excluded or closed ${excludedOrClosed}\n`);

if (!settleable.length) {
  console.log('Nothing settles at this block, so there is no beat to break. Re-seed the pool.');
  process.exit(1);
}

// Calibrate: walk the floors until the settlement disappears. The last floor that still
// settles and the first that does not are both stated in the run of show, so a judge can move
// the control either way and watch the answer follow.
console.log(`calibrating the credit floor on ${Math.min(CALIBRATE, settleable.length)} settleable intent(s):`);
const beats: Beat[] = [];
for (const s of settleable.slice(0, CALIBRATE)) {
  const intent = snapshot.intents.find((i) => i.hash === s.hash)!;
  let settlesAt: number | null = null;
  let breaksAt: number | null = null;
  for (const floor of FLOORS) {
    const result = await solveHypothetical(
      snapshot,
      { replaceHash: s.hash, intent: { ...intent, maxNetPay: BigInt(Math.round(floor * 1e6)) } },
      funds
    );
    if (result.found) settlesAt = floor;
    else { breaksAt = floor; break; }
  }
  console.log(
    `  ${s.hash.slice(0, 10)}...  settles now (${s.participants} participants, pays ${s.pays} USDC)` +
    `  ·  deepest floor that still settles: ${settlesAt === null ? 'none tried' : settlesAt + ' USDC'}` +
    `  ·  breaks at: ${breaksAt === null ? 'not within the floors tried' : breaksAt + ' USDC'}`
  );
  if (breaksAt !== null) beats.push({ hash: s.hash, owner: s.owner, settlesAt, breaksAt, participants: s.participants });
}

if (!beats.length) {
  console.log('\nNo intent stops settling within the floors tried. Do not record the budget beat:');
  console.log('a control that changes nothing on screen is worse than no control.');
  process.exit(1);
}

const pick = beats[0];
const before = await diagnose(snapshot, pick.hash, funds);
console.log(`\nsuggested demo intent  ${pick.hash}`);
console.log(`  owner        ${pick.owner}`);
console.log(`  status now   ${before.status}  (${pick.participants} participants)`);
console.log(`  sentence now ${renderEvidence(before)}`);
console.log(`\n  Beat: Apply budget -> ${pick.breaksAt} USDC (a credit floor: "pay me at least ${-pick.breaksAt}").`);
console.log(`  That is deeper than the ${usdc(deepest)} USDC anyone in this pool signed up to pay, so the`);
console.log(`  rehearsed prediction after indexing is NOT_FOUND_WITHIN_BOUND.`);
console.log(`  To bring it back on camera, set the floor to ${pick.settlesAt} USDC, which still settles.`);
console.log(`\n  The budget change is a real revoke + commit, so the hash changes. Point the drawer at`);
console.log(`  the newHash the control returns, not at the hash above.`);
process.exit(0);
