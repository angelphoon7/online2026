/** Retry-After supports seconds or an HTTP date. Never turn an invalid value into a tight loop. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number {
  if (!value?.trim()) return 60;
  const text = value.trim();
  const seconds = /^\d+$/.test(text) ? Number(text) : (Date.parse(text) - now) / 1000;
  return Number.isFinite(seconds) ? Math.max(1, Math.min(86400, Math.ceil(seconds))) : 60;
}
