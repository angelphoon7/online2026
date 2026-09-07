/**
 * Shared World ID configuration.
 *
 * `app_id`, `action` and `rp_id` are public values — they ship to the browser.
 * The RP signing key is server-only and must never be imported into a client
 * component.
 */

// IDKit types app_id as `app_${string}`, so assert the prefix here rather than
// at every call site.
export const WORLD_APP_ID = (process.env.NEXT_PUBLIC_WORLD_APP_ID ??
  "app_") as `app_${string}`;
export const WORLD_ACTION = process.env.NEXT_PUBLIC_WORLD_ACTION ?? "";
export const WORLD_RP_ID = process.env.NEXT_PUBLIC_WORLD_RP_ID ?? "";

/** Developer Portal endpoint that validates a proof. */
export const WORLD_VERIFY_URL = "https://developer.world.org/api/v4/verify";

/** Routes exposed by `app/api/world/*`, re-exported from `./handlers`. */
export const RP_SIGNATURE_ROUTE = "/api/world/rp-signature";
export const VERIFY_ROUTE = "/api/world/verify";

/** Shape returned by `RP_SIGNATURE_ROUTE`. */
export type RpSignatureResponse = {
  nonce: string;
  created_at: number;
  expires_at: number;
  sig: string;
};
