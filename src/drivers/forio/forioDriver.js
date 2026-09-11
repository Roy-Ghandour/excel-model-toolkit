import {
  authAdapter,
  config,
  projectAdapter,
  runAdapter,
  SCOPE_BOUNDARY,
} from "epicenter-libs";
import { assertWritable } from "../common.js";

/**
 * The only module that knows we are talking to Forio.
 *
 * `createForioDriver` logs in and resolves everything model-invariant up front.
 * Each run it creates owns its runKey, matching the local driver's run shape, so
 * `replay` drives either without knowing which.
 */

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
 * Log in and return a driver bound to one model on one project.
 *
 * Targets a private project on a team account, where only account admins can
 * create runs — so we log in as one. After `login` the SDK attaches the session
 * token to every request itself.
 *
 * Note `config` and the session are process-wide singletons inside epicenter-libs,
 * so two drivers in one process must target the same account/project.
 *
 * @param {{ account: string, project: string, modelFile: string, credentials: { handle: string, password: string } }} options
 */
export async function createForioDriver({
  account,
  project,
  modelFile,
  credentials,
}) {
  config.accountShortName = account;
  config.projectShortName = project;

  // Project-scoped admin login: POST /{account}/{project}/authentication. Team accounts only.
  await authAdapter.login(credentials, { objectType: "admin" });
  const { projectKey: scopeKey } = await projectAdapter.get();
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
     * Create a fresh PROJECT-scoped run at Step 0, so "reset" is just another
     * `createRun`. The returned run lives on Forio until `dispose` removes it.
     */
    async createRun() {
      const { runKey } = await runAdapter.create(modelFile, {
        scopeBoundary: SCOPE_BOUNDARY.PROJECT,
        scopeKey,
      });

      return {
        id: runKey,

        /** Read named ranges. Timelines come back as arrays, single cells as scalars. */
        async read(names) {
          return runAdapter.getVariables(runKey, names, { ritual: "REVIVE" });
        },

        /**
         * Write any number of named ranges in one request. A batch may freely mix
         * timeline ranges and single cells, so a year's worth of decisions costs one
         * round trip.
         */
        async write(step, updates) {
          if (!Number.isInteger(step) || step < 0) {
            throw new Error(
              `write(step, updates): step must be a non-negative integer, received: ${step}`
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
        async step() {
          return runAdapter.operation(runKey, "step");
        },

        /** Best-effort cleanup. A leftover run is untidy, not broken, so never throw. */
        async dispose() {
          try {
            await runAdapter.remove(runKey);
            return true;
          } catch {
            return false;
          }
        },
      };
    },
  };
}
