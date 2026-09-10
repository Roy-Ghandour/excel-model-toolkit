import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** FORMAT_VERSION version this module reads. Bumped only when a change breaks old files. */
export const FORMAT_VERSION = 1;

/**
 * Serialize a value with object keys sorted at every depth.
 *
 * The run id must not depend on the order someone happened to type the decisions
 * in: `{a:1,b:2}` and `{b:2,a:1}` are the same run and must hash alike. Arrays
 * keep their order, because in `steps` the order *is* the timeline.
 */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value === null || typeof value !== "object") return JSON.stringify(value);

  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`);
  return `{${entries.join(",")}}`;
}

/**
 * The run's identity: a digest of its inputs, and nothing else.
 *
 * Deliberately excludes the model, the label and every other field. Two runs with
 * the same decisions share an id even when they were generated against different
 * versions of a model.
 *
 * @param {Record<string, number>} [settings] Writes applied before stepping.
 * @param {Array<Record<string, number>>} steps Per-step writes.
 * @returns {string} 16 hex characters.
 */
export function runId(settings, steps) {
  const inputs = canonical({ settings: settings ?? {}, steps });
  return createHash("sha256").update(inputs).digest("hex").slice(0, 16);
}

/** Render a value inside an error message without it turning into `[object Object]`. */
function describe(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (Array.isArray(value)) return "an array";
  if (value !== null && typeof value === "object") return "an object";
  return String(value);
}

/**
 * Check one map of writes, naming the offending entry precisely.
 *
 * The driver would reject a bad value anyway, but only once a run is already
 * underway and some earlier step has been applied. Catching it here means a
 * malformed file never starts a run at all.
 *
 * @param {unknown} writes The candidate map.
 * @param {string} where Path to report, e.g. `steps[3]`.
 */
function checkWrites(writes, where) {
  if (writes === null || typeof writes !== "object" || Array.isArray(writes)) {
    throw new Error(
      `${where} must be an object of named-range writes, received: ${describe(
        writes
      )}`
    );
  }
  for (const [name, value] of Object.entries(writes)) {
    if (!Number.isFinite(value)) {
      throw new Error(
        `${where}.${name} must be a finite number, received: ${describe(value)}`
      );
    }
  }
}

/**
 * Check a parsed run file's structure, throwing on the first problem.
 *
 * Structure only: that the fields are present and the right shape. Whether the
 * named ranges exist is the driver's business, and whether the decisions are
 * *legal* under a simulation's own rules is the injected policy's — neither
 * belongs here.
 *
 * @param {unknown} run The parsed JSON.
 * @returns {{ modelkit: number, simulation: string, model: { file: string, version?: string, sha256?: string }, id?: string, label?: string, createdAt?: string, origin?: { tool: string }, settings?: Record<string, number>, steps: Array<Record<string, number>> }}
 */
export function validate(run) {
  if (run === null || typeof run !== "object" || Array.isArray(run)) {
    throw new Error(
      `a run file must be a JSON object, received: ${describe(run)}`
    );
  }

  if (run.modelkit !== FORMAT_VERSION) {
    throw new Error(
      `unsupported run file FORMAT_VERSION: expected "modelkit": ${FORMAT_VERSION}, received: ${describe(
        run.modelkit
      )}`
    );
  }

  if (
    run.model === null ||
    typeof run.model !== "object" ||
    Array.isArray(run.model)
  ) {
    throw new Error(
      `"model" must be an object describing the model, received: ${describe(
        run.model
      )}`
    );
  }
  if (typeof run.model.file !== "string" || run.model.file === "") {
    throw new Error(
      `"model.file" must name the model file, received: ${describe(
        run.model.file
      )}`
    );
  }

  // Required even though nothing reads it yet. It names the ruleset a run must be
  // checked against, and a run that cannot say which rules apply to it can never
  // be verified — so it has to be there from the first file, not retrofitted onto
  // a corpus of runs that never declared one.
  if (typeof run.simulation !== "string" || run.simulation === "") {
    throw new Error(
      `"simulation" must name the simulation this is a run of, received: ${describe(
        run.simulation
      )}`
    );
  }

  for (const field of ["id", "label", "createdAt"]) {
    if (run[field] !== undefined && typeof run[field] !== "string") {
      throw new Error(
        `"${field}" must be a string when present, received: ${describe(
          run[field]
        )}`
      );
    }
  }

  // `origin` is a discriminated union keyed on `tool`: every writer sets `tool`,
  // and the rest of the fields are that tool's own business. So `tool` is all we
  // check. That is only safe because `origin` is documentation and never control
  // flow — nothing branches on it, so a typo there cannot change a run's outcome.
  // The day something wants to *read* origin.seed, this needs to grow teeth.
  if (run.origin !== undefined) {
    if (
      run.origin === null ||
      typeof run.origin !== "object" ||
      Array.isArray(run.origin)
    ) {
      throw new Error(
        `"origin" must be an object when present, received: ${describe(
          run.origin
        )}`
      );
    }
    if (typeof run.origin.tool !== "string" || run.origin.tool === "") {
      throw new Error(
        `"origin.tool" must name the tool that wrote this run, received: ${describe(
          run.origin.tool
        )}`
      );
    }
  }

  if (run.settings !== undefined) checkWrites(run.settings, "settings");

  if (!Array.isArray(run.steps)) {
    throw new Error(
      `"steps" must be an array of per-step writes, received: ${describe(
        run.steps
      )}`
    );
  }
  if (run.steps.length === 0) {
    throw new Error('"steps" is empty, so the run has no steps to take');
  }
  run.steps.forEach((writes, step) => checkWrites(writes, `steps[${step}]`));

  return run;
}

/**
 * Read a run file from disk and hand back its content plus its id.
 *
 * @param {string | URL} path
 */
export async function loadRunFile(path) {
  const source = await readFile(path, "utf8");

  let parsed;
  try {
    parsed = JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }

  const run = validate(parsed);
  return { ...run, id: run.id ?? runId(run.settings, run.steps) };
}
