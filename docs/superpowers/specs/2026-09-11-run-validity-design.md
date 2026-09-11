# Run validity — design

**Status:** agreed 2026-09-11. Not built. Built one step at a time, in the order
under [Build order](#build-order).

## The problem

Three tools need the same thing:

| Need | Used by |
|---|---|
| **Validate** a run file against its simulation's rules | any tool that takes a run file |
| **Generate** a random run that is valid | the sweep |
| **Generate a neighbour** of a run that is still valid | the hill-climb optimiser |

These are one problem: **given the model's state at step *k*, what decisions
are legal?** If each tool answers it separately, they drift apart. So the rules
are answered in one place, and all three tools go through it.

Before any of this, the tool needs to know **which** simulation's rules apply.
See [Identifying the simulation](#identifying-the-simulation).

## Principle: legality depends on state, so checking needs the model

In AI-Gov, whether a decision is legal depends on values the model computes.
Whether a policy is available this year is `EcPro7Show`. The budget left is
`EcAvaialbleToAllocate` / `EcBudgetRemaining`, and it depends on earlier
decisions and on model outputs. A run cannot be validated from its JSON alone.
It is **replayed**, and each step is checked against the state it produces.

- **Read the model's own values** wherever the model computes the rule's inputs
  (budget, availability). Never re-implement model logic in JS.
- **JS rules only for constraints the interface enforces and the model does not**
  (slider bounds, "cannot pick a policy that isn't shown", etc.). These are
  ported from the live sim's interface (`../ai-governance`).

This replaces the "pure, no driver and no network" validation described under
"Run file `simulation` is written but read by nothing" in
[deferred-decisions.md](../../deferred-decisions.md). That entry is updated when
this ships. The local driver is what makes validating by replay cheap.

## Architecture

### One guarded step loop, in core

A guarded variant of [`replay`](../../../src/core/replay.js). Generic: it knows
nothing about any simulation.

```
settings: write(0, settings), then check them
for each step k:
  state  = run.read(rules.reads)          what the interface shows before deciding
  writes = decide(k, state)               ← the only thing that differs per tool
  run.write(k, writes)
  after  = run.read(rules.reads)          what the interface shows after deciding
  violations += rules.check(k, state, after, writes)
  run.step()
```

Checking **after the write** mirrors the interface. A player picks, the model
recalculates, and the UI shows what's left. So the rules can read the model's
remaining budget instead of doing the cost arithmetic themselves.

### The three tools are three `decide` functions

| Tool | `decide(k, state)` | A violation means |
|---|---|---|
| Validate | the run file's `steps[k]` | the run is invalid. Report it. |
| Random run | `rules.sample(k, state, rng)` | a bug in `sample`. Throw. |
| Neighbour | the base run's `steps[k]`, except at the mutated step: `rules.mutate(...)` | see [Neighbours cascade](#neighbours-cascade) |

`check` runs on every path. **A generated run is valid because it passed the
same checker a hand-written file goes through**, not because the generator is
trusted. A generator bug shows up as a violation, never as a bad row in an export.

When validating, the replay **continues past a violation** and collects every
violation. The model still computes a real state from an illegal decision, so
later steps remain meaningful to check, and one report lists everything wrong.

### A simulation's rules

One object per simulation, looked up in a registry keyed by simulation id, in the
same way [`registry.js`](../../../src/cli/registry.js) lists tools. It is the only
place that knows the model's names and the interface's constraints.

| Member | What it is | Arrives |
|---|---|---|
| `reads` | named ranges `check` / `sample` need to see | step 2 |
| `check(k, state, after, writes)` | → `violations[]`. **Single source of truth.** | step 2 |
| `checkSettings(settings)` | → `violations[]` for facilitator settings | step 2 |
| `sample(k, state, rng)` | → writes for step *k*. A proposal; still checked. | step 3 |
| `mutate(...)` / `repair(...)` | neighbour generation | step 4 |

A violation names the step, the named range and the reason. For example:
`step 2 · EcPro7 · selected but EcPro7Show is 0`.

Two implementations from the start:

- **`savings`**: `test.xlsx`. It has a state-dependent rule (a withdrawal cannot
  exceed the balance), so it proves the seam and the after-write check on a
  cheap model before AI-Gov depends on either.
- **`aigov`**: `AIGovModel.xlsx`. Availability, budget, slider bounds, and any
  further interface conditions.

### Neighbours cascade

In hill climbing, changing step *k* changes the state at *k*+1 and later, so a
later step can become illegal (for example, the budget it relied on is spent).
The loop already handles this: a neighbour is a replay with the check running,
so any cascade shows up as violations. What to do then is decided when the
optimiser is built:

- **Reject** the neighbour and draw another. Simple, but it may waste a lot of
  replays.
- **Repair**: the rules supply `repair`, which removes the fewest choices needed
  to make the step legal.

## Identifying the simulation

The simulation id lives **inside the workbook** as the text named range
`ModelKitID`, holding the id string (`aigov`, `savings`). The cell it points at
is up to the modeller: AIGov uses `'Project Variables'!B1`, savings uses B16.

Why a named range rather than a fixed cell like Sheet1!A1:

- Named ranges are already the model's public API. The existing driver reads it
  with `run.read([...])`, with no new driver method. Forio reads it the same way,
  so a deployed model can be checked too.
- A1 on the first sheet is positional. Reordering the sheets or inserting a row
  silently breaks it.
- The name must not look like a cell address (letters then digits). HyperFormula
  refuses those (see
  [localDriver.js](../../../src/drivers/local/localDriver.js#L37-L43)).

The id is a **ruleset id that we own**, not a Forio project short name, because
the same model runs on `temp-project` and on production. This settles the open
"`aigov` or `ai-governance`" question in deferred-decisions: it is **`aigov`**.

Behaviour:

- The model's id picks the rules.
- A run file whose `simulation` differs from the model's id is **refused**.
- A model with no id is **refused**. `test.xlsx` gets `savings` added.
- A generated run file has the model's id stamped into `simulation`.

## Build order

1. **Identity.** ✅ Shipped 2026-09-11. `ModelKitID` in both workbooks, checked
   by each tool before it replays ([simulation.js](../../../src/core/simulation.js)).
   It is read straight from the `.xlsx`, so it costs no run. `replay` stays free of it.
   The rules registry moved to step 2: nothing to register until a `check` exists.
2. **Validate.** The rules registry, the guarded loop, plus `check` /
   `checkSettings`: savings first, then AI-Gov (conditions ported from
   `../ai-governance`).
3. **Sample.** Random valid runs.
4. **Neighbours.** `mutate` and reject-or-repair, with the optimiser.

Each step is designed in more detail when we reach it. Only step 1 is needed
before step 2 starts.

## Open, resolved when their step arrives

- Which AI-Gov constraints the model computes and which only the interface
  enforces. Found by reading `../ai-governance` in step 2.
- Where the rules modules live (`src/simulations/<id>/` is the working
  assumption).
- Whether a validation CLI tool (`modelkit validate <run> <model>`) ships with
  step 2, or validation first shows up inside existing tools.
- Reject vs repair for neighbours (step 4).
