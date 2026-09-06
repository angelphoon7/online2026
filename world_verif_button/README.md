# World Selfie Check button

A drop-in button that runs World ID **Selfie Check (Beta)** verification.

## What's here

| File | Role |
| --- | --- |
| `WorldVerifyButton.tsx` | Client component — the button plus the IDKit modal |
| `handlers.ts` | Server logic: signs requests, verifies proofs |
| `config.ts` | Shared IDs, routes and types |
| `index.ts` | Barrel export |

The API routes live at `app/api/world/rp-signature` and `app/api/world/verify`
— Next.js requires route files under `app/`, so those are one-line re-exports
of `handlers.ts`.

## Setup

1. Create an app at [developer.world.org](https://developer.world.org) and note
   the `app_id`, `rp_id` and RP signing key.
2. **Request Selfie Check access** by emailing `developers@toolsforhumanity.com`.
   Selfie Check is gated — requests fail until it's enabled for your `app_id`.
3. Create an **action** (e.g. `verify-human`) in the portal.
4. Copy `.env.local.example` to `.env.local` and fill it in.

## Usage

```tsx
import WorldVerifyButton from "@/world_verif_button/WorldVerifyButton";

<WorldVerifyButton
  signal={userId}                      // optional, binds the proof to a user
  onVerified={() => router.push("/")}   // optional
/>
```

## The flow

```
click → POST /api/world/rp-signature   (server signs, key never leaves server)
      → IDKit modal opens
        desktop: shows a QR code → scan with World App → selfie on phone
        mobile:  deep-links straight into World App
      → proof polled back to the browser
      → POST /api/world/verify → developer.world.org/api/v4/verify/{rp_id}
      → onVerified()
```

## Before production

`verifyHandler` in `handlers.ts` rejects repeat nullifiers using an in-memory
`Set` — good enough to demo the anti-replay check, but it resets on every
restart/redeploy and isn't shared across serverless instances. Swap it for a
real database before production; the suggested schema is in the comment
there.

## Notes

- Selfie Check is a World ID 3.0 credential, hence the preset name
  `selfieCheckLegacy` and `allow_legacy_proofs={true}`.
- It's *medium*-assurance (device camera), weaker than Orb-backed
  `proofOfHuman`. Swap the preset in `WorldVerifyButton.tsx` if you need
  stronger guarantees.
- To test the full flow before going live, see
  [Testing Selfie Check in Sandbox](https://docs.world.org/world-id/sandbox/testing-selfie-check)
  — it needs the sandbox World App build from TestFlight or the private Play link.
