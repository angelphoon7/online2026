# Architecture image

- [architecture.png](architecture.png): **3840 × 2160**, 16:9, opaque dark background. Insert directly into a presentation or video editor.
- [architecture.svg](architecture.svg): **1920 × 1080 viewBox**, scalable vector. Opens independently in a browser or an SVG-capable design tool. Includes a title and accessible description; no external images, fonts or scripts.

The image describes the current Arc Testnet implementation: Next.js frontend, Node.js HTTP backend, TypeScript solver, RPC discovery and simulation, four Solidity contracts, wallet submission, verified evidence and the USDC net distribution. The Graph adapter is explicitly marked as planned. The HTTP backend does not sign transactions.

## Regenerate

From the repository root, after installing the project dependencies:

```sh
node scripts/export-architecture.mjs
```

The [export script](../../scripts/export-architecture.mjs) contains the editable SVG layout and labels. It writes both artifacts, using the locally installed Sharp renderer included in the Next.js dependency tree. No network requests or credentials are needed. The PNG is rendered at twice the SVG's base resolution for presentation use.

If the architecture changes, update the script and regenerate both images together. Keep the current RPC discovery path and the wallet/backend signing boundary accurate.
