import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { loadRunFile } from "../core/runFile.js";
import { replay } from "../core/replay.js";
import { createForioDriver } from "../drivers/forio/forioDriver.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Testbed: execute a run file locally and on Forio, and compare what each reports. */

const MODEL_FILE = "AIGovModel.xlsx";

/** `{ account, project }` of the Forio project to run against. Credentials come from `.env`. */
const FORIO_TARGET = "forio.json";

/** The variables compared across both runtimes. `Step` shows where each run ended. */
const REPORTED = [
  "Step",
  "TrustInGovernment",
  "EconomyScore",
  "AIFDIStock",
  "AIContributionToGDP",
  "NetJobsFromAI",
];

const WIDTH = Math.max(...REPORTED.map((name) => name.length));

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) =>
  Array.isArray(value) ? `[${value.join(", ")}]` : String(value);

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
  Object.entries(writes)
    .map(([name, value]) => `${name}=${value}`)
    .join("  ");

const seconds = (ms) => `${(ms / 1000).toFixed(2)}s`;

/**
 * Connect a driver and replay the run through it, timing both halves.
 * `connect` covers loading the model (local) or logging in and introspecting (Forio).
 */
async function timedReplay(connect, run) {
  const start = performance.now();
  const driver = await connect();
  const connected = performance.now();
  const trace = await replay(driver, run, REPORTED);
  const end = performance.now();
  return {
    trace,
    connect: connected - start,
    run: end - connected,
    total: end - start,
  };
}

/** Print one side's reported variables and timings. */
function report(label, { trace, connect, run, total }) {
  console.log(`\n${label} · run ${trace.runKey}`);
  for (const name of REPORTED) {
    console.log(`  ${name.padEnd(WIDTH)}   ${show(trace.final[name])}`);
  }
  console.log(
    `  time   connect ${seconds(connect)} · run ${seconds(run)} · total ${seconds(total)}`
  );
}

/** @type {import('../cli/dispatch.js').Tool} */
export const test = {
  name: "test",
  summary: `Testbed: execute a run file against ${MODEL_FILE} locally and on Forio, and compare`,
  usage: [
    "usage: modelkit test <run-file.json>",
    "",
    `Executes a run file against ${MODEL_FILE} locally, then on the Forio project in`,
    `${FORIO_TARGET}, and prints ${REPORTED.slice(1).join(", ")}`,
    "from each, whether they match, and how long each side took.",
    "",
    "Needs FORIO_HANDLE and FORIO_PASSWORD (a team-account admin login) in .env.",
    "",
    "  modelkit test runs/aigov-base.run.json",
  ].join("\n"),

  async run(args, ctx) {
    const [path] = args;
    if (!path) {
      console.error(test.usage);
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

    const local = await timedReplay(
      () => createLocalDriver({ modelPath: resolve(ctx.cwd, MODEL_FILE) }),
      run
    );
    report("local", local);

    const forio = await timedReplay(
      () =>
        createForioDriver({
          ...target,
          modelFile: MODEL_FILE,
          credentials: { handle, password },
        }),
      run
    );
    report(`forio ${target.account}/${target.project}`, forio);

    console.log("\nparity");
    for (const name of REPORTED) {
      const same =
        JSON.stringify(local.trace.final[name]) ===
        JSON.stringify(forio.trace.final[name]);
      console.log(`  ${name.padEnd(WIDTH)}   ${same ? "same" : "DIFFERS"}`);
    }
  },
};
