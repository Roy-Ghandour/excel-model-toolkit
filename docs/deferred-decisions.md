# Deferred decisions

Decisions that are **settled but deliberately not implemented**. The point of this
file is that none of them has to be carried in anyone's head: an undocumented
deferral is just something to forget, and later reads as an oversight rather than a
choice.

Each entry records the decision, why it was chosen over the alternative, why it is
deferred, and where it plugs in. Delete an entry when it ships.

---

## Run file id verification

**Decided 2026-09-10. Not built.**

Every generated run file carries an `id`. On load, the tool should recompute the id
from `settings` + `steps` and compare it against the stored value. On a mismatch it
should **warn on the console and prefer the computed value — not throw.**

**Why warn rather than throw.** A mismatch has exactly two causes, and both are
worth seeing rather than being blocked by: someone hand-edited the decisions in a
run file, or the hash recipe itself changed. Throwing would make hand-editing
hostile — you would have to compute a sha256 before your edit would load — and
hand-editability is a property of this format worth protecting. A warning surfaces
the problem without standing in the way.

**Why deferred.** It was deferred because nothing generated run files. That changed
on 2026-09-13: [`sample`](../src/tools/sample.js) writes files carrying a stored `id`,
so a hand-edited one can now be stale and the risk this guards against is live. Still
unbuilt; this is the next thing in this file to ship.

**Where it plugs in.** [`loadRunFile`](../src/core/runFile.js) currently ends with:

```js
return { ...run, id: run.id ?? runId(run.settings, run.steps) };
```

That `??` is the line this grows out of — replace it with a compare-and-warn. The
stored ids in `runs/*.run.json` were computed with `runId`, so they will match.

**Related.** The id recipe is pinned in [`run-file.md`](run-file.md#identity).
Changing what feeds the hash invalidates every id ever written, so if this ships
after ids are in CSV exports, the recipe is frozen from that point.

---

## Run file fields defined but written by nothing

**Decided 2026-09-10. `createdAt` and `origin` shipped 2026-09-13 with
[`sample`](../src/tools/sample.js); the two `model` fields not built.**

Two optional fields remain part of the run file contract and validated when present,
but written by no code today:

| Field | Arrives with |
|---|---|
| `model.version` | the compare tool |
| `model.sha256` | the compare tool |

**Why they are in the contract now.** Defining them up front costs nothing —
unknown and absent fields both pass validation, so each is additive and none needs
a `modelkit` bump when it starts being written. Agreeing the shape once, while the
reasoning is fresh, is cheaper than re-litigating it per tool.

**Why this is worth writing down.** A field that appears in the spec and in the
example but never in a real file looks like a bug. It is not: nothing has had
reason to write one yet.

**Where they plug in.** The compare tool needs `model.version` and `model.sha256` to
say anything useful about running one set of decisions against two model versions.

---

## Run file `simulation` picks no ruleset yet

**Decided 2026-09-10. Identity check shipped 2026-09-11; legality not built.**

`simulation` is **required** on every run file, enforced by
[`validate`](../src/core/runFile.js), and **read** by each tool before it
replays: a run file whose `simulation` differs from the model's `ModelKitID` named
range, or a model with none, is refused
([`simulation.js`](../src/core/simulation.js)). `ModelKitID` is read straight from
the `.xlsx`, so the check costs no run, and `replay` knows nothing of it.

Since 2026-09-12 it also picks the **ruleset** a run is checked against, through
[`simulations/registry.js`](../src/simulations/registry.js). Only one rule exists
so far — AI-Gov's sliders must be a whole number from 0 to 3 — so affordability,
policy availability and the rest are still to come.

**Why required from the first file.** A run file that cannot say which rules apply
to it can never be verified, and the information is not recoverable from the
decisions alone, so it could never be retrofitted onto an existing corpus.

**Where it plugs in.** Step 2 of the
[run-validity design](superpowers/specs/2026-09-11-run-validity-design.md):
`simulation` keys a rules registry, and legality is checked during replay against
the model's live state. Not as a pure function of the JSON, because AI-Gov's rules
depend on values the model computes.

**Resolved: what value belongs here.** A short ruleset id modelkit owns (`aigov`,
`savings`), not an Epicenter project short name, since the same model runs on more
than one project.

---

## `randomSettings` ships ahead of its caller

**Decided 2026-09-13. Built, unused.**

Every simulation now implements `randomSettings(rng)`, which draws one legal settings
map. Nothing calls it. [`sweep`](../src/tools/sweep.js) requires a
[scenario file](scenario-file.md), and [`sample`](../src/tools/sample.js) always has.

**Why it exists anyway.** A deliberate exception to YAGNI, made explicitly rather than
by drift: it was written alongside `results` as one expansion of the rules interface,
while the reasoning about what a simulation declares about itself was in front of us.
Adding it later would mean reopening every simulation for a second time.

**The tension a caller has to resolve.** AI-Gov's settings *imply the run's length* —
`NumYears + 1 === stepCount`, enforced by `checkStep` at step 0. **A tool that draws
settings derives its length from them**, rather than taking a length and hoping the
draw agrees.

That tension is what produced the [scenario file](scenario-file.md) on 2026-09-13:
`stepCount` and `settings` now travel as one object precisely because they are one
fact. But it is not resolved, only relocated. A caller of `randomSettings` must
displace *both* fields of the scenario together, drawing `stepCount` from the settings
it drew — it cannot draw settings into a scenario that already states a length.

**Where it plugs in.** A future generation tool that wants variety across settings and
not only across decisions — `sweep --random-settings`, most likely, which would make
the scenario file's `stepCount` and `settings` optional together rather than required
together.

---

## Running a sweep's runs in parallel

**Decided 2026-09-13. Measured, not built.**

`sweep` drives its runs one at a time. Worker threads would parallelise them — each run
is fully independent — but the measurements say it is not worth it yet.

**Note first that `Promise.all` would do nothing.** The local driver's `read`, `write`
and `step` are synchronous ([`localDriver.js`](../src/drivers/local/localDriver.js)); the
`await`s in [`simulate`](../src/core/simulate.js) exist for the Forio driver, which is
genuinely async. Concurrency on the local path needs real threads, not promises.

**Worker threads, measured on a 4-physical-core machine**, 24 runs of AIGovModel:

| workers | wall | speedup |
|---|---|---|
| 1 | 40.1s | 0.97x |
| 2 | 23.6s | 1.64x |
| 3 | 20.8s | **1.86x** |
| 4 | 21.5s | 1.80x |
| 6 | 23.8s | 1.62x |

It peaks at three and then *degrades*. An engine of AIGovModel is ~460MB, so several at
once are bound by memory bandwidth rather than CPU, and each worker also parses the
workbook itself. Output was verified identical to the sequential path.

**Why deferred.** Engine reuse shipped instead and was worth far more — 1.45s to 0.29s
per run, taking 100 runs from 2m30s to 31s — because 87% of a run was
`HyperFormula.buildFromSheets` rather than the simulation. 1.86x on top of that is a
poor return for a worker pool, slicing, and per-worker workbook parses.

**Where it plugs in.** The loop in [`sweep`](../src/tools/sweep.js), behind a `--workers`
flag. Note that engine reuse makes this *worse* per worker, not better: each worker would
hold its own pooled engine, multiplying the memory pressure that already caps the curve
above. Re-measure before building.

Since 2026-09-13 [`anneal`](../src/core/anneal.js) wants this more than `sweep` does, and
can use it less: a sweep's runs are independent, but a climb's are inherently sequential —
each candidate is a mutation of the one before. Only the **restarts** parallelise, which
caps the speedup at `--restarts` however many cores there are.

---

## Keeping more than the single best run

**Decided 2026-09-13. Not built.**

`maximize` and `minimize` emit one run file: the best found. A `--keep N` would emit the
best N instead.

**Why it is worth more than it looks.** A single optimum tells you the ceiling but not
*which decisions produced it*. Five runs within a point of each other tell you which
choices every one of them makes — those are the decisions that matter — and which vary
freely, which are the ones that do not. That is the question anyone actually has after
seeing an optimum, and it is a far better use of the output than the per-iteration
convergence CSV that was considered and rejected in the same conversation.

**Why deferred.** YAGNI, and it is purely additive: the search already sees every
candidate's score, so keeping a sorted top-N costs a few lines and no extra runs.

**Where it plugs in.** The `best` tracking in [`anneal`](../src/core/anneal.js) becomes a
bounded sorted list, and [`optimise`](../src/tools/optimise.js) writes a folder rather
than a file when `--keep` is given. Note the near-duplicate problem: consecutive accepted
candidates often differ by one decision, so a naive top-5 can be five views of one run.
De-duplicating by run `id` is not enough — they are genuinely different runs. Some spread
criterion is needed, and picking one is the real work here.

---

## Reading fewer named ranges per step

**Decided 2026-09-13. Not built.**

[`simulate`](../src/core/simulate.js) defaults to reading **every** named range after
every step — 1329 of them for AIGovModel. A search of 623 runs does that ~3700 times.

**Why it is tempting.** It is where the 0.3s per run goes, now that engine rebuilds are
gone, and a search feels the cost 623 times over where `sample` feels it once.

**Why it is not obviously a win.** The rules need most of them. `sample`, `repair` and
`mutate` read `<id>Show`, `<id>CanCancel`, `<id>CostValue`, `<id>CostRecurringValue`,
`<id>Type` for all 49 policies, plus `SliderCosts`, four `AvaialbleToAllocate`, six
`Op<n>Year` and the ministry flags; `checkStep` adds the four `BudgetRemaining`. The
objective adds one more, and which one is not known until the command line is read.

**Where it plugs in.** `names` is already a parameter of `simulate` and `generate`,
threaded and unused — so the seam exists. What does not exist is a way for a simulation
to *declare* what its rules read, which is what this needs and what makes it more than a
one-line change. Measure first: the win is bounded by what fraction of a run is actually
`read`, and that has not been profiled since engine reuse landed.

---
