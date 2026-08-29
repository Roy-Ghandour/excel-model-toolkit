import { authAdapter, runAdapter, SCOPE_BOUNDARY } from 'epicenter-libs';
import { configureForio } from './forioConfig';

/**
 * Thin driver over epicenter-libs v3 for the savings-account test models.
 * Every entry point takes the model `file` to run, so the UI can swap versions.
 *
 * Named ranges (verified by inspecting the workbook):
 *   initialBalance   scalar  (B3  = 500)
 *   interestRate     scalar  (B4) — 0.05 in test1, 0.10 in test2
 *   Time             B6:N6   (0..12) — one column per step
 *   transactionAmount B7:N7  — INPUT, one per year
 *   Balance          B8:N8   — OUTPUT; Balance[t] = (Balance[t-1] + transactionAmount[t-1])·(1+rate)
 *   Step             scalar  (B10 = 0) — Forio increments on each `step` operation
 */
export const NAMED_RANGES = [
  'Time',
  'Balance',
  'transactionAmount',
  'Step',
  'initialBalance',
  'interestRate',
] as const;

/** Number of steps the timeline supports (Time is B6:N6 → columns 0..12). */
export const MAX_STEP = 12;

export interface ModelState {
  runKey: string;
  step: number; // current Step / year (0..12)
  time: number[];
  balance: number[];
  transactionAmount: number[];
  initialBalance: number;
  interestRate: number;
}

function asNumberArray(v: unknown): number[] {
  return Array.isArray(v) ? v.map(Number) : [Number(v)];
}

/**
 * The project's scope key, needed to create PROJECT-scoped runs. On a PUBLIC
 * project `projectAdapter.get()` returns 401 anonymously, but `createSingular`
 * works anonymously and its response carries `scope.scopeKey` — so we mint the
 * (harmless, shared) singular run once purely to discover the key, then cache it.
 * Verified live against ghandourroy/model-toolkit-project.
 */
let cachedScopeKey: string | undefined;

async function getScopeKey(modelFile: string): Promise<string> {
  if (cachedScopeKey) return cachedScopeKey;
  const singular = await runAdapter.createSingular(modelFile);
  cachedScopeKey = singular.scope.scopeKey;
  return cachedScopeKey;
}

/**
 * Create a fresh PROJECT-scoped run for `modelFile`. On a PUBLIC project this is
 * creatable anonymously — no login, no API key in the browser — which is the
 * whole reason the MVP targets a public project. Each call is an independent run
 * starting at Step 0, so `reset()` / switching models just makes a new one.
 */
async function createRun(modelFile: string): Promise<string> {
  const run = await runAdapter.create(modelFile, {
    scopeBoundary: SCOPE_BOUNDARY.PROJECT,
    scopeKey: await getScopeKey(modelFile),
  });
  return run.runKey;
}

/** Read the current model state for a run. */
export async function read(runKey: string): Promise<ModelState> {
  const vars = (await runAdapter.getVariables(runKey, [...NAMED_RANGES], {
    ritual: 'REVIVE',
  })) as Record<string, unknown>;
  return {
    runKey,
    step: Number(vars.Step),
    time: asNumberArray(vars.Time),
    balance: asNumberArray(vars.Balance),
    transactionAmount: asNumberArray(vars.transactionAmount),
    initialBalance: Number(vars.initialBalance),
    interestRate: Number(vars.interestRate),
  };
}

/**
 * Clear any cached Epicenter session cookie so we operate as a clean anonymous
 * user under the configured account. A stale guest/pseudonym session bound to a
 * different account otherwise triggers "PSEUDONYM_KEY does not belong to account"
 * — the SDK binds `userKey` from that session on run creation, whereas a true
 * anonymous request (no session) works on a public project.
 */
async function ensureAnonymous(): Promise<void> {
  if (authAdapter.getLocalSession()) {
    await authAdapter.removeLocalSession();
  }
}

/** Connect to Forio and start a fresh run for `modelFile`. */
export async function connect(modelFile: string): Promise<ModelState> {
  configureForio();
  await ensureAnonymous();
  return read(await createRun(modelFile));
}

/**
 * Start a fresh run of `modelFile` — used both for Reset and for switching model
 * versions. Drops the previous run (best-effort) and creates a clean one.
 */
export async function reset(
  modelFile: string,
  previousRunKey?: string,
): Promise<ModelState> {
  if (previousRunKey) {
    try {
      await runAdapter.remove(previousRunKey);
    } catch {
      /* best-effort — a fresh run is created regardless */
    }
  }
  return read(await createRun(modelFile));
}

/**
 * Record a transaction for the current year and advance one step.
 *
 * The model computes `Balance[t] = (Balance[t-1] + transactionAmount[t-1])·(1+rate)`
 * (verified live), so a transaction made in year `currentStep` is written into
 * that column and shows up in the next year's balance after stepping.
 */
export async function advanceYear(
  runKey: string,
  currentStep: number,
  transaction: number,
): Promise<ModelState> {
  await runAdapter.updateVariables(runKey, {
    [`transactionAmount[0,${currentStep}]`]: transaction,
  });
  await runAdapter.operation(runKey, 'step');
  return read(runKey);
}
