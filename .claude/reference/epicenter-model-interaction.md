# Reference: How We Interact With a Forio Epicenter Excel Model

> Derived from a deep read of the reference project at `references/ai-governance` (`fashion-forward`, `epicenter-libs` **^3.27.2**, React 17 + Redux). This is Claude's durable reference for how the team's simulations actually drive the model. Paths below are relative to `references/ai-governance/`.
>
> The reference project also ships its own hand-written notes at `.claude/docs/epicenter-libs.md` (SDK adapter reference) and `.claude/docs/simulation-flow.md` (game flow) — both accurate against the source.

---

## 0. TL;DR — the minimal driver sequence

To programmatically drive one of these Excel models:

1. **Configure** `config.accountShortName` / `config.projectShortName` (or use `Router` builder methods).
2. **Authenticate** — `authAdapter.login({handle, password, groupKey})` for users, or admin/service login via the low-level `Router` (see §2).
3. **Get a world + run** — `worldAdapter.get({groupName, mine:true})` / `selfAssign(...)`, then `runAdapter.retrieveFromWorld(worldKey, 'AIGovModel.xlsx', {allowChannel:true})` → `runKey`.
4. **Read** — `runAdapter.getVariables(runKey, namedRangesArray, {ritual:'REVIVE'})` → arrays for multi-cell named ranges, scalars for single cells.
5. **Write** — `runAdapter.updateVariables(runKey, {'Name[0,step]': value})` — `[0,0]` for scalars, `[0,step]` for year columns. Triggers recalculation.
6. **Step** — `runAdapter.operation(runKey, 'step')` → returns new `Step`.
7. **Metadata** (non-model per-run KV) — `getMetadata(runKey, [keys])` / `updateMetadata(runKey, {set:{...}})`.
8. **Query many runs** — `runAdapter.query(modelFile, {variables, metadata, filter:['run.hidden=false'], sort:['-run.created'], max})` with `.all()` paging.
9. **Group settings** — `vaultAdapter.byName('settings')` / `define` / `update`.

There is **no custom server** in the reference repo — all backend I/O goes through `epicenter-libs`. Model calls live in Redux thunks under `src/actions/`.

---

## 1. Epicenter SDK usage

Everything is imported by **named export** from `epicenter-libs`. The reference project uses **adapters** + one low-level `Router` + `Channel`. It does **not** use `runManager`/`RunRouter`/`run.introduce`/`run.do`/episodes/`sessionManager`.

Named exports used: `config`, `Router`, `Fault`, `Channel`, `PUSH_CATEGORY`, `SCOPE_BOUNDARY`; adapters `authAdapter`, `groupAdapter`, `worldAdapter`, `runAdapter`, `vaultAdapter`, `userAdapter`.

**Every adapter method exercised:**

```
authAdapter:  login, logout, getLocalSession
groupAdapter: get, getSessionGroups, statusUpdate, addUser
worldAdapter: get, selfAssign, create, autoAssignUsers, setPersonas, getPersonas,
              editAssignments, removeUsers
runAdapter:   retrieveFromWorld, getVariables, updateVariables, operation, query,
              getMetadata, updateMetadata, update, remove, removeFromWorld, get
vaultAdapter: byName, define, update, remove
userAdapter:  get, uploadCSV
```

**Key call sites:**

- `src/actions/run-actions.js` — the primary model driver (run lifecycle, variable read/write, metadata, vault read, `operation` step). ~1300 lines; the most important file.
- `src/actions/facilitator-actions.js` — vault define/update (settings), world/persona/user management, run querying.
- `src/actions/login-actions.js` — auth + login/init orchestration.
- `src/actions/channel-actions.js` — CometD push channel subscriptions.
- `src/utils/constants.js` — `config` override for localhost; `MODEL_FILE`; the master `namedRanges` array (~1200 entries).
- `src/utils/functions.js` — `config`, `authAdapter.getLocalSession` (demo/trial detection).
- `token.mjs`, `allow-player-reset.mjs` — standalone Node scripts using the low-level `Router`.

---

## 2. Authentication

### Config bootstrap (`src/utils/constants.js:3-12`)

```js
import { config } from "epicenter-libs";
if (config.isLocal()) {
  config.accountShortName = "tr";
  config.projectShortName = "ai-governance";
}
```

In production these come from the hosting URL automatically (Epicenter serves the app under `/app/{account}/{project}/`). `config` fields: `isLocal()`, `isDemo`, `isTrial`, `accountShortName`, `projectShortName`, `apiProtocol`, `apiHost`.

### In-app user login (`src/actions/login-actions.js:218-239`)

```js
const session = await authAdapter.login({
  handle,
  password,
  groupKey: group || undefined, // omitted when user picks group later
});
```

- If `session.groupKey` present → proceed.
- If `session.multipleGroups` → `groupAdapter.getSessionGroups()`, user picks a group, re-login with `groupKey`.
- Logout: `authAdapter.logout({ inert: fault => fault.status === 401 })`.
- `authAdapter.getLocalSession()` returns the cached session synchronously.

**`UserSession` shape:** `{ userKey, groupKey, groupName, groupRole: 'FACILITATOR'|'PARTICIPANT'|'REVIEWER'|'LEADER', token, accountShortName, projectShortName, multipleGroups, displayName }`.

### Admin / service authentication via low-level `Router` (the pattern a new tool reuses)

`token.mjs` (creds from `config.json`; template in `config-example.json`):

```js
import { Router } from "epicenter-libs";
const res = await new Router()
  .withAccountShortName(ACCOUNT_SHORT_NAME)
  .withProjectShortName(PROJECT_SHORT_NAME)
  .post("/authentication", {
    body: {
      handle: ADMIN_HANDLE,
      password: ADMIN_PASSWORD,
      objectType: "admin",
    },
  });
console.log(res.body.token); // bearer token
```

`allow-player-reset.mjs` uses that admin token for privileged PATCHes:

```js
await new Router()
  .withAccountShortName("tr")
  .withProjectShortName("net-zero-v2")
  .withAuthorization(`Bearer ${token}`)
  .patch("/project", {
    body: {
      objectType: "team",
      allowWorldReset: true,
      allowWorldSelfAssign: true,
      allowChannelGroupDefault: true,
    },
  });
```

- Endpoint: `POST https://forio.com/api/v3/{account}/{project}/authentication`.
- `objectType: 'admin'` for admin login; user login is what `authAdapter.login` does.
- Router builder: `.withAccountShortName()`, `.withProjectShortName()`, `.withAuthorization()`, `.post()/.patch()/.get()`; returns `{ body, ... }`.
- `config-example.json` keys: `ACCOUNT_SHORT_NAME`, `PROJECT_SHORT_NAME`, `ADMIN_HANDLE`, `ADMIN_PASSWORD` (real creds go in a git-ignored `config.json`).

**Identifiers:** account `tr`, project `ai-governance`. Hierarchy: **Project → Group (`groupKey`) → World (`worldKey`) → Run (`runKey`)**.

> For **headless/bot** automation in the new tool, prefer Epicenter **application/API-key credentials** (see the platform reference doc §5) so the bot can act across users without an interactive login. The `Router` admin pattern above is the fallback for privileged project ops.

---

## 3. Run lifecycle

A "run" is a live server-side process that loads `AIGovModel.xlsx` into memory. Variables are read/written through `runAdapter`.

### Create / attach a run (`run-actions.js:361-404`)

```js
let [world] = await worldAdapter.get({ groupName, mine: true });
if (world === undefined) {
  world = await worldAdapter.selfAssign({
    role: "player",
    populace: [{ minimum: 1, maximum: 1, role: "player" }],
    allowChannel: true,
  });
  await runAdapter.removeFromWorld(world.worldKey); // detach the auto-created run
}
const run = await runAdapter.retrieveFromWorld(worldKey, MODEL_FILE, {
  allowChannel: true,
});
// run.runKey identifies it
```

`MODEL_FILE = 'AIGovModel.xlsx'` (`constants.js:14`). `retrieveFromWorld(worldKey, modelFile, opts)` lazily creates the run if the world has none. `allowChannel: true` opts into push notifications.

### Read variables (`getVariables`)

```js
const variables = await runAdapter.getVariables(runKey, namedRanges, {
  ritual: "REVIVE",
});
// → { VarName: scalar, ArrayVar: [v0, v1, ...], ... }
```

- `namedRanges` is an **array of ~1200 named-range strings** (`constants.js:126-1457`).
- **Multi-cell named ranges return arrays** (indexed by year/step); **single cells return scalars**.
- **`ritual: 'REVIVE'`** is used on _every_ read — restores the most recent archived state when reconnecting.
- Result merged wholesale into Redux `model` slice.

### Write decisions/inputs (`updateVariables`)

Cell-addressing is the crux: `"VarName[0,0]"` for a single cell, `"VarName[0,<step>]"` for a named range at a step.

```js
await runAdapter.updateVariables(runKey, { "AIBudget[0,0]": 500 });
await runAdapter.updateVariables(runKey, { "GDPGrowth[0,2]": 2.4 });
```

Writing triggers **model recalculation**. Write thunks (all in `run-actions.js`):

- `updateModel(updates)` (**preferred**, line 1029) — generic, batched, optimistic Redux dispatch with auto-revert on failure. Shape `{ VarName: { value, step? } }`. Array vars default step = `model.Step + 1` → `"Var[0,step]"`; scalars → `"Var[0,0]"`. Also calls `getRunVariables` as a channel-disconnect fallback.
- `updateDecisionSingleCell(name, value)` (line 1157) — writes `"name[0,0]"`.
- `updateDecisionNamedRange(name, value)` (line 1101) — writes `"name[0,currentStep]"`.
- Legacy `updateDecisions` (line 936) enforces an editor check; newer ones gate in the UI instead.

### Step / advance the model (`operation`)

```js
const newStep = await runAdapter.operation(runKey, "step"); // advances one year
```

`operation(runKey, 'step')` is the **only model operation** invoked (no `run.do`/macro). `submitDecision` (line 1237) = advance then `getRunVariables`. `advanceToEnd`/`advanceToLastYr` are UI-only (they just set `Step` in Redux, no server call). After a step, the push channel emits a `STATE` event whose `content.actions[0].name === 'step'`.

### Query runs (`run-actions.js`, `facilitator-actions.js`)

```js
runAdapter.query(MODEL_FILE, {
    variables: ['Step','Location', ...],   // model vars to include per run
    metadata:  ['userNames'],              // run-metadata keys to include
    filter:    ['run.hidden=false', `var.settingsID=${id}`],
    sort:      ['-run.created'],
    max: 1,
});
// → { values, resultSize, totalResults, all() }  — .all() pages beyond resultSize
```

### Reset / restart

- `detachRun` → `runAdapter.removeFromWorld(worldKey)` (detach without delete).
- `runAdapter.update(runKey, { hidden: true })` — soft delete (facilitator `hideRun`/`resetWorld`).
- `runAdapter.remove(runId)` — force-removes/resets.
- Full `restart` flow (`run-actions.js:1289`): check run limit via vault → `detachRun('reuse-never')` → create fresh run → `getRunVariables` → `setRunUsers` → `readVault()` → solo-player defaults.

### Run metadata (per-run KV, outside the model)

```js
const [editor] = await runAdapter.getMetadata(runKey, ["editor"]);
await runAdapter.updateMetadata(runKey, { set: { editor: userKey } });
```

Used for: `editor` (who may write in multiplayer), `userNames`/`userKeys`, `editorMinistry1..4`. Missing keys throw `error.code === 'UNRECORDED_VARIABLE'` (handled gracefully).

---

## 4. The model itself (`model/` folder)

- `AIGovModel.xlsx` (636 KB) — the Forio-hosted Excel simulation. `MODEL_FILE = 'AIGovModel.xlsx'`.
- `AIGovModel.ctx2` — Epicenter model context/config. Declares which variables persist to archived state:
  ```json
  {
    "variables": {
      "Step": { "save": true },
      "Time": { "save": true },
      "settingsID": { "save": true }
    }
  }
  ```
  Only `Step`, `Time`, `settingsID` are `save:true`; everything else is recomputed from decisions on `REVIVE`.
- `end-user-template*.csv` — bulk user-import templates for `userAdapter.uploadCSV`.

**Named ranges are the model's public API.** The full list (`namedRanges`, `constants.js:126-1457`) is passed to `getVariables`. Multi-column ranges → arrays (one entry per year/step); single cells → scalars. Writes use `"Name[0,col]"` (col = step for arrays, `0` for scalars).

**Root-level model tooling (authoring aids, not runtime):**

- `namedRanges.txt` (22 KB) — newline-delimited list of all named ranges (source of truth mirrored into `constants.js`).
- `createNamedRange.js` — reads `namedRanges.txt`, JSON-stringifies, writes `output.txt` (the array seeding the `namedRanges` constant). **Reuse this pipeline to regenerate the named-range array from a model.**
- `output.txt` — the generated JSON array.
- `kpi-ranking-model-additions.md` — design doc for a planned KPI-ranking feature.
- `allow-player-reset.mjs` — one-off admin script to flip project flags.
- `impacts-count.txt`, `policy-impacts.bat` — **leftover from a prior hospital-management sim**; not the AI-gov model's variables (see caveats).

---

## 5. Decisions/inputs & outputs (naming conventions)

- **Ministry prefixes:** `Def*` (Defense), `Ec*` (Economy), `Edu*` (Education), `Env*` (Environment).
- **Policy ("initiative") inputs** per ministry, numbered 3–24: `{Prefix}Pro{N}` + companions `...CostValue`, `...CostRecurringValue`, `...CanCancel`, `...Decidedlastyr`, `...Decided2yrsago`, `...New`, `...Show`, `...Sort`, `...Type`, `...YearSelected`, `...Reasoning` (student free-text), `...Response` (AI feedback written back).
- **Budget sliders:** `{Prefix}Slider1`, `{Prefix}Slider2` (+ `...Cost`, `...LastYear`).
- **Budget/allocation outputs:** `{Prefix}Budget`, `{Prefix}BudgetRemaining`, `{Prefix}AvaialbleToAllocate` [sic], `{Prefix}TotalCost`, `{Prefix}InitialCost`, `{Prefix}NextYearReucurringCost` [sic].
- **Per-ministry scores:** `EconomyScore`, `DefenseScore`, `EducationScore`, `EnvironmentScore`.
- **KPI outputs** come as 4-tuples: `<KPI>`, `<KPI>Target`, `<KPI>AlmostTarget`, `<KPI>TargetResult`. Examples: `AIContributionToGDP`, `AILiteracy`, `CircularityIndex`, `CybersecurityIndex`, `EcosystemIntegrityIndex`, `GHGFromDataCenters`, `InnovationIndex`, `InstitutionalAdoptionRate`, `MilitaryTechnologyTradeBalance`, `NetJobsFromAI`, `ProductivityGrowth`, `ThreatsIndex`.
- **Aggregate outputs:** `TotalScore`, `NumTargetsMet`, `NumTargetsAlmostMet`, `NumTargetsNotMet`, `GrowthWellBeing`, `TrustInGovernment`, plus `JobsCreated`, `JobsDisplaced`, `CarbonIntensityFromDataCenters`, `EnergyConsumedFromDataCenters`.
- **Control/state vars:** `Step` (current year; 0 = setup), `NumYears`, `Time`, `Year`, `GameMode`, `GameModeConfirmed`, `GameOver`, `ReadVault`, `settingsID`, `RolesConfirmed`, `ValuesConfirmed`.
- **Crisis cards:** `_C1..C4` families (`_C1Enabled`, `_C1Show`, `_C1Year`, `_C1ShowCrisisCard`, `_C1Prepared`).
- **Roles/values:** `RoleUser0..4` (userKey per role slot; 0 = PM), `RoleUser{n}Value{1..6}Position`, `RoleUser{n}ValuesConfirmed`, shared `Value1Position..Value6Position`.
- **`singleCellDecisionVars`** (`constants.js:1459-1507`) — the decision subset written as scalars (roles + value positions + confirmations); other decisions are named-range writes at the current step.

**Data flow UI → model → UI:**

1. Player interacts → thunk `updateModel({ Var: { value, step? } })` → optimistic Redux `UPDATE_DECISION` → `runAdapter.updateVariables(runKey, { 'Var[0,step]': value })`.
2. Model recalculates server-side; `updateModel` also calls `getRunVariables` as a channel fallback.
3. Push channel (`PUSH_CATEGORY.RUN`, WORLD scope) fires `STATE`; handler re-reads all `namedRanges` and merges into Redux `model`.
4. Submit → `operation(runKey, 'step')` → `STATE` event `name==='step'` → re-read + navigate to dashboard.

**Redux slices** (`src/reducers/`): `model`, `run`, `world`, `login`, `globalSettings`, `facilitator`, `impersonate`, `settings`, `loading`. Selectors in `src/selectors/`.

**AI feedback path** (`run-actions.js:242-359`, not model I/O): posts reasoning to a Forio proxy `https://{domain}/proxy/{account}/{project}/completion` with `Authorization: Bearer <session.token>`, then writes the result back as `{code}Response`. Per `simulation-flow.md` Q16 the proxy is currently unused.

---

## 6. The Vault (facilitator settings — group-scoped persistence)

A **group-scoped KV store** that survives run resets — facilitator settings that seed every player's model. Adapter `vaultAdapter`.

**Read** (`run-actions.js:753-913`, `facilitator-actions.js:47`):

```js
const vaults = await vaultAdapter.byName("settings");
const items = vaults[0].items; // { simStatus, settingsID, currentSettings:{...}, NumYears, ... }
```

**Create** (`facilitator-actions.js:191`):

```js
vault = await vaultAdapter.define('settings', {}, {
    body: {
        scope: { scopeBoundary: SCOPE_BOUNDARY.GROUP, scopeKey: groupKey },
        permit: { readLock: 'PARTICIPANT', writeLock: 'FACILITATOR' },
        items: { set: { currentSettings:{}, newSettings:{...}, defaultSettings:{...},
                        simStatus: 0, canCreateNewRun: true, settingsID: 0 } },
        allowChannel: true,
    },
});
```

**Update:** `vaultAdapter.update(vaultKey, { set: {...} })`. `groupAdapter.statusUpdate('OPEN'|'CLOSED', msg)` accompanies sim open/close.

**Applying vault → model** (`readVault`): for each name in `vaultNamedRanges` it builds `{ "name[0,0]": currentSettings[name] }` and batch-writes via `updateVariables`, finally setting `ReadVault[0,0] = 1`. `vaultNamedRanges` (`run-actions.js:487`): `settingsID`, `_C1Enabled.._C4Enabled`, `NumYears`, `AIFeedbackEnabled`, `ReadVault`.

`settingsID` is the sync/version stamp: on save it increments; players compare their model's `settingsID` to the vault's and either auto-apply or show a "settings changed" modal.

---

## 7. Push channels (real-time)

CometD/BAYEUX under the hood. `src/actions/channel-actions.js`:

```js
import { Channel, PUSH_CATEGORY, SCOPE_BOUNDARY } from "epicenter-libs";
const handle = await new Channel({
  scopeBoundary: SCOPE_BOUNDARY.WORLD, // PROJECT | GROUP | WORLD | EPISODE
  scopeKey: worldKey,
  pushCategory: PUSH_CATEGORY.RUN, // RUN | WORLD | GROUP | VAULT | CHAT | PRESENCE | CONTROL | SYSTEM
}).subscribe(async (data) => {
  const { type, content } = data; /* ... */
});
// handle.unsubscribe() / unsubscribeAll()
```

Four subscriptions set up at login:

| Handler                 | Scope / Category | Purpose                                                                                   |
| ----------------------- | ---------------- | ----------------------------------------------------------------------------------------- |
| `connectToRunChannel`   | WORLD / RUN      | model var changes; routes `STATE` (step/decisions/reasoning) & `META`; re-reads variables |
| `connectToWorldChannel` | WORLD / WORLD    | run reset/reattach → reload run, nav to `/welcome`                                        |
| `connectToGroupChannel` | GROUP / GROUP    | `ASSIGNMENT` events → player moved worlds → modal                                         |
| `connectToSettings`     | GROUP / VAULT    | facilitator settings changes → apply or show modal                                        |

Event payload: `data.type` (`STATE`/`META`/`RUN`/`ASSIGNMENT`), `data.content` — for STATE, `content.actions[0].name` (e.g. `"step"` or `"VarName[0,2]"`) and `content.actions[0].value`.

---

## 8. Directly reusable artifacts for the new tool

- **`src/utils/constants.js`** — authoritative `namedRanges` list and `MODEL_FILE`.
- **`namedRanges.txt` + `createNamedRange.js`** — pipeline to regenerate the named-range array from a model.
- **`token.mjs` / `config-example.json`** — admin-auth template.
- **`src/tools/epicenter.ts`** — a `Fault`-based `fetch` normalizer (for proxy calls).
- **`run-actions.js` thunks** — clean reference for optimistic-update + revert + channel-fallback semantics.
- **`.claude/docs/epicenter-libs.md` / `.claude/docs/simulation-flow.md`** — the repo's own accurate SDK/flow notes.

---

## 9. Caveats

- **Domain drift:** `impacts-count.txt`, `policy-impacts.bat`, `vaultNamedRanges2/3`, and location tables in `facilitator-actions.js` are **carryover from prior hospital-management / net-zero sims** and do **not** map to `AIGovModel.xlsx`.
- **Editor enforcement is UI-level, not server-enforced** in the newer write thunks; only legacy `updateDecisions` checks `editor === session.userKey`.
- **`NumYears` default unsettled** — both `5` and `7` appear.
- **Roles Mode / KPI-ranking pass 2 not implemented** — designed in `kpi-ranking-model-additions.md`, current storage is shared `Value1..6Position` + `ValuesConfirmed` scalars.
- **`.ctx2` persistence:** only `Step`, `Time`, `settingsID` are `save:true`; other vars recompute on `REVIVE`.
- **`operation` signature:** only `operation(runKey, 'step')` is exercised; other operation/macro names untested here.
- The binary `AIGovModel.xlsx` was **not** opened to enumerate exact cell geometry — the array-vs-scalar distinction is inferred from code behavior and the `namedRanges`/`singleCellDecisionVars` lists.
