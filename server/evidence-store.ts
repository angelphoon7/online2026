import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { durableStore, encodeRecord, StorageUnavailable, storageMode } from './durable-store';

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
}
const directory = join(process.cwd(), '.data', 'evidence');
export async function saveEvidence(value: Record<string, unknown>, existingId?: string) {
  const id = existingId ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid evidence ID');
  const record: Record<string, unknown> = { ...value, id };
  const store = durableStore(), key = `evidence:${id}`;
  const previous = existingId ? await store.get(key) : null;
  if (previous && JSON.parse(previous).receipt?.confirmed) {
    if (JSON.parse(previous).transactionHash !== record.transactionHash) throw new Error('Evidence already has a different confirmed receipt');
    return JSON.parse(previous);
  }
  if (!await store.compareAndSet(key, previous, encodeRecord(record))) throw new StorageUnavailable('Evidence changed concurrently; reload the saved record.');
  return JSON.parse(serialize(record));
}
export async function readEvidence(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  const saved = await durableStore().get(`evidence:${id}`);
  if (saved !== null) return JSON.parse(saved);
  // Preserve access to pre-migration local evidence; production never falls back to local files.
  if (storageMode() !== 'file') return null;
  try { return JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
