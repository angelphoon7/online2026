import { randomUUID } from 'node:crypto';
import { isAddress, isHex, verifyMessage, type Address } from 'viem';
import { checkDemoIssuer, demoTicketConfig, DemoTicketError, issueDemoTickets } from '@/server/demo-tickets';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;
const challenges = new Map<string, { recipient: Address; expires: number }>();
const headers = { 'Cache-Control': 'no-store' };
function failure(error: unknown) {
  return Response.json({ error: error instanceof DemoTicketError ? error.message : 'Demo ticket issuance could not finish. Retry Get free tickets to resume your claim; the issuer must have test USDC for gas.' }, { status: error instanceof DemoTicketError ? error.status : 503, headers });
}

export async function GET(request: Request) {
  try {
    const recipient = new URL(request.url).searchParams.get('address');
    if (!recipient || !isAddress(recipient) || /^0x0{40}$/i.test(recipient)) throw new DemoTicketError('Select a valid recipient wallet.', 400);
    const { addresses } = await checkDemoIssuer();
    for (const [message, claim] of challenges) if (claim.expires < Date.now()) challenges.delete(message);
    if (challenges.size >= 100) throw new DemoTicketError('Too many pending demo claims. Retry shortly.', 429);
    const expires = Date.now() + 300000;
    const message = `RESHUFFLE demo ticket claim\nReceive two free test tickets; no spending approval.\nWallet: ${recipient}\nChain: 5042002\nTicket contract: ${addresses.TicketNFT}\nSite: ${new URL(request.url).origin}\nExpires: ${new Date(expires).toISOString()}\nNonce: ${randomUUID()}`;
    challenges.set(message, { recipient, expires });
    return Response.json({ message }, { headers });
  } catch (error) { return failure(error); }
}

export async function POST(request: Request) {
  try {
    if (request.headers.get('origin') !== new URL(request.url).origin) throw new DemoTicketError('Claim demo tickets from this app.', 403);
    demoTicketConfig();
    const body = await request.text();
    if (body.length > 4096) throw new DemoTicketError('Invalid demo claim.', 400);
    const { message, signature } = JSON.parse(body);
    if (typeof message !== 'string' || !isHex(signature)) throw new DemoTicketError('Sign the demo claim in your wallet.', 400);
    const claim = challenges.get(message);
    if (!claim || claim.expires < Date.now()) throw new DemoTicketError('Demo claim expired. Click Get free tickets again.', 401);
    if (!await verifyMessage({ address: claim.recipient, message, signature })) throw new DemoTicketError('The claim must be signed by the receiving wallet.', 401);
    // Consume once, before any minting. A retry obtains a new challenge and resumes
    // the durable claim for that same wallet instead of issuing another pair.
    if (!challenges.delete(message)) throw new DemoTicketError('This demo claim is already being processed.', 409);
    return Response.json(await issueDemoTickets(claim.recipient), { headers });
  } catch (error) { return failure(error); }
}
