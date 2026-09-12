import { simulate } from "./simulate.js";

/**
 * Replay a run file and return the output state.
 *
 * The returned trace holds the state before anything was written, then one entry
 * per step recording the decisions made and the state they produced. State is
 * captured *after* stepping, which is the point at which the model has responded to
 * the decision — the same convention a recorded Epicenter run uses.
 *
 * A replay is [`simulate`](./simulate.js) with the decisions already made. Pass
 * `rules` and they are checked as the run is driven: checking a run and running it
 * are one execution, because a rule can only be judged against what the model
 * calculates. What comes back is `violations`, as data — refusing an invalid run is
 * the caller's decision, see [`assertValid`](./violations.js).
 *
 * @param {{ schema: Map<string, object>, createRun: () => object | Promise<object> }} driver
 * @param {{ id?: string, settings?: Record<string, number>, steps: Array<Record<string, number>> }} runFile
 * @param {object} [options]
 * @param {import('./simulate.js').Rules} [options.rules] The rules of the run file's simulation. Omitted, nothing is checked.
 * @param {string[]} [options.names] The named ranges to read at each step. Defaults to all of them.
 * @returns {Promise<{ id: string | undefined, runKey: string, namedRanges: string[], initial: object, steps: Array<{ step: number, writes: object, state: object }>, final: object, violations: Array<{ step: number, name: string, reason: string }> }>}
 */
export async function replay(
  driver,
  runFile,
  { rules, names = [...driver.schema.keys()] } = {}
) {
  const { trace, violations } = await simulate(driver, {
    settings: runFile.settings,
    length: runFile.steps.length,
    decide: (step) => runFile.steps[step],
    rules,
    names,
  });

  // Always present, empty without rules, so no caller has to check it exists.
  return { id: runFile.id, ...trace, violations };
}
