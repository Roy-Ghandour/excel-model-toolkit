# Reference: Forio Epicenter Platform & SDK (for driving Excel models)

> Claude's durable reference for the Forio Epicenter platform, distilled from https://docs.forio.com/epicenter. Companion to [`epicenter-model-interaction.md`](./epicenter-model-interaction.md), which documents how our reference project uses this in practice.

> **📌 Authoritative docs: https://docs.forio.com/epicenter** — Forio is rolling out these NEW docs; always check them first for anything Forio-related. The legacy `forio.com/epicenter/docs/public/*` links below are older v2 material and may be stale — treat them as secondary/fallback, and prefer the new site.

---

## SDK generations — read this first

There are **two SDK generations**:

- **`epicenter-libs` v3.x** (the one we use, ~3.27) — docs at **https://docs.forio.com/epicenter**. Uses **adapters** (`runAdapter`, `authAdapter`, …). **Source of truth for v3 code: https://github.com/forio/epicenter-libs — always use this repo** (`src/adapters/*.ts` JSDoc documents endpoints the docs site doesn't).
- Legacy **`epicenter-js-libs` / Epicenter.js v2** — docs at **https://forio.com/epicenter/docs/public/**. Uses **managers** (`RunManager`, `AuthManager`). Richer prose but a different API.

This doc leads with **v3** and flags v2 only where it fills gaps.

> **Verification caveats:** npm returned 403 and the GitHub README was only partially readable during research, so exact **3.27.x** signatures are **v3-current, not version-pinned** — confirm against the in-package `.d.ts` TypeScript definitions when implementing. Other flagged gaps are collected at the end.

---

## 1. Platform overview

Epicenter turns computational models (Excel, Python, Vensim, Julia, Java, Powersim, Stella, SimLang) into interactive web apps. Models live on Epicenter servers; apps talk to them through the Epicenter REST API, abstracted by `epicenter-libs`.

- Docs home: https://docs.forio.com/epicenter
- Models: https://docs.forio.com/epicenter/models/about-models

**Hierarchy / entity definitions** (some synthesized — the docs never present all terms in one table):

| Entity      | Definition                                                                                                                                                                                                                                                  |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Account** | Top-level owner: an organization (team) or personal account. A scope boundary; admins operate here.                                                                                                                                                         |
| **Project** | Container for one app: model file(s) + frontend UI. Identified by an **account/project shortname** pair (surfaced via URL). Types: **Team** or **Personal**. Access: **Private** / **Public** (no login) / **Authenticated** (team only). A scope boundary. |
| **Group**   | A cohort of users within a project. Members have a **groupRole**: Facilitator, Reviewer, Participant, or Leader. Drives most access rights. A scope boundary.                                                                                               |
| **World**   | A shared multiplayer container so users share common state/runs. Holds runs and users; world context (account/project/group) comes from the session. A scope boundary.                                                                                      |
| **Run**     | One loaded instance of a model in memory: holds variables, executes operations. User-, group-, or world-scoped. Has archived (DB) + in-memory state.                                                                                                        |
| **Session** | The authenticated context (account/group/user identity + permissions), server-side with a client cache. Produced by `authAdapter.login`.                                                                                                                    |
| **Episode** | A scope boundary representing a timeline/session grouping of runs. Runs can migrate between episodes (`runAdapter.migrate`). _(No full prose definition page reached — gap.)_                                                                               |
| **User**    | An identity (`userKey`, `handle`, `displayName`). Added to a scope via `userKey`.                                                                                                                                                                           |

**Scope model** (key for the Run API): a scope = **scopeBoundary** (`ACCOUNT`/`PROJECT`/`GROUP`/`EPISODE`/`WORLD`) + **scopeKey** (GUID), optionally + **userKey**. Scope defines namespace _and_ lifecycle (delete the boundary entity → its scoped entities are deleted). Enum: `SCOPE_BOUNDARY.GROUP`, etc.
Docs: https://docs.forio.com/epicenter/developer-concepts/scope

---

## 2. Excel / spreadsheet models

Docs: https://docs.forio.com/epicenter/models/excel-models/about-excel-models

- Epicenter treats an **`.xlsx`** as a computational engine. You read/update **named ranges, named tables, and raw cell references**; on update the workbook **recalculates automatically**, propagating to dependents — that's how you "execute" the model.
- **Named range name → variable name.** You can also address raw cells by A1 notation (`B8:N8` → array).

```js
import { runAdapter } from "epicenter-libs";
const balance = await runAdapter.getVariable("runKey", "Balance"); // named range (may be multi-cell)
const row = await runAdapter.getVariable("runKey", "B8:N8"); // cells as array
```

- **Two mandatory named ranges for turn-based models:**
  - **`Step`** — single cell (integer); Epicenter increments by 1 per app action.
  - **`Time`** — a range of integers defining the timeline; values correspond to steps.
- **Structural constraint:** turn-by-turn models expect **one column per step, starting at column B**. `transactionAmount[Current Step]` resolves to the current step's column.
- **Reading/writing:** write inputs with `updateVariables` / `getVariable`; the sheet recalculates; read outputs back. Which variables **persist to the DB** is declared in the **CTX2** context file, not the API call.
- **Excel-specific operations** (via `runAdapter.operation`): `step()`, `stepTo(step | 'END')`, `stepBack(step | 'START')` (SDK only), `recalculate()`, `download()` (export current workbook state).

```js
await runAdapter.operation("runKey", "stepBack", [4]);
```

**CTX2 context file** (JSON, named to match the model, in `/model`). Configures memory restoration, rewind, and which variables are saved:

```json
{
  "version": "v2",
  "variables": {
    "State": { "save": true },
    "Revenue": { "save": true },
    "Cost": { "save": true },
    "Profit": { "save": true }
  }
}
```

Restoration modes: **Replay** (record + replay state-changing ops) vs **Snapshot** (save current values; good for long histories). Docs: https://docs.forio.com/epicenter/models/model-context-schema

---

## 3. Runs & the Run API

Docs: https://docs.forio.com/epicenter/developer-concepts/runs · Functions: https://docs.forio.com/epicenter/developer-reference/adapters/run-functions

**Lifecycle:** create/introduce → write decision variables → execute operations (step) → read outputs → save/reset (or remove). Runs have **archived** (DB) + **in-memory** state.

### Create / obtain a run

```ts
create<V,M>(model: string,
           scope: { userKey?: string } & GenericScope,
           optionals?: RunCreateOptions): Promise<RunReadOutView<V,M>>
// RunCreateOptions: permits (readLock/writeLock ROLE), ephemeral, trackingKey, executionContext

await runAdapter.create('model.xlsx', {
  scopeBoundary: SCOPE_BOUNDARY.GROUP,
  scopeKey: '0000017dd3bf540e5ada5b1e058f08f20461'
});
```

Related: `clone(runKey, optionals?)`, `getWithStrategy(strategy, model, scope, optionals?)` (find-or-create), `retrieveFromWorld(worldKey, model, optionals?)` / `removeFromWorld`, **`createSingular(model, optionals?)` + `getSingularRunKey(optionals?)`** (one project-wide shared run — ideal for a **base-case/reference** run), `get(runKey, optionals?)`.

### Write decision variables

```ts
updateVariables<V>(runKey: string | string[], update: Partial<V>,
                   optionals?: { timeout?, ritual? }): Promise<Partial<V>>

await runAdapter.updateVariables('0000017307...', { price: 100, foo: 'bar' });
```

### Execute operations / batch

```ts
operation(runKey, name: string, args?: unknown[], optionals?): Promise<unknown>

// action(): bundle set-variables + operations in one round-trip (order preserved)
await runAdapter.action('0000017307...', [
  { name: 'price',    value: 100,        objectType: 'set'     },
  { name: 'simulate', arguments: [10],   objectType: 'execute' }
]);
```

`action()` is the efficient way to combine sets + steps — use it when hammering many runs.

### Read outputs

```ts
getVariable<V>(runKey|runKey[], variable|variable[], optionals?)      // single/multi
getVariables<V>(runKey|runKey[], variables: (keyof V)[], optionals?)  // bulk; ignorable? flag
getMetadata / updateMetadata                                          // run annotations (set/push/pop)
```

`getVariable(s)` accept an **array of runKeys** → `Array<{runKey, variables}>` — read many runs at once.

### Save / reset / persistence

- **Ephemeral runs:** `ephemeral: true` at create → in-memory only, never written to DB.
- **Rituals** control memory persistence: `REANIMATE`, `EXILE`, `EXORCISE` (via `optionals.ritual`). _(Note: our reference app uses `REVIVE` on reads — confirm the exact ritual enum names against the in-package types.)_
- `restore(runKey)` — load an archived run into memory; `rewind(runKey, steps)`; `update(runKey|[], {readLock, writeLock, trackingKey, marked, hidden, closed})`; `remove(runKey)`; `migrate(runKey, episodeKey)`.

### Batch / many runs — `query()` (the primary bulk/search tool)

```ts
query<V,M>(model, {
  scope?, groupName?, episodeName?,
  variables?: (keyof V)[], metadata?: (keyof M)[],
  filter?: string[], sort?: string[]
}, optionals?): Promise<Page<RunReadOutView<V,M>>>

const page = await runAdapter.query('model.xlsx', {
  scope: { scopeBoundary: SCOPE_BOUNDARY.GROUP, scopeKey: '...' },
  filter: ['var.score>=24', 'run.hidden=false'],
  variables: ['score']
});
```

Filter syntax: `var.<name>` and `run.<field>`. Results paginated (see §6). **This is effectively a runs database with server-side filtering** — the backbone of our Runs Database tool.

### Introspection

`introspect(model)` / `introspectWithRunKey(runKey)` return model structure (available variables/operations) — use to **auto-discover a model's named ranges** per version.

---

## 4. epicenter-libs (JS SDK, v3)

- Concept: https://docs.forio.com/epicenter/developer-concepts/about-the-libraries
- Reference: https://docs.forio.com/epicenter/developer-reference/about-the-reference
- Source: https://github.com/forio/epicenter-libs

- **Import style:** named adapter imports — `import { runAdapter, authAdapter, Router, SCOPE_BOUNDARY } from 'epicenter-libs';`
- **Adapters available:** Accounts, Assets, **Authentication (`authAdapter`)**, Chat Rooms, Consensus Barrier, **Episodes (`episodeAdapter`)**, Groups, Leaderboards, **Models**, Projects, Push Channels, **Runs (`runAdapter`)**, Scope, Somebody, Users, Vaults, Video Conferencing, Wallets, **Worlds (`worldAdapter`)**.
- Each adapter has **two reference pages**: functions + entities (e.g. `/adapters/run-functions`).
- **`Router`** — low-level escape hatch to call any REST endpoint directly, with pagination:

```js
import { Router } from "epicenter-libs";
const groups = await new Router()
  .get("/group/search", { paginated: true })
  .then(({ body }) => body);
```

- **v3 characteristics:** resources carry **scopes + permits**; users have `displayName`; automatic SSO token handling on load; session-expiration support; built-in `errorManager`; pagination via **page objects** (not headers); TS defs + JSDoc ship in-package (generics `<V, M>` = your Variables and Metadata shapes). Dev prerequisite: Node 24.
- **v3 uses `runAdapter`, not v2 `RunManager`.** The v3 equivalent of RunManager strategy is `runAdapter.getWithStrategy(strategy, …)`.

**Legacy v2 reference (prose, still online):** RunManager — https://forio.com/epicenter/docs/public/api_adapters/generated/run-manager/ · Run API Service — https://forio.com/epicenter/docs/public/api_adapters/generated/run-api-service/ · Excel model creation — https://forio.com/epicenter/docs/public/model_code/excel/

---

## 5. Authentication & authorization

Docs: https://docs.forio.com/epicenter/developer-concepts/authentication · Functions: https://docs.forio.com/epicenter/developer-reference/adapters/authentication-functions

**Two credential models:**

- **User credentials** — `handle` + `password` (+ optional group key). Access limited by `groupRole` (Participant sees own runs; Facilitator sees all group runs).
- **Application credentials** — private/public **API keys** (`secretKey`). App-level access **across all users/groups** — **the right choice for our headless bot**, leaderboards, cross-user aggregation.

**Core functions:**

```ts
login(credentials: UserCredentials | AppCredentials, optionals?): Promise<Session>
regenerate(groupOrAccount: string, optionals?): Promise<Session>   // switch group (user) or account (admin)
getSession(optionals?): Promise<Session>
verify(token: string, optionals?): Promise<Session>                // validate a Bearer token
logout(...): Promise<void>
resetPassword(handle, { redirectURL?, subject? }): Promise<void>
ssoOutcome(ltiVersion, outcomeInformation, optionals?)             // LTI grade passback
// Local (no API call):
getLocalSession(); setLocalSession(session); removeLocalSession();
```

**Scopes / roles:** sessions scope to a **group** (user-level) or **account** (admin-level) via `objectType`. Role ladder: `ANONYMOUS`, `PARTICIPANT`, up through Facilitator/Leader (`groupRole`). Runs carry **permits** — `readLock` / `writeLock` set to a `ROLE`.

**Headless / bot authentication pattern (recommended):**

1. Use **application credentials** (`AppCredentials` with `secretKey`) with `authAdapter.login(...)` → a session that acts across users/groups without interactive login.
2. Or obtain a Bearer token and `authAdapter.verify(token)` / `setLocalSession(session)` to seed a client.
3. `regenerate(group)` to target a specific group's scope when creating/reading runs.

Common auth errors: `AUTHENTICATION_EXPIRED`, `AUTHENTICATION_BLOCKED`, `AUTHORIZATION_FAILURE`.

> **Gap:** the docs excerpts don't give a copy-paste `AppCredentials` shape or an explicit anonymous-guest login call. Confirm the exact `AppCredentials` object (`secretKey` + likely account/project) against the in-package TS types. Our reference project instead uses admin `Router` auth (`objectType:'admin'`) — see the model-interaction doc §2.

---

## 6. Automation notes (hundreds of scenarios)

- **Bulk read/write:** `getVariable(s)` and `updateVariables` accept **arrays of runKeys** → one call touches many runs. `action()` bundles set + execute per run into one round-trip.
- **Batch search & save-for-later:** `runAdapter.query(model, {filter, sort, variables})` searches persisted runs by variable/metadata; combine with `update(runKey, {marked, hidden})` to tag/hide scenario runs. Use non-ephemeral runs (default) with CTX2 `"save": true` variables so outputs persist.
- **Pagination:** query results are **Page** objects; **~200 records per request** max (also `first`/`max` params). Router supports `{ paginated: true }`.
- **Ephemeral vs saved:** `ephemeral: true` for throwaway sensitivity sweeps (faster, no DB writes); omit it (+ CTX2 `save:true`) to keep browsable scenarios.
- **Per-call `timeout` and `ritual`** tune long recalcs and whether a run stays memory-resident between calls.
- **Singular run** (`createSingular`/`getSingularRunKey`) = a shared base-case run for comparison.
- **Rate limits:** not documented — **gap**; test empirically, honor pagination caps, minimize request count via arrays/`action()`.

---

## 7. Project file API (`fileAdapter`) — uploading model files

Not documented on docs.forio.com; authoritative source is the v3 repo:
**https://github.com/forio/epicenter-libs → `src/adapters/file.ts`** (JSDoc lists every REST endpoint).
This is the API for writing to a project's file tree (incl. `/model`) — distinct from
`assetAdapter` (S3-presigned, scope-bound *user* assets, not project/model files).

REST base: `https://forio.com/api/v3/{ACCOUNT}/{PROJECT}/file`. All calls need an
authenticated author/admin Bearer token.

| SDK function | REST | Notes |
| --- | --- | --- |
| `list(path?, {depth})` | GET `/file[/{path}]?depth=n` | file tree |
| `listByFilter(glob, path?)` | GET `/file/filter/{glob}[/{path}]` | e.g. `*.xlsx` |
| `create(formData, path?)` | POST `/file[/{path}]` | **new** files (multipart) |
| `upload(formData, path?)` | PUT `/file[/{path}]` | **replace existing** (multipart) |
| `remove(path?)` | DELETE `/file[/{path}]` | file or directory |
| `download(path)` | GET `/file/download/{path}` | non-JSON needs raw fetch |
| `compress(path?)` | PATCH `/file/compress[/{path}]` | zip up server-side |
| `explode(path?)` | PATCH `/file/explode[/{path}]` | unzip in place, deletes the zip |
| `move(origin, dest, {includeOrigin})` | PATCH `/file/move` | rename/move |
| `createDirectory(path)` | POST `/file/directory/{path}` | mkdir |

**Critical caveats (from the SDK's own JSDoc):**
- `create`/`upload` are **browser-only** — in Node the Router doesn't serialize
  `FormData` as multipart. In Node/Bun, build the URL (`router().getURL(...)` or by
  hand) and use **raw `fetch` with FormData** — native fetch serializes it correctly.
- **POST = create new, PUT = replace existing** — using the wrong verb for the file's
  current state is a likely source of errors. The known-good Forio deploy script
  POSTs to the *directory* path with the filename carried in the FormData part.
- **Auth for file writes (verified live 2026-07-25):** an author on a **personal
  account** logs in the way the Epicenter manager UI does —
  `POST https://forio.com/api/v3/epicenter/manager/authentication` with
  `{objectType: 'admin', handle, password}`. The returned token works directly on
  the target project's `/file` API (session includes `personalAccountShortName`;
  no `regenerate` needed). **Project-scoped** admin login (the Forio proxy
  script's approach, `.withServer()` supported) is **team-account only** — on a
  personal account it 500s with a `PersonalAccount`→`TeamAccount` cast error.
  `objectType: 'personal'` does not exist (400: unknown `Credential` subclass);
  project-scoped `user` login 401s for a non-participant owner.
- Multi-file deploy pattern (Forio's own): zip locally → DELETE old files →
  POST zip → PATCH `/file/explode/{dir}/{zip}`.

---

## Key URLs

- Docs home: https://docs.forio.com/epicenter
- Models overview: https://docs.forio.com/epicenter/models/about-models
- Excel models: https://docs.forio.com/epicenter/models/excel-models/about-excel-models
- Model context schema: https://docs.forio.com/epicenter/models/model-context-schema
- Run concepts: https://docs.forio.com/epicenter/developer-concepts/runs
- Run adapter functions: https://docs.forio.com/epicenter/developer-reference/adapters/run-functions
- Scope: https://docs.forio.com/epicenter/developer-concepts/scope
- Auth concept: https://docs.forio.com/epicenter/developer-concepts/authentication
- Auth adapter functions: https://docs.forio.com/epicenter/developer-reference/adapters/authentication-functions
- Reference index: https://docs.forio.com/epicenter/developer-reference/about-the-reference
- Projects/hierarchy: https://docs.forio.com/epicenter/administering-epicenter/projects/about-projects
- Source: https://github.com/forio/epicenter-libs · npm: https://www.npmjs.com/package/epicenter-libs (403 during research)
- Legacy v2 docs: https://forio.com/epicenter/docs/public/

## Gaps / caveats

- **Exact 3.27.x version specifics unconfirmed** (npm 403, partial GitHub README). Signatures are v3-current; verify against in-package `.d.ts`.
- **Ritual enum names** — docs list `REANIMATE`/`EXILE`/`EXORCISE`; the reference app uses `REVIVE`. Confirm the full set in the types.
- **Episode** lacks a reachable prose definition page (treated as scope boundary + `episodeKey`/`episodeName`).
- **`worldAdapter` / `episodeAdapter` signatures** not individually retrieved — consult `/adapters/world-functions`, `/adapters/episode-functions`.
- **Rate limits** not found in the reviewed docs.
- **`AppCredentials` object shape** for headless auth needs confirmation from the TS types.
- A few guessed URLs 404'd (`excel-model-context-example`, `developer-concepts/multiplayer`, `worlds-and-episodes`); use the live left-nav on docs.forio.com.
