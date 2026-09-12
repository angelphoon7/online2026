# Architecture image

- [architecture.png](architecture.png): **3840 × 2160**, 16:9, opaque dark background. Insert directly into a presentation or video editor.
- [architecture.svg](architecture.svg): **1920 × 1080 viewBox**, scalable vector. Opens independently in a browser or an SVG-capable design tool. Includes a title and accessible description; no external images, fonts or scripts.

The image describes the Arc Testnet implementation: Next.js frontend, Node.js backend, The Graph discovery, read-only agent, TypeScript solver, RPC revalidation and simulation, four Solidity contracts, wallet submission, verified evidence and USDC net distribution. Separate enabled testnet issuer/judge routes can sign for controlled wallets; the agent and solver cannot broadcast.

## Regenerate

From the repository root, after installing the project dependencies:

```sh
node scripts/export-architecture.mjs
```

The [export script](../../scripts/export-architecture.mjs) contains the editable SVG layout and labels. It writes both artifacts, using the locally installed Sharp renderer included in the Next.js dependency tree. No network requests or credentials are needed. The PNG is rendered at twice the SVG's base resolution for presentation use.

If the architecture changes, update the script and regenerate both images together. Keep Graph discovery, RPC execution checks and the wallet/backend signing boundaries accurate.
