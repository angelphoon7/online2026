import type { MarketSnapshot } from './market-types';

export class SnapshotTooOld extends Error {
  constructor(public block: bigint, public required: bigint) {
    super(`SnapshotTooOld: received block ${block}, required ${required}`);
    this.name = 'SnapshotTooOld';
  }
}
export function requireSnapshotBlock(block: string, required: bigint) {
  if (BigInt(block) < required) throw new SnapshotTooOld(BigInt(block), required);
}

type State = {
  market: MarketSnapshot | null;
  floor: bigint;
  indexingBlock: bigint | null;
  revision: number;
  error: string;
};
const INITIAL: State = { market: null, floor: 0n, indexingBlock: null, revision: 0, error: '' };

// One store for every market read and the agent drawer. A receipt raises the floor BEFORE
// waiting. Neither a timeout nor an older concurrent response can lower or clear that floor.
export class MarketFreshness {
  private state = INITIAL;
  private listeners = new Set<() => void>();
  private pending: { revision: number; promise: Promise<boolean> } | null = null;
  constructor(
    private read: (fresh: boolean, minBlock: bigint) => Promise<MarketSnapshot>,
    private wait: (block: bigint) => Promise<unknown>,
  ) {}
  getSnapshot = () => this.state;
  getServerSnapshot = () => INITIAL;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(state: State) { this.state = state; this.listeners.forEach(listener => listener()); }
  requireBlock(block: bigint) {
    const floor = block > this.state.floor ? block : this.state.floor;
    this.publish({ ...this.state, floor, indexingBlock: floor, revision: this.state.revision + 1, error: '' });
  }
  current(revision: number) { return revision === this.state.revision; }
  canAnswer(revision: number, block: string) {
    return this.current(revision) && this.state.indexingBlock === null && BigInt(block) >= this.state.floor;
  }
  refresh = (fresh = false): Promise<boolean> => {
    const ticket = this.state;
    if (this.pending?.revision === ticket.revision) return this.pending.promise;
    const minimum = ticket.market && BigInt(ticket.market.blockNumber) > ticket.floor ? BigInt(ticket.market.blockNumber) : ticket.floor;
    const promise = (async () => {
      try {
        if (ticket.indexingBlock !== null && ticket.market?.source !== 'rpc') await this.wait(minimum);
        if (!this.current(ticket.revision)) return false;
        const market = await this.read(fresh || ticket.indexingBlock !== null, minimum);
        if (!this.current(ticket.revision)) return false;
        requireSnapshotBlock(market.blockNumber, minimum);
        this.publish({ ...this.state, market, indexingBlock: null, error: '' });
        return true;
      } catch (error) {
        if (this.current(ticket.revision)) {
          const message = error instanceof Error ? (error.message.startsWith(error.name) ? error.message : `${error.name}: ${error.message}`) : 'Public reads unavailable';
          this.publish({ ...this.state, error: message });
        }
        return false;
      } finally {
        if (this.pending?.revision === ticket.revision) this.pending = null;
      }
    })();
    this.pending = { revision: ticket.revision, promise };
    return promise;
  };
}
