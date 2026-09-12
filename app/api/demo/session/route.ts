import { authenticated, createJudgeSession, deleteJudgeSession, judgeAccessConfigured, judgeControlsEnabled, JudgeAccessError, requireSameOrigin, SESSION_COOKIE } from '@/server/judge-access';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'no-store' };
function cookie(token: string, age: number) {
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${process.env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
function failure(error: unknown) {
  return Response.json({ error: error instanceof JudgeAccessError ? error.message : 'Judge access is temporarily unavailable.' }, { status: error instanceof JudgeAccessError ? error.status : 503, headers });
}
export async function GET(request: Request) {
  try { return Response.json({ enabled: judgeControlsEnabled(), configured: judgeAccessConfigured(), authenticated: judgeAccessConfigured() && await authenticated(request) }, { headers }); }
  catch (e) { return failure(e); }
}
export async function POST(request: Request) {
  try {
    requireSameOrigin(request);
    const body = await request.text();
    if (body.length > 1024) throw new JudgeAccessError('Invalid access code.', 400);
    const { code } = JSON.parse(body);
    if (typeof code !== 'string') throw new JudgeAccessError('Enter the access code.', 400);
    const token = await createJudgeSession(code);
    return Response.json({ authenticated: true }, { headers: { ...headers, 'Set-Cookie': cookie(token, 3600) } });
  } catch (e) { return failure(e); }
}
export async function DELETE(request: Request) {
  try {
    requireSameOrigin(request); await deleteJudgeSession(request);
    return Response.json({ authenticated: false }, { headers: { ...headers, 'Set-Cookie': cookie('', 0) } });
  } catch (e) { return failure(e); }
}
