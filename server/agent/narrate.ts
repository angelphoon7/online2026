import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import type { Hex } from 'viem';
import type { Snapshot } from '@/shared/graph';
import { TOOLS, dispatcher } from './tools';
import { guard, bigintSafe, type GuardedAnswer, type ToolLogEntry } from './guard';
import { poolOverview } from './overview';

// Narration - step 7-G of docs/RESHUFFLE_GRAPH_PLAN.md.
//
// The model's job here is deliberately small: pick a tool, then put the tool's findings into
// four sentences. It decides nothing about the market. Every number, address and verdict comes
// from a tool result in this conversation, and guard.ts rejects the answer if it does not.
//
// The loop is manual rather than the SDK's tool runner because every tool call has to be
// recorded, in order, with the exact output the model was given: that log IS the evidence
// chain the plan requires, it is what the guard checks the answer against, and it is what the
// drawer shows a judge who asks "how do you know that?".

const MODEL = process.env.AGENT_MODEL ?? 'claude-sonnet-5';
/** Four is enough for diagnose plus two follow-up what_ifs and a final answer. */
const MAX_TURNS = 4;
// Thinking tokens count against max_tokens, so this is not the four-sentence answer's size -
// it is the room the model needs to reason about which tool to call and still answer.
const MAX_TOKENS = 4096;

export class AgentNotConfigured extends Error {
  constructor() {
    super('ANTHROPIC_API_KEY is not set. GET /api/agent/diagnose/<hash> returns the evidence without it.');
    this.name = 'AgentNotConfigured';
  }
}

export const agentConfigured = () => !!process.env.ANTHROPIC_API_KEY;

/** Class-id vocabulary, generated from the pool so the model can map "Tier 2" to a section. */
function classVocabulary(snapshot: Snapshot): string {
  const overview = poolOverview(snapshot);
  const sections = overview.bySection.map((s) => `${s.sectionId} (${s.tickets} escrowed)`).join(', ') || 'none';
  const sessions = overview.bySession.map((s) => `${s.sessionId} (${s.tickets} escrowed)`).join(', ') || 'none';
  return `Section ids present in the pool: ${sections}.\nSession ids present in the pool: ${sessions}.`;
}

const SYSTEM = `You explain RESHUFFLE settlement results for one selected intent.

RESHUFFLE is a market for outcomes: a participant signs the conditions they will accept, and a
settlement executes only when a whole reshuffle exists that satisfies every participant's own
signed conditions. Conditions include which sessions and sections they accept, exactly how many
tickets they want, whether those seats must share a session or section or be adjacent, and a
signed payment limit (positive means they will pay up to that; negative means they must receive
at least that).

You decide nothing yourself. Every fact you state must come from a tool result in this
conversation. Call a tool before answering.

Rules:
- Begin with "At Arc Testnet block #<block>," using the pinned block from the tool results.
- If no settlement was found, say "no settlement was found within the search bound". Never say
  a solution does not exist - the search is bounded and a bound is not a proof of absence.
- Never use these words: optimal, best price, guaranteed, no risk, impossible, locked,
  eliminates, only possible, risk-free.
- When a relaxation produced a settlement, call it "the smallest change among those tried".
- If the supply funnel reached zero, name the stage where it reached zero.
- If nobody accepts the tickets this intent offers, say that changing this intent's own
  conditions will not help.
- A what_if result is hypothetical: the participant would have to sign a new intent, and
  nothing moves until they do. Say so whenever you report one.
- Mention only addresses, ticket ids and amounts that appear in tool results. Amounts in tool
  results are in contract units; USDC has 6 decimals, so 30000000 is 30 USDC.
- At most four sentences, then one concrete next action.`;

export type AgentAnswer = GuardedAnswer & { model: string; turns: number };

/**
 * Answer one question about one intent, pinned to one snapshot.
 *
 * The snapshot is taken once by the caller and every tool reads that same one, so the block
 * number in the answer and the evidence describe the same moment.
 */
export async function ask(snapshot: Snapshot, intentHash: Hex, question: string): Promise<AgentAnswer> {
  if (!agentConfigured()) throw new AgentNotConfigured();

  const client = new Anthropic();
  const tools = dispatcher(snapshot, intentHash);
  const log: ToolLogEntry[] = [];
  const block = snapshot.block.toString();

  const messages: Anthropic.MessageParam[] = [
    {
      role: 'user',
      content: `Selected intent: ${intentHash}\nPinned block: ${block}\nQuestion: ${question}`,
    },
  ];

  let turns = 0;
  let answer = '';

  while (turns < MAX_TURNS) {
    turns++;
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      // Stable prefix first: the system prompt and tool list never vary, so they cache, and
      // the per-request question sits after them.
      system: [{ type: 'text', text: `${SYSTEM}\n\n${classVocabulary(snapshot)}`, cache_control: { type: 'ephemeral' } }],
      tools: TOOLS,
      messages,
    });

    // A safety decline is not an answer about the market; fall through to the deterministic
    // sentence rather than showing the refusal as if it were a diagnosis.
    if (response.stop_reason === 'refusal') break;

    if (response.stop_reason !== 'tool_use') {
      answer = response.content
        .filter((block): block is Anthropic.TextBlock => block.type === 'text')
        .map((block) => block.text)
        .join('\n');
      break;
    }

    messages.push({ role: 'assistant', content: response.content });

    const results: Anthropic.ToolResultBlockParam[] = [];
    for (const content of response.content) {
      if (content.type !== 'tool_use') continue;
      const output = await tools.run(content.name, content.input);
      log.push({ tool: content.name, input: content.input, output });
      results.push({
        type: 'tool_result',
        tool_use_id: content.id,
        content: JSON.stringify(output, bigintSafe),
      });
    }
    // All results for one assistant turn go back in a single user message.
    messages.push({ role: 'user', content: results });
  }

  // The guard needs something deterministic to fall back to, and the selected intent's own
  // diagnosis is it - computed here if the model never asked for it.
  const fallback = await tools.baseline();
  return { ...guard(answer, log, block, fallback), model: MODEL, turns };
}
