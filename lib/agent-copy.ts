/** Read-only tool evidence wording, shared by the drawer and its copy checks. */
export const AGENT_EVIDENCE_COPY = {
  invalid: 'The agent returned incomplete evidence. Retry the question.',
  mismatch: 'The evidence does not match the selected intent and answer block. Retry the question.',
  missing: 'No evidence for the selected intent or pool was returned. Retry the question.',
  changes: 'Hypothetical changes',
  noChanges: 'No condition changes requested.',
  notEvaluated: 'Not evaluated: this intent is not live at this block.',
  found: 'Candidate found under these hypothetical conditions.',
  notFound: 'No candidate found within the search bound. This does not rule out a match outside that search.',
  candidate: 'Hypothetical candidate',
  participants: 'Participants',
  payment: "This intent's net payment",
  receives: 'This intent receives',
  noTickets: 'No tickets',
  commitments: 'Counterparty commitments used by this candidate',
  noCommitments: 'No counterparty commitments returned.',
  bound: 'Search bound',
  searchNotRun: 'Configured search bound (search not run)',
  hypothetical: 'Hypothetical only; this result cannot be submitted. Applying changed conditions requires a new signed intent. Settlement must validate all conditions before anything moves.',
  poolTotals: 'Pool totals',
  liveIntents: 'Searchable live intents',
  escrowedTickets: 'Escrowed, unredeemed tickets',
  buyers: 'Pure buyers',
  sellers: 'Pure sellers',
  sessionHeading: 'Escrowed tickets by session',
  sectionHeading: 'Escrowed tickets by section',
  sessions: 'Tickets by session',
  sections: 'Tickets by section',
  noSessions: 'No escrowed tickets by session at this block.',
  noSections: 'No escrowed tickets by section at this block.',
  excluded: 'Intents excluded from search',
  exclusionReasons: 'Exclusion reasons',
  noExclusions: 'No excluded intents at this block.',
  poolNote: 'These are snapshot counts. Tickets in escrow are not necessarily offered by a live intent or compatible with your conditions.',
  failed: 'Tool call failed',
  failureNote: 'This call returned an error, not a diagnosis or search result.',
  raw: 'Tool inputs and outputs (JSON)',
  rawNote: 'Accepted results for this intent and the pool at the answer block. Inputs describe requests; outputs contain the evidence or a call error.',
  sources: { fallback: 'Deterministic fallback tool result', direct: 'Direct endpoint result', model: 'Model-requested tool result' },
  changeLabels: {
    maxNetPayUsdc: 'Hypothetical signed payment limit', mustBeAdjacent: 'Adjacent seats required',
    mustShareSection: 'Same section required', mustShareSession: 'Same session required',
    addSections: 'Additional accepted sections', addSessions: 'Additional accepted sessions',
  } as Record<string, string>,
  changedValue: (field: string, value: number | boolean | number[]) => {
    if (field === 'maxNetPayUsdc') {
      const amount = value as number;
      return amount < 0 ? `Receive at least ${Math.abs(amount)} USDC` : `Pay up to ${amount} USDC`;
    }
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.join(', ') : 'None added';
    return String(value);
  },
  omitted: (count: number) => `${count} unrelated or unsupported tool result(s) omitted from this intent's evidence.`,
  whatIfTitle: (call: number) => `What-if result · call ${call}`,
  overviewTitle: (call: number) => `Pool overview · call ${call}`,
  intentBlock: (block: string, intent: string) => `Arc Testnet block #${block} · intent ${intent}`,
  poolBlock: (block: string) => `Arc Testnet block #${block} · indexed pool snapshot`,
  bounds: (participants: number, candidates: number, timeout: number) => `${participants} participants, ${candidates} candidates, ${timeout}ms.`,
  tickets: (ids: string[]) => ids.map(id => `Ticket #${id}`).join(', '),
};
