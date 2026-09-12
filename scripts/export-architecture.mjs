import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

// Editable vector source. Render locally without a browser or external assets.
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
const text = (x, y, value, size = 22, color = '#cbd5e1', weight = 400, extra = '') =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${color}" font-weight="${weight}" ${extra}>${escape(value)}</text>`;
const box = (x, y, w, h, fill = '#142036', stroke = '#334155', radius = 16, extra = '') =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${radius}" fill="${fill}" stroke="${stroke}" ${extra}/>`;
const lines = (x, y, values, size = 21, color = '#cbd5e1', gap = 30) => values.map((value, index) => text(x, y + index * gap, value, size, color)).join('');
const arrow = (d, color = '#93c5fd', marker = 'blue') => `<path d="${d}" fill="none" stroke="${color}" stroke-width="3" marker-end="url(#${marker})"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080" role="img" aria-labelledby="title description">
<title id="title">RESHUFFLE — deployed Arc Testnet architecture</title>
<desc id="description">Participants sign outcome conditions through a Next.js frontend. The Graph indexes Arc events for public discovery and the read-only agent. A Node.js backend rechecks Arc RPC state, runs a bounded TypeScript solver, simulates with eth_call, and stores evidence. A submitting wallet sends the settlement transaction. Four Solidity contracts enforce conditions and transfer USDC and tickets. Separate testnet issuer and judge controls may sign for controlled wallets.</desc>
<defs>
  <marker id="blue" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#93c5fd"/></marker>
  <marker id="green" markerWidth="10" markerHeight="10" refX="8" refY="4" orient="auto"><path d="M0 0 L8 4 L0 8" fill="#6ee7b7"/></marker>
</defs>
<rect width="1920" height="1080" fill="#080f1c"/>
<g font-family="Arial, Helvetica, sans-serif">
${text(64, 77, 'RESHUFFLE', 46, '#f8fafc', 700)}
${text(382, 77, 'Signed outcomes. Verified settlement.', 32, '#94a3b8')}
${text(64, 122, 'Every participant’s own signed conditions must hold before tickets or USDC move.', 25)}
${box(1450, 43, 406, 48, '#0a2d2a', '#276759', 24)}
${text(1653, 75, 'ARC TESTNET  /  5042002', 21, '#6ee7b7', 700, 'text-anchor="middle"')}

${box(64, 157, 1792, 52, '#101b2c', '#243247', 10)}
${text(88, 191, '01  SIGN CONDITIONS', 20, '#e2e8f0', 700)}
${text(531, 191, '02  SEARCH + SIMULATE', 20, '#93c5fd', 700)}
${text(1038, 191, '03  VERIFY + EXECUTE', 20, '#6ee7b7', 700)}
${text(1510, 191, '04  SHOW EVIDENCE', 20, '#e2e8f0', 700)}

${box(64, 237, 450, 583, '#0e192b', '#334155')}
${text(88, 278, 'FRONTEND + WALLETS', 23, '#f8fafc', 700)}
${box(88, 301, 402, 137)}
${text(108, 336, 'Next.js application', 25, '#f8fafc', 700)}
${lines(108, 369, ['Swapper · buyer · seller · issuer', 'Choose tickets and outcome conditions', 'Approve / deposit · sign / commit'], 20)}
${box(88, 458, 402, 159)}
${text(108, 493, 'Outcome authorisation', 24, '#f8fafc', 700)}
${lines(108, 526, ['EIP-712 signature → IntentRegistry', 'Bound to chain ID + registry address', 'Users need not return to approve', 'the discovered settlement proposal.'], 20, '#cbd5e1', 26)}
${box(88, 637, 402, 159, '#0b2928', '#276759')}
${text(108, 672, 'Submitting wallet', 24, '#6ee7b7', 700)}
${lines(108, 706, ['Signs and broadcasts settlement', 'After verified receipt: who paid / received', 'USDC net distribution · Σ = 0', 'Gas excluded from the payment sum'], 19, '#cbd5e1', 25)}

${box(634, 237, 500, 583, '#0e192b', '#334155')}
${text(658, 278, 'BACKEND / NODE.JS', 23, '#f8fafc', 700)}
${box(658, 301, 452, 101)}
${text(678, 336, 'POST /api/solve/pool', 25, '#93c5fd', 700)}
${lines(678, 368, ['Live indexed intents from The Graph'], 20)}
${box(658, 423, 452, 166)}
${text(678, 458, 'TypeScript solver + simulation', 24, '#f8fafc', 700)}
${lines(678, 491, ['Read custody, intents and payment capacity', 'Bounded search · deterministic ranking', 'Least gross cash moved among candidates', 'found within the search budget · eth_call'], 20, '#cbd5e1', 27)}
${box(658, 610, 452, 186)}
${text(678, 645, 'Read-only agent + evidence', 24, '#f8fafc', 700)}
${lines(678, 678, ['Indexed pool → diagnosis → optional Claude', 'Conditions tried · bounds · commitment links', 'Receipt API checks calldata + chain result', 'Separate testnet issuer / judge routes sign', 'Agent and solver never broadcast'], 19, '#cbd5e1', 25)}

${box(1254, 237, 602, 583, '#0b211f', '#276759')}
${text(1278, 278, 'ARC TESTNET / FOUR CONTRACTS', 23, '#6ee7b7', 700)}
${box(1278, 301, 268, 115, '#102b2a', '#276759')}
${text(1298, 336, 'TicketNFT', 24, '#f8fafc', 700)}
${lines(1298, 369, ['ERC-721 · seat metadata', 'Holder redemption'], 19, '#cbd5e1', 26)}
${box(1566, 301, 266, 115, '#102b2a', '#276759')}
${text(1586, 336, 'Escrow', 24, '#f8fafc', 700)}
${lines(1586, 369, ['Custody · owner withdrawal', 'Settlement-only release'], 18, '#cbd5e1', 26)}
${box(1278, 437, 554, 104, '#102b2a', '#276759')}
${text(1298, 472, 'IntentRegistry', 24, '#f8fafc', 700)}
${lines(1298, 504, ['Authenticate signature · reserve nonce · commit / revoke'], 19)}
${box(1278, 562, 554, 234, '#113b32', '#40947b')}
${text(1298, 598, 'Settlement — the trust boundary', 25, '#6ee7b7', 700)}
${lines(1298, 633, ['V0–V8: recheck every signed condition at execution', 'Intent validity · custody · conservation · seat constraints', 'Signed budgets · balanced payments · owner capacity'], 19, '#e2e8f0', 27)}
${text(1298, 727, '1  Mark intents settled     2  Pull / push net USDC', 19, '#6ee7b7', 700)}
${text(1298, 758, '3  Release tickets            4  Emit settlement event', 19, '#6ee7b7', 700)}

${arrow('M514 347 H634')}
${text(574, 318, 'Hashes', 17, '#93c5fd', 400, 'text-anchor="middle"')}
${arrow('M634 573 H514')}
${text(574, 532, 'Proposal +', 16, '#93c5fd', 400, 'text-anchor="middle"')}
${text(574, 554, 'evidence', 16, '#93c5fd', 400, 'text-anchor="middle"')}
${arrow('M1134 366 H1254')}
${text(1194, 317, 'RPC reads', 17, '#93c5fd', 400, 'text-anchor="middle"')}
${text(1194, 340, '+ eth_call', 17, '#93c5fd', 400, 'text-anchor="middle"')}
${arrow('M1254 688 H1134')}
${text(1194, 642, 'State +', 17, '#93c5fd', 400, 'text-anchor="middle"')}
${text(1194, 665, 'receipts', 17, '#93c5fd', 400, 'text-anchor="middle"')}

${arrow('M289 820 V874 H1555 V820', '#6ee7b7', 'green')}
${box(546, 850, 756, 46, '#080f1c', '#080f1c', 0)}
${text(924, 880, 'WALLET → settle(intents, legs) · one onchain transaction', 23, '#6ee7b7', 700, 'text-anchor="middle"')}

${box(64, 923, 1090, 103, '#0b2928', '#276759', 14)}
${text(88, 960, 'USDC is both the settlement asset and native gas token.', 25, '#6ee7b7', 700)}
${text(88, 996, 'No second token needed. All signed conditions are checked before any transfer.', 21)}
${box(1178, 923, 678, 103, '#101724', '#93c5fd', 14)}
${text(1202, 959, 'THE GRAPH · Studio / arc-testnet', 23, '#93c5fd', 700)}
${text(1202, 988, 'Arc events → Ticket / Intent / Settlement → backend', 19, '#cbd5e1')}
${text(1202, 1013, 'Hash binding + receipt-block freshness floor', 18, '#94a3b8')}
${text(64, 1057, 'Implementation: app/reshuffle · app/api · server/ · solver/ · src/     |     Simulation does not lock state; contracts revalidate at execution.', 17, '#94a3b8')}
</g>
</svg>`;

const directory = new URL('../docs/diagrams/', import.meta.url);
await mkdir(directory, { recursive: true });
await writeFile(new URL('architecture.svg', directory), svg);
await sharp(Buffer.from(svg), { density: 144 }).png().toFile(fileURLToPath(new URL('architecture.png', directory)));
console.log('Exported docs/diagrams/architecture.svg (1920 × 1080 vector) and architecture.png (3840 × 2160).');
