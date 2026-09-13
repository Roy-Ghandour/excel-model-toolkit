import { generate } from "./generate.js";
import { endOfRun } from "./results.js";
import { createRng } from "./rng.js";
import { describe } from "./violations.js";

/**
 * Search a simulation's runs for the one that drives a named range furthest.
 *
 * Hill-climbing with simulated annealing, restarted from scratch several times. The
 * climbing is what random sampling cannot do — a sample has no memory of what worked —
 * and the annealing is what stops the climb settling for the first hill it finds.
 * Restarts are the outer guard: a single annealed climb can still end in a local
 * optimum, and nothing inside the climb can tell that it has.
 *
 * **A candidate costs one full model run**, the same as a sample row. That is the whole
 * cost model: 200 iterations across 3 restarts is 623 runs, a few minutes for AI-Gov.
 *
 * Everything simulation-specific is injected. This file knows that a run has steps and
 * that a number can be compared; it knows nothing about ministries, budgets or what a
 * legal decision is.
 */

/**
 * Probing stops at this many *moving* mutations, or at this many attempts.
 *
 * Not a fixed count, because how often a mutation moves the objective varies hugely
 * by objective: `TrustInGovernment` responds to roughly two decisions in three,
 * `JobsDisplaced` to about one in forty — it is an Economy KPI, and most of what a
 * run decides is in other ministries. A fixed budget is either wasteful for the
 * first or blind for the second, so probing spends attempts in proportion to how
 * hard the signal is to find.
 */
const MOVES = 10;
const PROBE_LIMIT = 200;

/** Below this hit rate, the search will spend most of its iterations on a plateau. */
const SPARSE = 0.1;

/** How often a downhill move should be accepted at the starting temperature. */
const INITIAL_ACCEPTANCE = 0.8;

/** How far the schedule cools: the last iteration runs a hundredth as hot as the first. */
const COOLING = 100;

/**
 * The candidate `decide`: the incumbent's run, with step `k` changed.
 *
 * Before `k` the incumbent's writes are replayed verbatim, and they are legal for
 * free — the model is deterministic, so those steps meet exactly the state they met
 * the first time. At `k` the mutation happens. After it the state has moved, so the
 * incumbent's remaining writes are put through `repair`, which keeps what still fits
 * and mends only what does not.
 *
 * That is what makes this neighbourhood *local*: one decision differs by intent, and
 * the rest of the run differs only where the model forced it to.
 *
 * `mutate` may decline a step that holds no decision, in which case the caller is told
 * so by `mutated` staying false.
 */
function perturb(rules, steps, k, rng) {
  const state = { mutated: false };

  state.decide = (step, live) => {
    if (step < k) return steps[step];
    if (step > k) return rules.repair(step, live, steps[step], rng);

    const writes = rules.mutate(step, live, steps[step], rng);
    if (writes === null) return steps[step];
    state.mutated = true;
    return writes;
  };

  return state;
}

/**
 * Search for the run that scores highest, and hand back the best one found.
 *
 * `score` is always maximised: a minimising caller passes a `direction` of −1 and the
 * comparison, the acceptance rule and the cooling all stay as they are.
 *
 * @param {object} driver A local driver.
 * @param {object} options
 * @param {string} options.simulation The model's `ModelKitID`.
 * @param {Record<string, number>} options.settings
 * @param {number} options.length How many steps each run has.
 * @param {import('./simulate.js').Rules} options.rules
 * @param {string} options.objective The named range to drive.
 * @param {1 | -1} options.direction +1 to maximise it, −1 to minimise.
 * @param {number} options.iterations Candidates per restart.
 * @param {number} options.restarts Independent climbs.
 * @param {string} options.seed
 * @param {(line: string) => void} options.report Progress, one line at a time.
 * @returns {Promise<{ runFile: object, value: number, stats: object }>}
 */
export async function anneal(
  driver,
  {
    simulation,
    settings,
    length,
    rules,
    objective,
    direction,
    iterations,
    restarts,
    seed,
    report,
  }
) {
  if (!rules.mutate || !rules.repair) {
    throw new Error(
      `modelkit cannot optimise runs of '${simulation}': it has no ${
        rules.mutate ? "repair" : "mutate"
      }`
    );
  }

  let runs = 0;
  let invalid = 0;
  let reported = false;

  /**
   * Drive one run and score it.
   *
   * An invalid candidate is a bug in `mutate` or `repair` rather than an unlucky
   * draw — both draw only from the legal set. It is still discarded rather than
   * thrown on: the incumbent is untouched, so the search can finish and report both
   * the answer and the bug, where throwing would lose a long search to tell you
   * something a counter tells you just as well. Nothing invalid is ever emitted.
   */
  async function evaluate(runSeed, decide) {
    runs++;
    const { runFile, trace, violations } = await generate(driver, {
      simulation,
      settings,
      length,
      rules,
      rng: createRng(runSeed),
      decide,
      // No `origin`: hundreds of these are discarded, and the one that survives is
      // stamped by the tool that ran the search, which is the tool that wrote the file.
    });

    if (violations.length > 0) {
      invalid++;
      // Once, with the detail. After that the count carries it.
      if (!reported) {
        reported = true;
        report(describe(violations));
      }
      return null;
    }

    const value = endOfRun(trace.final, [objective], length)[objective];
    return Number.isFinite(value)
      ? { runFile, value, score: direction * value }
      : null;
  }

  /** A fresh random run, the start of one climb. */
  const start = (index) => evaluate(`${seed}/start/${index}`, undefined);

  /** One mutation of a run, or null where the mutation was impossible or invalid. */
  async function neighbour(incumbent, runSeed) {
    const rng = createRng(runSeed);
    const k = rng.int(length);
    const step = perturb(rules, incumbent.runFile.steps, k, rng);
    const candidate = await evaluate(runSeed, step.decide);
    return step.mutated ? candidate : null;
  }

  const first = await start(0);
  if (first === null) {
    throw new Error(
      `the first run of the search is invalid or has no numeric '${objective}', so every run would be`
    );
  }

  // How far one decision moves the objective. This is deliberately the spread over
  // *mutations* and not over unrelated runs: two random runs differ by far more than
  // one changed decision, and a temperature set from that would accept nearly every
  // downhill move for most of the search — annealing in name, a random walk in fact.
  //
  // **Only mutations that actually move it count.** A mutation that leaves the
  // objective alone is not a downhill move — it is accepted unconditionally — so
  // averaging it in would drag the temperature below the moves it is meant to price,
  // by however sparse the objective happens to be.
  const deltas = [];
  let probes = 0;
  while (deltas.length < MOVES && probes < PROBE_LIMIT) {
    probes++;
    const probe = await neighbour(first, `${seed}/probe/${probes}`);
    const delta = probe === null ? 0 : Math.abs(probe.score - first.score);
    if (delta > 0) deltas.push(delta);
  }

  if (deltas.length === 0) {
    throw new Error(
      `${probes} mutations of a random run all left '${objective}' unchanged, so this search has no signal to follow`
    );
  }

  // The temperature at which a typical downhill move is accepted with probability
  // INITIAL_ACCEPTANCE, from exp(-spread / T) = p.
  const spread = deltas.reduce((total, delta) => total + delta, 0) / deltas.length;
  const hot = spread / Math.log(1 / INITIAL_ACCEPTANCE);
  const cold = hot / COOLING;
  const rate = deltas.length / probes;
  report(
    `probing · ${probes} mutations · ${deltas.length} moved · T0 ${hot.toPrecision(3)}`
  );

  // Worth saying out loud rather than leaving to be inferred from a flat search: the
  // climb is not broken, it is crossing a plateau, and most of its runs will be spent
  // there. A scenario with fewer ministries in play concentrates the decisions.
  if (rate < SPARSE) {
    report(
      `only ${(rate * 100).toFixed(1)}% of mutations move '${objective}', so most iterations will change nothing`
    );
  }

  let best = first;
  let bestAt = null;
  let downhill = 0;
  let descended = 0;

  // One source for every accept-a-worse-candidate coin, so the search reproduces from
  // its seed. Kept apart from the per-candidate rngs, whose sequences belong to the
  // decisions they draw rather than to the walk.
  const coin = createRng(`${seed}/accept`);

  for (let restart = 0; restart < restarts; restart++) {
    const label = `restart ${restart + 1}/${restarts}`;
    let current = restart === 0 ? first : await start(restart);
    if (current === null) continue;

    report(`${label} · start ${current.value.toPrecision(4)}`);
    let restartBest = current;

    for (let index = 0; index < iterations; index++) {
      // Geometric, from `hot` down to `cold`. A single-iteration search never cools.
      const temperature =
        iterations === 1
          ? hot
          : hot * (cold / hot) ** (index / (iterations - 1));

      const candidate = await neighbour(current, `${seed}/${restart}/${index}`);
      if (candidate === null) continue;

      // Uphill always; downhill on a coin weighted by how far down and how hot it is.
      const delta = candidate.score - current.score;
      if (delta >= 0) {
        current = candidate;
      } else {
        // Only these are counted. The temperature governs downhill moves and nothing
        // else, so a rate taken over every candidate would measure the objective's
        // flatness instead of the schedule — and on a sparse objective, where most
        // mutations change nothing and are accepted for free, it would read as 98%
        // however cold the search actually ran.
        downhill++;
        if (coin.float() < Math.exp(delta / temperature)) {
          current = candidate;
          descended++;
        }
      }

      if (candidate.score > restartBest.score) restartBest = candidate;
      if (candidate.score > best.score) {
        best = candidate;
        bestAt = { restart: restart + 1, iteration: index + 1 };
        report(`${label} · iteration ${index + 1} · ${candidate.value.toPrecision(4)}`);
      }
    }

    report(`${label} · best ${restartBest.value.toPrecision(4)}`);
  }

  return {
    runFile: best.runFile,
    value: best.value,
    stats: { runs, invalid, downhill, descended, bestAt, temperature: hot },
  };
}
