# Epicenter Model Workbench — Design

> **Status:** living design doc. Working title **Epicenter Model Workbench** (name TBD).
> **Scope of the current phase:** design + reference only. No app code yet.

---

## 1. What it is & what it does

The Workbench is an internal tool for **developing, testing, debugging, and benchmarking Forio Epicenter Excel models**. It centralizes the repetitive work the team does today — running scenarios by hand, comparing model changes, hunting for min/max outcomes — behind one consistent, extensible surface.

**Core loop:**

1. **Register a project** (a Forio Epicenter model app the team works on).
2. The tool **version-controls its `.xlsx`** and deploys versions to Forio.
3. A growing suite of **tools** act on the *active model version* — run scenarios, sweep hundreds of runs with a bot, benchmark against saved base runs, surface AI insights.
4. **All results land in a shared, browsable database**, stamped with exactly which model version + tool version produced them.

**Design north star — baby-proof extensibility.** Adding a new capability should mean writing one self-contained tool module that plugs into a shared platform, never re-plumbing the app. The platform owns projects, versioning, Epicenter I/O, run storage, and shared UX; tools just do their one job.

**Primary users:** the internal team (a handful of people). Runs locally in dev most of the time, with the option to host for shared access.

---

## 2. Core concepts (domain model)

| Concept | What it is |
|---|---|
| **Project** | One Epicenter model app (e.g. AI-Governance). Holds Forio coordinates (account/project shortname, credentials), the model file identity, and everything below. |
| **Model Version** | An immutable snapshot of the project's `.xlsx`, captured **automatically on file change** (content hash). Carries a version number, note/tag, the introspected variable/named-range schema, and Forio deploy status. **The unit everything is benchmarked against.** |
| **Tool** | A self-contained capability acting on the active model version (Manual Run, Bot Runner, Runs Database, Min/Max Optimizer, Base Runs, AI Insights, Version Diff…). Declares metadata (id, title, icon, **semver**) and owns its UI. |
| **Run** | One execution of the model with a set of decisions, producing outputs/scores. The universal result record. Every tool that executes the model writes Runs. |
| **Base Run / Benchmark** | A named, saved set of decisions (and reference outputs) tied to a model version, used to benchmark the effect of model changes. |
| **Action History** | Append-only audit log of what happened, per project, filterable by tool. |

**The universal Run record:**

```ts
interface Run {
  id: string;
  projectId: string;
  modelVersionId: string;     // which model produced it
  toolId: string;
  toolVersion: string;        // stamped for reproducibility
  actor: 'human' | 'bot';
  inputs: Record<string, unknown>;   // decisions set
  outputs: Record<string, unknown>;  // scores / KPIs read back
  forioRunKey?: string;       // link back to the live Forio run
  tags: string[];
  notes?: string;
  createdAt: string;
}
```

**Relationships:** `Project 1—* ModelVersion`, `Project 1—* Run`, `Run *—1 ModelVersion`, `Run *—1 Tool(+version)`, `Project 1—* BaseRun`, `Project 1—* ActionHistory`.

---

## 3. UI / UX layout

A **two-level shell**.

### Level 1 — Project Browser (app root)

A single page to **search/filter projects** and **create a new one**. Each project is a card (name, active version, run count, last activity). This is the only place you pick or make a project.

```
┌──────────────────────────────────────────────────────┐
│  Epicenter Model Workbench            [ + New Project ]│
│  ┌────────────── search projects ──────────────┐      │
│  └──────────────────────────────────────────────┘      │
│  ┌───────────┐ ┌───────────┐ ┌───────────┐           │
│  │ AI-Gov    │ │ Net-Zero  │ │ Hospital  │           │
│  │ v12 ·1204 │ │ v4  · 88  │ │ v9  · 340 │           │
│  └───────────┘ └───────────┘ └───────────┘           │
└──────────────────────────────────────────────────────┘
```

### Level 2 — Project Workspace (after entering a project)

Persistent chrome, top-right:

- **Exit button** — backs out to the Project Browser.
- **Active Model Version** — beside exit, shows the current version (e.g. `v12`). Click → **popover** to switch the active version at will and see version stats (created, note, deploy status, # runs against it, quick diff link).

The rest of the screen is a **left sidebar of tools** + a main content area. The sidebar starts with **Model & Versions** (the built-in version manager), then lists every registered tool. Selecting a tool renders it in the main area. **Each tool has complete freedom** over its layout and interactions.

```
┌──────┬─────────────────────────────────────────────────┐
│      │                    AI-Governance   [v12 ▼] [Exit]│
│ ▸ Model & Versions ──────────────────────────────────── │
│ ▸ Manual Run  │                                         │
│ ▸ Bot Runner  │           active tool workspace         │
│ ▸ Runs DB     │           (free-form per tool)          │
│ ▸ Min/Max     │                                         │
│ ▸ Base Runs   │                                         │
│ ▸ AI Insights │                                         │
└──────┴─────────────────────────────────────────────────┘
```

### Shared chrome available to every tool (the "tool contract" UX)

- **Action History** drawer — every tool's actions, filterable.
- **Tool version** badge — visible per tool.
- **Active-version binding** — the selected model version is always in scope; tools stamp results with it.
- **Shared UI kit** — toasts/notifications, consistent loading/empty/error states, and exporters (CSV/JSON/PDF/DOCX).
- **Notes & tags** — attach to runs and versions from anywhere.

Any tool that executes the model writes **Run** records, so the **Runs Database** tool (a filterable data grid + charts) browses everything — whether a human clicked once or the bot did 500 runs.

---

## 4. The Tool Framework (extensibility contract)

The heart of "baby-proof." Every tool is a module implementing one interface and registering itself; the sidebar and routing are generated from the registry.

```ts
interface ToolDefinition {
  id: string;                 // stable unique id, e.g. "manual-run"
  title: string;              // sidebar label
  icon: React.ReactNode;      // MUI icon
  version: string;            // semver — stamped onto every run/action
  sidebarGroup?: string;      // optional grouping
  component: React.FC<ToolContext>;   // the tool's UI; free-form
  backend?: ToolBackend;      // optional server routes/jobs this tool needs
}
```

Each tool component receives a **ToolContext** giving it everything it needs without reaching into globals:

```ts
interface ToolContext {
  project: Project;
  activeVersion: ModelVersion;          // + its variable/named-range schema
  epicenter: EpicenterClient;           // backend calls to Forio (deploy, run, read/write vars, query)
  runs: RunStore;                       // record()/query() the shared Run database
  baseRuns: BaseRunStore;               // read/compare against saved benchmarks
  recordAction(action: ActionEvent): void;   // append to Action History
  notify: NotificationApi;              // toasts
  exporters: Exporters;                 // csv/json/pdf/docx
}
```

### Shared platform services (cross-tool concerns, consolidated)

1. **Action History / audit log** — `recordAction`, per project, filterable by tool.
2. **Tool versioning** — semver in `ToolDefinition`, stamped on runs & actions.
3. **Runs store** — the universal Run record + shared query API.
4. **Active-model-version binding** — one selected version flows to all tools; stamps results.
5. **Variable/named-range schema** — introspected per version, shared catalog with human labels.
6. **Base runs / benchmarks** — shared baselines any tool can compare against.
7. **Notes & tags** — on runs and versions.
8. **One Epicenter session/credential per project** — auth handled once (app API key), reused by all tools + the bot.
9. **Shared UI kit** — toasts, loading/empty/error states, exporters.

**Adding a tool** = create `tools/<name>/`, implement `ToolDefinition`, register it. No changes to the shell, routing, or platform.

---

## 5. Architecture

**Monorepo, one `bun run dev` starts everything.** Runs trivially on localhost; deployable later.

- **Frontend:** React 19 + TypeScript + **MUI 5** + Vite (already scaffolded). Houses the shell, the tool registry, and all tool UIs.
- **Backend:** a Node/TypeScript service (Fastify or Express) that:
  - wraps **`epicenter-libs`** to talk to Forio (deploy model, create/drive runs, read/write variables, `query` runs, singular base run),
  - owns credentials so the browser never holds Forio secrets,
  - runs the **bot runner** as background jobs (hundreds of runs),
  - serves the REST API the frontend's `EpicenterClient`/`RunStore` call.
- **Database:** **SQLite via a typed ORM (Drizzle/Prisma)** for zero-config localhost; schema is Postgres-portable for later hosting.
- **Model/version store:** **content-addressed file store on disk** — each `.xlsx` version saved by content hash; the auto-snapshot watcher hashes the registered file and creates a new `ModelVersion` when it changes.
- **Shared types package** between frontend and backend.

**Proposed layout:**

```
/src            # frontend (shell + tool registry + tools/)
  /shell        # project browser, workspace chrome, version popover
  /tools        # one folder per tool (each a ToolDefinition)
  /platform     # ToolContext, RunStore, EpicenterClient (frontend side), UI kit
/server         # backend: epicenter integration, bot runner, REST API, DB
/shared         # types shared by both
/references     # provided reference project (read-only)
/.claude        # Claude's reference docs
/docs           # design.md and future docs
```

---

## 6. Epicenter integration (how we actually drive the model)

Grounded in the two reference docs in `.claude/reference/`. The backend uses `epicenter-libs` **v3 adapters** (not the legacy managers):

- **Auth:** application/API-key credentials via `authAdapter.login(AppCredentials)` for the headless bot (acts across users) + admin `Router` auth for privileged project ops. One session per project, held server-side.
- **Deploy a version:** push the versioned `.xlsx` to the Forio project (assets/model API) so runs execute against the intended version.
- **Run lifecycle:** `runAdapter.create(model, scope)` (or `retrieveFromWorld`) → `updateVariables(runKey, {'Var[0,step]': value})` → `operation(runKey, 'step')` / `action()` to batch set+step → `getVariables(runKey, namedRanges, {ritual})` to read outputs.
- **Base run:** `createSingular` / `getSingularRunKey` gives a shared base-case run for benchmarking.
- **Runs database:** `runAdapter.query(model, {filter:['var.score>=24','run.hidden=false'], sort, variables})` — server-side filtered search, paginated (~200/page); mirror/cache into our own DB for rich browsing.
- **Schema discovery:** `introspect(model)` to enumerate named ranges/variables per version.
- **Cell addressing:** scalars `Var[0,0]`, year/step columns `Var[0,step]`; multi-column named ranges read back as arrays.

Full detail: [`.claude/reference/epicenter-model-interaction.md`](../.claude/reference/epicenter-model-interaction.md) and [`.claude/reference/forio-epicenter-platform.md`](../.claude/reference/forio-epicenter-platform.md).

---

## 7. Planned tool suite (roadmap — each a future plugin)

| Tool | Purpose |
|---|---|
| **Model & Versions** (built-in) | Register `.xlsx`, auto-snapshot on change, switch active version, diff versions, deploy to Forio. |
| **Manual Run** | Set decisions, step the model, see outputs. The vertical-slice proof. |
| **Bot Runner** | Configure and launch hundreds of automated runs; watch progress. |
| **Runs Database** | Filterable data grid + charts over all runs (human + bot). |
| **Base Runs / Benchmark** | Save decision sets, compare model versions against baselines. |
| **Min/Max Optimizer** | Algorithms to find decisions that minimize/maximize target scores. |
| **AI Insights** | LLM analysis over runs/versions (the reference app already uses `openai`). |
| **Version Diff** | What changed between two model versions (named ranges, outputs on the base run). |

---

## 8. Build phases

- **Phase 0 — Base:** monorepo scaffold, MUI theme, shell (project browser + workspace chrome + version popover), the Tool Framework (registry + ToolContext), backend skeleton (epicenter-libs integration + SQLite + content-addressed version store), and the built-in **Model & Versions** manager.
- **Phase 1 — First real tool:** **Manual Run** end-to-end against the `ai-governance` reference model, proving the full vertical slice.
- **Phase 2+:** Bot Runner → Runs Database → Base Runs → Min/Max → AI Insights, one plugin at a time.

---

## 9. Open questions / decisions to revisit

- Final product name.
- Backend framework (Fastify vs Express) and ORM (Drizzle vs Prisma) — leaning Fastify + Drizzle for lightness; confirm before Phase 0.
- Multi-user/auth for the Workbench itself when hosted (out of scope for localhost-first Phase 0).
- Exact Forio deploy mechanism for pushing a new `.xlsx` version (assets/model upload endpoint) — verify against a live Forio project during Phase 0.
