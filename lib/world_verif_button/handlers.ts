import "server-only";

import { signRequest } from "@worldcoin/idkit/signing";
import { WORLD_ACTION, WORLD_RP_ID, WORLD_VERIFY_URL } from "@/component/world_verif_button/config";

// Demo-grade anti-replay store: resets on every server restart/redeploy, and
// isn't shared across serverless instances. Fine for a hackathon build —
// swap for a real database (see the schema below) before production.
const usedNullifiers = new Set<string>();

/**
 * Signs a proof request so World can confirm it really came from this app.
 *
 * The signing key stays on the server — a leaked key lets anyone impersonate
 * the app, so this must never move into the client bundle.
 */
export async function rpSignatureHandler(request: Request): Promise<Response> {
  const signingKeyHex = process.env.WORLD_RP_SIGNING_KEY;
  if (!signingKeyHex) {
    return Response.json(
      { error: "WORLD_RP_SIGNING_KEY is not set" },
      { status: 500 },
    );
  }

  // The action is pinned server-side; a client-supplied action would let a
  // caller mint signatures for actions this app never intended to request.
  const { action = WORLD_ACTION } = (await request
    .json()
    .catch(() => ({}))) as { action?: string };

  if (action !== WORLD_ACTION) {
    return Response.json({ error: "Unknown action" }, { status: 400 });
  }

  const { sig, nonce, createdAt, expiresAt } = signRequest({
    signingKeyHex,
    action,
  });

  return Response.json({
    sig,
    nonce,
    created_at: createdAt,
    expires_at: expiresAt,
  });
}

/**
 * Forwards a proof collected by IDKit to the Developer Portal.
 *
 * A proof is only meaningful once the Portal has validated it, so this must
 * happen server-side — a client-side "success" is trivially faked.
 */
export async function verifyHandler(request: Request): Promise<Response> {
  const { idkitResponse } = (await request.json()) as {
    idkitResponse: {
      action?: string;
      responses?: { nullifier?: string }[];
    };
  };

  if (!idkitResponse) {
    return Response.json({ error: "Missing idkitResponse" }, { status: 400 });
  }

  // The nullifier is this user's stable, anonymous handle for this action —
  // it's part of the proof itself, so it's safe to read before the Portal
  // confirms the proof is valid. Checked against usedNullifiers below to stop
  // the same person from verifying twice.
  const nullifier = idkitResponse.responses?.[0]?.nullifier;
  const nullifierKey = nullifier ? `${WORLD_ACTION}:${nullifier}` : null;

  if (nullifierKey && usedNullifiers.has(nullifierKey)) {
    return Response.json({ error: "Already verified" }, { status: 400 });
  }

  const response = await fetch(`${WORLD_VERIFY_URL}/${WORLD_RP_ID}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(idkitResponse),
  });

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    return Response.json(
      { error: "Verification failed", detail: body },
      { status: 400 },
    );
  }

  // Persisting in a real database instead of usedNullifiers would look like:
  //
  //   CREATE TABLE nullifiers (
  //     nullifier   NUMERIC(78, 0) NOT NULL,
  //     action      TEXT NOT NULL,
  //     verified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  //     UNIQUE (nullifier, action)
  //   );
  if (nullifierKey) usedNullifiers.add(nullifierKey);

  return Response.json({ success: true, result: body });
}
