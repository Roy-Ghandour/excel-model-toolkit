import { resolve } from "node:path";
import { loadRunFile } from "../core/runFile.js";
import { replay } from "../core/replay.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Execute a run file against a model and print what the model did. */

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
  Object.entries(writes)
    .map(([name, value]) => `${name}=${value}`)
    .join("  ");

/** @type {import('../cli/dispatch.js').Tool} */
export const execute = {
  name: "execute",
  summary: "Execute a run file against a model and print the trace",
  usage: [
    "usage: modelkit execute <run-file.json> <model.xlsx>",
    "",
    "Executes the decisions in a run file against a model, and prints each step's",
    "decisions followed by the full final state.",
    "",
    "  modelkit execute runs/savings-golden.run.json test.xlsx",
    "  modelkit execute runs/aigov-base.run.json AIGovModel.xlsx",
  ].join("\n"),

  async run(args, ctx) {
    const [path, modelFile] = args;
    if (!path || !modelFile) {
      console.error(execute.usage);
      return 1;
    }

    const run = await loadRunFile(resolve(ctx.cwd, path));
    const driver = await createLocalDriver({
      modelPath: resolve(ctx.cwd, modelFile),
    });

    console.log(`run ${run.id} · ${driver.modelFile}`);
    if (run.label) console.log(run.label);
    if (run.settings) console.log(`\nsettings   ${decisions(run.settings)}`);

    const trace = await replay(driver, run);

    console.log("\n  step   decisions");
    console.log("  ----   ---------");
    if (trace.steps.length === 0) console.log("  (none - base state)");
    for (const taken of trace.steps) {
      console.log(
        `  ${String(taken.state.Step ?? taken.step + 1).padStart(
          4
        )}   ${decisions(taken.writes)}`
      );
    }

    // The full final state rather than a chosen few: which ranges matter is a
    // question for whatever analyses the numbers, not for the thing producing them.
    const width = Math.max(...trace.namedRanges.map((name) => name.length));
    console.log("\nfinal state");
    for (const name of trace.namedRanges) {
      console.log(`  ${name.padEnd(width)}   ${show(trace.final[name])}`);
    }
  },
};
