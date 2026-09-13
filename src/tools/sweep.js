import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadSettings, parse, whole } from "../cli/args.js";
import { generate } from "../core/generate.js";
import { endOfRun, summarize, toCsv } from "../core/results.js";
import { createRng } from "../core/rng.js";
import { assertDeclaration, writeRunFile } from "../core/runFile.js";
import { SIMULATION_ID } from "../core/simulation.js";
import { describe } from "../core/violations.js";
import { rulesFor } from "../simulations/registry.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Generate many random valid runs of one model, and a table of how they turned out. */

/** A folder name that sorts by when the sweep ran and survives every filesystem. */
const stamp = () =>
  `sweep-${new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19)}`;

/** The column the run id goes in, and the one the summary rows label themselves in. */
const ID = "id";

/** Long enough that minutes read better than a four-digit second count. */
function seconds(ms) {
  if (ms < 60_000) return `${(ms / 1000).toFixed(2)}s`;
  const whole = Math.round(ms / 1000);
  return `${Math.floor(whole / 60)}m ${String(whole % 60).padStart(2, "0")}s`;
}

/** @type {import('../cli/dispatch.js').Tool} */
export const sweep = {
  name: "sweep",
  summary: "Generate many random valid runs and export their results as CSV",
  usage: [
    "usage: modelkit sweep <model.xlsx> <settings.json> --steps <n> [--runs <n>] [--seed <s>] [--out <dir>]",
    "",
    "Plays the model at random many times over, writing one run file per run plus a",
    "sweep.csv holding each run's id and its simulation's results.",
    "",
    "  --steps   how many steps each run has, including the simulation's own setup turn",
    "  --runs    how many runs to generate (default 100)",
    "  --seed    number or text; the same seed, model and settings reproduce the sweep",
    "  --out     write the folder here instead of ./sweep-<timestamp>",
    "",
    "Each result is read at the run's last step, so the model's authored tail past the",
    "end of a short run is never reported. The CSV ends with a max, min and average row.",
    "",
    "  modelkit sweep models/AIGovModel.xlsx runs/aigov.settings.json --steps 6",
    "  modelkit sweep models/test.xlsx runs/savings.settings.json --steps 8 --runs 20 --seed abc",
  ].join("\n"),

  async run(args, ctx) {
    const { flags, positional } = parse(args);
    const [modelFile, settingsFile] = positional;
    if (!modelFile || !settingsFile || flags.steps === undefined) {
      console.error(sweep.usage);
      return 1;
    }

    const length = whole(flags.steps, "steps", 0);
    const runs = flags.runs === undefined ? 100 : whole(flags.runs, "runs", 1);

    // One seed for the sweep, one derived seed per run: the sweep reproduces whole,
    // and any single row of it reproduces on its own.
    const seed = flags.seed ?? String(Date.now());
    const settings = await loadSettings(resolve(ctx.cwd, settingsFile));

    // Parsing the workbook is a one-off the whole sweep shares, so it is timed apart
    // from the runs — otherwise a short sweep looks slower per run than a long one.
    const started = performance.now();
    const driver = await createLocalDriver({ modelPath: resolve(ctx.cwd, modelFile) });
    const load = performance.now() - started;

    if (!driver.schema.has(SIMULATION_ID)) {
      throw new Error(
        `${driver.modelFile} has no '${SIMULATION_ID}' named range, so which simulation it implements is unknown`
      );
    }
    const simulation = driver.readFromFile(SIMULATION_ID);
    const rules = rulesFor(simulation);

    // Everything decidable from the request alone, decided once rather than `runs` times.
    assertDeclaration({ simulation, stepCount: length, settings }, rules);

    const columns = [ID, "seed", "steps", ...rules.settings, ...rules.results];
    const directory = resolve(ctx.cwd, flags.out ?? stamp());
    let created = false;

    const rows = [];
    const seen = new Set();
    let invalid = 0;
    let duplicate = 0;

    for (let index = 0; index < runs; index++) {
      const runSeed = `${seed}/${index}`;
      const { runFile, trace, violations } = await generate(driver, {
        simulation,
        settings,
        length,
        rules,
        rng: createRng(runSeed),
        origin: { tool: "sweep", seed: runSeed },
      });

      if (violations.length > 0) {
        // Every run of a sweep shares its settings and its length, so a violation on
        // the first one is a property of the request rather than of the draw — a
        // `--steps` the settings contradict, say, which only `checkStep` can see.
        // Later ones are a sampler bug in one draw, and 99 good runs outlive it.
        if (index === 0) {
          throw new Error(
            `${describe(violations)}\n\nthe first run of the sweep is invalid, so every run would be`
          );
        }
        console.error(`run ${index + 1}/${runs} · invalid · ${describe(violations)}`);
        invalid++;
        continue;
      }

      if (seen.has(runFile.id)) {
        console.error(`run ${index + 1}/${runs} · ${runFile.id} · duplicate, skipped`);
        duplicate++;
        continue;
      }
      seen.add(runFile.id);

      // Made here rather than up front, so an aborted sweep leaves no empty folder.
      if (!created) {
        await mkdir(directory, { recursive: true });
        created = true;
      }

      await writeRunFile(join(directory, `${runFile.id}.run.json`), runFile);
      rows.push({
        [ID]: runFile.id,
        seed: runSeed,
        steps: length,
        ...settings,
        ...endOfRun(trace.final, rules.results, length),
      });
      console.error(`run ${index + 1}/${runs} · ${runFile.id}`);
    }

    await writeFile(
      join(directory, "sweep.csv"),
      toCsv(columns, [...rows, ...summarize(rows, columns, ID)])
    );

    const skipped = [
      invalid && `${invalid} invalid`,
      duplicate && `${duplicate} duplicate`,
    ].filter(Boolean);
    // Per run is over every run attempted, skipped ones included: they cost the same
    // to generate, so it is the number that predicts what a larger sweep will take.
    const elapsed = performance.now() - started;
    console.error(
      `\n${rows.length} run${rows.length === 1 ? "" : "s"} · ${directory}${
        skipped.length ? ` · skipped ${skipped.join(", ")}` : ""
      }`
    );
    console.error(
      `${seconds(elapsed)} total · ${seconds(load)} loading the model · ${seconds(
        (elapsed - load) / runs
      )} per run`
    );
    return skipped.length ? 1 : 0;
  },
};
