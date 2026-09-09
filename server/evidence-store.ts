import 'server-only';
import { mkdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

export function serialize(value: unknown): string {
  return JSON.stringify(value, (_, v) => typeof v === 'bigint' ? v.toString() : v);
}
const directory = join(process.cwd(), '.data', 'evidence');
export function saveEvidence(value: Record<string, unknown>, existingId?: string) {
  const id = existingId ?? randomUUID();
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new Error('Invalid evidence ID');
  mkdirSync(directory, { recursive: true });
  const path = join(directory, `${id}.json`);
  const temp = `${path}.${randomUUID()}.tmp`;
  const record = { ...value, id };
  writeFileSync(temp, serialize(record));
  renameSync(temp, path);
  return JSON.parse(serialize(record));
}
export function readEvidence(id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  try { return JSON.parse(readFileSync(join(directory, `${id}.json`), 'utf8')); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}
