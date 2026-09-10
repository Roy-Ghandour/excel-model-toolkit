import {
  authAdapter,
  config,
  runAdapter,
  SCOPE_BOUNDARY,
} from "epicenter-libs";
import { assertWritable } from "../common.js";

/**
 * The only module that knows we are talking to Forio.
 *
 * A stateless library of commands: `createForioDriver` resolves everything
 * model-invariant up front and closes over it, so the returned driver never
 * tracks which runs are alive. Callers pass a `runKey` and a `step` every time.
 *
 */

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
 * singular run once purely to discover the key. This indirection is load-bearing;
 * it is not an accident.
 */
async function fetchScopeKey(modelFile) {
  const singular = await runAdapter.createSingular(modelFile);
  return singular.scope.scopeKey;
}

/**
 * Fold introspection output into `Map<name, { rows, cols }>`.
 *
 * Epicenter reports each named range as two entries — `Balance.R` listing row
 * indices and `Balance.C` listing column indices — so a single cell is 1x1 and a
 * timeline row is 1xN. This is what lets `write` decide between `[0,0]` and
 * `[0,step]` without the caller declaring the shape.
 */
function toSchema(info) {
  const schema = new Map();
  for (const { name, indices } of info.ranges ?? []) {
    const split = name.lastIndexOf(".");
    const axis = name.slice(split + 1);
    if (axis !== "R" && axis !== "C") continue;

    const range = name.slice(0, split);
    const shape = schema.get(range) ?? { rows: 1, cols: 1 };
    shape[axis === "R" ? "rows" : "cols"] = indices.length;
    schema.set(range, shape);
  }
  return schema;
}

/**
 * Connect to a model and return a driver bound to it.
 *
 * Note `config` is a process-wide singleton inside epicenter-libs, so two drivers
 * in one process must target the same account/project. Per-call routing overrides
 * exist in the SDK if that ever needs to change.
 *
 */
export async function createForioDriver({ account, project, modelFile }) {
  config.accountShortName = account;
  config.projectShortName = project;

  await ensureAnonymous();
  const scopeKey = await fetchScopeKey(modelFile);
  const schema = toSchema(await runAdapter.introspect(modelFile));

  /**
   * Resolve a named range plus a step into an Epicenter cell key.
   * Every failure throws before a request is sent — a malformed key can be
   * accepted while writing nowhere, which would surface as quietly wrong sweep
   * data rather than an error.
   */
  function cellKey(name, step) {
    const shape = schema.get(name);
    if (!shape) {
      throw new Error(`'${name}' is not a named range in ${modelFile}.`);
    }
    if (shape.rows > 1) {
      throw new Error(
        `'${name}' is a ${shape.rows}x${shape.cols} 2-D range; only single cells and single-row timelines are supported`
      );
    }
    // A single cell has no timeline, so there is no column to choose. The step
    // is still required of the caller — see `write` — it just has nowhere to go.
    if (shape.cols === 1) return `${name}[0,0]`;

    const last = shape.cols - 1;
    if (step > last) {
      throw new Error(
        `step ${step} is out of range for '${name}' (expected 0-${last})`
      );
    }
    return `${name}[0,${step}]`;
  }

  return {
    /** The model this driver drives, and its named ranges. Read-only intel. */
    modelFile,
    schema,

    /**
     * Create a fresh PROJECT-scoped run. Each call is an independent run starting
     * at Step 0, so "reset" is just another `createRun`.
     */
    async createRun() {
      const run = await runAdapter.create(modelFile, {
        scopeBoundary: SCOPE_BOUNDARY.PROJECT,
        scopeKey,
      });
      return run.runKey;
    },

    /** Read named ranges. Timelines come back as arrays, single cells as scalars. */
    async read(runKey, names) {
      return runAdapter.getVariables(runKey, names, { ritual: "REVIVE" });
    },

    /**
     * Write any number of named ranges in one request. A batch may freely mix
     * timeline ranges and single cells, so a year's worth of decisions costs one
     * round trip.
     */
    async write(runKey, step, updates) {
      if (!Number.isInteger(step) || step < 0) {
        throw new Error(
          `write(runKey, step, updates): step must be a non-negative integer, received: ${step}`
        );
      }

      const payload = Object.fromEntries(
        Object.entries(updates).map(([name, value]) => {
          assertWritable(name, value);
          return [cellKey(name, step), value];
        })
      );
      return runAdapter.updateVariables(runKey, payload);
    },

    /** Advance the model one step; Epicenter increments the `Step` named range. */
    async step(runKey) {
      return runAdapter.operation(runKey, "step");
    },

    /** Best-effort cleanup. A leftover run is untidy, not broken, so never throw. */
    async dispose(runKey) {
      try {
        await runAdapter.remove(runKey);
        return true;
      } catch {
        return false;
      }
    },
  };
}
