import 'server-only';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

export class StorageUnavailable extends Error {
  constructor(message = 'Shared storage is unavailable. Retry after the operator checks storage configuration.') {
    super(message); this.name = 'StorageUnavailable';
  }
}
export type Guard = { key: string; value: string };
export type CasOptions = { ttlMs?: number; guard?: Guard };
export interface DurableStore {
  get(key: string): Promise<string | null>;
  compareAndSet(key: string, expected: string | null, next: string | null, options?: CasOptions): Promise<boolean>;
}
const CAS = `
if #KEYS == 2 and redis.call('GET', KEYS[2]) ~= ARGV[6] then return 0 end
local current = redis.call('GET', KEYS[1])
if ARGV[1] == 'absent' then
  if current then return 0 end
elseif current ~= ARGV[2] then return 0 end
if ARGV[3] == 'delete' then redis.call('DEL', KEYS[1])
elseif tonumber(ARGV[5]) > 0 then redis.call('SET', KEYS[1], ARGV[4], 'PX', ARGV[5])
else redis.call('SET', KEYS[1], ARGV[4]) end
return 1`;

export class RedisRestStore implements DurableStore {
  constructor(private url: string, private token: string, private namespace: string) {
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new StorageUnavailable('Configure a HTTPS Redis REST endpoint and token.'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash || !token) throw new StorageUnavailable('Configure a HTTPS Redis REST endpoint and token.');
  }
  private key(key: string) { return `${this.namespace}:${key}`; }
  private async command<T>(command: (string | number)[]): Promise<T> {
    try {
      const response = await fetch(this.url, { method: 'POST', headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' }, body: JSON.stringify(command), cache: 'no-store', signal: AbortSignal.timeout(10_000) });
      const body = await response.json();
      if (!response.ok || body.error || !Object.hasOwn(body, 'result')) throw new StorageUnavailable();
      return body.result as T;
    } catch { throw new StorageUnavailable(); } // Provider errors can contain credentials or stored signed transactions.
  }
  get(key: string) { return this.command<string | null>(['GET', this.key(key)]); }
  async compareAndSet(key: string, expected: string | null, next: string | null, options: CasOptions = {}) {
    const keys = [this.key(key), ...(options.guard ? [this.key(options.guard.key)] : [])];
    return (await this.command<number>(['EVAL', CAS, keys.length, ...keys, expected === null ? 'absent' : 'value', expected ?? '', next === null ? 'delete' : 'set', next ?? '', options.ttlMs ?? 0, options.guard?.value ?? ''])) === 1;
  }
}

/** Development or one persistent-volume backend only. All mutations share one short disk lock. */
export class FileStore implements DurableStore {
  constructor(private directory: string) {}
  private file(key: string) { return join(this.directory, `${createHash('sha256').update(key).digest('hex')}.json`); }
  async get(key: string): Promise<string | null> {
    try {
      const record = JSON.parse(await readFile(this.file(key), 'utf8')) as { value: string; expires: number | null };
      return record.expires !== null && record.expires <= Date.now() ? null : record.value;
    } catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new StorageUnavailable(); }
  }
  async compareAndSet(key: string, expected: string | null, next: string | null, options: CasOptions = {}) {
    await mkdir(this.directory, { recursive: true });
    const lockPath = join(this.directory, 'mutation.lock');
    let lock;
    for (let attempt = 0; !lock; attempt++) {
      try { lock = await open(lockPath, 'wx', 0o600); }
      catch (e) {
        // Windows may report EACCES/EPERM while the previous worker unlinks its closed
        // lock handle. Retry acquisition only; never remove another worker's lock.
        if (!['EEXIST', 'EACCES', 'EPERM'].includes((e as NodeJS.ErrnoException).code ?? '') || attempt >= 100) throw new StorageUnavailable('Local storage is locked. Stop local writers and inspect mutation.lock before recovery.');
        await new Promise(r => setTimeout(r, 10));
      }
    }
    try {
      if (options.guard && await this.get(options.guard.key) !== options.guard.value) return false;
      if (await this.get(key) !== expected) return false;
      if (next === null) await unlink(this.file(key)).catch(e => { if (e.code !== 'ENOENT') throw e; });
      else {
        const temp = `${this.file(key)}.${randomUUID()}.tmp`;
        await writeFile(temp, JSON.stringify({ key, value: next, expires: options.ttlMs ? Date.now() + options.ttlMs : null }), { mode: 0o600 });
        await rename(temp, this.file(key));
      }
      return true;
    } finally { await lock.close(); await unlink(lockPath); }
  }
}

export function storageMode(): 'redis' | 'file' {
  const mode = process.env.STORAGE_BACKEND ?? (process.env.REDIS_REST_URL ? 'redis' : 'file');
  if (mode !== 'redis' && mode !== 'file') throw new StorageUnavailable('STORAGE_BACKEND must be redis or file.');
  if (mode === 'file' && (process.env.VERCEL || (process.env.NODE_ENV === 'production' && process.env.ALLOW_PERSISTENT_FILE_STORAGE !== 'true'))) throw new StorageUnavailable('Production requires Redis REST storage or an explicitly configured persistent-volume backend.');
  return mode;
}
export function durableStore(): DurableStore {
  const namespace = process.env.STORAGE_NAMESPACE ?? 'reshuffle-arc-testnet';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(namespace)) throw new StorageUnavailable('Invalid STORAGE_NAMESPACE.');
  return storageMode() === 'redis'
    ? new RedisRestStore(process.env.REDIS_REST_URL ?? '', process.env.REDIS_REST_TOKEN ?? '', namespace)
    : new FileStore(resolve(process.env.STORAGE_DIRECTORY ?? join(process.cwd(), '.data', 'shared'), namespace));
}
export const encodeRecord = (value: unknown) => JSON.stringify(value, (_, v) => typeof v === 'bigint' ? String(v) : v);
export async function readRecord<T>(key: string, store = durableStore()): Promise<T | null> {
  const value = await store.get(key); return value === null ? null : JSON.parse(value) as T;
}
export async function putRecord(key: string, value: unknown, store = durableStore(), guard?: Guard, ttlMs?: number) {
  const previous = await store.get(key);
  if (!await store.compareAndSet(key, previous, encodeRecord(value), { guard, ttlMs })) throw new StorageUnavailable('Concurrent state change; retry to read the saved operation.');
}
export async function consumeQuota(key: string, maximum: number, windowMs: number, store = durableStore()): Promise<boolean> {
  const bucket = `quota:${key}:${Math.floor(Date.now() / windowMs)}`;
  for (let attempt = 0; attempt < 20; attempt++) {
    const current = await store.get(bucket), count = current === null ? 0 : Number(current);
    if (count >= maximum) return false;
    if (await store.compareAndSet(bucket, current, String(count + 1), { ttlMs: windowMs * 2 })) return true;
  }
  throw new StorageUnavailable();
}
