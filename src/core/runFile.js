import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

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
export function describe(value) {
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
export function checkWrites(writes, where) {
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
 * @returns {{ modelkit: number, simulation: string, model?: { file?: string, version?: string, sha256?: string }, id?: string, label?: string, createdAt?: string, origin?: { tool: string }, settings: Record<string, number>, stepCount: number, steps: Array<Record<string, number>> }}
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

  // Required so that a run states what it was run under rather than inheriting
  // whatever the workbook happens to be saved with. Which settings a simulation
  // expects is its own business — see `assertDeclaration`.
  checkWrites(run.settings, "settings");

  if (!Array.isArray(run.steps)) {
    throw new Error(
      `"steps" must be an array of per-step writes, received: ${describe(
        run.steps
      )}`
    );
  }
  // Empty is legal here: whether a run of zero steps makes sense is the
  // simulation's call, made in `assertDeclaration` against its `minSteps`.
  run.steps.forEach((writes, step) => checkWrites(writes, `steps[${step}]`));

  if (!Number.isInteger(run.stepCount) || run.stepCount < 0) {
    throw new Error(
      `"stepCount" must be a whole number of steps, received: ${describe(
        run.stepCount
      )}`
    );
  }
  // The array is what executes; `stepCount` is the author saying what they meant.
  // A truncated file is otherwise indistinguishable from an intended short run.
  if (run.stepCount !== run.steps.length) {
    throw new Error(
      `"stepCount" is ${run.stepCount} but "steps" holds ${run.steps.length} entries`
    );
  }

  return run;
}

/** List names in an error message, in the order the simulation declares them. */
const list = (names) => names.join(", ");

/**
 * Check a run file against the static facts its simulation declares about itself.
 *
 * Everything here is decided from the file alone — no model is driven, so a run
 * that cannot be the shape its simulation takes is refused before a driver exists.
 * Rules that need what the model computes belong in `checkStep`.
 *
 * Settings must match *exactly*. Missing means a run silently inherited whatever
 * the workbook was saved with; unexpected means a setting nobody vetted is reaching
 * the model. Both are reported at once, with every name — fixing five settings one
 * error at a time is five pointless cycles.
 *
 * @param {ReturnType<typeof validate>} run
 * @param {{ minSteps: number, maxSteps: number, settings: string[] }} rules Its simulation's.
 */
export function assertDeclaration(run, { minSteps, maxSteps, settings }) {
  if (run.stepCount < minSteps || run.stepCount > maxSteps) {
    throw new Error(
      `a run of '${run.simulation}' is ${minSteps} to ${maxSteps} steps long, but "stepCount" is ${run.stepCount}`
    );
  }

  const declared = new Set(Object.keys(run.settings));
  const missing = settings.filter((name) => !declared.has(name));
  const unexpected = [...declared].filter((name) => !settings.includes(name));

  if (missing.length || unexpected.length) {
    const problems = [
      missing.length && `missing ${list(missing)}`,
      unexpected.length && `unexpected ${list(unexpected)}`,
    ].filter(Boolean);
    throw new Error(
      `"settings" must declare exactly the settings of '${
        run.simulation
      }' (${list(settings)}) · ${problems.join(" · ")}`
    );
  }
}

/**
 * Assemble a run file from decisions a tool just made.
 *
 * Field order is the order `run-file.md` lists them in, so a generated file reads
 * the way the documented one does. The result goes through `validate` before it is
 * returned: a tool that emits a file no tool can load is a bug worth catching here
 * rather than on someone else's machine.
 *
 * @param {object} run
 * @param {string} run.simulation The model's `ModelKitID`.
 * @param {Record<string, number>} run.settings
 * @param {Array<Record<string, number>>} run.steps
 * @param {{ tool: string } & Record<string, unknown>} [run.origin] Provenance, never read back.
 * @param {string} [run.label]
 * @returns {ReturnType<typeof validate> & { id: string }}
 */
export function toRunFile({ simulation, settings, steps, origin, label }) {
  return validate({
    modelkit: FORMAT_VERSION,
    id: runId(settings, steps),
    ...(label === undefined ? {} : { label }),
    createdAt: new Date().toISOString(),
    simulation,
    ...(origin === undefined ? {} : { origin }),
    settings,
    stepCount: steps.length,
    steps,
  });
}

/**
 * Write a run file to disk, formatted the way a hand-written one is.
 *
 * @param {string | URL} path
 * @param {ReturnType<typeof validate>} run
 */
export async function writeRunFile(path, run) {
  await writeFile(path, `${JSON.stringify(run, null, 2)}\n`);
}

/**
 * Read a run file from disk and hand back its content plus its id.
 *
 * @param {string | URL} path
 * @returns {Promise<ReturnType<typeof validate> & { id: string }>}
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
