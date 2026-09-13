# Planned tools

Tools we intend to build, in rough order of how ready they are. Each entry says
what it does, what it costs, and what is genuinely unsettled — so that picking one
up later means reading one section, not reconstructing a conversation.

Distinct from [deferred-decisions.md](deferred-decisions.md), which holds decisions
that are **settled but unbuilt**. These are tools that are **wanted but undesigned**:
the open questions are recorded rather than answered. Delete an entry when it ships,
and move anything it settles into the tool's own docs.

Everything here trades in [run files](runFile/run-file.md) — that is what lets these
compose. A tool that emits something else needs a reason.

---

## `id`

**Recompute a run file's identity.**

```sh
modelkit id runs/hand-written.run.json
```

Takes a run file and recomputes `id` from `settings` + `steps`, **whether or not one
is already there**, replacing a stale value rather than trusting it. This is the
deliberate, explicit counterpart to the automatic compare-and-warn described under
[run file id verification](deferred-decisions.md#run-file-id-verification): that one
happens on every load and only warns; this one is what you run to actually fix the
file.

The machinery exists — `runId()` in [`runFile.js`](../src/core/runFile.js) computes
it and `loadRunFile` already backfills a missing one. This is a CLI surface over
`runId`, not new logic.

**Open: what "name populated with ID" means.** Two readings, and they are not
exclusive:

- the **file** is renamed to `<id>.run.json`, which is what
  [`sample`](../src/tools/sample.js) already does for every run it writes;
- the run file's **`label`** field is set to the id.

The first is clearly wanted — it makes a hand-written file indistinguishable from a
generated one, which is the point. The second is worse than it sounds: `label` is
documented as "free text, the human handle for a run worth keeping", so filling it
with a hash spends the one field a human would have written *"defense collapsed in
year 3"* into. **Default to renaming the file and leaving `label` alone**; if a
label is wanted, it should be `--label`, set by a human.

**Note it must not touch anything else.** No re-validation, no model, no run. `id` is
a pure function of the JSON, and staying that way is what makes it safe to run over a
whole folder.

---

## `validate`

**Is this run file legal, and if not, why.**

```sh
modelkit validate runs/hand-written.run.json models/AIGovModel.xlsx
```

Drives the run with the rules on and reports violations, writing nothing. Exit 0 for
a clean run, 1 with a violation list otherwise.

**This reverses an earlier decision, deliberately.** The run-validity design argued
there should be no `validate` tool, because every tool that takes a run file already
validates as it runs — a separate one would be a second way to do the same thing.
That reasoning holds for a person, who is running `execute` anyway and will see the
error. It breaks for an agent, which hand-writes run files, gets them wrong, and
wants a check that is **cheap, side-effect-free, and machine-readable** — not one
buried in a tool that also prints a full trace and may write files. The cost of the
duplication is a thin wrapper over `preflight` + `replay` + the violations list.

**Should accept a scenario file too.** [`preflight`](../src/core/simulation.js) takes
both shapes, and an invalid *scenario* is the more common mistake — it invalidates
every run generated from it, which is exactly the failure
[`sample`](../src/tools/sample.js) special-cases on its first run.

**Layers 1 and 2 need no model run** (structure, then declaration), so a
badly-shaped file should be refused before the workbook is even parsed — a ~2s
saving per call that matters when something is calling this in a loop.

---

## `compare`

**One set of decisions, two models, one CSV.**

```sh
modelkit compare runs/baseline.run.json models/AIGovModel-v2.xlsx models/AIGovModel-v3.xlsx
modelkit compare runs/ models/AIGovModel-v2.xlsx models/AIGovModel-v3.xlsx
```

The question is *what did this model change do*, and the only honest way to answer it
is to hold the decisions fixed and vary the model.

**It must work over a collection, not just one run.** A single run tells you two
numbers differ; a hundred runs tell you whether the change is systematic, how large
it typically is, and which runs it does not affect. That is the actual question after
a model edit, and it is the reason this is worth building rather than diffing two
`execute` outputs by hand.

**On how the collection is named** — a folder is the right default and probably the
only mechanism needed. The generalisation that costs nothing: accept **any number of
paths, where a path may be a file or a directory**, and expand directories to their
`*.run.json` children. That covers one run, a folder, several folders, and a
shell glob (`runs/aigov-*.run.json`) with no new concept, and it is how every unix
tool behaves. A [`sample`](../src/tools/sample.js) output folder is then a valid
argument as-is, which is the case that matters.

**Cost.** Two model loads, then one run per file per model. Both engines stay loaded
across the collection — the [engine reuse](deferred-decisions.md) that took a sample
from 1.45s to 0.29s per run applies here unchanged. 100 runs × 2 models ≈ 1 minute.

**It needs `model.version` and `model.sha256`**, the two run file fields that
[exist in the contract and are written by nothing](deferred-decisions.md#run-file-fields-defined-but-written-by-nothing).
That entry names this tool as their arrival. Without them a comparison CSV cannot say
*which* two models it compared, which makes the output unciteable a week later.

**Open: what the CSV holds.** Per-run-per-model rows (tall) or per-run rows with
paired columns and a delta (wide)? Wide is what a human wants — the delta is the
finding — but it doubles the column count and needs a rule for results that exist in
one model and not the other. Settle this against a real pair of model versions rather
than in the abstract.

---

## `optimize --keep N`

**Emit the best N runs instead of the single best.**

A single optimum tells you the ceiling but not which decisions produced it. Five runs
within a point of each other tell you which choices *every one of them* makes — those
are the decisions that matter — and which vary freely, which are the ones that do not.

Purely additive: [`anneal`](../src/core/anneal.js) already sees every candidate's
score, so keeping a sorted top-N costs a few lines and no extra model runs.
[`optimise`](../src/tools/optimise.js) writes a folder instead of a file when `--keep`
is given, which makes its output a valid `compare` argument for free.

**The real work is de-duplication, not the top-N.** Consecutive accepted candidates
usually differ by one decision, so a naive top-5 is five views of one run. Filtering
by run `id` is not enough — they are genuinely different runs, just not usefully
different ones. Some spread criterion is needed (a minimum count of differing
decisions between kept runs is the obvious first try) and choosing it is the whole
task. This is recorded at more length under
[keeping more than the single best run](deferred-decisions.md#keeping-more-than-the-single-best-run).

---

## `sensitivity`

**How much does one input move the outputs.**

This is the properly-built version of the "vary one variable and see what happens"
idea, which today is done by hand: write the run files, run `execute`, read the
numbers. That works and is not urgent to replace. What it cannot do is scale, and
scale is where sensitivity findings actually live.

Forio asked for sensitivity testing specifically; the other two things they asked for
are [extreme-condition](#extreme-condition-testing) and
[structural](#structural-testing) testing, below.

### Three modes, one tool

**1. One-at-a-time, from a fixed baseline.** Hold a run fixed, vary one named range
across a range, one model run per point.

```sh
modelkit sensitivity models/AIGovModel.xlsx runs/baseline.run.json --vary EcSlider1 --range 0..3
```

Output is a CSV of input value → every result. Cheap (N runs), immediately readable,
and the mode to build first. Note the sharp edge: for AI-Gov most decisions are
**coupled forward** — change year 2's policy and year 3's budget moves with it — so
varying one input can invalidate later steps. The fix already exists as
`rules.repair`, which is what [`anneal`](../src/core/anneal.js) uses for exactly this
reason. Reuse it; do not re-solve it.

**2. Per-decision attribution of one run.** The same mechanism aimed at a *finished*
run rather than at the parameter space: given the run `maximize` just found, revert
each of its decisions in turn, re-run, and report each one's marginal effect on the
objective.

This answers *which of these forty decisions actually carried the score* — the
question everyone has on seeing an optimum, and one no amount of staring at the run
file answers. It is not a separate tool; it is mode 1 with the baseline being a real
run and the "range" being "this decision, or not". Cost is one model run per decision,
so ~40 runs for a 6-step AI-Gov run — cheaper than a single `maximize` restart.

**3. Global, over a sample.** Correlate decisions against outputs across a large
[`sample`](../src/tools/sample.js) rather than perturbing a baseline. This is the one
we have already done once, by hand, over 100 runs — and it produced the most useful
finding anyone has got out of modelkit so far, which was about the *sampler* rather
than the model: it cancels 77% of every policy it adopts, so that sample described
high-churn play rather than any strategy a player would follow.

Nearly free to wire in: `sample` already writes every run file and a results CSV, so
this is a post-pass over its own output. **The caveat is the finding above** — a
global sensitivity is only as good as the sampler's realism, and ours is not yet a
player. Modes 1 and 2 do not have that problem, which is a further argument for
building them first.

### Why this matters beyond curiosity

The mode that a teaching simulation actually needs is **policy sensitivity**: not
"does the output change" (it always does) but "does the *ranking* of decisions
reverse". If a small change to an assumption flips which strategy wins, the sim
teaches the wrong lesson, and nothing else in the toolkit would ever surface that.
Mode 2 over several runs is the cheapest route to it.

---

## Extreme-condition testing

**Does the model stay sane at its boundaries.**

Generate the corner cases from the simulation's declared bounds instead of at random —
`NumYears` at min and max, every ministry off, every slider at max, adopt every policy,
adopt none, spend nothing — run them, and assert that the outputs are still meaningful.

**The cheap first version needs no simulation knowledge at all.** A generic pass that
runs the corners and flags `NaN`, `#REF!`, `#DIV/0!`, `#N/A` and non-finite numbers
anywhere in the model's 1329 named ranges catches the whole class of "the spreadsheet
computed something rather than nothing", and the local driver already reads every
named range after every step. This is a few hours of work and would likely find
something today.

**The real version needs a new hook on the rules interface**: `invariants(state)`,
returning the same `{ name, reason }[]` shape `checkStep` does. *Trust is a
percentage. No budget may go negative. Population cannot fall below zero.* These are
model-specific claims that only a person who knows the simulation can write, and they
are exactly what distinguishes "the model produced a number" from "the model produced
a number that means something".

Note this is the first thing that would check the model rather than the run, which is
a genuine widening of what modelkit is for. Worth saying out loud before building it.

---

## Structural testing

**Does the workbook's structure make sense.**

Mostly *not* a run-time question — it is a workbook-inspection question, and the local
driver already parses the whole thing with HyperFormula, so the dependency graph is
sitting there unused. Things that fall straight out of it, none of which cost a single
model run:

- **Dead named ranges** — defined, never read by any formula. 1329 ranges is a lot of
  surface for nothing to be pointing at.
- **What feeds what** — for a named range, its upstream and downstream. This is the
  question anyone debugging an unexpected KPI actually has.
- **Authored-state errors** — `#REF!`, `#N/A`, `#DIV/0!` present before anything is
  written.
- **Circular references.**
- **Magic numbers** — constants hardcoded inside formulas rather than named, which are
  where undocumented assumptions hide.

**This shares a substrate with [`describe`](#describe--context)** — both need the model
to explain itself rather than merely compute. Whichever is built first should expose
the introspection as a core module rather than burying it in a tool.

---

## `upload`

**Push a run to Forio so it can be opened in the interface.**

The driver can already do the mechanical part: `createForioDriver` creates a real
Epicenter run, replays decisions into it, and hands back a `runKey`. Two things stand
between that and what is actually wanted.

**The small blocker.** `dispose()` calls `runAdapter.remove(runKey)` — the run is
deleted on close, by design, because everything using the Forio driver so far was a
parity check that should leave nothing behind. `upload` needs a keep-alive path, and
probably a non-ephemeral/saved run so it survives in the database rather than only in
memory.

**The real blocker, and the reason this is not nearly done.** A run created the way
`forioDriver` creates one **is not a student's session**. It is `PROJECT`-scoped, via
the `createSingular` scope-key trick, under an admin login, with no `userKey`. For a
run to show up in the interface the way a real participant's would, it has to exist in
the structure the interface reads:

- inside a **group** (the cohort), and a **world** (the shared multiplayer container
  that holds runs and users), rather than loose at project scope;
- **attributed to a user** — a `userKey` on the scope, so the run belongs to a
  participant rather than to nobody;
- with whatever the sim's own multiplayer state expects — role assignment, and the
  per-player fields the interface reads to decide who saw what.

So this is not "keep the run alive", it is "construct a plausible session". That means
`worldAdapter` and group/user provisioning, neither of which modelkit touches today,
and the world/episode adapter signatures are a **known gap** in
[the platform reference](../.claude/reference/forio-epicenter-platform.md) — they were
never retrieved. Expect the first day of this to be spent finding out what the API
actually is.

**Worth noting** that `test` and `testFull` — deleted 2026-09-14 — were the only
commands that touched Forio. `forioDriver.js` is still exercised by
`test/record-golden.js`, so it has not rotted, but there is currently no CLI path to
Forio at all. `upload` would be the first one back.

---

## `describe` / `context`

**A run file in English.**

*"Year 1: took the FDI incentive, put economy research at level 2, rejected the data
privacy dilemma. Year 2: …"* — a `.md` explaining what a run did, for someone who is
not going to read a JSON array of named ranges.

**Lowest priority and furthest from shipping**, for a reason worth being precise
about: it is the only tool here that cannot be built from what modelkit knows. A run
file is deliberately in the driver's vocabulary — `EcPro7New: 1` — and modelkit has no
idea that `EcPro7` is a policy, let alone which one. That is not an oversight, it is
[principle 1](../CLAUDE.md); the meaning lives in the simulation layer, and today the
simulation layer knows the *rules* about `EcPro7` but not its *name*.

So this needs a vocabulary hook per simulation — named ranges to human labels, and
which are policies vs sliders vs dilemmas — sourced from the live sim's own strings.
That hook is the actual deliverable; rendering prose from it is the easy half, whether
by template or by handing the structured version to an LLM.

**It is also the answer to "an agent has no model introspection."** An assistant
driving these tools cannot discover that `TrustInGovernment` is a KPI or that `EcPro7`
is a policy — it has 1329 undifferentiated names. The same vocabulary hook, exposed as
a machine-readable dump rather than as prose, is what fixes that, and it is worth
building in that order: the structured description first, the English second.

---

## `--json`

**Undecided — flagged here so the question does not get lost.**

Every tool currently prints prose for a person, mostly to stderr. Anything driving
modelkit programmatically has to scrape it. A `--json` mode would emit one structured
object per tool instead, and the argument for it is that it is worth more than any
single tool on this list: it is what turns five commands into a pipeline.

The argument against is that it is five separate output contracts to keep stable, and
`sample` and `compare` already emit CSV, which is machine-readable — so the win is
concentrated in the tools that currently emit *only* prose (`execute`, `validate`,
`maximize`/`minimize`) rather than being uniform across all of them.

**Not a decision. Settle it when something is actually driving modelkit in a loop**,
because the shape of what it needs is easier to see then than now, and a guessed
schema that nothing consumes is worse than no schema.

---

## Considered and dropped

Recorded so they are not re-proposed.

| Idea | Why not |
|---|---|
| `frontier` — Pareto front over several KPIs from a sample | Real, but not wanted. Multi-objective optimisation stays out; `maximize`/`minimize` take one objective, and [that decision has its own reasoning](optimising.md#what-is-not-here). |
| `branch` — keep steps 0..k of a run, re-decide the tail N ways | Counterfactual-from-a-decision-point. `anneal` does this internally; exposing it was not wanted. |
| `diff` — two run files or two result sets | Subsumed by `compare`, which needs the same logic internally. If it ever appears, it should be a module `compare` calls, not a command. |
| `attribute` as its own tool | Folded into [`sensitivity` mode 2](#three-modes-one-tool). It is the same machinery pointed at a finished run; two commands for one mechanism is worse than one command with a mode. |
| `XXX` — generate runs varying one variable | **Already covered.** Write the run files by hand or with an LLM and run `execute`. The scaled-up version is [`sensitivity`](#sensitivity). |
