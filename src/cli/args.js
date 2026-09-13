import { readFile } from "node:fs/promises";

/** Argument handling every tool shares. */

/** Pull `--flag value` pairs off the command line, leaving the positional arguments. */
export function parse(args) {
  const flags = {};
  const positional = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith("--")) flags[args[i].slice(2)] = args[++i];
    else positional.push(args[i]);
  }
  return { flags, positional };
}

/** Read a settings file: a plain map of named range to number, nothing more. */
export async function loadSettings(path) {
  const source = await readFile(path, "utf8");
  try {
    return JSON.parse(source);
  } catch (error) {
    throw new Error(`${path} is not valid JSON: ${error.message}`);
  }
}

/**
 * Read a `--flag` that must be a whole number, naming the flag when it is not.
 *
 * @param {string | undefined} value As typed on the command line.
 * @param {string} flag The flag's name, for the error message.
 * @param {number} least Smallest value the flag accepts.
 */
export function whole(value, flag, least) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < least) {
    throw new Error(
      `--${flag} must be a whole number of at least ${least}, received: ${value}`
    );
  }
  return number;
}
