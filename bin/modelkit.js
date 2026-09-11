#!/usr/bin/env bun
import { dispatch } from "../src/cli/dispatch.js";

/**
 * The program entry point, passes args and CWD to dispatch
 */

process.exitCode = await dispatch(process.argv.slice(2), {
  cwd: process.cwd(),
});
