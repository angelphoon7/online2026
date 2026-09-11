import { isHash } from 'viem';
import { settlementReceipt } from '@/server/receipt';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export async function GET(request: Request) {
  const hash = new URL(request.url).searchParams.get('hash');
  if (!hash || !isHash(hash)) return Response.json({ error: 'Invalid transaction hash' }, { status: 400 });
  try { return Response.json(await settlementReceipt(hash), { headers: { 'Cache-Control': 'no-store' } }); }
  catch { return Response.json({ error: 'Receipt could not be verified against Arc. Retry shortly.' }, { status: 503 }); }
}
