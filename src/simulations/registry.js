import { aigov } from "./aigov.js";
import { savings } from "./savings.js";

/**
 * Every simulation modelkit knows the rules of, keyed by the id a run file declares
 * in `simulation` and a model in its `ModelKitID` named range.
 *
 * @type {Record<string, import('../core/simulate.js').Rules>}
 */
const simulations = { aigov, savings };

/**
 * The rules a run of `simulation` is checked against.
 *
 * @param {string} simulation
 * @returns {import('../core/simulate.js').Rules}
 */
export function rulesFor(simulation) {
  const rules = simulations[simulation];
  if (!rules) {
    throw new Error(
      `no rules for simulation '${simulation}', which modelkit has never heard of`
    );
  }
  return rules;
}
