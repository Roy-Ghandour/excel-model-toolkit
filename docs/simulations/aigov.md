# AI-Governance — the rules modelkit enforces

What `[src/simulations/aigov.js](../../src/simulations/aigov.js)` checks, why each
rule exists, and what in the model or the live sim establishes it. The general design
is in `[the run-validity spec](../superpowers/specs/2026-09-11-run-validity-design.md)`;
this is the catalogue.

The governing standard: **a run must be one a player could have made.** Not merely
one the spreadsheet will compute a number for — the spreadsheet will compute a number
for almost anything.

## A step is a model column

Every AI-Gov timeline is nine columns wide, indexed 0–8, and **column 0 is the
baseline year**. It is not a decision column:

- `EcBudget` is `[0, 100000000 ×8]` — column 0 has no money at all.
- `Op1Year` is `[0,1,0,…]`: dilemma 1 belongs to column 1. Each `Op<n>Year` marks its
  own column, through `Op6Year` at column 6.
- `EcPro7Show` is `[2, 2, formula…]` — the literal `2` prefix is the unlock schedule,
  so a policy that unlocks in year 2 is locked through column 1.
- The live sim never writes it: `updateModel` writes timelines at `model.Step + 1`
  (`run-actions.js`), and `Step` is 0 before the first year is submitted.

So modelkit maps **step 0 to the setup turn** and **years 1…NumYears to steps
1…NumYears**, which is where the sim puts them. Step 0 carries the value ranking and
nothing else; it is the one thing a player settles before year 1 that the model
actually reads.

`NumYears` is 3–6 (the facilitator's slider), so a run is **4 to 7 steps** —
`minSteps` and `maxSteps` — and its length must be exactly `NumYears + 1`.

### `GameOver` stays 0, by construction

The setup turn spends a `step()`, so a run ends at `Step = NumYears + 1` while the
model defines `GameOver = IF(Step = NumYears, 1, 0)`. A finished modelkit run
therefore reports `GameOver` as 0 where a finished game reports 1.

This is deliberate and costs nothing: driving the same decisions with and without the
extra step produces **identical values for every timeline** — `TrustInGovernment`,
`EconomyScore`, `AverageMinistryScore`, `EcBudgetRemaining`, all of them. `Step` feeds
`GameOver` and the sim's own display logic, not the model's arithmetic. Anything
exporting results should read the timelines, not `GameOver`.

## What may be written

| Step | Names |
|---|---|
| 0 | `Value1Position` … `Value6Position`, all six, ranking 1–6 once each |
| 1…NumYears | `<M>Slider{1,2}`, `<M>Pro<N>`, `Op<N>Selected` |

Anything else is refused. That is strict on purpose: the model is full of computed
rows whose names look writable, and writing one silently replaces a formula. The
run-file example in this repo used to write `EcPro3New` — the unlock-detector row,
`=IF(AND(BI6=2,BJ6<>2),1,0)` — which no player has ever written.

The value ranking is required because it moves the model: `TrustInGovernment` reads
46.3 under `1..6` and 43 under `6..1`. A run states the ranking it ran under rather
than inheriting the workbook's.

## The rules

| Rule | Check | Established by |
|---|---|---|
| **Run length** | `NumYears + 1 === length`, checked at step 0 | `NumYears` is a single cell, so the length is settled before the first year |
| **Setup turn** | step 0 takes the whole ranking and nothing else | column 0 is the baseline; the ranking is the only setup the model reads |
| **Ranking is a permutation** | the six values are 1–6, once each | six values, six ranks |
| **Ministry in play** | no write to a ministry whose `<M>Enabled` is 0 | a disabled ministry never existed; the sim's own over-budget check filters through the enabled list, so nothing else would catch it |
| **Slider range** | `<M>Slider{1,2}` is a whole number 0–3 | four discrete marks in the UI; cost is an XLOOKUP over `[0, 10M, 20M, 40M]` |
| **Policy is binary** | `<M>Pro<N>` is 0 or 1 | the UI writes a checkbox |
| **Policy has a card** | `Pro3` … `Pro13/15/15/14` for Ec/Env/Def/Edu | the model carries `Pro3`–`Pro24` per ministry, 88 blocks; only 49 have a card in `initiatives-data.js`. None of the other 39 is permanently locked, so no other rule catches them |
| **Policy is on screen** | `<id>Show[step]` is 0 or 1 | see below |
| **Non-cancellable stays on** | cannot write 0 to an active policy whose `<id>CanCancel` is 0 | the card renders no delete control at all |
| **Dilemma is binary** | `Op<N>Selected` is 0 or 1 | 0 latches `Op<N>_` to −1, 1 latches it to 1 — both are answers |
| **Dilemma in its own year** | `Op<N>Year[step]` is 1 | every other column carries `=prev`; a write elsewhere would clobber the carry-forward |
| **Budget** | `<M>BudgetRemaining[step] >= 0` for each enabled ministry | the sim hides Proceed outright when any enabled ministry is negative |

### Why "on screen" is one rule and not three

`<id>Show` encodes the policy's whole lifecycle, and it is derived from the *previous*
column — so it is settled before the turn begins and cannot be changed by the turn's
own decisions.

| `Show` | Meaning | UI |
|---|---|---|
| 2 | locked, not yet in play | no card rendered |
| 0 | available | selectable |
| 1 | active | shown with a cancel control |
| 3 | abandoned | read-only |

`Done` is sticky (`Done[t] = IF(dec[t]=1, 1, Done[t-1])`), so 3 is permanent. That
makes "unlocked" and "not abandoned" the single predicate `Show ∈ {0,1}`, and no
separate sequence-shape check is needed to enforce that a policy's history is
`0* 1* 0*`.

It also closes a hole rather than merely tidying one. Cost is
`MAX((dec − Show) × CostValue, 0)`. Writing 1 against a locked policy gives
`(1 − 2) → 0` and against an abandoned one `(1 − 3) → 0`: both clamp to free, and both
still apply the policy's full impact. An invalid run here is not just illegal, it is a
free-money exploit.

### Why the budget rule reads the model

`BudgetRemaining` is a formula over the very column just written, covering the budget,
upfront costs, and the 20% recurring charge that starts the year after selection.
modelkit reads `after[<M>BudgetRemaining][step]` and re-implements none of it — the
standing rule that the model computes what the model computes.

Two consequences worth knowing: budgets do not carry over between years, and the four
ministries cannot transfer between each other. `EcCarriedOverBudget`, `EcInvBudget`
and `EcInvBudgetRemaining` exist as named ranges but point at empty cells — dead
leftovers, Economy only.

## Deliberately not checked

- **Sliders do not carry forward.** The decision row is nine literal `0`s, with no
  `=prev` chain — unlike policies, which do carry forward. Each year's level is
  independent, the full cost is charged every year, and an unwritten year is level 0.
  That is a fact a *generator* must respect; it is not a validity rule, because level
  0 is legal.
- **`{Ec,Env,Def,Edu}Confirmed`** is multiplayer bookkeeping. Every decision clears
  its ministry's flag and submitting clears all four; an unconfirmed ministry warns
  but does not block.
- **`RolesConfirmed` / `ValuesConfirmed` / `MinistriesConfirmed`** are frontend submit
  gates, not model inputs — a run computes correctly with `ValuesConfirmed` at 0.
  They are refused as unwritable until something needs them.
- **Crises and breaking news** (`_C<n>*`, `News<n>*`) are facilitator-configured
  events, not player decisions. Note they are timelines, not settings.
- **No cap on policies per year, no prerequisites between policies, no minimum
  spend.** Every `Show` formula references only its own block, so nothing gates one
  policy on another. The budget is the only limit.
- **Pace.** `Step` advances one at a time and the facilitator can cap how far a
  session runs. That is session state, not a model rule.

## Still open

Which further constraints the interface enforces that the model does not. Settled
rule by rule with the lead dev, as they come up.
