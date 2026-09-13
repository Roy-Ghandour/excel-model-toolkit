import { resolve } from "node:path";
import { loadSettings, parse, whole } from "../cli/args.js";
import { generate } from "../core/generate.js";
import { createRng } from "../core/rng.js";
import { assertDeclaration, writeRunFile } from "../core/runFile.js";
import { SIMULATION_ID } from "../core/simulation.js";
import { rulesFor } from "../simulations/registry.js";
import { assertValid } from "../core/violations.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/** Generate one random, valid run of whatever simulation a model implements. */

/** @type {import('../cli/dispatch.js').Tool} */
export const sample = {
  name: "sample",
  summary: "Generate a random valid run file for a model",
  usage: [
    "usage: modelkit sample <model.xlsx> <settings.json> --steps <n> [--seed <s>] [--out <file>]",
    "",
    "Plays the model at random, choosing only what the simulation's rules allow, and",
    "writes the result as a run file. Prints to stdout unless --out is given.",
    "",
    "  --steps   how many steps to generate, including the simulation's own setup turn",
    "  --seed    number or text; the same seed and model reproduce the same run",
    "  --out     write the run file here instead of stdout",
    "",
    "  modelkit sample models/AIGovModel.xlsx runs/aigov.settings.json --steps 6 --seed 1",
  ].join("\n"),

  async run(args, ctx) {
    const { flags, positional } = parse(args);
    const [modelFile, settingsFile] = positional;
    if (!modelFile || !settingsFile || flags.steps === undefined) {
      console.error(sample.usage);
      return 1;
    }

    const length = whole(flags.steps, "steps", 0);

    // A recorded seed is what makes a run reproducible, so an unspecified one is
    // chosen here rather than left to chance inside the generator. Kept as text: the
    // rng hashes it either way, and the run file records exactly what was typed.
    const seed = flags.seed ?? String(Date.now());
    const settings = await loadSettings(resolve(ctx.cwd, settingsFile));
    const driver = await createLocalDriver({ modelPath: resolve(ctx.cwd, modelFile) });

    if (!driver.schema.has(SIMULATION_ID)) {
      throw new Error(
        `${driver.modelFile} has no '${SIMULATION_ID}' named range, so which simulation it implements is unknown`
      );
    }
    const simulation = driver.readFromFile(SIMULATION_ID);
    const rules = rulesFor(simulation);

    // The same declaration check every run file faces, applied to what this tool was
    // asked to make — so an impossible request is refused before a model is driven.
    assertDeclaration(
      { simulation, stepCount: length, settings },
      rules
    );

    const { runFile, violations } = await generate(driver, {
      simulation,
      settings,
      length,
      rules,
      rng: createRng(seed),
      origin: { tool: "sample", seed },
    });

    // `sample` draws only from the legal set, so a violation here is a bug in the
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
