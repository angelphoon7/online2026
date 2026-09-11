# Solver

Off-chain, TypeScript, deterministic given the same inputs. Arc explicitly requires a working
backend, and this is it.

## Pipeline

```
1  fetch live intents from the subgraph
2  verify freshness against chain state          the indexer lags
3  search for valid reshuffles within budget
4  rank: gross cash moved, then participant count, then intent-hash order
5  eth_call simulate
6  submit propose+execute in one transaction
```

Steps 5 and 6 are immediately consecutive but are separate calls; simulation does not lock
state. A participant withdrawing in
between causes the transaction to fail; the proposer loses gas, which is why simulation comes
first.

## Issuer inventory is just another intent

The solver does not distinguish issuer intents. They appear in the pool with wide masks and a
negative `maxNetPay`, and they are the reason a chain can exist where no closed user-to-user
cycle does: issuer inventory **injects a ticket** into the graph, which lets another
participant's offered ticket flow directly onward in the same settlement. Nothing is relayed
through the issuer — V4 forbids a ticket being received twice.

Do not special-case them in ranking either — an issuer leg counts toward gross cash moved
like any other.

## Search

This is a combinatorial exchange. Bounded exhaustive search at demo scale.

**Publish the bound:** participant cap, candidate cap, timeout. Measure actual runtime and
candidate counts and report those, never estimates.

*No solution found* is not *no solution exists*. Say so wherever a result is displayed.

## Ranking

Several reshuffles may satisfy everyone. The contract accepts any of them — it checks
conditions, it does not rank. Selection is the solver's, so the rule must be published and
reproducible:

> Among valid reshuffles found within the search budget, minimise **gross cash moved** —
> `sum of max(netPayment, 0)` over all legs. Ties break toward fewer participants, then toward
> the lexicographically smallest ordered set of intent hashes.

The final tie-break is a hash comparison, not gas. The solver must be deterministic given the
same inputs; gas estimation is neither stable nor reliable on Arc. Measure gas and report it —
never rank on it.

**Gross, not net.** V7 requires `sum(netPayment) == 0` for every valid settlement, so net total
is identically zero and ranking on it would compare every candidate as equal. Gross cash moved
is the total USDC that has to move among participants. Minimising it is a defensible default
and nothing more — the system assigns no valuation to any ticket, so it cannot make claims
about value being absorbed anywhere.

**Never call the result optimal or the price best.** The search is bounded; a better solution
may lie outside it.

The interface distinguishes three numbers that are easy to conflate:

```
Your limit        30 USDC    what you signed
Actual payment    15 USDC    what this solution costs you
Why this one      least cash moved among 4 candidates
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
