import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRunFile } from "../core/runFile.js";
import { replay } from "../core/replay.js";
import { createForioDriver } from "../drivers/forio/forioDriver.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Testbed: execute a run file locally and on Forio, and compare every named range at every step. */

const MODEL_FILE = "AIGovModel.xlsx";

/** `{ account, project }` of the Forio project to run against. Credentials come from `.env`. */
const FORIO_TARGET = "forio.json";

/** Mismatches printed in full; any beyond this are only counted. */
const SHOWN = 40;

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
  Object.entries(writes)
    .map(([name, value]) => `${name}=${value}`)
    .join("  ");

const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

/** Connect a driver and replay the run through it, reading `names` at every state. */
async function timedReplay(connect, run, names) {
  const start = performance.now();
  const driver = await connect();
  const connected = performance.now();
  const trace = await replay(driver, run, names);
  const end = performance.now();
  return {
    trace,
    connect: connected - start,
    run: end - connected,
    total: end - start,
  };
}

/** Pair up the states both traces captured: before anything, then after each step. */
const states = (local, forio) => [
  { label: "initial", local: local.initial, forio: forio.initial },
  ...local.steps.map((taken, i) => ({
    label: `step ${i + 1}`,
    local: taken.state,
    forio: forio.steps[i].state,
  })),
];

/** @type {import('../cli/dispatch.js').Tool} */
export const testFull = {
  name: "testFull",
  summary: `Testbed: execute a run file against ${MODEL_FILE} locally and on Forio, compare every named range`,
  usage: [
    "usage: modelkit testFull <run-file.json>",
    "",
    `Executes a run file against ${MODEL_FILE} locally, then on the Forio project in`,
    `${FORIO_TARGET}, and compares every named range before anything is written and`,
    "after each step. Prints a match count per state and every value that differs.",
    "",
    "Needs FORIO_HANDLE and FORIO_PASSWORD (a team-account admin login) in .env.",
    "",
    "  modelkit testFull runs/aigov-ecslider1.run.json",
  ].join("\n"),

  async run(args, ctx) {
    const [path] = args;
    if (!path) {
      console.error(testFull.usage);
      return 1;
    }

    const { FORIO_HANDLE: handle, FORIO_PASSWORD: password } = process.env;
    if (!handle || !password) {
      throw new Error("FORIO_HANDLE and FORIO_PASSWORD must be set in .env");
    }
    const target = JSON.parse(
      await readFile(resolve(ctx.cwd, FORIO_TARGET), "utf8")
    );

    const run = await loadRunFile(resolve(ctx.cwd, path));
    console.log(`run ${run.id} · ${MODEL_FILE}`);
    if (run.label) console.log(run.label);
    if (run.settings) console.log(`\nsettings   ${decisions(run.settings)}`);
    console.log("\n  step   decisions");
    console.log("  ----   ---------");
    if (run.steps.length === 0) console.log("  (none - base state)");
    run.steps.forEach((writes, step) =>
      console.log(`  ${String(step + 1).padStart(4)}   ${decisions(writes)}`)
    );

    // Loaded outside `timedReplay` because its names drive both sides; timed here instead.
    const loadStart = performance.now();
    const localDriver = await createLocalDriver({
      modelPath: resolve(ctx.cwd, MODEL_FILE),
    });
    const load = performance.now() - loadStart;
    const names = [...localDriver.schema.keys()];

    const local = await timedReplay(() => localDriver, run, names);
    const forio = await timedReplay(
      () =>
        createForioDriver({
          ...target,
          modelFile: MODEL_FILE,
          credentials: { handle, password },
        }),
      run,
      names
    );

    console.log(
      `\nlocal · connect ${seconds(load)} · run ${seconds(local.run)} · total ${seconds(load + local.total)}`
    );
    console.log(
      `forio ${target.account}/${target.project} · connect ${seconds(forio.connect)} · run ${seconds(forio.run)} · total ${seconds(forio.total)}`
    );

    const mismatches = [];
    console.log(`\ncompared ${names.length} named ranges at each state`);
    for (const state of states(local.trace, forio.trace)) {
      const differing = names.filter(
        (name) =>
          JSON.stringify(state.local[name]) !== JSON.stringify(state.forio[name])
      );
      console.log(
        `  ${state.label.padEnd(8)}   ${names.length - differing.length}/${names.length} match`
      );
      for (const name of differing) mismatches.push({ state: state.label, name, ...state });
    }

    if (mismatches.length === 0) {
      console.log("\nevery named range matches at every state");
      return;
    }

    console.log(`\n${mismatches.length} mismatches`);
    for (const { state, name, local: l, forio: f } of mismatches.slice(0, SHOWN)) {
      console.log(`\n  ${state} · ${name}`);
      console.log(`    local   ${show(l[name])}`);
      console.log(`    forio   ${show(f[name])}`);
    }
    if (mismatches.length > SHOWN) {
      console.log(`\n  … and ${mismatches.length - SHOWN} more`);
    }
    return 1;
  },
};
