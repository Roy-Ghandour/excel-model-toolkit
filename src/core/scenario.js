import { readFile } from "node:fs/promises";
import { FORMAT_VERSION, checkWrites, describe } from "./runFile.js";

/**
 * A **scenario file**: the conditions a run happens under, without the run.
 *
 * Exactly a [run file](./runFile.js) minus `steps` — same version, same
 * `simulation`, same exhaustive `settings`, same `stepCount`. That is not a
 * coincidence but the point: a tool that *generates* runs is handed everything a
 * run file declares except the decisions, which are the thing it is about to
 * invent.
 *
 * **Why `stepCount` lives here rather than on the command line.** For AI-Gov the
 * length is not independent of the settings — `checkStep` enforces
 * `NumYears + 1 === stepCount` at step 0 — so a `--steps` flag beside a settings
 * file is two halves of one fact, typed twice and reconciled by hand. One file
 * cannot contradict itself.
 *
 * **Why `simulation` is required** when the model already declares its own
 * `ModelKitID`: it makes a scenario the exact shape
 * [`preflight`](./simulation.js) takes, so every tool gets the model match, the
 * ruleset lookup and `assertDeclaration` from one call rather than a local copy
 * of two of the three. A scenario paired with the wrong model is then refused by
 * name, instead of surfacing later as a confusing settings mismatch.
 */

/**
 * Check a parsed scenario's structure, throwing on the first problem.
 *
 * Structure only, in the same division of labour `validate` keeps: whether the
 * named ranges exist is the driver's business, whether `settings` is the set this
 * simulation names is `assertDeclaration`'s, and whether the length suits the
 * simulation is its `minSteps`/`maxSteps`.
 *
 * Unknown top-level keys pass through untouched, as they do in a run file, so a
 * later tool can carry its own section here without a format bump.
 *
 * @param {unknown} scenario The parsed JSON.
 * @returns {{ modelkit: number, simulation: string, stepCount: number, settings: Record<string, number> }}
 */
export function validate(scenario) {
  if (
    scenario === null ||
    typeof scenario !== "object" ||
    Array.isArray(scenario)
  ) {
    throw new Error(
      `a scenario file must be a JSON object, received: ${describe(scenario)}`
    );
  }

  // Shares the run file's version, because it is the run file's header. A change
  // that breaks one breaks the other.
  if (scenario.modelkit !== FORMAT_VERSION) {
    throw new Error(
      `unsupported scenario file FORMAT_VERSION: expected "modelkit": ${FORMAT_VERSION}, received: ${describe(
        scenario.modelkit
      )}`
    );
  }

  if (typeof scenario.simulation !== "string" || scenario.simulation === "") {
    throw new Error(
      `"simulation" must name the simulation this is a scenario for, received: ${describe(
        scenario.simulation
      )}`
    );
  }

  if (!Number.isInteger(scenario.stepCount) || scenario.stepCount < 0) {
    throw new Error(
      `"stepCount" must be a whole number of steps, received: ${describe(
        scenario.stepCount
      )}`
    );
  }

  checkWrites(scenario.settings, "settings");

  return scenario;
}

/**
 * Read a scenario file from disk.
 *
 * @param {string | URL} path
 * @returns {Promise<ReturnType<typeof validate>>}
 */
export async function loadScenario(path) {
  const source = await readFile(path, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }

  return validate(parsed);
}
