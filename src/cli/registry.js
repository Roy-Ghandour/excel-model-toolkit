import { execute } from "../tools/execute.js";
import { sample } from "../tools/sample.js";
import { test } from "../tools/test.js";
import { testFull } from "../tools/testFull.js";

/**
 * Every tool `modelkit` can run.
 *
 * @type {import('./dispatch.js').Tool[]}
 */
export const tools = [execute, sample, test, testFull];
