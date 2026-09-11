/**
 * Replay a run file and return the output state.
 *
 * The returned trace holds the state before anything was written, then one entry
 * per step recording the decisions made and the state they produced. State is
 * captured *after* stepping, which is the point at which the model has responded to
 * the decision — the same convention a recorded Epicenter run uses.
 *
 * @param {{ schema: Map<string, object>, createRun: () => object }} driver
 * @param {{ id?: string, settings?: Record<string, number>, steps: Array<Record<string, number>> }} runFile
 * @returns {{ id: string | undefined, runKey: string, namedRanges: string[], initial: object, steps: Array<{ step: number, writes: object, state: object }>, final: object }}
 */
export function replay(driver, runFile) {
  const namedRanges = [...driver.schema.keys()];
  const run = driver.createRun();

  const initial = run.read(namedRanges);

  // Settings are written at step 0.
  if (runFile.settings) run.write(0, runFile.settings);

  const taken = runFile.steps.map((writes, step) => {
    run.write(step, writes);
    run.step();
    return { step, writes, state: run.read(namedRanges) };
  });

  return {
    id: runFile.id,
    runKey: run.id,
    namedRanges,
    initial,
    steps: taken,
    // No steps: the final state is whatever settings left behind.
    final: taken.length ? taken.at(-1).state : run.read(namedRanges),
  };
}
