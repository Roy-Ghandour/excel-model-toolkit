# modelkit — working plan

> **Status:** open questions + a proposed architecture. Nothing is built.
> Answer inline (or verbally); each question has a **recommendation** so you can
> say "defaults" to anything you don't care about.

---

## 0. Settled so far

| Decision | Value |
|---|---|
| Name | `modelkit` |
| Shape | **Completely headless.** CLI + JSON config. A UI may come later; nothing may assume one. |
| First (only) tool | Random sweep: do *N* runs with unique valid random inputs, export the data |
| Storage | **No database.** CSV / XLSX export, analysis happens elsewhere |
| Versioning | **Manual** (file management / git). One model file at a time |
| Target project | `ghandourroy/model-toolkit-project` (free, Public, personal account) |
| Model | `AIGovModel.xlsx` — must be uploaded to that project first |
| Style | Dependency injection at every model/runtime boundary |
| Decision generation | Model-specific, injected. Must produce **100% valid** runs |
| Facilitator settings | Fixed per sweep by an up-front config / config id, shared by all runs |

---

## 1. Proposed architecture

Three layers. The middle layer is the whole product; the outer two are swappable.

```
        ┌──────────────────────────── CLI ────────────────────────────┐
        │  bun run sweep --config sweeps/aigov-baseline.json          │
        └─────────────────────────────┬───────────────────────────────┘
                                      │
   ┌──────────────────────────── core (generic) ───────────────────────────┐
   │  SweepRunner   — for i in 1..N: derive seed → plan → execute → record │
   │  RunPlan/RunResult types · RunId hashing · Exporter (CSV/XLSX)        │
   │  Concurrency, retry, resume, progress                                 │
   │  Knows NOTHING about Forio, Excel, ministries, or named ranges        │
   └───────┬────────────────────────────────────────────┬─────────────────┘
           │ injected                                    │ injected
   ┌───────▼──────────────┐                    ┌─────────▼──────────────────┐
   │ ModelDriver          │                    │ ScenarioPolicy             │
   │ (HOW to talk to it)  │                    │ (WHAT a valid run is)      │
   │                      │                    │                            │
   │ ForioDriver          │                    │ AiGovPolicy                │
   │  create/reset run    │                    │  setup(): apply fac.       │
   │  read(vars)          │                    │    settings, crises, etc.  │
   │  write(vars)         │                    │  decideYear(state, rng):   │
   │  step()              │                    │    → valid decisions       │
   │  dispose()           │                    │  outputs(): what to record │
   └──────────────────────┘                    └────────────────────────────┘
```

**The two seams.** `ModelDriver` is *how* we reach a model (Forio today; a local
Excel engine or a mock tomorrow). `ScenarioPolicy` is *what the simulation's rules
are* (AI-Gov today; another sim tomorrow). The core sweeps blindly through both.

`ScenarioPolicy` is where every messy AI-gov-specific thing you listed lives:
policy unlock years, budget feasibility, sliders vs toggles, dilemmas, crises,
breaking news, enabled ministries. The core never sees any of it.

### Proposed file layout

```
modelkit/
  src/
    core/          sweep runner, types, run-id, exporters, rng
    drivers/       forio/  (+ mock/ for tests)
    scenarios/     aigov/  (policy, named-range map, output schema)
    cli/           sweep.ts, deploy.ts
  sweeps/          *.json — sweep configs (checked in)
  out/             exported CSVs (git-ignored)
  model/           the one .xlsx we care about
  references/      read-only material (already gathered)
  .claude/         reference docs
```

---

## 2. Questions

### A. Scope & workflow

**A1.** Is the sweep the *only* command in v1, or do you also want a `deploy`
command (upload/replace the `.xlsx` on Forio) from day one? The upload code is
already proven in `references/mvp-archive/deploy.ts` — it's near-free to port.
→ *Recommend: include `deploy`. Without it you're drag-and-dropping in the Forio UI every time you change the model, which fights your version-management goal.*

**A2.** After a sweep, what do you actually do with the CSV — Excel? Python/pandas?
Tableau? This decides whether "one wide row per run" or "one row per run-year"
is the right default shape.
→ *Recommend: emit **both** (`runs.csv` wide summary + `run-years.csv` long panel). Cheap, and covers either.*

**A3.** Should a sweep be resumable — i.e. if run 63 of 100 crashes, can you
re-invoke and continue? Or is "delete and rerun" fine at this scale?
→ *Recommend: write results incrementally to disk as each run finishes, so a crash never loses completed work, but no formal resume in v1.*

**A4.** Do you want a `--dry-run` that generates and prints the decisions for N
runs **without touching Forio**? Useful for eyeballing whether the randomiser
produces sensible, valid scenarios before burning API calls.
→ *Recommend: yes. It's a cheap flag and it makes the policy layer testable.*

### B. The sweep itself

**B1.** 100 runs × 4 years × (write decisions + step + read ~1300 named ranges).
That's a lot of round trips. What's an acceptable wall-clock time for 100 runs —
minutes, or is an hour fine? This drives how hard I optimise (`action()` batching,
concurrency, restricting the read set).
→ *Recommend: batch writes+step into one `action()` call per year, and read the full named-range set only at the end. Start sequential, add a `--concurrency` flag if it's slow.*

**B2.** How many runs concurrently? Forio's rate limits are **undocumented**
(noted as a gap in the platform reference). I'd have to find them empirically.
→ *Recommend: default concurrency 1, configurable. Do a short calibration spike before committing to a number.*

**B3.** Should the sweep read outputs **every year** (giving a full time series per
run) or only at the **end** (final scores only)? Every year is far richer data and
what you'd want for analysis, but ~4× the reads.
→ *Recommend: every year. The analysis value is the whole point; make it a flag if it's slow.*

**B4.** Which outputs get recorded? Options: (a) all 1329 named ranges,
(b) the 12 `save:true` vars from the `.ctx2`, (c) a curated KPI/score list
(TotalScore, the 4 ministry scores, the 12 KPI 4-tuples, NumTargetsMet, …).
→ *Recommend: (c) as the default, defined declaratively in the aigov scenario, with a config switch to dump everything. All 1329 per run per year would be unwieldy in a CSV.*

**B5.** Should inputs be recorded alongside outputs in the export, or only the
run-id (from which they're reproducible)? Recording all decisions makes very wide
rows (4 ministries × 22 policies × 4 years ≈ 350 columns) but makes the CSV
self-contained.
→ *Recommend: both — `runs.csv` carries id + config + outputs; a separate `decisions.csv` (long: run_id, year, ministry, variable, value) carries the inputs.*

**B6.** Should a run whose model returns an error or an obviously broken state
(e.g. negative budget) be **dropped**, **retried with a new seed**, or **exported
with an error flag** so you can see it?
→ *Recommend: export with a status column and a reason. Silently dropping data hides bugs in either the model or the randomiser.*

### C. Run identity / hashing

You said every possible run should have a hash/id encoding the decisions needed to
make that run. Two very different readings:

**C1.** Which do you mean?
- **(i) Seed-as-id** — the id *is* the PRNG seed. Given the same seed + same model
  + same policy version + same facilitator config, the run is exactly reproducible.
  Ids are short, and you can *replay* any run from its id alone.
- **(ii) Digest-of-decisions** — the id is a hash of the actual decision set. It
  identifies a scenario after the fact, but you can't reconstruct decisions from it.
- **(iii) Encoded decisions** — a compact reversible encoding of the full decision
  vector (e.g. the 22 policy toggles per ministry-year as a bitfield + slider values,
  base64'd). Genuinely "encodes the decisions"; longer, but decodable and enumerable.

→ *Recommend: **(i) + (ii) together**. Record `seed` (replayable, short) **and**
`decision_digest` (a sha256 of the canonicalised decision set, truncated to 16 hex
chars — used to detect duplicate scenarios). (iii) is the interesting long-term one
for enumerating the decision space, but it's YAGNI now and its format would be
locked to a model version.*

**C2.** The digest is only stable if the model version, policy version, and
facilitator config are also pinned. Should the exported id be **composite** —
e.g. `<model-hash>.<policy-version>.<config-hash>.<seed>` — so a run id is
meaningful across model versions?
→ *Recommend: keep those as separate columns rather than jamming them into one
string, plus a short `sweep_id` that ties every row to the sweep's manifest.*

**C3.** Should duplicate scenarios (same `decision_digest`) be rejected and
re-rolled, so "100 runs" means 100 *distinct* scenarios? With this decision space
collisions are astronomically unlikely, but the guarantee might matter to you.
→ *Recommend: detect and log collisions, don't re-roll.*

### D. The AI-Gov scenario policy

**D1.** Facilitator settings — the live sim stores these in a group-scoped **vault**
and the model reads them via `ReadVault`. For a headless sweep on *your own* project
there's no facilitator. Do we (a) write the settings directly into the model as
named ranges at Step 0 (bypassing the vault entirely), or (b) faithfully replicate
the vault mechanism?
→ *Recommend: (a). `readVault` in the live sim ultimately just does
`updateVariables({"name[0,0]": value})` for a handful of names — we can do that
directly and skip groups/worlds/vaults completely. Simpler and it's the same end state.*

**D2.** Which facilitator settings do you want exposed in the sweep config JSON?
Candidates from `defaultSimSettings`: `NumYears`, the four `*Enabled` ministry
flags, `_C1..C4Enabled` (crises), `AIFeedbackEnabled`, `FacilSetsTargets` + the
target values, `SliderReasoningEnabled`. All of them, or a curated subset?
→ *Recommend: expose all of `defaultSimSettings` in the config (it's just a JSON
blob written into the model), with a `defaults` file you override selectively.*

**D3.** `NumYears` — the reference notes it's unsettled between 4, 5 and 7.
What should a sweep default to?

**D4.** Crises and breaking news — are these **deterministic given the settings**
(e.g. `_C1Year` fixes when crisis 1 fires), or does the model roll its own randomness?
If the model has internal randomness, runs are **not** reproducible from a seed and
C1(i) above partly breaks. I need to check this — flagging it as a **risk**.

**D5.** Dilemmas — I haven't found these in the named-range list. Are they a newer
addition to the model? Where do they live?

**D6.** Are there decisions besides policies + sliders that a valid run must make?
From the reference: roles (`RoleUser0..4`), value positions (`Value1..6Position`),
`ValuesConfirmed`, `RolesConfirmed`, `GameMode`. Does a headless single-player
sweep need to set these, and to what?

**D7.** Policy availability by year — the reference shows `{Prefix}Pro{N}New`,
`...Show`, `...YearSelected`, `...CanCancel`, `...Decidedlastyr`. Is `...Show`
the authoritative "is this policy available this year" flag we should read before
choosing? And is *cancelling* a previously-taken policy a decision the randomiser
should also make, or should it only ever add?
→ *Recommend: read `Show` each year to get the legal choice set; v1 only adds
policies, never cancels. Revisit later.*

**D8.** Budget — the intended algorithm: read `{Prefix}AvaialbleToAllocate` (or
`BudgetRemaining`) each year, shuffle the available policies, greedily take them
while their `CostValue` fits, then set sliders with what's left. Is that a faithful
enough model of how a player behaves, or do you want a different randomisation
shape (e.g. target a spend fraction, weight by ministry)?
→ *Recommend: start with "greedy shuffled fill to a random target spend fraction
(uniform 0.5–1.0 of available budget)". Purely uniform greedy always maxes spend,
which is an unrealistic and narrow slice of the space.*

**D9.** Do you want the randomiser **pluggable within** the AI-gov scenario too —
i.e. several named strategies (`uniform`, `budget-greedy`, `min-spend`,
`single-ministry-focus`) selectable from the config? Useful later for comparing
strategy families.
→ *Recommend: design the interface so it's trivially pluggable, ship one strategy.*

**D10.** Free-text `...Reasoning` fields and the AI feedback path — skip entirely
for v1?
→ *Recommend: yes, skip. `AIFeedbackEnabled: 0`.*

### E. Forio mechanics

**E1.** The MVP proved anonymous `PROJECT`-scoped runs on a public project. But the
AI-gov model in the live sim is driven through **worlds** (`retrieveFromWorld`).
Will a bare `runAdapter.create(model, {PROJECT scope})` work for it, or does the
model need a world? I believe it will (worlds are for multiplayer, not a model
requirement) — but this is the **single biggest technical risk** and I'd want to
verify it before building on it.
→ *Recommend: a short spike — upload the model, create one anonymous PROJECT-scoped
run, write a decision, step, read back. Half an hour, de-risks everything.*

**E2.** 100 runs create 100 persisted runs on the Forio project, forever. Should
the sweep (a) delete each run when done, (b) mark them `hidden`, or (c) create them
`ephemeral: true` (in-memory, never written to the DB — faster, but nothing is
queryable afterwards)?
→ *Recommend: `ephemeral: true`, since we export to CSV ourselves and don't need
Forio's run database. Falls back to (a) if ephemeral breaks `REVIVE`/step semantics.*

**E3.** Does the `.ctx2` need changing for headless sweeps? Only 12 vars are
`save:true`. If we read every year *within* a live run we never need archived
state, so probably no — confirm?

**E4.** Bun or Node? model-tool used Bun (auto-loads `.env`, runs TS directly).
→ *Recommend: Bun. Zero build step for a CLI.*

**E5.** Do you want tests? A `MockDriver` + `MockPolicy` would let the core sweep
logic be tested with no network at all, and would also be the second implementation
that proves the DI seams actually work.
→ *Recommend: yes, a small suite. It's the cheapest possible proof that "it runs on
anything" is true rather than aspirational.*

### F. Config & output format

**F1.** One sweep config JSON — proposed shape. Does this look right?

```jsonc
{
  "sweepId": "aigov-baseline-001",
  "model": { "file": "AIGovModel.xlsx", "localPath": "model/AIGovModel.xlsx" },
  "target": { "account": "ghandourroy", "project": "model-toolkit-project" },
  "scenario": "aigov",
  "runs": 100,
  "seed": 20260830,          // master seed; run i uses derive(seed, i)
  "concurrency": 1,
  "settings": {              // facilitator settings, applied identically to every run
    "NumYears": 4,
    "EcEnabled": 1, "EnvEnabled": 1, "DefEnabled": 1, "EduEnabled": 1,
    "_C1Enabled": 1, "_C2Enabled": 1, "_C3Enabled": 0, "_C4Enabled": 0,
    "AIFeedbackEnabled": 0
  },
  "strategy": { "name": "budget-greedy", "spendFraction": [0.5, 1.0] },
  "record": { "cadence": "every-year", "outputs": "curated" },
  "out": "out/aigov-baseline-001/"
}
```

**F2.** Should the sweep write a **manifest** next to the CSVs — the resolved
config, the model file's sha256, the tool version, the wall-clock, and any
errors — so a result set is self-describing months later?
→ *Recommend: yes. This is your version management, given there's no database.*

**F3.** CSV only, or CSV **and** a formatted `.xlsx` (multiple sheets: runs,
run-years, decisions, manifest)? You mentioned Excel sheets.
→ *Recommend: CSV as the primitive; add an `--xlsx` flag that packs them into one
workbook. Doing it the other way round makes streaming/incremental writes awkward.*

**F4.** Do you want a summary printed at the end (N ok / N failed, score min/max/
mean, elapsed), or is silence-plus-files fine?
→ *Recommend: a short summary. Free, and it's how you'll notice something's wrong.*

---

## 3. Risks / unknowns I'd want to close before writing much code

| # | Risk | How to close it |
|---|---|---|
| R1 | AI-gov model may require a **world** rather than a PROJECT-scoped run (E1) | Spike: upload + drive one run anonymously |
| R2 | Model may contain **internal randomness** (crises, breaking news) → seeds don't fully reproduce runs (D4) | Run the same seed twice, diff the outputs |
| R3 | **Rate limits are undocumented** — 100 runs × 4 years × many calls could get throttled (B2) | Calibrate empirically at small N |
| R4 | Deriving the *legal* choice set each year depends on named ranges (`Show`, `CostValue`, `AvaialbleToAllocate`) whose exact semantics I've read about but not verified (D7, D8) | Spike: one manual run, inspect these values year by year |
| R5 | 800 KB workbook: per-step recalc latency unknown | Falls out of R1's spike |

**Proposed first move:** a single throwaway spike script that closes R1, R2 and R4
at once — upload the model, drive one run by hand, print the budget/availability
variables each year, run it twice with the same decisions and diff. One session.
Everything else in this plan is much cheaper to design once that comes back.

---

## 4. Build order (once questions are answered)

1. **Spike** — close R1/R2/R4. Throwaway code.
2. **Core skeleton** — types, `ModelDriver` + `ScenarioPolicy` interfaces, seeded
   RNG, `MockDriver`/`MockPolicy`, sweep loop, CSV exporter, manifest. Fully tested,
   no network.
3. **ForioDriver** — port `references/mvp-archive/forio.ts`. Proven against the tiny
   `test1.xlsx` first (it's a real second model — free proof the seam works).
4. **AiGovPolicy** — settings application, per-year legal choice set, budget-aware
   randomiser, curated output schema.
5. **CLI** — `sweep`, `deploy`, `--dry-run`, `--xlsx`.
6. **Calibrate** — find a safe concurrency, run 100 for real, look at the data.

---

## 5. Open items with no recommendation (need you)

- D3 (`NumYears` default), D5 (dilemmas — where are they?), D6 (roles/values —
  are they required?), A2 (what tool consumes the CSV), B1 (acceptable runtime).
- Everything else has a default you can accept by saying nothing.
