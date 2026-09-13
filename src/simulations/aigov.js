/**
 * The rules of the AI-Governance simulation.
 *
 * The only place in modelkit that knows what an AI-Gov named range means. Rules are
 * the simulation's own, as its interface enforces them — a run that breaks one is a
 * run no player could have made.
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
};
