# Epicenter Model Workbench — MVP Findings & Status

> **Status (2026-07-25):**
> - **Step 1 (connect + drive a model in the browser): ✅ done & verified live.**
> - **Step 2 (model swapping): partially done.** Switching between already-uploaded model versions ✅ works anonymously in the browser. **Programmatic *upload* of a model is ⚠️ BLOCKED on the free tier** — parked, to take another swing at soon (see §5).
>
> This doc replaces the original MVP plan. It captures everything learned across the MVP so a fresh session (or a human) can resume.
>
> **📌 Forio docs authority:** always use the new site **https://docs.forio.com/epicenter** first. Legacy `forio.com/epicenter/docs/public/*` = older v2, fallback only.

---

## 1. Why this MVP existed — three questions

Before committing to the full Workbench ([design.md](design.md)), de-risk:

- **(A)** Do we need the password-protected work project we can't spare, or can we use a **free, public** Epicenter project?
- **(B)** Can we **connect to Forio and drive a model** live (set inputs, step, read outputs)?
- **(C)** **Model swapping** — programmatically upload a new model and swap it, replacing the manual upload + sim-reset we do today.

## 2. Verdicts

| # | Question | Verdict |
|---|---|---|
| A | Free/public project usable? | **✅ Yes.** Free Personal plan; a **Public** project runs anonymously (no login). |
| B | Connect + drive a model? | **✅ Yes, verified live.** Anonymous run create/read/write/step all work on a public project. |
| C | Programmatic model swapping? | **⚠️ Split.** *Switching* between uploaded versions ✅ works anonymously. *Uploading* a model programmatically ❌ is blocked on the free Personal tier (no auth path — see §4.4/§5). |

Live target used throughout: **`ghandourroy` / `model-toolkit-project`** (free, Public).

## 3. What was built

**Browser app (React 19 + Vite, `epicenter-libs` v3), anonymous — no secrets in the browser:**
- `src/mvp/forioConfig.ts` — project coordinates + `MODELS` list + localhost `config` setup.
- `src/mvp/forio.ts` — thin driver: connect / read / `advanceYear` / reset, model-file-parameterised.
- `src/mvp/SavingsMvp.tsx` — UI: per-year transaction input, **Advance** (step), **Reset**, per-year Balance table, and a **Model version dropdown** (switching = fresh run of the selected file).
- `src/mvp/models/test1.xlsx` (5% interest) and `test2.xlsx` (10%) — the two versions.

**Deploy CLI (Node/Bun) — for authenticated accounts only:**
- `tools/deploy.ts` (`bun run deploy` / `--list`) — logs in, uploads `src/mvp/models/*.xlsx` via the Forio **file API**. Correct code; can't authenticate on free Personal (§4.4).

**Secrets & guard:**
- Root `.env` (git-ignored; template `.env.example`) — Bun auto-loads it for deploy.
- Global secret-file guard `~/.claude/hooks/guard-sensitive.py` + `~/.claude/settings.json` — blocks the assistant from reading `.env`, keys, `.ssh`/`.aws`, etc., across every project.

## 4. Findings in detail

### 4.1 Forio tiers & access
- **Personal plan is free**; unlimited public & private projects; **0 authenticated projects** (authenticated = paid Team+).
- **Public** project ⇒ reachable at `forio.com/app/{account}/{project}` with **no end-user login**, and **anonymous run creation is allowed**. This is the whole basis of Step 1.
- "Public" = no *end-user* password. It does **not** grant *authoring* rights anonymously (uploading files still needs an author — see §4.4).

### 4.2 The test model (`src/mvp/models/test1.xlsx`, 5%)
Sheet "Savings account simulation". Named ranges: `initialBalance` (B3=500), `interestRate` (B4; 0.05 in test1, 0.10 in test2), `Time` (B6:N6 = 0…12), `transactionAmount` (B7:N7, input), `Balance` (B8:N8, output), `Step` (B10=0).
- **Verified formula (live):** `Balance[t] = (Balance[t-1] + transactionAmount[t-1]) · (1 + interestRate)`.
- ⇒ a transaction entered in year *k* lands in year *k+1*'s balance. `advanceYear` writes `transactionAmount[0,currentStep]` then steps. Decisions are strictly forward-looking (year 0 decision leaves year 0 balance untouched) — same invariant as ai-governance; the exact column differs per model's formula.
- Cell addressing: scalars `X[0,0]`; year columns `X[0,<step>]`. `test2.xlsx` was generated from test1 with `interestRate=0.1`, refreshed cached balances, and `fullCalcOnLoad`.

### 4.3 Connecting anonymously (Step 1) — gotchas solved
- **`GET /project` (and `projectAdapter.get`) → 401 anonymously.** Our first draft used it to fetch the project scope key and failed with "Not authorized."
- **Fix:** `runAdapter.createSingular(model)` works anonymously and its response includes `scope.scopeKey`. We mint it once to discover the key, then `runAdapter.create(model, {PROJECT, scopeKey})` for real, resettable runs.
- Confirmed 200 anonymously: create run, `getVariables`, `updateVariables`, `operation('step')`. Example: fresh run, deposit 100 at year 0 → `Balance[1] = (500+100)·1.05 = 630`.
- **Stale session/pseudonym:** the SDK caches a session cookie (`com.forio.epicenter.session`); a leftover guest/pseudonym bound to another account caused `PSEUDONYM_KEY does not belong to account`. Fixed by `authAdapter.removeLocalSession()` before connecting (in `ensureAnonymous`).
- **Refresh resets the model** — by design: `connect()` creates a fresh run each load and we don't persist the runKey. Making it resume would need runKey persistence + a `.ctx2` marking `Step`/`Time` as `save:true`. Fine for the MVP.
- CORS from localhost → forio.com works (reference project does the same via `config.isLocal()`).

### 4.4 Model swapping (Step 2)
**Switch half — ✅ works.** Both versions live on the project; the dropdown picks the model `file` and starts a fresh run. Fully anonymous, instant, no re-upload per switch. Confirmed test1 → year-1 balance 525 (5%), test2 → 550 (10%).

**Upload half — ❌ blocked on free Personal. Full auth investigation:**
- Upload path is the Forio **file API**: `PUT /api/v3/{account}/{project}/file/{modelDir}/{name}` (multipart). Wrapped by `epicenter-libs` `fileAdapter` (browser-only multipart), so the CLI uses raw `fetch`. Uploading requires an **authenticated author** — never anonymous.
- `POST /api/v3/{account}/{project}/authentication` credential `objectType` values are exactly **`user` / `admin` / `account`** (probed live; any other value → `INCOMPREHENSIBLE_REQUEST`). Results with real/dummy creds:
  - `user` → **401** (`AUTHORIZATION_FAILURE`). `user` is project-participant login; the Personal-project **owner is not enrolled as a participant**.
  - `admin` → **500** (`PersonalAccount cannot be cast to TeamAccount`). `admin` is **Team-account only**.
  - `account` → app credentials; needs a **Secret API key** (dummy key → clean `AUTHORIZATION_FAILURE`, so the field/shape is right — just needs a real key).
- **No API Keys anywhere in the free Personal project UI.** Settings → *General Settings* only (name, access, delete). Confirmed by the user; also **no visible API keys on the user's WORK (team) Epicenter** — the only key-related feature there is a **Git integration** (not accessible to us, relevance TBD).
- ⇒ **On the free Personal tier there is no programmatic auth path for authoring.** `tools/deploy.ts` is correct and should work on an account that exposes admin auth or API keys; it simply can't authenticate here.

### 4.5 The deploy script
`tools/deploy.ts` reads config from env (`FORIO_ACCOUNT/PROJECT/MODEL_DIR` + either `FORIO_SECRET_KEY` **or** `FORIO_HANDLE`+`FORIO_PASSWORD`+`FORIO_OBJECT_TYPE`). Auth: secret key → `{objectType:'account', secretKey}`; else `{objectType, handle, password}`. Then `--list` prints the file tree; default run uploads every model via multipart PUT. **Kept for the future swing / a team account.**

## 5. OPEN PROBLEM — programmatic upload (threads to pull next)

We are **not** giving up; parked pending another attempt. The key realization: **the owner CAN upload models via the web UI (Project Files), so an auth path exists — we just haven't reproduced it.** Threads, roughly in priority:

1. **Reproduce the web-UI / account-level login.** Project-scoped `/authentication` fails for the owner. The forio.com owner session (the one that uploads via Project Files) is likely established by an **account-level** login (different endpoint/shape, e.g. no project in the path, or a `/authentication` at account scope, or a web login flow). Capture that request in the browser devtools (Network tab) while logging in / uploading, and replicate it to get an owner token, then use it against the file API. **This is the most promising thread.**
2. **Inspect the actual Project Files upload request** in devtools — exact endpoint, headers, auth, and body it uses to place a model file. It may not be `/api/v3/.../file/...` at all.
3. **Forio Git integration** — the only key-ish feature present (even on the team account). Forio may support deploying project files from a Git remote; could be a legitimate programmatic upload channel. Investigate access + mechanics.
4. **Team/paid account** — `admin` auth is Team-only and would unblock the existing deploy script; confirm whether the work Team account can generate API keys (they weren't visible, but may be permissioned).
5. **Ask Forio** (docs at https://docs.forio.com/epicenter, or support) how a Personal-account owner authenticates to the REST API for authoring.

Read the **new docs** (https://docs.forio.com/epicenter) developer-reference / administering sections for the authoring/auth flow before the next attempt.

## 6. Interim workflow (unblocks the MVP now)
1. Forio → project → **Project Files** → drag-drop `src/mvp/models/test1.xlsx` and `test2.xlsx` (same place as the existing `test.xlsx`).
2. `bun run dev` → use the **Model version** dropdown → confirm test1 (year-1 = 525) ↔ test2 (year-1 = 550).

This proves the switch half end-to-end; upload stays manual until §5 lands.

## 7. Repo reference

**Run the app:** `bun install` → `bun run dev`. Build/typecheck: `bun run build`. Lint: `bun run lint`.

**Key files:** `src/mvp/{forioConfig.ts, forio.ts, SavingsMvp.tsx, models/*.xlsx}`, `tools/deploy.ts`, `.env.example`.

**Env (`.env`, git-ignored):** `FORIO_ACCOUNT`, `FORIO_PROJECT`, `FORIO_MODEL_DIR`, and auth (`FORIO_SECRET_KEY` or `FORIO_HANDLE`+`FORIO_PASSWORD`+`FORIO_OBJECT_TYPE`). Copy from `.env.example`.

**Secret guard:** global `~/.claude/hooks/guard-sensitive.py` + `~/.claude/settings.json` block the assistant from reading `.env`/keys/`.ssh`/`.aws`/etc. in every project (exempts `.env.example`, `*.pub`). `bun` can still auto-load `.env` for the user's own `deploy` runs.

**tsconfig note:** `tools/` is included in `tsconfig.node.json` (Node types); the browser app is `tsconfig.app.json`.

## 8. References
- New Forio docs (authoritative): https://docs.forio.com/epicenter
- Local: `.claude/reference/forio-epicenter-platform.md`, `.claude/reference/epicenter-model-interaction.md`
- Reference project: `references/ai-governance` (team's working sim); team's proxy deploy: `references/deploy reference/deploy.ts` (uses `admin` auth — works because that's a **Team** account).
