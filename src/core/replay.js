/**
 * Replay a run file and return the output state.
 *
 * The returned trace holds the state before anything was written, then one entry
 * per step recording the decisions made and the state they produced. State is
 * captured *after* stepping, which is the point at which the model has responded to
 * the decision — the same convention a recorded Epicenter run uses.
 *
 * @param {{ schema: Map<string, object>, createRun: () => object | Promise<object> }} driver
 * @param {{ id?: string, settings?: Record<string, number>, steps: Array<Record<string, number>> }} runFile
 * @param {string[]} [names] The named ranges to read at each step. Defaults to all of them.
 * @returns {Promise<{ id: string | undefined, runKey: string, namedRanges: string[], initial: object, steps: Array<{ step: number, writes: object, state: object }>, final: object }>}
 */
export async function replay(
  driver,
  runFile,
  names = [...driver.schema.keys()]
) {
  const run = await driver.createRun();

  try {
    const initial = await run.read(names);

    // Settings are written at step 0.
    if (runFile.settings) await run.write(0, runFile.settings);

    const taken = [];
    for (const [step, writes] of runFile.steps.entries()) {
      await run.write(step, writes);
      await run.step();
      taken.push({ step, writes, state: await run.read(names) });
    }

    return {
      id: runFile.id,
      runKey: run.id,
      namedRanges: names,
      initial,
      steps: taken,
      // No steps: the final state is whatever settings left behind.
      final: taken.length ? taken.at(-1).state : await run.read(names),
    };
  } finally {
    // Forio runs outlive the process unless removed; local runs have nothing to release.
    await run.dispose?.();
  }
}
