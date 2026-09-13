# Optimising a run

`sweep` answers *what does this simulation typically do*. `maximize` and `minimize`
answer a different question — *what is the best a player could do* — and they need a
different method, because random sampling has no memory of what worked. A hundred
random AI-Gov runs plateau (`TrustInGovernment` 44.3–61.2) and the hundred-and-first
is no more likely to beat them than the first was.

So: hill-climbing with simulated annealing, restarted several times.

```sh
modelkit maximize models/AIGovModel.xlsx runs/aigov.scenario.json TrustInGovernment
modelkit minimize models/AIGovModel.xlsx runs/aigov.scenario.json JobsDisplaced
```

Everything simulation-specific is injected. [`anneal`](../src/core/anneal.js) knows
that a run has steps and that a number can be compared; what a *decision* is, and
which ones are legal, stays in the simulation's rules.

## The cost model

**One candidate is one full run of the model.** That is the whole budget calculation:
`--iterations 200 --restarts 3` is 623 runs, about three minutes for AIGovModel at
roughly 0.3s each. There is no cheap evaluation — the objective is whatever the model
computes, so finding it out means running the model.

## What a neighbour is

Hill-climbing needs *"perturb this run slightly, get another valid run"*, and for
AI-Gov that is genuinely hard: decisions are coupled forward. Change year 2's policy
and year 3's budget, unlock states and cancellability all move with it. You cannot
flip one number in a run file and expect a legal run back.

A candidate is therefore built by re-running the model with the incumbent's decisions
and one step changed:

```
step <  k   the incumbent's writes, verbatim
step == k   rules.mutate(...)      one decision changed
step >  k   rules.repair(...)      the incumbent's writes, mended where they no longer fit
```

The prefix is legal for free — the model is deterministic, so those steps meet exactly
the state they met the first time. `repair` is what keeps the move *local*: one
decision differs by intent, and the rest of the run differs only where the model
forced it to.

`k` is drawn uniformly and is deliberately **not** biased by temperature. Under repair
every `k` is already a local move, which is the point.

### Why not re-sample the tail instead

The obvious alternative needs no `repair` at all: replay steps `0..k-1`, then re-sample
`k..end` from scratch. Valid by construction, and no new hook on the rules interface.

It was rejected because its neighbourhood has **no small moves at early steps**.
Mutating a 6-step run at `k=1` re-randomises five of six steps — that is not a
neighbour, it is a fresh sample. But AI-Gov's early decisions are the ones that
dominate: budget compounds, `Show` unlocks off earlier selections, recurring charges
accrue from the year a policy was bought. That neighbourhood could only ever fine-tune
the decisions that matter least, and for everything that matters it degenerates into
the random restart that already plateaus.

## Why the temperature is measured, not passed

Simulated annealing accepts a worse candidate with probability `exp(Δ/T)`, and `Δ`
arrives in the objective's own units — around 1–5 for `TrustInGovernment`, around 10⁹
for `AIFDIStock`. A `--temperature` flag would need retuning for every named range, and
getting it wrong fails *silently*: too cold and it is plain hill-climbing that never
escapes a local optimum, too hot and it is a random walk that merely keeps a
best-so-far.

So before the search, mutations of a random run are probed, and `T₀` is set to the
temperature at which a typical one of those is accepted 80% of the time. It calibrates
to both the objective's units and to how much one decision actually moves them. The
schedule then cools geometrically to `T₀/100`.

Note that this is the spread of **one mutation**, not of two unrelated runs. Those
differ by far more, and a temperature taken from them would accept nearly every
downhill move for most of the search.

**Only mutations that actually move the objective are counted.** One that leaves it
alone is not a downhill move — it is accepted unconditionally — so averaging it in
would drag the temperature below the moves it exists to price.

## Sparse objectives

That last point is not a technicality, because how often a mutation moves the objective
varies enormously:

| Objective | Mutations that move it | Downhill moves in a default search |
|---|---|---|
| `TrustInGovernment` | roughly 2 in 3 | 254 |
| `JobsDisplaced` | roughly 1 in 40 | 20 |

`JobsDisplaced` is an Economy KPI, and in a four-ministry scenario most of what a run
decides is in the other three. Measured over 120 mutations of one random run, exactly
three moved it — `EcPro10`, `EcSlider2`, `EcPro7`.

So probing is **adaptive**: it stops at ten moving mutations or two hundred attempts,
whichever comes first, spending its budget in proportion to how hard the signal is to
find. A dense objective costs about a dozen runs; a sparse one costs the full two
hundred, and says so.

When fewer than 10% of mutations move the objective, the search says that too. It is
not broken — it is crossing a plateau, and a sideways move is how you cross one — but
most of its iterations will change nothing, and the honest response is usually a
scenario with fewer ministries in play, which concentrates the decisions that matter.

An objective that **no** probe moves is refused outright: there is no signal to follow,
and a search would be theatre.

## Reading the output

```
probing · 15 mutations · 10 moved · T0 3.99
restart 1/3 · start 52.30
restart 1/3 · iteration 14 · 58.90
restart 1/3 · best 79.40
...
best 79.40 · TrustInGovernment · restart 1, iteration 195
618 runs · 30% of 254 downhill moves taken · 2m 11s
```

That is a real run. A hundred random runs top out at 61.2.

**The downhill rate is the diagnostic.** Near 100% and the schedule ran hot — the
search was a random walk that happened to keep a best-so-far. Near 0% and it never
explored, so the answer is the first hill it found. Somewhere in between is a search
that did what it says.

It counts **only** the candidates that scored worse than the incumbent, because those
are the only ones the temperature governs — an equal or better candidate is taken
unconditionally. Counting every candidate instead would measure how flat the objective
is rather than how the schedule ran: on `JobsDisplaced`, where 97.5% of mutations
change nothing and are accepted for free, that reads as 98% however cold the search
actually was.

**The `start → best` line per restart** answers the other question: whether the search
beat where it happened to begin. Restarts exist because a single annealed climb can
still end in a local optimum and nothing inside it can tell that it has — so each one
begins from a fresh random run, and only the global best survives.

For a random baseline to compare against, run `sweep` — that is what it is for.

## Output

The best run, as an ordinary [run file](runFile/run-file.md), to stdout or `--out`.
Nothing is written until the search finishes, so an interrupted search leaves no
artifacts. The value found is recorded in `origin` alongside the objective and the
seed, so a file found this way can still be placed a month later.

Because it is an ordinary run file, `execute` will replay it and `test` will check it,
neither knowing a search ever happened.

## What is not here

- **No convergence CSV.** Per-iteration rows are a development-time concern; the
  acceptance rate carries the same diagnostic in one line.
- **One objective, no weights.** A weighted sum over several named ranges is a small
  change to the scoring function, but the honest version needs normalisation — the
  objectives here span 10⁹ — and it collapses a Pareto front to a single point chosen
  by weights nobody can calibrate by eye.
- **An invalid candidate is discarded and counted, never emitted.** `mutate` and
  `repair` draw only from the legal set, so a violation is a bug in one of them rather
  than an unlucky draw. The count is reported and the exit code is 1, but the search
  finishes: the incumbent is untouched, and losing a ten-minute search to report a bug
  a counter reports just as well is the worse trade.
