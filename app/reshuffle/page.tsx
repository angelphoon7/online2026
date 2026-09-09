"use client";

import { useState, useCallback, useEffect } from 'react';
import { useWallet } from '@/lib/hooks/useWallet';
import { truncateAddress } from '@/lib/format';
import {
  getTicketMeta,
  getTicketOwner,
  getDepositor,
  getIntentState,
  approveNFTsForEscrow,
  depositTickets,
  withdrawTickets,
  signAndCommitIntent,
  hashIntent,
  revokeIntent,
  approveUSDC,
  submitSettlement,
  redeemTicket,
  getNextTokenId,
  getCommittedIntents,
  waitForTransaction,
} from '@/lib/contracts';
import { CONTRACTS, EVENT_ID, sessionName, sectionName } from '@/lib/config';
import TicketCard from '@/component/reshuffle/TicketCard';
import IntentCard from '@/component/reshuffle/IntentCard';
import IntentForm from '@/component/reshuffle/IntentForm';
import SettlementView from '@/component/reshuffle/SettlementView';
import EvidencePanel from '@/component/reshuffle/EvidencePanel';
import ArcGasNotice from '@/component/reshuffle/ArcGasNotice';
import ArcWalletBalance from '@/component/reshuffle/ArcWalletBalance';
import { findSettlement, confirmSettlementEvidence, type SettlementProposal, type SolveEvidence } from '@/lib/solve-api';
import type { Address, Hex } from 'viem';

interface Ticket {
  tokenId: bigint;
  eventId: number;
  sessionId: number;
  sectionId: number;
  row: number;
  seat: number;
  status: number;
  owner?: string;
  escrowed: boolean;
}

interface IntentDisplay {
  hash: Hex;
  owner: Address;
  offered: bigint[];
  exactCount: number;
  sessionMask: bigint;
  sectionMask: bigint;
  mustShareSession: boolean;
  mustShareSection: boolean;
  mustBeAdjacent: boolean;
  maxNetPay: bigint;
  deadline: bigint;
  nonce: bigint;
  state: number;
}

type DemoScene = 'overview' | 'cycle' | 'chain' | 'refusal';

export default function ReshufflePage() {
  const { account, chainId, connect } = useWallet();
  const [scene, setScene] = useState<DemoScene>('overview');
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [intents, setIntents] = useState<IntentDisplay[]>([]);
  const [selectedTickets, setSelectedTickets] = useState<Set<bigint>>(new Set());
  const [log, setLog] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [showIntentForm, setShowIntentForm] = useState(false);
  const [nonce, setNonce] = useState(0n);
  const [proposal, setProposal] = useState<SettlementProposal | null>(null);
  const [settlementStatus, setSettlementStatus] = useState<
    'pending' | 'simulating' | 'simulated' | 'submitting' | 'settled' | 'failed'
  >('pending');
  const [settlementError, setSettlementError] = useState<string>();
  const [settlementTxHash, setSettlementTxHash] = useState<string>();
  const [evidence, setEvidence] = useState<SolveEvidence | null>(null);

  const addLog = useCallback((msg: string) => {
    setLog((prev) => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  const loadData = useCallback(async () => {
    if (!account || !CONTRACTS.ticketNFT) return;
    try {
      const nextId = await getNextTokenId();
      const loadedTickets: Ticket[] = [];
      for (let i = 0n; i < nextId; i++) {
        try {
          const meta = await getTicketMeta(i);
          const depositor = await getDepositor(i);
          const isEscrowed = depositor !== '0x0000000000000000000000000000000000000000';
          let ticketOwner: string | undefined;
          if (isEscrowed) {
            ticketOwner = depositor;
          } else {
            try {
              ticketOwner = await getTicketOwner(i);
            } catch {
              // token may not exist
            }
          }
          loadedTickets.push({
            tokenId: i,
            ...meta,
            escrowed: isEscrowed,
            owner: ticketOwner,
          });
        } catch {
          break;
        }
      }
      setTickets(loadedTickets);

      const committed = await getCommittedIntents();
      setIntents(committed);
      const ownerNonces = committed.filter(i => i.owner.toLowerCase() === account.toLowerCase()).map(i => i.nonce);
      setNonce(ownerNonces.reduce((next, used) => used >= next ? used + 1n : next, 0n));

    } catch (err) {
      addLog(`Error loading: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [account, addLog]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (!account) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-black p-6">
        <h1 className="mb-6 text-3xl font-bold text-white">RESHUFFLE</h1>
        <p className="mb-4 text-white/60">A market for outcomes, not listings.</p>
        <div className="mb-6 w-full max-w-xl"><ArcGasNotice /></div>
        <button
          type="button"
          onClick={connect}
          className="rounded bg-blue-600 px-6 py-3 text-white transition-colors hover:bg-blue-500"
        >
          Connect Wallet
        </button>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-black text-white">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
        <h1 className="text-xl font-bold">RESHUFFLE</h1>
        <div className="flex items-center gap-4">
          <span className="rounded-full border border-white/10 px-3 py-1 text-sm">
            {truncateAddress(account)}
          </span>
        </div>
      </header>

      <div className="px-6 py-4">
        <ArcWalletBalance key={account} account={account} walletChainId={chainId} />
      </div>

      {/* Scene tabs */}
      <nav className="flex gap-1 border-b border-white/10 px-6">
        {([
          ['overview', 'Overview'],
          ['cycle', 'Scene 1: The Cycle'],
          ['chain', 'Scene 2: The Chain'],
          ['refusal', 'Scene 3: Refusal'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setScene(key)}
            className={`border-b-2 px-4 py-3 text-sm transition-colors ${
              scene === key
                ? 'border-blue-500 text-white'
                : 'border-transparent text-white/40 hover:text-white/60'
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Content */}
      <main className="flex flex-1 gap-6 p-6">
        <div className="flex flex-1 flex-col gap-6">
          {scene === 'overview' && (
            <OverviewScene
              tickets={tickets}
              intents={intents}
              account={account}
              onRefresh={loadData}
              addLog={addLog}
            />
          )}
          {scene === 'cycle' && (
            <SceneDescription
              title="Scene 1 — The Cycle"
              description="Three families hold tickets for different sessions. No two can trade directly. A three-way reshuffle moves all tickets in one atomic transaction."
              steps={[
                'Each family deposits their tickets into escrow',
                'Each signs an intent specifying what they want',
                'The solver finds a valid three-way reshuffle',
                'One transaction: all tickets move, all conditions verified',
              ]}
            />
          )}
          {scene === 'chain' && (
            <SceneDescription
              title="Scene 2 — The Chain"
              description="One family now wants cash only — no cycle exists. A registered buyer takes one end, a pure seller exits the other. The chain still completes."
              steps={[
                'The seller deposits tickets and signs a sell intent (exactCount=0, negative maxNetPay)',
                'The buyer signs a buy intent (no offered tickets, positive maxNetPay)',
                'The solver chains them into a valid settlement',
                'Tickets go to buyer, USDC goes to seller, all in one transaction',
              ]}
            />
          )}
          {scene === 'refusal' && (
            <SceneDescription
              title="Scene 3 — Refusal"
              description="Lower a budget below feasibility or revoke an intent. Nothing executes. The interface names the failing condition."
              steps={[
                'Create intents where budgets don\'t balance',
                'Try to submit — contract rejects with BudgetExceeded or PaymentImbalance',
                'Revoke an intent — contract rejects with IntentNotLive',
                'The named error on-screen proves the check is enforced on-chain',
              ]}
            />
          )}

          {/* Tickets */}
          <section>
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-medium">Tickets</h2>
              <button
                type="button"
                onClick={loadData}
                className="text-xs text-white/40 hover:text-white/60"
              >
                Refresh
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
              {tickets.map((t) => (
                <TicketCard
                  key={t.tokenId.toString()}
                  tokenId={t.tokenId}
                  eventId={t.eventId}
                  sessionId={t.sessionId}
                  sectionId={t.sectionId}
                  row={t.row}
                  seat={t.seat}
                  status={t.status}
                  escrowed={t.escrowed}
                  selected={selectedTickets.has(t.tokenId)}
                  onSelect={() => {
                    setSelectedTickets((prev) => {
                      const next = new Set(prev);
                      if (next.has(t.tokenId)) next.delete(t.tokenId);
                      else next.add(t.tokenId);
                      return next;
                    });
                  }}
                />
              ))}
              {tickets.length === 0 && (
                <p className="col-span-full text-sm text-white/40">
                  No tickets found. Deploy contracts and mint tickets first.
                </p>
              )}
            </div>
          </section>

          {/* Actions */}
          {selectedTickets.size > 0 && (
            <section className="flex gap-2">
              <ActionButton
                label={`Deposit ${selectedTickets.size} ticket${selectedTickets.size > 1 ? 's' : ''}`}
                loading={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const ids = [...selectedTickets];
                    addLog(`Approving NFTs for escrow...`);
                    await approveNFTsForEscrow(account);
                    addLog(`Depositing tickets: ${ids.map((id) => `#${id}`).join(', ')}`);
                    await depositTickets(account, ids);
                    addLog(`Deposited successfully`);
                    setSelectedTickets(new Set());
                    await loadData();
                  } catch (err) {
                    addLog(`Deposit failed: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setLoading(false);
                  }
                }}
              />
              <ActionButton
                label={`Withdraw ${selectedTickets.size} ticket${selectedTickets.size > 1 ? 's' : ''}`}
                loading={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    const ids = [...selectedTickets];
                    addLog(`Withdrawing tickets: ${ids.map((id) => `#${id}`).join(', ')}`);
                    await withdrawTickets(account, ids);
                    addLog(`Withdrawn successfully`);
                    setSelectedTickets(new Set());
                    await loadData();
                  } catch (err) {
                    addLog(`Withdraw failed: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setLoading(false);
                  }
                }}
              />
              <ActionButton
                label={`Redeem ${selectedTickets.size} ticket${selectedTickets.size > 1 ? 's' : ''}`}
                loading={loading}
                onClick={async () => {
                  setLoading(true);
                  try {
                    for (const id of selectedTickets) {
                      addLog(`Redeeming ticket #${id}...`);
                      await redeemTicket(account, id);
                    }
                    addLog(`Redeemed successfully`);
                    setSelectedTickets(new Set());
                    await loadData();
                  } catch (err) {
                    addLog(`Redeem failed: ${err instanceof Error ? err.message : String(err)}`);
                  } finally {
                    setLoading(false);
                  }
                }}
              />
            </section>
          )}

          {/* Create Intent */}
          <section className="flex flex-col gap-2">
            {!showIntentForm ? (
              <button
                type="button"
                onClick={() => setShowIntentForm(true)}
                className="rounded border border-dashed border-white/20 px-4 py-3 text-sm text-white/60 transition-colors hover:border-white/40 hover:text-white/80"
              >
                + Create Intent {selectedTickets.size > 0 ? `(offering ${selectedTickets.size} selected)` : '(pure buyer)'}
              </button>
            ) : (
              <>
                <IntentForm
                  offeredTickets={[...selectedTickets]}
                  loading={loading}
                  onSubmit={async (params) => {
                    setLoading(true);
                    try {
                      const intentNonce = nonce;
                      const intentParams = {
                        owner: account,
                        offered: params.offered,
                        eventId: params.eventId,
                        sessionMask: params.sessionMask,
                        sectionMask: params.sectionMask,
                        exactCount: params.exactCount,
                        mustShareSession: params.mustShareSession,
                        mustShareSection: params.mustShareSection,
                        mustBeAdjacent: params.mustBeAdjacent,
                        maxNetPay: params.maxNetPay,
                        deadline: params.deadline,
                        nonce: intentNonce,
                      };
                      addLog(`Signing intent (nonce ${intentNonce})...`);
                      const commitTx = await signAndCommitIntent(account, intentParams);
                      await waitForTransaction(commitTx);
                      const intentHash = await hashIntent(intentParams);
                      addLog(`Intent committed: ${intentHash.slice(0, 10)}...`);
                      setIntents((prev) => [
                        ...prev,
                        {
                          hash: intentHash,
                          owner: account,
                          offered: params.offered,
                          exactCount: params.exactCount,
                          sessionMask: params.sessionMask,
                          sectionMask: params.sectionMask,
                          mustShareSession: params.mustShareSession,
                          mustShareSection: params.mustShareSection,
                          mustBeAdjacent: params.mustBeAdjacent,
                          maxNetPay: params.maxNetPay,
                          deadline: params.deadline,
                          nonce: intentNonce,
                          state: 1,
                        },
                      ]);
                      setNonce((n) => n + 1n);
                      setShowIntentForm(false);
                      setSelectedTickets(new Set());
                      await loadData();
                    } catch (err) {
                      addLog(`Intent failed: ${err instanceof Error ? err.message : String(err)}`);
                    } finally {
                      setLoading(false);
                    }
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowIntentForm(false)}
                  className="text-xs text-white/40 hover:text-white/60"
                >
                  Cancel
                </button>
              </>
            )}
          </section>

          {/* Intents */}
          {intents.length > 0 && (
            <section>
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-medium">Live Intents ({intents.filter((i) => i.state === 1).length})</h2>
                {intents.filter((i) => i.state === 1).length >= 2 && (
                  <button
                    type="button"
                    disabled={loading}
                    onClick={async () => {
                      setLoading(true);
                      setProposal(null);
                      setSettlementStatus('pending');
                      setSettlementError(undefined);
                      setSettlementTxHash(undefined);
                      try {
                        const liveIntents = intents.filter((i) => i.state === 1);
                        addLog(`Searching for settlement among ${liveIntents.length} intents...`);
                        const result = await findSettlement(liveIntents);
                        setEvidence(result.evidence);
                        setProposal(result.proposal);
                        if (result.proposal && result.evidence.simulationResult?.success) {
                          setSettlementStatus('simulated');
                          addLog('Backend found and simulated a settlement');
                        } else if (result.proposal) {
                          setSettlementStatus('failed');
                          setSettlementError(result.evidence.simulationResult?.error);
                        } else {
                          addLog('No solution found within the search bound');
                        }
                      } catch (err) {
                        addLog(`Search failed: ${err instanceof Error ? err.message : String(err)}`);
                      } finally {
                        setLoading(false);
                      }
                    }}
                    className="rounded bg-green-600 px-4 py-1.5 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                  >
                    Find Settlement
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-2">
                {intents.map((i) => (
                  <IntentCard
                    key={i.hash}
                    intentHash={i.hash}
                    owner={i.owner}
                    offered={i.offered}
                    exactCount={i.exactCount}
                    sessionMask={i.sessionMask}
                    sectionMask={i.sectionMask}
                    mustShareSession={i.mustShareSession}
                    mustShareSection={i.mustShareSection}
                    mustBeAdjacent={i.mustBeAdjacent}
                    maxNetPay={i.maxNetPay}
                    deadline={i.deadline}
                    state={i.state}
                    onRevoke={
                      i.owner.toLowerCase() === account.toLowerCase() && i.state === 1
                        ? async () => {
                            try {
                              addLog(`Revoking intent ${i.hash.slice(0, 10)}...`);
                              await revokeIntent(account, i.hash);
                              setIntents((prev) =>
                                prev.map((pi) =>
                                  pi.hash === i.hash ? { ...pi, state: 2 } : pi
                                )
                              );
                              addLog('Revoked');
                              await loadData();
                            } catch (err) {
                              addLog(`Revoke failed: ${err instanceof Error ? err.message : String(err)}`);
                            }
                          }
                        : undefined
                    }
                  />
                ))}
              </div>
            </section>
          )}

          {/* Settlement proposal */}
          {proposal && (
            <section className="flex flex-col gap-3">
              <SettlementView
                legs={proposal.legs}
                gross={proposal.gross}
                candidateCount={proposal.candidatesFound}
                status={settlementStatus}
                error={settlementError}
                txHash={settlementTxHash}
                evidence={evidence}
                onSubmit={
                  settlementStatus === 'simulated'
                    ? async () => {
                        setSettlementStatus('submitting');
                        try {
                          const intentParams = proposal.intents;
                          const legs = proposal.legs.map((l) => ({
                            intentHash: l.intentHash,
                            receives: l.receives,
                            netPayment: l.netPayment,
                          }));

                          addLog('Submitting settlement...');
                          const txHash = await submitSettlement(account, intentParams, legs);
                          await waitForTransaction(txHash);
                          const confirmed = await confirmSettlementEvidence(proposal.evidenceId, txHash);
                          setEvidence(confirmed);
                          const hash = typeof txHash === 'string' ? txHash : String(txHash);
                          setSettlementTxHash(hash);
                          setEvidence((prev) =>
                            prev ? { ...prev, transactionHash: hash } : null
                          );
                          addLog(`Settled! tx: ${hash.slice(0, 10)}...`);
                          setSettlementStatus('settled');
                          setIntents((prev) =>
                            prev.map((i) =>
                              proposal.legs.some((l) => l.intentHash === i.hash)
                                ? { ...i, state: 3 }
                                : i
                            )
                          );
                          await loadData();
                        } catch (err) {
                          const msg = err instanceof Error ? err.message : String(err);
                          addLog(`Settlement failed: ${msg}`);
                          setSettlementError(msg);
                          setSettlementStatus('failed');
                        }
                      }
                    : undefined
                }
              />
            </section>
          )}
          <EvidencePanel evidence={evidence} />
        </div>

        {/* Sidebar — Activity log */}
        <aside className="w-80 shrink-0">
          <h2 className="mb-3 text-sm font-medium text-white/60">Activity Log</h2>
          <div className="flex max-h-[600px] flex-col gap-1 overflow-y-auto rounded-lg border border-white/10 bg-white/[.02] p-3 font-mono text-xs">
            {log.length === 0 ? (
              <span className="text-white/30">No activity yet</span>
            ) : (
              log.map((entry, i) => (
                <div key={i} className="text-white/50">
                  {entry}
                </div>
              ))
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}

function OverviewScene({
  tickets,
  intents,
  account,
  onRefresh,
  addLog,
}: {
  tickets: Ticket[];
  intents: IntentDisplay[];
  account: Address;
  onRefresh: () => void;
  addLog: (msg: string) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border border-white/10 bg-white/5 p-6">
        <h2 className="mb-2 text-xl font-medium">A market for outcomes, not listings</h2>
        <p className="text-sm leading-relaxed text-white/60">
          Sign the outcome you would accept. The market composes many such intents.
          Nothing moves until an entire outcome exists that satisfies every
          participant's own signed conditions. No partial execution. No trust in the solver.
        </p>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <StatCard label="Total Tickets" value={tickets.length.toString()} />
        <StatCard label="Live Intents" value={intents.filter((i) => i.state === 1).length.toString()} />
        <StatCard label="Your Tickets" value={tickets.filter((t) => t.owner?.toLowerCase() === account.toLowerCase()).length.toString()} />
      </div>
    </div>
  );
}

function SceneDescription({
  title,
  description,
  steps,
}: {
  title: string;
  description: string;
  steps: string[];
}) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-6">
      <h2 className="mb-2 text-xl font-medium">{title}</h2>
      <p className="mb-4 text-sm text-white/60">{description}</p>
      <ol className="flex flex-col gap-2">
        {steps.map((step, i) => (
          <li key={i} className="flex gap-3 text-sm">
            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-white/10 text-xs">
              {i + 1}
            </span>
            <span className="text-white/80">{step}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-4">
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-white/40">{label}</div>
    </div>
  );
}

function ActionButton({
  label,
  onClick,
  loading,
}: {
  label: string;
  onClick: () => void;
  loading: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={loading}
      className="rounded border border-white/10 px-4 py-2 text-sm text-white transition-colors hover:bg-white/5 disabled:opacity-50"
    >
      {label}
    </button>
  );
}
