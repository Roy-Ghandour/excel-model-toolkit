/**
 * Drive a model step by step. The one loop every tool runs through.
 *
 * What varies between tools is only *where each step's decisions come from*: a run
 * file hands back what it recorded, a generator invents them from the state in front
 * of it. So `decide` is injected, and the loop itself never knows which it is.
 *
 * `rules` is likewise injected and simulation-specific. The loop only collects what
 * it returns.
 */

/**
 * One simulation's rules: what it declares about itself, and what it checks.
 *
 * The three static members are facts about every run of the simulation, checked
 * from a run file alone by `assertDeclaration` before any model is driven.
 * `checkStep` is for everything that needs what the model computes. It is given
 * `length` as well, so a rule can be about the run as a whole and not only the step.
 *
 * @typedef {object} Rules
 * @property {number} minSteps Shortest legal run.
 * @property {number} maxSteps Longest legal run.
 * @property {string[]} settings Exactly the settings a run file must declare.
 * @property {(step: { step: number, length: number, writes: object, before: object, after: object }) => Array<{ name: string, reason: string }>} checkStep Returns a violation per illegal decision.
 */

/**
 * Run one simulation, from the model's authored state to the end of the run.
 *
 * State is captured *after* stepping, the point at which the model has responded to
 * the decision — the same convention a recorded Epicenter run uses. That state is
 * also what the next step decides from.
 *
 * @param {{ schema: Map<string, object>, createRun: () => object | Promise<object> }} driver
 * @param {object} options
 * @param {Record<string, number>} [options.settings] Written once, before stepping.
 * @param {number} options.length How many steps to take.
 * @param {(step: number, state: object) => Record<string, number>} options.decide Determines the writes for a given step
 * @param {Rules} [options.rules] Checked at every step. Omitted, nothing is checked.
 * @param {string[]} [options.names] The named ranges to read. Defaults to all of them.
 * @returns {Promise<{ trace: { runKey: string, namedRanges: string[], initial: object, steps: Array<{ step: number, writes: object, state: object }>, final: object }, violations: Array<{ step: number, name: string, reason: string }> }>}
 */
export async function simulate(
  driver,
  { settings, length, decide, rules, names = [...driver.schema.keys()] }
) {
  const run = await driver.createRun();

  try {
    const initial = await run.read(names);

    // Settings are written at step 0.
    if (settings) await run.write(0, settings);

    // State after applying settings
    let before = settings && rules ? await run.read(names) : initial;

    const steps = [];
    const violations = [];
    for (let step = 0; step < length; step++) {
      const writes = decide(step, before);
      await run.write(step, writes);
      await run.step();
      const state = await run.read(names);

      steps.push({ step, writes, state });
      if (rules) {
        violations.push(
          ...rules
            .checkStep({ step, length, writes, before, after: state })
            .map((violation) => ({ step, ...violation }))
        );
      }
      before = state;
    }

    return {
      trace: {
        runKey: run.id,
        namedRanges: names,
        initial,
        steps,
        // No steps: the final state is whatever settings left behind.
        final: steps.length ? steps.at(-1).state : await run.read(names),
      },
      violations,
    };
  } finally {
    // Forio runs outlive the process unless removed; local runs have nothing to release.
    await run.dispose?.();
  }
}
