"use client";

import { useState } from 'react';
import { SESSIONS, SECTIONS, EVENT_ID } from '@/lib/config';
import { parseUSDC } from '@/lib/format';

interface IntentFormProps {
  offeredTickets: bigint[];
  onSubmit: (intent: {
    offered: bigint[];
    eventId: number;
    sessionMask: bigint;
    sectionMask: bigint;
    exactCount: number;
    mustShareSession: boolean;
    mustShareSection: boolean;
    mustBeAdjacent: boolean;
    maxNetPay: bigint;
    deadline: bigint;
  }) => void;
  loading?: boolean;
}

export default function IntentForm({ offeredTickets, onSubmit, loading }: IntentFormProps) {
  const [selectedSessions, setSelectedSessions] = useState<Set<number>>(
    new Set(Object.keys(SESSIONS).map(Number))
  );
  const [selectedSections, setSelectedSections] = useState<Set<number>>(
    new Set(Object.keys(SECTIONS).map(Number))
  );
  const [exactCount, setExactCount] = useState(offeredTickets.length);
  const [mustShareSession, setMustShareSession] = useState(false);
  const [mustShareSection, setMustShareSection] = useState(false);
  const [mustBeAdjacent, setMustBeAdjacent] = useState(false);
  const [budgetType, setBudgetType] = useState<'pay' | 'receive'>('pay');
  const [budgetAmount, setBudgetAmount] = useState('0');

  function handleSubmit() {
    let sessionMask = 0n;
    for (const id of selectedSessions) sessionMask |= 1n << BigInt(id);

    let sectionMask = 0n;
    for (const id of selectedSections) sectionMask |= 1n << BigInt(id);

    const usdcAmount = parseUSDC(budgetAmount);
    const maxNetPay = budgetType === 'pay' ? usdcAmount : -usdcAmount;

    const deadline = BigInt(Math.floor(Date.now() / 1000) + 86400);

    onSubmit({
      offered: offeredTickets,
      eventId: EVENT_ID,
      sessionMask,
      sectionMask,
      exactCount,
      mustShareSession,
      mustShareSection,
      mustBeAdjacent,
      maxNetPay,
      deadline,
    });
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-white/10 bg-white/5 p-4">
      <h3 className="font-medium text-white">Create Intent</h3>

      <div className="text-sm text-white/60">
        Offering: {offeredTickets.length === 0
          ? 'none (pure buyer)'
          : offeredTickets.map((id) => `#${id}`).join(', ')}
      </div>

      {/* Session selection */}
      <fieldset>
        <legend className="mb-1 text-xs text-white/40">Acceptable sessions</legend>
        <div className="flex gap-2">
          {Object.entries(SESSIONS).map(([id, name]) => {
            const numId = Number(id);
            const checked = selectedSessions.has(numId);
            return (
              <label key={id} className="flex items-center gap-1.5 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selectedSessions);
                    if (checked) next.delete(numId);
                    else next.add(numId);
                    setSelectedSessions(next);
                  }}
                  className="rounded"
                />
                {name}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Section selection */}
      <fieldset>
        <legend className="mb-1 text-xs text-white/40">Acceptable sections</legend>
        <div className="flex gap-2">
          {Object.entries(SECTIONS).map(([id, name]) => {
            const numId = Number(id);
            const checked = selectedSections.has(numId);
            return (
              <label key={id} className="flex items-center gap-1.5 text-sm text-white/80">
                <input
                  type="checkbox"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(selectedSections);
                    if (checked) next.delete(numId);
                    else next.add(numId);
                    setSelectedSections(next);
                  }}
                  className="rounded"
                />
                {name}
              </label>
            );
          })}
        </div>
      </fieldset>

      {/* Exact count */}
      <label className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Exactly this many tickets</span>
        <input
          type="number"
          min={0}
          max={10}
          value={exactCount}
          onChange={(e) => setExactCount(Number(e.target.value))}
          className="w-20 rounded border border-white/10 bg-black px-2 py-1 text-sm text-white"
        />
      </label>

      {/* Constraints */}
      <fieldset>
        <legend className="mb-1 text-xs text-white/40">Constraints</legend>
        <div className="flex flex-col gap-1.5">
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input
              type="checkbox"
              checked={mustShareSession}
              onChange={(e) => setMustShareSession(e.target.checked)}
              className="rounded"
            />
            All must share one session
          </label>
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input
              type="checkbox"
              checked={mustShareSection}
              onChange={(e) => setMustShareSection(e.target.checked)}
              className="rounded"
            />
            All must share one section
          </label>
          <label className="flex items-center gap-1.5 text-sm text-white/80">
            <input
              type="checkbox"
              checked={mustBeAdjacent}
              onChange={(e) => setMustBeAdjacent(e.target.checked)}
              className="rounded"
            />
            Adjacent seats (same row)
          </label>
        </div>
      </fieldset>

      {/* Budget */}
      <div className="flex flex-col gap-1">
        <span className="text-xs text-white/40">Budget</span>
        <div className="flex items-center gap-2">
          <select
            value={budgetType}
            onChange={(e) => setBudgetType(e.target.value as 'pay' | 'receive')}
            className="rounded border border-white/10 bg-black px-2 py-1 text-sm text-white"
          >
            <option value="pay">Pay at most</option>
            <option value="receive">Receive at least</option>
          </select>
          <input
            type="text"
            value={budgetAmount}
            onChange={(e) => setBudgetAmount(e.target.value)}
            className="w-24 rounded border border-white/10 bg-black px-2 py-1 text-sm text-white"
          />
          <span className="text-sm text-white/60">USDC</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleSubmit}
        disabled={loading}
        className="mt-2 rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
      >
        {loading ? 'Signing...' : 'Sign & Commit Intent'}
      </button>
    </div>
  );
}
