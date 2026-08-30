import {
  authAdapter,
  config,
  runAdapter,
  SCOPE_BOUNDARY,
} from "epicenter-libs";
import { FORIO, MODEL_FILE } from "./config.js";

/**
 * The only module that knows we are talking to Forio.
 *
 * Ported from the browser MVP (`references/mvp-archive/forio.ts`), which verified
 * every trick in here live. Callers speak in named ranges and values; nothing
 * above this file should import `epicenter-libs` or know about `[0,step]` cell
 * syntax, scope keys, or rituals.
 */

let configured = false;

/**
 * Point epicenter-libs at our account/project.
 */
export function configure() {
  if (configured) return;
  config.accountShortName = FORIO.account;
  config.projectShortName = FORIO.project;
  configured = true;
}

/**
 * Clear any cached session so we act as a clean anonymous user. In Node the
 * session store is an in-process Map, so this is nearly always a no-op — but a
 * stale session bound to another account produces a baffling
 * "PSEUDONYM_KEY does not belong to account" error, and the guard is free.
 */
async function ensureAnonymous() {
  if (authAdapter.getLocalSession()) {
    await authAdapter.removeLocalSession();
  }
}

/**
 * The project's scope key, needed to create PROJECT-scoped runs.
 *
 * On a PUBLIC project `projectAdapter.get()` returns 401 anonymously, so we
 * cannot look the key up directly. `createSingular` *does* work anonymously and
 * its response carries `scope.scopeKey` — so we mint the (harmless, shared)
 * singular run once purely to discover the key, then cache it. This indirection
 * is load-bearing; it is not an accident.
 */
let cachedScopeKey;

async function getScopeKey() {
  if (cachedScopeKey) return cachedScopeKey;
  const singular = await runAdapter.createSingular(MODEL_FILE);
  cachedScopeKey = singular.scope.scopeKey;
  return cachedScopeKey;
}

/**
 * Create a fresh PROJECT-scoped run. Each call is an independent run starting at
 * Step 0, so "reset" is just another `createRun`.
 */
export async function createRun() {
  await ensureAnonymous();
  const run = await runAdapter.create(MODEL_FILE, {
    scopeBoundary: SCOPE_BOUNDARY.PROJECT,
    scopeKey: await getScopeKey(),
  });
  return run.runKey;
}

/** Read named ranges. Multi-cell ranges come back as arrays, single cells as scalars. */
export async function read(runKey, names) {
  return runAdapter.getVariables(runKey, names, { ritual: "REVIVE" });
}

/**
 * Write named ranges. Keys use Epicenter cell addressing:
 * `Name[0,0]` for a scalar, `Name[0,<step>]` for a column on the timeline.
 * The workbook recalculates on write.
 */
export async function write(runKey, updates) {
  return runAdapter.updateVariables(runKey, updates);
}

/** Advance the model one step; Epicenter increments the `Step` named range. */
export async function step(runKey) {
  return runAdapter.operation(runKey, "step");
}

/** Best-effort cleanup. A leftover run is untidy, not broken, so never throw. */
export async function dispose(runKey) {
  try {
    await runAdapter.remove(runKey);
    return true;
  } catch {
    return false;
  }
}
