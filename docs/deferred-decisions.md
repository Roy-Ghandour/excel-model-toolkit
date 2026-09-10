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

**Why deferred.** Nothing generates run files yet, so no stored id can be stale
today. The risk this guards against does not exist until the sweep lands.

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

**Decided 2026-09-10. Not built.**

Four optional fields are part of the run file contract and validated when present,
but no code writes them today:

| Field | Arrives with |
|---|---|
| `createdAt` | the sweep |
| `origin` | the sweep (and any other generating tool) |
| `model.version` | the compare tool |
| `model.sha256` | the compare tool |

**Why they are in the contract now.** Defining them up front costs nothing —
unknown and absent fields both pass validation, so each is additive and none needs
a `modelkit` bump when it starts being written. Agreeing the shape once, while the
reasoning is fresh, is cheaper than re-litigating it per tool.

**Why this is worth writing down.** A field that appears in the spec and in the
example but never in a real file looks like a bug. It is not: nothing has had
reason to write one yet.

**Where they plug in.** The sweep writes `createdAt` and `origin` as it generates
each file. The compare tool needs `model.version` and `model.sha256` to say
anything useful about running one set of decisions against two model versions.

---

## Run file `simulation` is written but read by nothing

**Decided 2026-09-10. Not built.**

`simulation` is **required** on every run file and is enforced by
[`validate`](../src/core/runFile.js) — but nothing reads it yet, because the thing
that would read it does not exist.

It names the **ruleset a run is validated against**: the injected policy that
decides whether a decision was affordable, whether a policy was unlocked that year,
whether a slider was in range. Structural validation checks none of that today.

**Why required rather than optional, given nothing reads it.** A run file that
cannot say which rules apply to it can never be verified. If the field were
optional, the day legality checking lands there would be a corpus of run files with
no ruleset named — and it could not be retrofitted, because the information was
never captured and is not recoverable from the decisions alone. Requiring it now
costs one line per file and keeps every run ever written verifiable.

**Where it plugs in.** The first simulation policy. `simulation` becomes the
dispatch key: `policy(run.simulation).validate(run) → { ok, violations[] }`, pure,
no driver and no network. That same function is what makes a `--dry-run` possible
(generate and check without touching a model) and what a compare tool would run
against two model versions to report which decisions became illegal.

**Open: what value belongs here.** The example calls it `aigov`; the savings run
files call it `savings`. The comment on the example describes it as the Epicenter
project name, which for the live simulation would be `ai-governance`. Those are two
different conventions — a short ruleset identifier, or a literal Epicenter project
short name — and only one can be right. Settle it before more than a handful of run
files exist, because changing it later means rewriting all of them.

---

## Short runs leave an authored-default tail; the exporter owns the trim

**Decided 2026-09-10. Not built.**

A run file may declare fewer steps than the model's timeline is wide.
[`replay`](../src/core/replay.js) drives exactly `steps.length` transitions and then
reads the **whole** timeline, so the columns past the end of the run come back
populated with whatever the model computes from its **authored** cell contents.

`runs/savings-varied.run.json` (8 steps against a 13-column horizon) shows it:

```
Step                8
transactionAmount   [250, 250, 0, -100, 400, 0, 125, 125, 0, 0, 0, 0, 0]
Balance             [1000, 1337.5, ..., 3210.10, 3434.81, 3675.24, 3932.51, 4207.79]
                                          ^ end of run          ^ end of horizon
```

**This is correct behaviour, not a bug.** Stopping early and leaving the sheet to
compute the rest of its horizon is what Epicenter does too — the driver is not
diverging from the runtime, and reading the full state is the right call for
something whose job is to produce numbers rather than choose which ones matter.

**The two hazards it creates.**

1. **The tail is authored defaults, not zeros.** In `test.xlsx` the unwritten
   decision cells are empty, so they read `0` and a short run's tail looks like
   idling. That is a property of *that workbook*. A model shipped with non-zero
   authored decisions — which AIGovModel plausibly is, given the live sim carries
   `defaultSimSettings` — would instead run its own defaults past the end of the
   run. Verify this explicitly against AIGovModel rather than inheriting the
   assumption from the savings model.
2. **`final` mixes two time scopes.** Scalars are step-scoped (`Step` is 8); arrays
   are horizon-scoped (13 entries). So `final.Balance[8]` is the run's end state and
   `final.Balance.at(-1)` is four further years of default-driven growth. On a
   full-length run the two coincide — which is exactly the trap: `.at(-1)` looks
   right everywhere until a short run reaches it.

**Why nothing changes today.** The information needed to trim is already present and
already specified: `steps.length` is the length of the run, and nothing else declares
it ([run-file.md](runFile/run-file.md#L79)). Truncating inside `replay` would throw
away real model output that some analysis may legitimately want.

**Where it plugs in.** The CSV/XLSX exporter. It carries the step count and picks
**one** convention — either truncate timelines to `Step`, or emit the column index
alongside each value — so "end of run" is unambiguous in the output rather than
re-derived, differently, by each analysis downstream.
