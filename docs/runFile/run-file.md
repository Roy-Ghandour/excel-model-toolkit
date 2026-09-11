# The run file

A **run file** is the complete description of one run's inputs, as portable JSON.
It is the unit modelkit's tools trade in: a sweep emits many, `execute` executes
one, a compare tool feeds the same one to two model versions.

One rule generates most of what follows: **a run file describes inputs, in the
driver's vocabulary, and never outputs.**

- _Inputs_ — the decisions and settings written into a model. Results live in CSV
  exports that reference a run by its `id`.
- _The driver's vocabulary_ — named ranges and the step each is written at, which
  is exactly what `write(step, updates)` takes. Not model-meaningful concepts like
  "ministry" or "policy".

The consequence is that the **structure is generic while the content is
model-specific**. A run file replays through a bare driver with no simulation or
policy code loaded, so every tool works against every model for free. Anything that
knows what the values _mean_ lives in the injected policy layer, never here.

`[run-file.example.jsonc](run-file.example.jsonc)` **is the canonical example** —
every field, annotated. Read it first; this document is the contract behind it.

## Fields

| Field           | Required                          | Type             | Meaning                                                                               |
| --------------- | --------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `modelkit`      | **yes**                           | integer          | Format version of the run file itself. Currently `1`.                                 |
| `id`            | no                                | string           | `sha256` over the inputs, first 16 hex. See [Identity](#identity).                    |
| `label`         | no                                | string           | Free text. The human handle for a run worth keeping.                                  |
| `createdAt`     | no                                | string           | ISO 8601 timestamp of generation. Provenance only.                                    |
| `simulation`    | **yes**                           | string           | Which simulation this is a run of. Determines the ruleset a run is validated against. |
| `model`         | no                                | object           | What the run was generated against.                                                   |
| `model.file`    | no                                | string           | Model filename.                                                                       |
| `model.version` | no                                | string           | Semver. Declared compatibility _intent_.                                              |
| `model.sha256`  | no                                | string           | Exact identity of the model file. Provenance, not a constraint.                       |
| `origin`        | no                                | object           | How the file came to exist. See [Origin](#origin).                                    |
| `origin.tool`   | **yes**, when `origin` is present | string           | Which tool wrote the file.                                                            |
| `settings`      | no                                | object           | Named ranges written once, before stepping.                                           |
| `steps`         | **yes**                           | array of objects | Per-step named-range writes. May be empty: the model's base state.                    |

Optional fields are **absent rather than null**. Every value inside `settings` and
`steps` must be a finite number.

`model.version` and `model.sha256` answer different questions and both earn their
place: semver is what a human _declares_ about compatibility, the hash is what is
_true_ about identity.

### Why `simulation` is required

`simulation` names the simulation a run is of, and so the **ruleset it is
validated against** — which policy decides whether a decision was affordable,
whether a policy was unlocked that year, whether a slider was in range.

Every model declares the simulation it implements in a text named range,
`ModelKitID`. Every tool refuses a run file whose `simulation` differs from the
model's `ModelKitID`, or a model with none, before replaying it
(`[src/core/simulation.js](../../src/core/simulation.js)`).

A run file that cannot say which rules apply to it can never be verified. Making
the field optional would mean that the day legality checking arrives, some existing
corpus of run files has no ruleset to check against and cannot be retrofitted with
one — the information was never captured and is not recoverable from the decisions
alone. Requiring it from the first file costs a line and keeps every run
verifiable, forever.

A model with no rules worth enforcing still names one: the run files under
`[runs/](../runs/)` declare `"simulation": "savings"` even though the savings
workbook has no policy behind it yet.

## Execution

```
createRun()
write(0, settings)                    // skipped when absent
for i in 0 .. steps.length-1:
    write(i, steps[i])
    step()
```

- **The array index is the step.** `steps[0]` is written at step 0. There is no
  separate step number to contradict the ordering.
- `steps.length` **is the length of the run.** Nothing else declares it. `[]` is a
  run of length zero — the model exactly as authored, never stepped.
- `settings` is written at step 0. Single-cell named ranges ignore the step
  outright; for a timeline, step 0 is the run's starting column — so one write
  covers both without special-casing.

Implemented in `[src/core/replay.js](../src/core/replay.js)`.

## Identity

`id` is `sha256` over canonical JSON — object keys sorted recursively, array order
preserved — of `settings` **and** `steps` **only**, truncated to the first 16 hex
characters.

This recipe is **pinned**. Once ids are written into files and CSV exports,
changing what feeds the hash silently invalidates every id ever emitted.

Excluded deliberately: `model`, `simulation`, `origin`, `label`, `createdAt`.

- **Excluding** `model` **is the load-bearing choice.** The id names _the decisions_,
  so the same decisions carry one id across two model versions — which is what
  gives a compare tool a join key. Were the model in the hash, "this run on v1
  versus v2" would be two ids with nothing to join on.
- Key order cannot change an id: `{a:1,b:2}` and `{b:2,a:1}` are the same run.
  Array order can and must, because in `steps` the order _is_ the timeline.
- Identical decisions collide by construction, so detecting a duplicate scenario
  in a sweep costs nothing.

Generated run files always carry an `id`. Hand-written ones may omit it — writing a
run file by hand should not require computing a hash first — and it is derived on
load. A stored id is currently trusted; see
`[deferred-decisions.md](deferred-decisions.md)`.

## Origin

`origin` is a **discriminated union keyed on** `tool`. `tool` is the only field
every writer sets; everything beside it belongs to whichever tool wrote the file.

```json
{ "tool": "sweep",   "sweepId": "aigov-baseline-001", "index": 7, "seed": "20260910:7", "strategy": "budget-greedy" }
{ "tool": "compare", "sourceRunId": "dd891207bc59e44f" }
{ "tool": "hand" }
```

`tool` is an open string, so a new tool adds itself without touching the format.
**Never read a field beside** `tool` **without checking** `tool` **first.**

`seed` and `strategy` are worth calling out: they _explain_ a file, they do not
_reconstruct_ it. Re-running a seed against a different model version produces
different decisions, which is why the concrete values in `steps` are the definition
and the seed is only provenance.

> `origin` **is documentation, never control flow.**
>
> Nothing branches on it, computes from it, or lets it affect a run's outcome. That
> is the entire reason it is safe to validate `tool` and nothing else — a typo in
> `sweepId` cannot change a result, only confuse a reader.
>
> The day a tool wants to _branch_ on `origin`, it has stopped being provenance and
> the union needs real per-tool validation.

Hand-written run files are not expected to carry `origin` at all.

## Validation

`[src/core/runFile.js](../src/core/runFile.js)` checks **structure only**: that
required fields are present and every field is the right shape and type. It fails
on the first problem with the path to it, e.g.
`steps[3].transactionAmount must be a finite number, received: "10"`.

It deliberately does **not** check:

- **Whether the named ranges exist.** That is the driver's business — it knows the
  model's schema and refuses an unknown name before writing anything.
- **Whether the run is _legal_.** Whether a decision was affordable, whether a
  policy was unlocked that year, whether a slider was in range — all of that is
  specific to a simulation's own rules and belongs in its injected policy. No
  policy exists yet, so nothing checks legality today. Every run file still names
  its `simulation`, so the runs written now stay checkable once one does.

A structurally valid run file can therefore describe a run the simulation would
consider nonsense. That is intentional: it is the compare tool's job to surface it,
not the format's job to prevent it.

## Changing the format

`modelkit` is the format version. Bump it only for a change that breaks files
written against the old version.

**Does not warrant a bump** — adding an optional field. Unknown fields pass through
validation untouched, which is what makes every deferred field additive.

**Warrants a bump** — renaming or removing a field, changing a field's type,
changing execution semantics, or changing the `id` recipe.

## Deferred

Decisions that are agreed but deliberately not implemented live in
`[deferred-decisions.md](deferred-decisions.md)`. This document describes what the
format _is_; that one records what it will become.
