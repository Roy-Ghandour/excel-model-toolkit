# Run validity — design

**Status:** agreed 2026-09-11. Steps 1 and 2 shipped; built one step at a time, in
the order under [Build order](#build-order).

## The problem

Three tools need the same thing:

| Need | Used by |
|---|---|
| **Validate** a run file against its simulation's rules | every tool that takes a run file |
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

## Architecture

### One step loop: `simulate`

[`simulate`](../../../src/core/simulate.js) drives a model from its authored state
to the end of a run. It knows no simulation. What varies between tools is injected:

- **`decide(step, state)`** — this step's writes. A run file returns what it
  recorded; a generator invents them from the state in front of it.
- **`rules`** — checked after each step. Omitted, nothing is checked.

```
initial = read()
write settings
before = read()                     the state the first decision is made in
for each step k:
  writes = decide(k, before)
  write(k, writes); step()
  after = read()
  violations += rules.checkStep({ step: k, writes, before, after })
  before = after
```

**It reads the whole model** — all 1405 named ranges, measured at 3–6ms locally,
against ~1.7s to build an engine. So no simulation declares which names it needs:
that would be friction for every new simulation and would buy nothing.

[`replay`](../../../src/core/replay.js) is built on it: the decisions are already
made, and `rules` are optional. It returns `violations` **as data**, alongside the
trace — always present, empty when no rules were passed.

### Checking a run and running it are one execution

A rule can only be judged against what the model calculates, so validating means
driving the run. That is the tool's own run, not an extra one, and on Forio a
second one would be a second server-side run.

What it does *not* mean is hiding the answer. Violations come back as a list, so:

- a tool refuses explicitly, at its own call site, with
  [`assertValid`](../../../src/core/violations.js);
- a caller that wants to report rather than refuse can;
- step 4's optimiser gets violations **structured**, which it needs to choose
  between repairing a neighbour and rejecting it.

There is no `validate` tool. Every tool that takes a run file passes the rules to
`replay` and asserts on what comes back, so nothing works with an unchecked run.

| Tool | How |
|---|---|
| `execute` | its one run is the validating run |
| `test`, `testFull` | the local side validates, and it already runs first, so an illegal run never reaches Forio |

The same `simulate` serves the generators later: sampling and neighbour-mutation
are `decide` functions, with `rules` on so what they produce is checked as it is
made.

### A simulation's rules

One object per simulation in [`src/simulations/`](../../../src/simulations/),
looked up by [`rulesFor`](../../../src/simulations/registry.js) with the id the run
file declares. It is the only place that knows the model's names and the
interface's constraints.

| Member | What it is | Status |
|---|---|---|
| `minSteps` / `maxSteps` | how long a run of it may be | shipped |
| `settings` | exactly the settings a run file must declare | shipped |
| `checkStep({ step, length, writes, before, after })` | → `{ name, reason }[]`. **Single source of truth.** | shipped |
| `sample(step, state, rng)` | proposes a step's writes; still checked | step 3 |
| `mutate` / `repair` | neighbour generation | step 4 |

The first three are **static facts, checked from a run file alone** by
[`assertDeclaration`](../../../src/core/runFile.js) before any model is driven. The
checking code is generic — it reads `minSteps`, `maxSteps` and `settings` off
whatever object `rulesFor` returns and never learns a named range. `checkStep` is
for everything that needs what the model computes; it is given `length` as well as
the step, so a rule can be about the run as a whole.

`settings` must match **exactly**: missing means the run silently inherited whatever
the workbook was saved with, unexpected means a named range nobody vetted is
reaching the model. This replaces the deferred `checkSettings` — a list of names
turned out to be all the rules anyone needed for what is written before stepping.

AI-Gov's length is not merely bounded, it is determined: a run is `NumYears + 1`
steps. That is `checkStep`'s business rather than the declaration's, because
`NumYears` is a setting the model reads — but it is caught at **step 0**, since the
value is already in the model before the first decision.

### One preflight

Every check that can be made before a run is driven runs in
[`preflight(driver, run)`](../../../src/core/simulation.js), in the order that
reports the real problem first — the wrong model is a worse mismatch than the wrong
shape:

```
assertSimulation(driver, run)     the file's simulation vs the model's ModelKitID
rulesFor(run.simulation)          →  returned, so the tool passes it to replay
assertDeclaration(run, rules)     stepCount in range, settings exactly declared
```

Separate functions, one ordered entry point. It is the only place the core reaches
the rules registry, which keeps `simulate`, `replay` and `runFile` registry-free.

A violation reads `step 2 · EcSlider1 · 5 is not a whole number from 0 to 3`.
Validation collects every violation rather than stopping at the first: the model
still computes a real state from an illegal decision, so later steps are still
worth checking.

Two implementations exist:

- **`savings`** (`models/test.xlsx`): 0 to 12 steps (its timelines are 13 columns
  wide), `initialBalance` and `interestRate`, and no step rules. A test workbook with
  no simulation behind it, registered so that "no rules" is distinct from "simulation
  modelkit has never heard of".
- **`aigov`** (`models/AIGovModel.xlsx`): 4 to 7 steps, five settings, and two step
  rules — `{Ec,Env,Def,Edu}Slider{1,2}` is a whole number from 0 to 3, and the run is
  `NumYears + 1` steps long. The rest — availability, budget, and what the interface
  enforces — is added with the lead dev.

### Neighbours cascade

In hill climbing, changing step *k* changes the state at *k*+1 and later, so a
later step can become illegal (for example, the budget it relied on is spent).
`simulate` already surfaces this: a neighbour is driven with the rules on, so any
cascade appears as violations. What to do then is decided when the optimiser is
built: **reject** the neighbour and draw another, or **repair** it by removing the
fewest choices that make the step legal.

## Identifying the simulation

The simulation id lives **inside the workbook** as the text named range
`ModelKitID`, holding the id string (`aigov`, `savings`). The cell it points at
is up to the modeller: AIGov uses `'Project Variables'!B1`, savings uses B16.

Why a named range rather than a fixed cell like Sheet1!A1:

- Named ranges are already the model's public API. The existing driver reads it
  with `readFromFile`, with no new concept. Forio reads it the same way, so a
  deployed model can be checked too.
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
- A model with no id is **refused**.
- A generated run file has the model's id stamped into `simulation`.

It is read straight from the parsed `.xlsx` with
[`readFromFile`](../../../src/drivers/local/localDriver.js), never through a run, so
the check costs nothing and `simulate` stays free of it.

## Build order

1. **Identity.** ✅ 2026-09-11. `ModelKitID` in both workbooks, checked by each
   tool before it replays ([simulation.js](../../../src/core/simulation.js)).
2. **Validate.** ✅ 2026-09-12, minimally. `simulate` + `replay` with rules +
   `assertValid` + the rules registry, with AI-Gov's slider rule as the only rule. More AI-Gov rules follow,
   walked through with the lead dev rather than read out of the live sim alone.
2.5. **Shape.** ✅ 2026-09-12. A run declares its own shape — `settings` and
   `stepCount` required — and each simulation declares the shape it takes:
   `minSteps`, `maxSteps`, `settings`. Checked by `assertDeclaration` inside
   `preflight`, before any model is driven. AI-Gov's `NumYears + 1` length rule is in
   `checkStep`.
3. **Sample.** Random valid runs: a `sample` that feeds `decide`.
4. **Neighbours.** `mutate` and reject-or-repair, with the optimiser.

## Open, resolved when their step arrives

- Which AI-Gov constraints the model computes and which only the interface
  enforces. Settled rule by rule with the lead dev.
- Which settings AI-Gov's list should hold beyond `NumYears` and the four ministry
  `*Enabled` switches. Nothing else matters yet; the rest of `defaultSimSettings`
  is added as a rule starts depending on it.
- Reject vs repair for neighbours (step 4).
