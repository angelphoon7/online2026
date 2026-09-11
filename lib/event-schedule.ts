// Fixed demo dates, not dates inferred from the concert artwork. Changing the
// schedule affects new drafts only; committed intents retain their signed expiry.
const sessionStarts: Readonly<Record<number, string>> = {
  0: process.env.NEXT_PUBLIC_SESSION_0_START || '2026-09-19T20:00:00+08:00',
  1: process.env.NEXT_PUBLIC_SESSION_1_START || '2026-09-20T20:00:00+08:00',
};
export const EIGHT_HOURS = 8n * 60n * 60n;
export function selectedClass(mask: bigint): number | null {
  if (mask <= 0n || (mask & (mask - 1n)) !== 0n) return null;
  const id = mask.toString(2).length - 1;
  return id < 256 ? id : null;
}
export function sessionStart(session: number): bigint | null {
  const milliseconds = Date.parse(sessionStarts[session] ?? '');
  return Number.isFinite(milliseconds) ? BigInt(Math.floor(milliseconds / 1000)) : null;
}
export function sessionDeadline(mask: bigint): bigint | null {
  const session = selectedClass(mask);
  const starts = session === null ? null : sessionStart(session);
  return starts === null ? null : starts - EIGHT_HOURS;
}
export function formatEventTime(timestamp: bigint) {
  const malaysiaTime = new Date(Number(timestamp + EIGHT_HOURS) * 1000);
  return `${malaysiaTime.toISOString().replace('T', ' ').slice(0, 16)} Malaysia (UTC+8)`;
}
export function validateNewIntentTiming(sessionMask: bigint, deadline: bigint, now: bigint) {
  const expected = sessionDeadline(sessionMask);
  if (expected === null) throw new Error('Choose one night with a configured event start time.');
  if (deadline !== expected) throw new Error('The event schedule changed. Review your intent before signing again.');
  if (deadline <= now) throw new Error('Swapping for this night closes eight hours before the event starts. Choose another night.');
}
