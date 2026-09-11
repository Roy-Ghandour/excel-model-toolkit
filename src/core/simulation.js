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
