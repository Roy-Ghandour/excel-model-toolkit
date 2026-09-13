import { simulate } from "./simulate.js";
import { toRunFile } from "./runFile.js";

/**
 * Invent a run, one legal step at a time, and hand back the run file for it.
 *
 * The mirror of [`replay`](./replay.js): same loop, same rules, only the source of
 * each step's decisions differs. A replay reads them from a file; here the
 * simulation's `sample` invents them from the state in front of it.
 *
 * **`sample` draws only from the legal set**, so there is no draw-and-reject loop and
 * one pass produces one valid run. The rules stay on while it does, which makes the
 * returned `violations` an assertion rather than a filter: anything in it is a bug in
 * `sample`, not a run to discard. Refusing is still the caller's decision, see
 * [`assertValid`](./violations.js).
 *
 * The run file is built from the writes `sample` actually produced, not from what it
 * was asked for — the decisions that reached the model are the run.
 *
 * @param {{ schema: Map<string, object>, createRun: () => object | Promise<object> }} driver
 * @param {object} options
 * @param {string} options.simulation The model's `ModelKitID`, stamped into the run file.
 * @param {Record<string, number>} options.settings Written once, before stepping.
 * @param {number} options.length How many steps to generate.
 * @param {import('./simulate.js').Rules} options.rules Its `sample` decides, its `checkStep` asserts.
 * @param {import('./rng.js').Rng} options.rng
 * @param {{ tool: string } & Record<string, unknown>} [options.origin] Provenance for the run file.
 * @param {string[]} [options.names] The named ranges to read. Defaults to all of them.
 * @returns {Promise<{ runFile: ReturnType<import('./runFile.js').toRunFile>, trace: object, violations: Array<{ step: number, name: string, reason: string }> }>}
 */
export async function generate(
  driver,
  { simulation, settings, length, rules, rng, origin, names = [...driver.schema.keys()] }
) {
  if (!rules.sample) {
    throw new Error(`modelkit cannot generate runs of '${simulation}': it has no sampler`);
  }

  const { trace, violations } = await simulate(driver, {
    settings,
    length,
    decide: (step, state) => rules.sample(step, state, rng),
    rules,
    names,
  });

  const runFile = toRunFile({
    simulation,
    settings,
    steps: trace.steps.map((taken) => taken.writes),
    origin,
  });

  return { runFile, trace, violations };
}
