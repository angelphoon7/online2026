export class SolveRequestError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message); this.name = 'SolveRequestError';
  }
}

export function solverErrorMessage(error: unknown): string {
  if (error instanceof SolveRequestError) return error.message;
  if (error instanceof Error && /^(Select|Live pool exceeds)/.test(error.message)) return error.message;
  return 'Solver unreachable. Your committed intent remains on-chain. Retry the solver.';
}
