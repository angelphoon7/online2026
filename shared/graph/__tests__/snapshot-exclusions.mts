import { getPoolSnapshot } from '../snapshot';
import { hashIntent } from '../../intent';

const OWNER = '0xa8dae73bde3a5c0e412884c9be2039a79dfb31fd';
const OTHER = '0x8c3345e88cb68f16dc31f88ee21b2032a5250e90';
const NOW = 1789173368n;

function makeIntent(over: Record<string, unknown> = {}) {
  const base = {
    owner: OWNER, offered: ['1', '2'], eventId: 1,
    sessionMask: '2', sectionMask: '1', exactCount: 2,
    mustShareSession: true, mustShareSection: true, mustBeAdjacent: true,
    maxNetPay: '100000', deadline: String(NOW + 10000n), nonce: '7',
    ...over,
  };
  const id = hashIntent({
    owner: base.owner as `0x${string}`, offered: base.offered.map(BigInt), eventId: Number(base.eventId),
    sessionMask: BigInt(base.sessionMask), sectionMask: BigInt(base.sectionMask), exactCount: Number(base.exactCount),
    mustShareSession: base.mustShareSession, mustShareSection: base.mustShareSection,
    mustBeAdjacent: base.mustBeAdjacent, maxNetPay: BigInt(base.maxNetPay),
    deadline: BigInt(base.deadline), nonce: BigInt(base.nonce),
  });
  return { ...base, id, committedAtBlock: '100', committedTx: '0xtx' };
}

const ticket = (id: string, over = {}) => ({ id, escrowed: true, depositor: OWNER, redeemed: false, ...over });
const universe = (over = {}) => ['1','2'].map(id => ({ id, eventId: 1, sessionId: 1, sectionId: 0, row: 1, seat: Number(id), depositor: OWNER, redeemed: false, ...over }));

async function run(label: string, intent: any, offeredTickets: any[], tickets = universe()) {
  globalThis.fetch = (async () => new Response(JSON.stringify({ data: {
    _meta: { block: { number: 999, timestamp: String(NOW) }, hasIndexingErrors: false, deployment: 'Qm' },
    intents: [{ ...intent, offeredTickets }],
    tickets,
  }}), { headers: { 'content-type': 'application/json' } })) as any;
  const snap = await getPoolSnapshot({ url: 'http://stub' } as any);
  const got = snap.excluded[0];
  console.log(`  ${label.padEnd(34)} kept=${snap.intents.length} excluded=${got ? got.reason : '-'}${got?.detail ? '  [' + got.detail + ']' : ''}`);
}

console.log('exclusion paths:');
const good = makeIntent();
await run('valid intent', good, [ticket('1'), ticket('2')]);
await run('HASH_MISMATCH (maxNetPay altered)', { ...good, maxNetPay: '999999' }, [ticket('1'), ticket('2')]);
await run('EXPIRED', makeIntent({ deadline: String(NOW - 1n) }), [ticket('1'), ticket('2')]);
await run('TICKET_UNKNOWN', good, [ticket('1')]);
await run('TICKET_REDEEMED', good, [ticket('1'), ticket('2', { redeemed: true })]);
await run('TICKET_NOT_IN_ESCROW (withdrawn)', good, [ticket('1'), ticket('2', { escrowed: false, depositor: null })]);
await run('TICKET_NOT_IN_ESCROW (other owner)', good, [ticket('1'), ticket('2', { depositor: OTHER })]);
await run('WRONG_EVENT', good, [ticket('1'), ticket('2')], universe({ eventId: 9 }));
await run('deadline == block (not expired)', makeIntent({ deadline: String(NOW) }), [ticket('1'), ticket('2')]);
