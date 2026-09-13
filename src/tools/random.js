import { resolve } from "node:path";
import { parse } from "../cli/args.js";
import { generate } from "../core/generate.js";
import { createRng } from "../core/rng.js";
import { writeRunFile } from "../core/runFile.js";
import { loadScenario } from "../core/scenario.js";
import { preflight } from "../core/simulation.js";
import { assertValid } from "../core/violations.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Generate one random, valid run of whatever simulation a model implements. */

/** @type {import('../cli/dispatch.js').Tool} */
export const random = {
  name: "random",
  summary: "Generate a random valid run file for a model",
  usage: [
    "usage: modelkit random <model.xlsx> <scenario.json> [--seed <s>] [--out <file>]",
    "",
    "Plays the model at random, choosing only what the simulation's rules allow, and",
    "writes the result as a run file. Prints to stdout unless --out is given.",
    "",
    "The scenario file carries the settings and how many steps the run has; see",
    "docs/scenarioFile/scenario-file.md.",
    "",
    "  --seed    number or text; the same seed and model reproduce the same run",
    "  --out     write the run file here instead of stdout",
    "",
    "  modelkit random models/AIGovModel.xlsx runs/aigov.scenario.json --seed 1",
  ].join("\n"),

  async run(args, ctx) {
    const { flags, positional } = parse(args);
    const [modelFile, scenarioFile] = positional;
    if (!modelFile || !scenarioFile) {
      console.error(random.usage);
      return 1;
    }

    // A recorded seed is what makes a run reproducible, so an unspecified one is
    // chosen here rather than left to chance inside the generator. Kept as text: the
    // rng hashes it either way, and the run file records exactly what was typed.
    const seed = flags.seed ?? String(Date.now());
    const scenario = await loadScenario(resolve(ctx.cwd, scenarioFile));
    const driver = await createLocalDriver({ modelPath: resolve(ctx.cwd, modelFile) });

    // A scenario is a run file without its decisions, so it faces the same checks a
    // run file does — and an impossible request is refused before a model is driven.
    const rules = preflight(driver, scenario);

    const { runFile, violations } = await generate(driver, {
      simulation: scenario.simulation,
      settings: scenario.settings,
      length: scenario.stepCount,
      rules,
      rng: createRng(seed),
      origin: { tool: "random", seed },
    });

    // `random` draws only from the legal set, so a violation here is a bug in the
    // sampler rather than a run to throw away. Either way nothing invalid is emitted.
    assertValid(violations);

    if (!flags.out) {
      process.stdout.write(`${JSON.stringify(runFile, null, 2)}\n`);
      return;
    }
    await writeRunFile(resolve(ctx.cwd, flags.out), runFile);
    // Diagnostics, so `--out` stays silent on stdout.
    console.error(`run ${runFile.id} · seed ${seed} · ${flags.out}`);
  },
};
