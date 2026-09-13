import { execute } from "../tools/execute.js";
import { maximize, minimize } from "../tools/optimise.js";
import { random } from "../tools/random.js";
import { sample } from "../tools/sample.js";

/**
 * Every tool `modelkit` can run.
 *
 * @type {import('./dispatch.js').Tool[]}
 */
export const tools = [execute, random, sample, maximize, minimize];
