/**
 * What a tool says when a run breaks its simulation's rules.
 *
 * Pure: no driver, no model, nothing to run. Violations arrive as data on a trace,
 * and a tool decides what to do with them — refuse here, or report them its own way.
 */

/** One violation. Steps count from 1, as the tools' step tables do. */
const line = ({ step, name, reason }) =>
  `  step ${step + 1} · ${name} · ${reason}`;

/**
 * Every violation, as one message.
 *
 * @param {Array<{ step: number, name: string, reason: string }>} violations
 * @returns {string}
 */
export function describe(violations) {
  return `run is invalid · ${violations.length} violation${
    violations.length === 1 ? "" : "s"
  }\n${violations.map(line).join("\n")}`;
}

/**
 * Refuse a run that broke any rule.
 *
 * @param {Array<{ step: number, name: string, reason: string }>} violations
 * @throws If there are any.
 */
export function assertValid(violations) {
  if (violations.length > 0) throw new Error(describe(violations));
}
