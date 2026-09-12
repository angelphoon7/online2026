/** A committed intent actually used by a candidate at the answer's snapshot block. */
export type CounterpartyIntent = {
  intentHash: `0x${string}`;
  owner: `0x${string}`;
  committedTx: string;
};
