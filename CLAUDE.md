# modelkit — Claude guidance

Headless test-suite / sweep tool for **Forio Epicenter Excel models**. Built
specifically for the **AI-Governance** simulation first, behind dependency-injected
seams so it can be re-pointed at another model later ("Doom runs on anything").

**Status: planning.** No app code yet. The working document is [`plan.md`](plan.md) —
read it before writing anything. Nothing else in this repo is source; it is all
reference material and inherited docs.

## Non-negotiable principles

1. **Dependency injection at every model boundary.** Nothing outside `adapters/`
   may know that the model is AI-Governance, that the runtime is Forio, or that
   named ranges are called `EcPro7`. The generic core talks to interfaces only.
2. **YAGNI.** Implement a feature the first time it is actually needed, not before.
   The only tool in v1 is the random-sweep exporter.
3. **No database.** Results are exported as CSV/XLSX for analysis elsewhere.
4. **One model file.** Version management is manual (file management / git);
   the tool cares about exactly one `.xlsx` at a time and records which one it used.
5. **Every generated run must be 100% valid** per the simulation's own rules —
   validity logic is model-specific and lives in the injected decision policy.
6. **Config lives in JSON**, not in code and not in an interactive prompt.

## Forio documentation — always use the new site

Authoritative: **https://docs.forio.com/epicenter**. Legacy
`forio.com/epicenter/docs/public/*` is v2 material — fallback only. The v3 SDK
source of truth is **https://github.com/forio/epicenter-libs** (`src/adapters/*.ts`
JSDoc documents endpoints the docs site omits).

Local durable references:

- `.claude/reference/forio-epicenter-platform.md` — platform, SDK, run API, file API
- `.claude/reference/epicenter-model-interaction.md` — how the AI-gov sim drives the model

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
| `docs/inherited/` | The predecessor `model-tool` project's design, MVP findings, hosting notes. **`mvp-findings.md` is the most valuable — it records what was verified live.** |

The live sim repo is a sibling: `/Users/roy/Desktop/Work/ai-governance`.

## Target

Sweeps run against **`ghandourroy` / `model-toolkit-project`** (free, Public,
personal account). Never against `tr/ai-governance` — that is production.

## Secrets

Secrets live only in a git-ignored root `.env` (template `.env.example`). A global
guard blocks the assistant from reading `.env`. Never put secrets in tracked files.
