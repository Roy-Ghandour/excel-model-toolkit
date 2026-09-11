import { resolve } from "node:path";
import { loadRunFile } from "../core/runFile.js";
import { replay } from "../core/replay.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/**
 * Run a run file and print what the model did.
 *
 * Everything about the run comes from the file: which model, what to write, and how
 * many steps to take. This tool only decides *how* to reach the model — it picks the
 * local driver — and how to render what came back.
 */

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
  Object.entries(writes)
    .map(([name, value]) => `${name}=${value}`)
    .join("  ");

/** @type {import('../cli/dispatch.js').Tool} */
export const simulate = {
  name: "simulate",
  summary: "Replay a run file against its model and print the trace",
  usage: [
    "usage: modelkit simulate <run-file.json>",
    "",
    "Replays the decisions in a run file against the model it names, and prints",
    "each step's decisions followed by the full final state.",
    "",
    "Both the run file and the model it names are resolved from the current",
    "directory, so run from wherever the files are:",
    "",
    "  modelkit simulate runs/savings-golden.run.json",
    "  cd ~/Downloads && modelkit simulate sweep-042.run.json",
  ].join("\n"),

  async run(args, ctx) {
    const [path] = args;
    if (!path) {
      console.error(simulate.usage);
      return 1;
    }

    const run = await loadRunFile(resolve(ctx.cwd, path));
    const driver = await createLocalDriver({
      modelPath: resolve(ctx.cwd, run.model.file),
    });

    console.log(`run ${run.id} · ${driver.modelFile}`);
    if (run.label) console.log(run.label);
    if (run.settings) console.log(`\nsettings   ${decisions(run.settings)}`);

    const trace = replay(driver, run);

    console.log("\n  step   decisions");
    console.log("  ----   ---------");
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
