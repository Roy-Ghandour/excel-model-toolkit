/**
 * The rules of the AI-Governance simulation, and how to play it at random.
 *
 * The only place in modelkit that knows what an AI-Gov named range means. Rules are
 * the simulation's own, as its interface enforces them — a run that breaks one is a
 * run no player could have made. `sample` is the same knowledge from the other end:
 * it draws only from what a player could have chosen, so what it produces is valid
 * without anything being redrawn.
 *
 * **A step is a model column.** Step 0 is the model's baseline column: it has no
 * budget (`EcBudget[0]` is 0), its policy rows are hard-coded, and the live sim never
 * writes it — decisions there would be free. So step 0 is the *setup* turn, carrying
 * only the value ranking, and years 1..NumYears are steps 1..NumYears, which is where
 * the sim puts them (it writes at `Step + 1`).
 *
 * Facts are read from the model wherever the model holds them — the unlock schedule
 * from `<id>Show`, the non-cancellable set from `<id>CanCancel`, each dilemma's year
 * from `Op<n>Year`, the budget from `<m>BudgetRemaining`. Nothing the model computes
 * is re-implemented here.
 */

const MINISTRIES = ["Ec", "Env", "Def", "Edu"];

/** Highest `Pro` with a card in the sim. The model carries blocks to 24 with none. */
const LAST_POLICY = { Ec: 13, Env: 15, Def: 15, Edu: 14 };

const SLIDER = /^(Ec|Env|Def|Edu)Slider[12]$/;
const POLICY = /^(Ec|Env|Def|Edu)Pro(\d+)$/;
const DILEMMA = /^Op(\d+)Selected$/;
const RANKING = /^Value([1-6])Position$/;

/** The six values a player ranks, before the first year. */
const RANKINGS = [1, 2, 3, 4, 5, 6].map((n) => `Value${n}Position`);

/** The six dilemmas, one per year through `Op6Year` at column 6. */
const DILEMMAS = [1, 2, 3, 4, 5, 6];

/** A slider has four positions. */
const legalSlider = (value) => Number.isInteger(value) && value >= 0 && value <= 3;

/** `<id>Show`: 2 locked, 0 available, 1 active, 3 abandoned. */
const onScreen = (show) => show === 0 || show === 1;

/**
 * The setup turn: the value ranking, all of it, and nothing else.
 *
 * The ranking measurably moves the model (`TrustInGovernment` differs by 3 points
 * between 1..6 and 6..1), so a run states the one it ran under rather than inheriting
 * the workbook's.
 */
function checkSetup(writes) {
  const violations = [];

  for (const name of Object.keys(writes)) {
    if (!RANKING.test(name)) {
      violations.push({
        name,
        reason: "step 0 is the setup turn and takes only the value ranking",
      });
    }
  }

  const missing = RANKINGS.filter((name) => !(name in writes));
  for (const name of missing) {
    violations.push({ name, reason: "the whole value ranking is set at step 0" });
  }

  if (missing.length === 0) {
    const ranks = RANKINGS.map((name) => writes[name]);
    const distinct = new Set(ranks);
    if (distinct.size !== 6 || ranks.some((r) => !Number.isInteger(r) || r < 1 || r > 6)) {
      violations.push({
        name: "Value1Position",
        reason: `the six values rank 1 to 6, once each, received: ${ranks.join(", ")}`,
      });
    }
  }

  return violations;
}

/** One year's decisions: sliders, policies and that year's dilemma. */
function checkYear({ step, writes, before, after }) {
  const violations = [];
  const at = (name) => before[name]?.[step];

  for (const [name, value] of Object.entries(writes)) {
    const slider = SLIDER.exec(name);
    const policy = POLICY.exec(name);
    const dilemma = DILEMMA.exec(name);

    if (!slider && !policy && !dilemma) {
      violations.push({
        name,
        reason: RANKING.test(name)
          ? "the value ranking is set at step 0 and never again"
          : "is not a slider, a policy or a dilemma, so no player could have written it",
      });
      continue;
    }

    // A ministry not in play has no decisions at all, and the budget check skips it,
    // so nothing else would notice.
    const ministry = (slider ?? policy)?.[1];
    if (ministry && before[`${ministry}Enabled`] === 0) {
      violations.push({ name, reason: `${ministry} is not a ministry in this run` });
      continue;
    }

    if (slider && !legalSlider(value)) {
      violations.push({ name, reason: `${value} is not a whole number from 0 to 3` });
    }

    if (policy) {
      const number = Number(policy[2]);
      if (value !== 0 && value !== 1) {
        violations.push({ name, reason: `${value} is not 0 or 1` });
      } else if (number < 3 || number > LAST_POLICY[ministry]) {
        violations.push({
          name,
          reason: `has no card in the simulation (${ministry} offers Pro3 to Pro${LAST_POLICY[ministry]})`,
        });
      } else {
        // Show is derived from the previous column, so it is already settled here.
        // 2 is locked and 3 is abandoned; the cost formula clamps both to free, which
        // is why writing to either is an exploit rather than a harmless no-op.
        const show = at(`${name}Show`);
        if (!onScreen(show)) {
          violations.push({
            name,
            reason:
              show === 2
                ? "has not unlocked yet"
                : "was abandoned, and abandoning is permanent",
          });
        } else if (value === 0 && show === 1 && before[`${name}CanCancel`] === 0) {
          violations.push({ name, reason: "cannot be cancelled once selected" });
        }
      }
    }

    if (dilemma) {
      if (value !== 0 && value !== 1) {
        violations.push({ name, reason: `${value} is not 0 or 1` });
      } else if (at(`Op${dilemma[1]}Year`) !== 1) {
        violations.push({ name, reason: `is not this year's dilemma` });
      }
    }
  }

  // The model's own arithmetic over the column just written: budget, upfront costs
  // and the 20% recurring charge. None of it is repeated here.
  for (const ministry of MINISTRIES) {
    if (before[`${ministry}Enabled`] === 0) continue;
    const remaining = after[`${ministry}BudgetRemaining`]?.[step];
    if (remaining < 0) {
      violations.push({
        name: `${ministry}BudgetRemaining`,
        reason: `is ${remaining}: the year's decisions cost more than the budget`,
      });
    }
  }

  return violations;
}

/** The setup turn: a random ranking of the six values. */
function sampleSetup(rng) {
  const ranks = rng.shuffle([1, 2, 3, 4, 5, 6]);
  return Object.fromEntries(RANKINGS.map((name, index) => [name, ranks[index]]));
}

/**
 * One ministry's year, spent out of a budget the model has already worked out.
 *
 * `<M>AvaialbleToAllocate[step]` is `Budget − RecurringCost`, and in the pre-step
 * state the column still holds its carry formulas — so it reads as *the money left
 * if every active policy is kept*, which is exactly the pot a player starts the year
 * with. The model's own `BudgetRemaining = Budget − (InitialCost + Recurring)` and
 * `InitialCost` is precisely sliders plus new selections, so spending within this pot
 * **is** `BudgetRemaining >= 0` rather than an estimate of it.
 *
 * Every item's cheapest option — slider level 0, a policy left alone — is free, so
 * however little is left there is always a legal choice and the walk cannot get
 * stuck. That is why one pass yields a valid year and nothing has to be redrawn.
 */
function sampleMinistry({ ministry, step, state, rng, writes }) {
  let pot = state[`${ministry}AvaialbleToAllocate`][step];

  const available = [];
  for (let number = 3; number <= LAST_POLICY[ministry]; number++) {
    const name = `${ministry}Pro${number}`;
    const show = state[`${name}Show`][step];

    if (show === 0) available.push(name);
    // Cancelling is a player's move, and it stops next year's recurring charge, so
    // the money it frees is spendable this year.
    else if (show === 1 && state[`${name}CanCancel`] === 1 && rng.chance()) {
      writes[name] = 0;
      pot += state[`${name}CostRecurringValue`];
    }
  }

  const sliders = [`${ministry}Slider1`, `${ministry}Slider2`];

  // Shuffled so no item has a standing claim on the budget ahead of another.
  for (const name of rng.shuffle([...sliders, ...available])) {
    if (sliders.includes(name)) {
      // Sliders do not carry forward, so each year states its own level. Position in
      // `SliderCosts` is the level, as the cost XLOOKUP's key row is 0,1,2,3 in order.
      const levels = state.SliderCosts.flatMap((cost, level) =>
        cost <= pot ? [level] : []
      );
      const level = rng.pick(levels);
      writes[name] = level;
      pot -= state.SliderCosts[level];
    } else {
      const cost = state[`${name}Type`] === 1 ? state[`${name}CostValue`] : 1;
      if (cost <= pot && rng.chance()) {
        writes[name] = 1;
        pot -= cost;
      }
    }
  }
}

/**
 * One year: each ministry's decisions, then that year's dilemma.
 *
 * Only what *changes* is written. An untouched policy carries forward on the model's
 * own formula, and re-writing `1` over an active one costs nothing and says nothing.
 */
function sampleYear(step, state, rng) {
  const writes = {};

  for (const ministry of MINISTRIES) {
    if (state[`${ministry}Enabled`] === 0) continue;
    sampleMinistry({ ministry, step, state, rng, writes });
  }

  // Both answers are answers — 0 latches the dilemma to −1, 1 to 1 — so a player
  // always gives one.
  for (const number of DILEMMAS) {
    if (state[`Op${number}Year`][step] === 1) {
      writes[`Op${number}Selected`] = rng.chance() ? 1 : 0;
    }
  }

  return writes;
}

/** @type {import('../core/simulate.js').Rules} */
export const aigov = {
  // The setup turn plus one turn per year, and the facilitator's slider allows 3 to 6 years.
  minSteps: 4,
  maxSteps: 7,

  settings: ["NumYears", "EcEnabled", "EnvEnabled", "DefEnabled", "EduEnabled"],

  checkStep({ step, length, writes, before, after }) {
    if (step > 0) return checkYear({ step, writes, before, after });

    const violations = checkSetup(writes);

    // `NumYears` is a single cell written with the settings, so the run's length is
    // already settled at the setup turn — no reason to replay it all to find out.
    if (before.NumYears + 1 !== length) {
      violations.push({
        name: "NumYears",
        reason: `${before.NumYears} years means a run of ${
          before.NumYears + 1
        } steps, but this run has ${length}`,
      });
    }

    return violations;
  },

  sample(step, state, rng) {
    return step === 0 ? sampleSetup(rng) : sampleYear(step, state, rng);
  },
};
