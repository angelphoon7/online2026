"use client";

interface EvidencePanelProps {
  evidence: {
    id?: string;
    source?: { kind: string; blockNumber: string; subgraphEndpoint: string | null };
    timestamp: string;
    intentsConsidered: number;
    candidatesFound: number;
    candidatesExcluded: { intentHashes: string[]; reason: string }[];
    chosen: { intentHashes: string[]; gross: string; reason: string } | null;
    simulationResult?: { success: boolean; error?: string };
    transactionHash?: string;
  } | null;
}

export default function EvidencePanel({ evidence }: EvidencePanelProps) {
  if (!evidence) return null;

  return (
    <details className="rounded-lg border border-white/10 bg-white/[.02]">
      <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-white/60 hover:text-white/80">
        Evidence Chain
      </summary>
      <div className="flex flex-col gap-2 border-t border-white/5 px-4 py-3 font-mono text-xs">
        <Row label="Timestamp" value={evidence.timestamp} />
        {evidence.source && <Row label="Source / block" value={`${evidence.source.kind} / ${evidence.source.blockNumber}`} />}
        {evidence.id && <a className="text-blue-400 underline" href={`/api/evidence/${evidence.id}`} target="_blank" rel="noreferrer">View full evidence</a>}
        <Row label="Intents considered" value={String(evidence.intentsConsidered)} />
        <Row label="Candidates found" value={String(evidence.candidatesFound)} />

        {evidence.candidatesExcluded.length > 0 && (
          <div className="flex flex-col gap-1">
            <span className="text-white/40">Excluded:</span>
            {evidence.candidatesExcluded.map((ex, i) => (
              <div key={i} className="ml-2 text-white/50">
                {ex.intentHashes.map((h) => h.slice(0, 10)).join(', ')} — {ex.reason}
              </div>
            ))}
          </div>
        )}

        {evidence.chosen && (
          <div className="flex flex-col gap-1">
            <span className="text-white/40">Chosen:</span>
            <div className="ml-2 text-white/60">
              {evidence.chosen.intentHashes.map((h) => h.slice(0, 10)).join(', ')}
            </div>
            <div className="ml-2 text-white/50">{evidence.chosen.reason}</div>
          </div>
        )}

        {evidence.simulationResult && (
          <Row
            label="Simulation"
            value={
              evidence.simulationResult.success
                ? 'passed'
                : `failed: ${evidence.simulationResult.error}`
            }
          />
        )}
        {evidence.transactionHash && (
          <Row label="Transaction" value={evidence.transactionHash} />
        )}
      </div>
    </details>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-white/40">{label}</span>
      <span className="text-white/60">{value}</span>
    </div>
  );
}
