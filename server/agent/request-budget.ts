import 'server-only';
import { setImmediate as yieldImmediate } from 'node:timers/promises';

export class AgentRequestTimeout extends Error {
  constructor(public timeoutMs: number) {
    super('The agent request reached its time limit. Retry to read a new snapshot.');
    this.name = 'AgentRequestTimeout';
  }
}

export class AgentRequestCancelled extends Error {
  constructor() {
    super('The agent request was cancelled.');
    this.name = 'AgentRequestCancelled';
  }
}

/** One monotonic deadline and cancellation signal, shared by every stage of an API request. */
export class RequestBudget {
  private controller = new AbortController();
  private deadline: number;
  private timer: ReturnType<typeof setTimeout>;
  private onCancel = () => this.controller.abort(new AgentRequestCancelled());
  readonly signal = this.controller.signal;

  constructor(readonly timeoutMs: number, private caller?: AbortSignal, private now = () => performance.now()) {
    this.deadline = this.now() + timeoutMs;
    this.timer = setTimeout(() => this.controller.abort(new AgentRequestTimeout(timeoutMs)), timeoutMs);
    this.caller?.addEventListener('abort', this.onCancel, { once: true });
    if (this.caller?.aborted) this.onCancel();
  }

  checkpoint(): void {
    // Timers cannot fire during synchronous search. Check elapsed time inside its loops too.
    if (!this.signal.aborted && this.now() >= this.deadline) this.controller.abort(new AgentRequestTimeout(this.timeoutMs));
    this.signal.throwIfAborted();
  }

  remainingMs(): number {
    this.checkpoint();
    return Math.max(1, Math.floor(this.deadline - this.now()));
  }

  async yield(): Promise<void> {
    this.checkpoint();
    await yieldImmediate(undefined, { signal: this.signal });
    this.checkpoint();
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    this.checkpoint();
    let onAbort: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      const result = await Promise.race([Promise.resolve().then(() => { this.checkpoint(); return work(); }), aborted]);
      this.checkpoint();
      return result;
    } catch (error) {
      this.checkpoint(); // Preserve the named timeout/cancellation through SDK error wrappers.
      throw error;
    } finally {
      this.signal.removeEventListener('abort', onAbort);
    }
  }

  dispose(): void {
    clearTimeout(this.timer);
    this.caller?.removeEventListener('abort', this.onCancel);
    // Cancel sibling I/O if another operation failed before the request deadline.
    if (!this.signal.aborted) this.controller.abort(new AgentRequestCancelled());
  }
}
