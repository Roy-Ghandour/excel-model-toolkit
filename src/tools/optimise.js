import { resolve } from "node:path";
import { parse, whole } from "../cli/args.js";
import { anneal } from "../core/anneal.js";
import { seconds } from "../core/format.js";
import { toRunFile, writeRunFile } from "../core/runFile.js";
import { loadScenario } from "../core/scenario.js";
import { preflight } from "../core/simulation.js";
import { createLocalDriver } from "../drivers/local/localDriver.js";

/**
 * Search a model's runs for the one that drives a named range highest, or lowest.
 *
 * Two tools from one body, because they differ by a sign and nothing else — the
 * search itself only ever maximises, and `minimize` hands it a negated score.
 */

/** Candidates per restart, and independent climbs, unless the caller says otherwise. */
const ITERATIONS = 200;
const RESTARTS = 3;

/**
 * @param {"maximize" | "minimize"} name
 * @param {1 | -1} direction
 * @returns {import('../cli/dispatch.js').Tool}
 */
function optimise(name, direction) {
  const goal = direction === 1 ? "highest" : "lowest";

  return {
    name,
    summary: `Search for the run that drives a named range ${goal}`,
    usage: [
      `usage: modelkit ${name} <model.xlsx> <scenario.json> <namedRange> [--iterations <n>] [--restarts <n>] [--seed <s>] [--out <file>]`,
      "",
      `Plays the model over and over, keeping what worked, to find the run with the`,
      `${goal} <namedRange> at its last step. Writes the best run as a run file,`,
      "printing it to stdout unless --out is given.",
      "",
      "  --iterations  candidates per restart (default 200)",
      "  --restarts    independent searches, so one local optimum cannot pass for the",
      "                global one (default 3)",
      "  --seed        number or text; the same seed and model reproduce the search",
      "  --out         write the best run file here instead of stdout",
      "",
      "Each candidate costs one full run of the model, so the total is roughly",
      "iterations x restarts. AIGovModel runs at about 0.3s each.",
      "",
      `  modelkit ${name} models/AIGovModel.xlsx runs/aigov.scenario.json TrustInGovernment`,
    ].join("\n"),

    async run(args, ctx) {
      const { flags, positional } = parse(args);
      const [modelFile, scenarioFile, objective] = positional;
      if (!modelFile || !scenarioFile || !objective) {
        console.error(this.usage);
        return 1;
      }

      const iterations =
        flags.iterations === undefined
          ? ITERATIONS
          : whole(flags.iterations, "iterations", 1);
      const restarts =
        flags.restarts === undefined ? RESTARTS : whole(flags.restarts, "restarts", 1);

      const seed = flags.seed ?? String(Date.now());
      const scenario = await loadScenario(resolve(ctx.cwd, scenarioFile));

      const started = performance.now();
      const driver = await createLocalDriver({ modelPath: resolve(ctx.cwd, modelFile) });
      const rules = preflight(driver, scenario);

      // Any named range the model has can be optimised, not only the ones a sweep
      // reports — a budget or an intermediate is a perfectly good thing to drive.
      // Checked here so a typo costs nothing rather than hundreds of runs.
      if (!driver.schema.has(objective)) {
        throw new Error(
          `'${objective}' is not a named range in ${driver.modelFile}, so there is nothing to ${name}`
        );
      }

      const { runFile: best, value, stats } = await anneal(driver, {
        simulation: scenario.simulation,
        settings: scenario.settings,
        length: scenario.stepCount,
        rules,
        objective,
        direction,
        iterations,
        restarts,
        seed,
        report: (line) => console.error(line),
      });

      // Rebuilt rather than amended, so the file goes through `validate` with its
      // origin already on it. The id is a digest of the decisions alone, so this is
      // the same run with the same id.
      //
      // Provenance only, never read back — but a run file that cannot say what it was
      // the best of is a run file nobody can place a month later.
      const runFile = toRunFile({
        simulation: scenario.simulation,
        settings: scenario.settings,
        steps: best.steps,
        origin: { tool: name, objective, value, seed, iterations, restarts },
      });

      const elapsed = performance.now() - started;
      const where = stats.bestAt
        ? `restart ${stats.bestAt.restart}, iteration ${stats.bestAt.iteration}`
        : "the starting run, unimproved";
      console.error(`\nbest ${value.toPrecision(4)} · ${objective} · ${where}`);

      // How many *downhill* moves were taken is the one number that says whether the
      // schedule worked. Near 100% and the search was a random walk that kept a
      // best-so-far; near 0% and it never left the first hill it climbed. Moves that
      // improve or change nothing are excluded: the temperature does not govern them,
      // and on a flat objective they would drown the signal.
      const rate = stats.downhill
        ? Math.round((stats.descended / stats.downhill) * 100)
        : 0;
      console.error(
        `${stats.runs} runs · ${rate}% of ${stats.downhill} downhill moves taken · ${seconds(
          elapsed
        )}${stats.invalid ? ` · ${stats.invalid} invalid, discarded` : ""}`
      );

      if (!flags.out) {
        process.stdout.write(`${JSON.stringify(runFile, null, 2)}\n`);
        return stats.invalid ? 1 : 0;
      }
      await writeRunFile(resolve(ctx.cwd, flags.out), runFile);
      console.error(`run ${runFile.id} · ${flags.out}`);
      return stats.invalid ? 1 : 0;
    },
  };
}

export const maximize = optimise("maximize", 1);
export const minimize = optimise("minimize", -1);
