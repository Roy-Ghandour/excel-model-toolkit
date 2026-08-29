# Epicenter Model Workbench — MVP Findings

> **What this is:** the MVP is done. It answered every question we needed to answer
> before building the real Workbench ([design.md](design.md)). This doc distills what
> we learned and — more importantly — **how each finding applies when we start
> building**. The MVP code itself is archived under
> [`references/mvp-archive/`](../references/mvp-archive/README.md).
>
> **📌 Forio docs authority:** always use the new site **https://docs.forio.com/epicenter**
> first. Legacy `forio.com/epicenter/docs/public/*` = older v2, fallback only.
> The v3 SDK source of truth is the repo **https://github.com/forio/epicenter-libs**.

---

## 1. The questions the MVP had to answer — and the verdicts

Before committing to the full Workbench we needed to de-risk four things. **All four
are now settled — including programmatic upload, which we cracked on 2026-07-25.**

| # | Question | Verdict |
|---|----------|---------|
| A | Can we use a **free, public** Epicenter project instead of a paid/authenticated one? | **✅ Yes.** Free Personal plan; a **Public** project runs anonymously, no end-user login. |
| B | Can we **connect and drive a model** live from the browser (set inputs, step, read outputs)? | **✅ Yes, verified live.** Anonymous run create / read / write / step all work on a public project. |
| C | Can we **switch** between model versions programmatically? | **✅ Yes.** Pick the model file, start a fresh run — instant, anonymous, no re-upload. |
| D | Can we **upload / replace model files** programmatically (no manual drag-drop)? | **✅ Yes — solved.** Author login via the Epicenter *manager* scope + the project file API. See §4. |

Live target used throughout: **`ghandourroy` / `model-toolkit-project`** (free, Public).

---

## 2. Finding: a public project is enough, and the browser stays secret-free

- **Personal plan is free**: unlimited public & private projects; **0 authenticated
  projects** (authenticated = paid Team+). We do not need the work project.
- **Public** ⇒ reachable at `forio.com/app/{account}/{project}` with **no end-user
  login**, and **anonymous run creation is allowed**. This is the entire basis of the
  browser app.
- "Public" removes the *end-user* password; it does **not** grant *authoring* rights
  anonymously. Reading/driving models = anonymous (browser). Uploading models =
  authenticated (server-side tool). Clean split.

**Applies to the build:** the Workbench frontend can run models with **zero secrets in
the browser**, against a free project. Anything that authors files (upload, delete)
lives in a server-side/CLI layer with credentials in `.env`. Keep that boundary — it's
the security model for the whole product.

---

## 3. Finding: how to drive an Excel model anonymously (the gotchas, solved)

The browser driver ([archived `forio.ts`](../references/mvp-archive/src/mvp/forio.ts))
is small, but every line of it encodes a lesson:

- **`GET /project` / `projectAdapter.get` → 401 anonymously.** You cannot fetch the
  project scope key that way on a public project.
  **Fix:** `runAdapter.createSingular(model)` works anonymously and its response
  carries `scope.scopeKey`. Mint it once to discover the key, cache it, then
  `runAdapter.create(model, { scopeBoundary: PROJECT, scopeKey })` for real,
  resettable runs.
- **Stale session poisoning:** the SDK caches a session cookie
  (`com.forio.epicenter.session`). A leftover guest/pseudonym bound to another account
  causes `PSEUDONYM_KEY does not belong to account`.
  **Fix:** `authAdapter.removeLocalSession()` before connecting (our `ensureAnonymous`).
- **Localhost needs explicit config:** on `config.isLocal()` the SDK can't infer
  account/project from the URL, so set `config.accountShortName` / `projectShortName`
  by hand. In production (served under `forio.com/app/...`) they auto-detect. CORS from
  localhost → forio.com works.
- **Refresh resets the model** by design — each load creates a fresh run and we don't
  persist the runKey. Resuming would need runKey persistence **plus** a `.ctx2` marking
  `Step`/`Time` as `save:true`.

**Verified model mechanics** (test model, sheet "Savings account simulation"):
- Named ranges: `initialBalance` (B3=500), `interestRate` (B4; 0.05 in test1, 0.10 in
  test2), `Time` (B6:N6 = 0…12), `transactionAmount` (B7:N7, input), `Balance` (B8:N8,
  output), `Step` (B10=0).
- **Formula, confirmed live:** `Balance[t] = (Balance[t-1] + transactionAmount[t-1]) · (1 + interestRate)`.
  A transaction entered in year *k* lands in year *k+1*'s balance — decisions are
  strictly forward-looking. Same invariant as the ai-governance reference sim; the
  exact column differs per model.
- **Cell addressing:** scalars `X[0,0]`; year columns `X[0,<step>]`. Write with
  `updateVariables`, advance with `operation(runKey, 'step')`, read with
  `getVariables(runKey, ranges, { ritual: 'REVIVE' })`.

**Applies to the build:** this driver is the template for the Workbench's run engine.
The scope-key-via-singular trick, session hygiene, and localhost config are all
required again. Don't rediscover them — lift them from the archive. For model
introspection at scale, prefer `runAdapter.introspect(model)` to hard-coding named
ranges per version.

---

## 4. Finding: programmatic model upload — SOLVED

This was the one open problem at the end of the MVP; it is now closed. The MVP's
reference implementation is the archived
[`references/mvp-archive/tools/deploy.ts`](../references/mvp-archive/tools/deploy.ts) —
a standalone developer CLI. It is **not** carried forward as-is: it's over-engineered
for that role and in the wrong shape. The real thing is a **core backend component**,
to be rebuilt when we get there. What carries forward is the *capability* below (the
auth pattern + file API), not the script.

**The blocker was authentication, not the file API.** A free **Personal** account owner
cannot use the auth paths the docs imply:
- `objectType: 'user'` on the project scope → **401** (the owner isn't enrolled as a
  project *participant*).
- `objectType: 'admin'` on the project scope → **500**, `PersonalAccount cannot be cast
  to TeamAccount` (project-scoped admin login is **Team-account only**).
- `objectType: 'personal'` → **400**, no such credential type. It does not exist.

**The fix (verified live 2026-07-25):** authenticate the way the Epicenter manager UI
itself does —

```
POST https://forio.com/api/v3/epicenter/manager/authentication
{ "objectType": "admin", "handle": <login>, "password": <password> }
```

The returned token is a personal-account **author** token (session includes
`personalAccountShortName`) and works **directly** on the target project's file API —
no `regenerate`, no account focus step needed.

**The file API** (base `https://forio.com/api/v3/{account}/{project}/file`, all calls
need the author Bearer token). Documented in
[`.claude/reference/forio-epicenter-platform.md` §7](../.claude/reference/forio-epicenter-platform.md):

| Action | REST | Notes |
|--------|------|-------|
| list | `GET /file[/{path}]?depth=n` | file tree |
| create **new** | `POST /file/{dir}` | multipart; filename in the form part |
| **replace** existing | `PUT /file/{dir}` | multipart |
| delete one | `DELETE /file/{path}` | file or directory |

- **POST = create, PUT = replace.** List the target dir first and pick the verb per
  file so an upload **never deletes anything**. Both paths verified live (created, then
  replaced on re-run).
- **Multipart must be raw `fetch`, not the SDK.** The SDK's own JSDoc marks
  `fileAdapter.create/upload` as **browser-only** — in Node/Bun the Router doesn't
  serialize `FormData` as multipart. Native `fetch` does.
- **Deleting one file** (`DELETE /file/{path}`, guarded so it never removes a directory)
  lets us prune stored files individually — needed to keep the project's file count in
  check over time.

Config the reference CLI read from a git-ignored root `.env` (template `.env.example`):
`FORIO_ACCOUNT`, `FORIO_PROJECT`, `FORIO_MODEL_DIR`, `FORIO_HANDLE`, `FORIO_PASSWORD`.
Those are the same credentials the eventual backend component will need.

**Applies to the build:** we now have a proven author-side capability — upload, replace,
list, delete — against a free project, with a working reference implementation in the
archive. When we build the real thing:
1. It's a **backend component**, not a dev CLI — give it a proper home, name, and
   interface. Lift the auth + fetch logic from the archived `deploy.ts`; drop the CLI
   argument-parsing, multi-candidate auth probing, and other MVP scaffolding.
2. The `epicenter/manager` admin login is the auth pattern to reuse for **every**
   authoring action, not just upload.

---

## 5. Reusable assets going into the build

| Asset | Status | Use next |
|-------|--------|----------|
| `references/mvp-archive/tools/deploy.ts` | Archived reference | Proven upload/replace/delete/list logic. Rebuild as a backend component; lift the auth + fetch, drop the CLI scaffolding. |
| `.claude/reference/forio-epicenter-platform.md` | Maintained | Platform + SDK + file-API reference (see §5–§7). |
| `.claude/reference/epicenter-model-interaction.md` | Maintained | How a model is driven in practice. |
| `references/mvp-archive/src/mvp/forio.ts` | Archived | Template for the run engine (anonymous drive, scope key, session hygiene). |
| `references/ai-governance` | Reference | The team's real working sim. |
| `references/deploy reference/` | Reference | Forio's own proxy deploy (Team-account `admin`; zip + explode multi-file pattern). |
| `.env` / `.env.example` + global secret guard | In place | Credentials for authoring; assistant is blocked from reading `.env`. |

---

## 6. Open threads (nice-to-have, not blockers)

- **Resumable runs** — persist the runKey + a `.ctx2` with `save:true` on `Step`/`Time`
  so a refresh continues instead of resetting. Needed only if the Workbench wants
  durable sessions.
- **Model introspection over hard-coded ranges** — use `runAdapter.introspect` so the
  UI adapts to each model's named ranges automatically.
- **Multi-file / bulk deploy** — Forio's proxy script zips locally then `PATCH
  /file/explode`s server-side; adopt if we ever push many files per publish.
- **Rate limits** — undocumented; test empirically, minimise request count via array
  args and `action()`.

---

## 7. Running what's left in the repo

`bun install` → `bun run dev` (currently a hello-world starting point). Build/typecheck:
`bun run build`. Lint: `bun run lint`. There is no longer a `deploy` script — model
upload will return as a backend component (see §4); the archived CLI is reference only.
