import { version } from "../../package.json" with { type: "json" };
import { tools } from "./registry.js";

/**
 * Turn a command line into a tool call.
 */

/**
 * Every tool implements the following interface
 *
 * Two rules the dispatcher enforces on its behalf, so that tools stay small:
 *
 * - **A tool never calls `process.exit`.** It returns an exit code, or returns
 *   nothing for success, or throws.
 * - **Data goes to stdout, diagnostics go to stderr.** That is what lets
 *   `modelkit <tool> | something` work. Errors are printed by the dispatcher.
 *
 * @typedef {object} Tool
 * @property {string} name Invoked as `modelkit <name>`.
 * @property {string} summary One line, listed by `modelkit help`.
 * @property {string} usage Printed by `modelkit help <name>` and on bad arguments.
 * @property {(args: string[], ctx: Context) => Promise<number | void> | number | void} run
 */

/**
 * What a tool is given besides its arguments.
 *
 * `cwd` is injected rather than read from `process` so a tool never touches global state.
 *
 * @typedef {object} Context
 * @property {string} cwd Absolute path the user invoked the tool from.
 */

/** Tools by name. Built once; the registry is static by necessity, see registry.js. */
const byName = new Map(tools.map((tool) => [tool.name, tool]));

/** The tool list, aligned, as `modelkit help` shows it. */
function toolList() {
  const width = Math.max(...tools.map((tool) => tool.name.length));
  return tools
    .map((tool) => `  ${tool.name.padEnd(width)}   ${tool.summary}`)
    .join("\n");
}

/** The top-level help text. */
function help() {
  return [
    `modelkit ${version}`,
    "",
    "usage: modelkit <tool> [args]",
    "",
    "tools:",
    toolList(),
    "",
    "Run `modelkit help <tool>` for a tool's own usage.",
    "Relative paths in arguments are resolved from the current directory.",
  ].join("\n");
}

/**
 * Run one command line.
 *
 * Never throws and never exits: it returns the process's exit code, so that the
 * whole CLI can be driven from a test or from another tool without taking the
 * process down with it.
 *
 * @param {string[]} argv Arguments after the program name, i.e. `process.argv.slice(2)`.
 * @param {Context} ctx
 * @returns {Promise<number>} Exit code.
 */
export async function dispatch(argv, ctx) {
  const [name, ...args] = argv;

  if (name === undefined || name === "help" || name === "--help" || name === "-h") {
    // `help <tool>` is the only place a tool name appears without being run.
    const topic = name === "help" ? args[0] : undefined;
    if (topic !== undefined) {
      const tool = byName.get(topic);
      if (!tool) {
        console.error(`modelkit: no such tool: ${topic}\n\ntools:\n${toolList()}`);
        return 1;
      }
      console.log(tool.usage);
      return 0;
    }
    console.log(help());
    return 0;
  }

  if (name === "--version" || name === "-v") {
    console.log(version);
    return 0;
  }

  const tool = byName.get(name);
  if (!tool) {
    console.error(`modelkit: no such tool: ${name}\n\ntools:\n${toolList()}`);
    return 1;
  }

  try {
    return (await tool.run(args, ctx)) ?? 0;
  } catch (error) {
    // Tools throw plain Errors; the driver layer attaches `information` with the
    // model-side detail that makes a failure diagnosable.
    console.error(`modelkit ${name}: ${error?.message ?? error}`);
    if (error?.information) console.error(error.information);
    return 1;
  }
}
