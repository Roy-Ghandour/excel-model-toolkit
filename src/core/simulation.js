import { assertDeclaration } from "./runFile.js";
import { rulesFor } from "../simulations/registry.js";

/** Named range every model carries, holding the id of the simulation it implements. */
export const SIMULATION_ID = "ModelKitID";

/**
 * Refuse a run file written for a different simulation than the model implements.
 * The id is read from the file itself, so the check costs no run.
 *
 * @param {{ modelFile: string, schema: Map<string, object>, readFromFile: (name: string) => unknown }} driver A local driver.
 * @param {{ simulation: string }} runFile
 */
export function assertSimulation(driver, runFile) {
  if (!driver.schema.has(SIMULATION_ID)) {
    throw new Error(
      `${driver.modelFile} has no '${SIMULATION_ID}' named range, so which simulation it implements is unknown`
    );
  }

  const simulation = driver.readFromFile(SIMULATION_ID);
  if (simulation !== runFile.simulation) {
    throw new Error(
      `run file is a run of '${runFile.simulation}' but ${driver.modelFile} implements '${simulation}'`
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
 * @param {{ simulation: string, stepCount: number, settings: Record<string, number> }} run A loaded run file.
 * @returns {import('./simulate.js').Rules} The run's simulation's rules, for `replay`.
 */
export function preflight(driver, run) {
  assertSimulation(driver, run);
  const rules = rulesFor(run.simulation);
  assertDeclaration(run, rules);
  return rules;
}
