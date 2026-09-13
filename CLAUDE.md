# modelkit — Claude guidance

Headless test-suite / sampling tool for **Forio Epicenter Excel models**. Built
specifically for the **AI-Governance** simulation first, behind dependency-injected
seams so it can be re-pointed at another model later ("Doom runs on anything").

Source lives in [`src/`](src). [`docs/`](docs) is a **shared space with humans**:
the format contracts ([run file](docs/runFile/run-file.md),
[scenario file](docs/scenarioFile/scenario-file.md)), the per-simulation rule
catalogues ([`docs/simulations/`](docs/simulations)), and
[what is planned but unbuilt](docs/planned-tools.md). Material that is only ever
read by an assistant belongs in [`.claude/reference/`](.claude/reference), not
there. `references/` is read-only.

## Non-negotiable principles

1. **Dependency injection at every model boundary.** Nothing outside `adapters/`
   may know that the model is AI-Governance, that the runtime is Forio, or that
   named ranges are called `EcPro7`. The generic core talks to interfaces only.
2. **YAGNI.** Implement a feature the first time it is actually needed, not before.
   The only tools in v1 are the random-run generator and the sample exporter.
3. **No database.** Results are exported as CSV/XLSX for analysis elsewhere.
4. **One model file.** Version management is manual (file management / git);
   the tool cares about exactly one `.xlsx` at a time and records which one it used.
5. **Every generated run must be 100% valid** per the simulation's own rules —
   validity logic is model-specific and lives in the injected decision policy.
6. **Config lives in JSON**, not in code and not in an interactive prompt.
7. **No tests unless asked.** Do not write tests — new files or new cases in
   existing ones — without an explicit request. This overrides any skill that would
   otherwise reach for test-first, including `superpowers:test-driven-development`.

## Forio documentation — always use the new site

Authoritative: **https://docs.forio.com/epicenter**. Legacy
`forio.com/epicenter/docs/public/*` is v2 material — fallback only. The v3 SDK
source of truth is **https://github.com/forio/epicenter-libs** (`src/adapters/*.ts`
JSDoc documents endpoints the docs site omits).

Local durable references:

- `.claude/reference/forio-epicenter-platform.md` — platform, SDK, run API, file API
- `.claude/reference/epicenter-model-interaction.md` — how the AI-gov sim drives the model
- `.claude/reference/forio-mvp-findings.md` — what the predecessor MVP verified live
  against Forio: auth scopes, the file API, the upload path `forioDriver.js` is built on

## What is in `references/` (read-only)

| Path | What it is |
|---|---|
| `references/mvp-archive/forio.ts` | **Proven** anonymous run driver: scope-key-via-`createSingular` trick, session hygiene, localhost config. Template for the Forio adapter. |
| `references/mvp-archive/deploy.ts` | **Proven** model upload/replace/list/delete against the Forio file API, incl. the `epicenter/manager` admin auth that actually works on a personal account. |
| `references/mvp-archive/forioConfig.ts` | How `config.accountShortName` / `projectShortName` get set on localhost. |
| `references/mvp-archive/test*.xlsx` | Tiny savings-account models — useful as a fast, cheap second model to prove the DI seam. |
| `references/ai-governance-model/AIGovModel.xlsx` | The real model (live copy, 2026-08-27). |
| `references/ai-governance-model/AIGovModel.ctx2` | Which variables persist. Note only 12 are `save:true`. |
| `references/ai-governance-model/namedRanges.txt` | 1329 named ranges — the model's public API. |
| `references/ai-governance-model/constants.js` | The live sim's `namedRanges`, `MODEL_FILE`, `defaultSimSettings`, `singleCellDecisionVars`. |
| `references/forio-deploy/` | Forio's own proxy deploy script (team-account pattern, zip+explode). |

The live sim repo is a sibling: `/Users/roy/Desktop/Work/ai-governance`.

## Target

Runs go against **`tr` / `temp-project`** (private, team account), set in
`forio.json`. The driver logs in with project-scoped admin auth, credentials from
`.env`. Never against `tr/ai-governance` — that is production.

## Secrets

Secrets live only in a git-ignored root `.env` (template `.env.example`). A global
guard blocks the assistant from reading `.env`. Never put secrets in tracked files.
