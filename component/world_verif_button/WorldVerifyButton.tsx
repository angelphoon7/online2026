"use client";

import { useState } from "react";
import {
  IDKitRequestWidget,
  selfieCheckLegacy,
  type RpContext,
} from "@worldcoin/idkit";
import {
  RP_SIGNATURE_ROUTE,
  VERIFY_ROUTE,
  WORLD_ACTION,
  WORLD_APP_ID,
  WORLD_RP_ID,
  type RpSignatureResponse,
} from "./config";

type Props = {
  /**
   * Binds context (a user id, a wallet address) into the proof. Your backend
   * should check it matches what it expects.
   */
  signal?: string;
  onVerified?: () => void;
  className?: string;
  label?: string;
};

export default function WorldVerifyButton({
  signal,
  onVerified,
  className,
  label = "Verify with World ID",
}: Props) {
  const [rpContext, setRpContext] = useState<RpContext | null>(null);
  const [open, setOpen] = useState(false);
  const [isPreparing, setIsPreparing] = useState(false);
  const [verified, setVerified] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startVerification() {
    setError(null);
    setIsPreparing(true);
    try {
      // Signatures carry an expiry, so fetch a fresh one per attempt rather
      // than reusing one from a previous click.
      const response = await fetch(RP_SIGNATURE_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: WORLD_ACTION }),
      });
      if (!response.ok) throw new Error("Could not sign the request");

      const sig = (await response.json()) as RpSignatureResponse;

      setRpContext({
        rp_id: WORLD_RP_ID,
        nonce: sig.nonce,
        created_at: sig.created_at,
        expires_at: sig.expires_at,
        signature: sig.sig,
      });
      setOpen(true);
    } catch {
      setError("Could not start verification. Try again.");
    } finally {
      setIsPreparing(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-2 sm:items-start">
      <button
        type="button"
        onClick={startVerification}
        disabled={isPreparing || verified}
        className={
          className ??
          "flex h-12 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-base font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc] md:w-[200px]"
        }
      >
        {verified && <span className="h-2 w-2 rounded-full bg-green-500" />}
        {verified ? "Verified" : isPreparing ? "Preparing..." : label}
      </button>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* Mounted only once signed context exists — the widget requires it. */}
      {rpContext && (
        <IDKitRequestWidget
          open={open}
          onOpenChange={setOpen}
          app_id={WORLD_APP_ID}
          action={WORLD_ACTION}
          rp_context={rpContext}
          // Selfie Check is still a World ID 3.0 credential.
          allow_legacy_proofs={true}
          preset={selfieCheckLegacy({ signal })}
          handleVerify={async (result) => {
            // Throwing here makes the widget surface the failure instead of
            // reporting success for a proof the Portal rejected.
            const response = await fetch(VERIFY_ROUTE, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ idkitResponse: result }),
            });
            if (!response.ok) throw new Error("Verification failed");
          }}
          onSuccess={() => {
            setVerified(true);
            onVerified?.();
          }}
          onError={(code) => setError(`Verification failed (${code})`)}
        />
      )}
    </div>
  );
}
