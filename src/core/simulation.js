import { assertDeclaration } from "./runFile.js";
import { rulesFor } from "../simulations/registry.js";

/** Named range every model carries, holding the id of the simulation it implements. */
export const SIMULATION_ID = "ModelKitID";

/**
 * Refuse a run written for a different simulation than the model implements.
 * The id is read from the file itself, so the check costs no run.
 *
 * The run may be a run file or a scenario — both declare a `simulation` — so the
 * message names what was declared rather than which kind of file declared it.
 *
 * @param {{ modelFile: string, schema: Map<string, object>, readFromFile: (name: string) => unknown }} driver A local driver.
 * @param {{ simulation: string }} run
 */
export function assertSimulation(driver, run) {
  if (!driver.schema.has(SIMULATION_ID)) {
    throw new Error(
      `${driver.modelFile} has no '${SIMULATION_ID}' named range, so which simulation it implements is unknown`
    );
  }

  const simulation = driver.readFromFile(SIMULATION_ID);
  if (simulation !== run.simulation) {
    throw new Error(
      `a run of '${run.simulation}' cannot be driven against ${driver.modelFile}, which implements '${simulation}'`
    );
  }
}

/**
 * Every check that can be made before a run is driven, in the order that reports
 * the real problem first: the wrong model is a worse mismatch than the wrong shape.
 *
 * The one place the core reaches the rules registry, so each tool asks for its
 * rules once and `simulate`, `replay` and `runFile` stay registry-free.
 *
 * @param {{ modelFile: string, schema: Map<string, object>, readFromFile: (name: string) => unknown }} driver A local driver.
 * @param {{ simulation: string, stepCount: number, settings: Record<string, number> }} run A loaded run file, or a scenario about to become one.
 * @returns {import('./simulate.js').Rules} The run's simulation's rules, for `replay`.
 */
export function preflight(driver, run) {
  assertSimulation(driver, run);
  const rules = rulesFor(run.simulation);
  assertDeclaration(run, rules);
  return rules;
}
