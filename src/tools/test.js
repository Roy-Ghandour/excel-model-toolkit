import { resolve } from "node:path";
import { loadRunFile } from "../core/runFile.js";
import { replay } from "../core/replay.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Testbed: execute a run file against AIGovModel and print the Results sheet. */

const MODEL_FILE = "AIGovModel.xlsx";
const REPORT_SHEET = "Results";

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
  Object.entries(writes)
    .map(([name, value]) => `${name}=${value}`)
    .join("  ");

/** @type {import('../cli/dispatch.js').Tool} */
export const test = {
  name: "test",
  summary: `Testbed: execute a run file against ${MODEL_FILE}, report the ${REPORT_SHEET} sheet`,
  usage: [
    "usage: modelkit test <run-file.json>",
    "",
    `Executes a run file against ${MODEL_FILE}, and prints each step's decisions`,
    `followed by the final state of every named range on the ${REPORT_SHEET} sheet.`,
    "",
    "  modelkit test runs/aigov-base.run.json",
  ].join("\n"),

  async run(args, ctx) {
    const [path] = args;
    if (!path) {
      console.error(test.usage);
      return 1;
    }

    const run = await loadRunFile(resolve(ctx.cwd, path));
    const driver = await createLocalDriver({
      modelPath: resolve(ctx.cwd, MODEL_FILE),
    });

    console.log(`run ${run.id} · ${driver.modelFile}`);
    if (run.label) console.log(run.label);
    if (run.settings) console.log(`\nsettings   ${decisions(run.settings)}`);

    const trace = replay(driver, run);

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

    const names = trace.namedRanges.filter(
      (name) => driver.schema.get(name).sheet === REPORT_SHEET
    );
    const width = Math.max(...names.map((name) => name.length));
    console.log(`\nfinal state · ${REPORT_SHEET}`);
    for (const name of names) {
      console.log(`  ${name.padEnd(width)}   ${show(trace.final[name])}`);
    }
  },
};
