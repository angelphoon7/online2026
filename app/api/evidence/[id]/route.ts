import { readEvidence } from '@/server/evidence-store';

export const runtime = 'nodejs';
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const record = await readEvidence((await context.params).id);
  return record ? Response.json(record, { headers: { 'Cache-Control': 'no-store' } }) : Response.json({ error: 'Evidence not found' }, { status: 404 });
}
