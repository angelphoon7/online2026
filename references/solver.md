# Solver

Off-chain, TypeScript, deterministic given the same inputs. Arc explicitly requires a working
backend, and this is it.

## Pipeline

```
1  fetch live intents from the subgraph
2  verify freshness against chain state          the indexer lags
3  search for valid reshuffles within budget
4  rank by the published rule
5  eth_call simulate
6  submit propose+execute in one transaction
```

Steps 5 and 6 are one transaction with no window between them. A participant withdrawing in
between causes the transaction to fail; the proposer loses gas, which is why simulation comes
first.

## Search

This is a combinatorial exchange. Bounded exhaustive search at demo scale.

**Publish the bound:** participant cap, candidate cap, timeout. Measure actual runtime and
candidate counts and report those, never estimates.

*No solution found* is not *no solution exists*. Say so wherever a result is displayed.

## Ranking

Several reshuffles may satisfy everyone. The contract accepts any of them — it checks
conditions, it does not rank. Selection is the solver's, so the rule must be published and
reproducible:

> Among valid reshuffles found within the search budget, minimise total net payment. Ties break
> toward fewer participants, then lowest gas.

**Never call the result optimal or the price best.** The search is bounded; a better solution
may lie outside it.

The interface distinguishes three numbers that are easy to conflate:

```
Your limit        30 USDC    what you signed
Actual payment    15 USDC    what this solution costs you
Why this one      lowest total net payment among 4 candidates
```

## Evidence chain

Every proposal emits an inspectable trace. This is also The Graph's evidence — the demand is
that live indexed data drives decisions, and this shows exactly how.

```
subgraph endpoint, block number
intents considered
candidates found
candidates excluded, each with its failing condition
chosen candidate and why
simulation result
transaction hash
```

"Excluded, with the failing condition" is the valuable part. It shows the solver reasoning over
real data rather than returning a fixture.

## Validation parity

The solver must reject anything `Settlement` would reject. A divergence means proposals fail
on-chain and the demo stalls.

Keep the constraint logic in one module, tested against the same fixtures as the Solidity
tests. When a constraint changes in `Settlement`, change it here in the same commit.

The solver checking a constraint is not a substitute for the contract checking it — a different
solver could submit anything.
