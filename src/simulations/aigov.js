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

/**
 * The events a facilitator switches on, each fixed to the year it fires in.
 *
 * Crisis `n` and breaking news `n` belong to year `n`, and the sim's settings screen
 * offers crises 1-6 and news 2-6 — year 1 has no breaking news. They are 9-wide
 * timelines whose first column is a literal and whose rest is a `=prev` chain, so
 * writing one at step 0 sets it for the whole run: settings in everything but shape.
 */
const EVENTS = [
  ...[1, 2, 3, 4, 5, 6].map((year) => ({ name: `_C${year}Enabled`, year })),
  ...[2, 3, 4, 5, 6].map((year) => ({ name: `News${year}Enabled`, year })),
];

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
const legalSlider = (value) =>
  Number.isInteger(value) && value >= 0 && value <= 3;

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
    violations.push({
      name,
      reason: "the whole value ranking is set at step 0",
    });
  }

  if (missing.length === 0) {
    const ranks = RANKINGS.map((name) => writes[name]);
    const distinct = new Set(ranks);
    if (
      distinct.size !== 6 ||
      ranks.some((r) => !Number.isInteger(r) || r < 1 || r > 6)
    ) {
      violations.push({
        name: "Value1Position",
        reason: `the six values rank 1 to 6, once each, received: ${ranks.join(
          ", "
        )}`,
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
      violations.push({
        name,
        reason: `${ministry} is not a ministry in this run`,
      });
      continue;
    }

    if (slider && !legalSlider(value)) {
      violations.push({
        name,
        reason: `${value} is not a whole number from 0 to 3`,
      });
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
        } else if (
          value === 0 &&
          show === 1 &&
          before[`${name}CanCancel`] === 0
        ) {
          violations.push({
            name,
            reason: "cannot be cancelled once selected",
          });
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
  return Object.fromEntries(
    RANKINGS.map((name, index) => [name, ranks[index]])
  );
}

/** What a policy costs to select this year. `Type` gates the price; see aigov.md. */
const policyCost = (state, name) =>
  state[`${name}Type`] === 1 ? state[`${name}CostValue`] : 1;

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
 *
 * **One allocator serves three callers**, because all three need this same pot and
 * would otherwise keep three copies of it that drift apart:
 *
 * - `preferred` **null** — decide freely. This is `sample`, and its draws from `rng`
 *   are exactly the ones it made before the other two callers existed.
 * - `preferred` **an object** — the incumbent's writes for this step, being replayed
 *   into a state that has moved. Honour each one, falling back only where the state
 *   no longer allows it. **An absent name is an opinion, not a gap**: only what
 *   *changes* is ever written, so a policy missing from the map is one the incumbent
 *   deliberately left to carry forward. Nothing here is re-randomised — that is what
 *   keeps a mutation local.
 * - `pinned` — the one item a mutation fixed. Paid before anything competes for the
 *   pot, so its affordability is decided against the whole budget. A pinned value of
 *   `null` means *fixed to unwritten*, which is how "stop selecting this" and "stop
 *   cancelling this" are expressed, neither of them being a write.
 */
function allocate({ ministry, step, state, rng, writes, preferred, pinned }) {
  let pot = state[`${ministry}AvaialbleToAllocate`][step];
  const fixed = (name) => pinned !== null && name in pinned;

  // The mutation's own choice, before anything else can spend the pot out from
  // under it.
  if (pinned !== null) {
    for (const [name, value] of Object.entries(pinned)) {
      if (value === null || !name.startsWith(ministry)) continue;
      writes[name] = value;
      if (SLIDER.test(name)) pot -= state.SliderCosts[value];
      else if (value === 1) pot -= policyCost(state, name);
      else pot += state[`${name}CostRecurringValue`];
    }
  }

  // Cancelling is a player's move, and it stops next year's recurring charge, so the
  // money it frees is spendable this year — which is why it settles before the walk.
  const available = [];
  for (let number = 3; number <= LAST_POLICY[ministry]; number++) {
    const name = `${ministry}Pro${number}`;
    if (fixed(name)) continue;
    const show = state[`${name}Show`][step];

    if (show === 0) available.push(name);
    else if (show === 1 && state[`${name}CanCancel`] === 1) {
      // A cancel the incumbent made is still a cancel if the policy is still active
      // and still cancellable; otherwise it is simply dropped.
      const cancel = preferred === null ? rng.chance() : preferred[name] === 0;
      if (cancel) {
        writes[name] = 0;
        pot += state[`${name}CostRecurringValue`];
      }
    }
  }

  const sliders = [`${ministry}Slider1`, `${ministry}Slider2`].filter(
    (name) => !fixed(name)
  );

  // Shuffled so no item has a standing claim on the budget ahead of another. That
  // matters for a repair too: when the pot has shrunk, something must lose, and
  // nothing should lose merely for sorting late.
  for (const name of rng.shuffle([...sliders, ...available])) {
    if (sliders.includes(name)) {
      // Sliders do not carry forward, so each year states its own level. Position in
      // `SliderCosts` is the level, as the cost XLOOKUP's key row is 0,1,2,3 in order.
      const levels = state.SliderCosts.flatMap((cost, level) =>
        cost <= pot ? [level] : []
      );
      // A level that no longer fits falls to the dearest one below it that does,
      // rather than to a fresh draw. Level 0 is free, so this always lands.
      const level =
        preferred === null
          ? rng.pick(levels)
          : Math.min(preferred[name] ?? 0, levels.at(-1));
      writes[name] = level;
      pot -= state.SliderCosts[level];
    } else {
      const cost = policyCost(state, name);
      const take =
        preferred === null
          ? cost <= pot && rng.chance()
          : preferred[name] === 1 && cost <= pot;
      if (take) {
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
 *
 * `preferred` and `pinned` mean what they mean in `allocate`. All of `sample`,
 * `repair` and `mutate` come through here.
 */
function decideYear(step, state, rng, preferred = null, pinned = null) {
  const writes = {};

  for (const ministry of MINISTRIES) {
    if (state[`${ministry}Enabled`] === 0) continue;
    allocate({ ministry, step, state, rng, writes, preferred, pinned });
  }

  // Both answers are answers — 0 latches the dilemma to −1, 1 to 1 — so a player
  // always gives one. The year a dilemma fires is fixed by the model, so an
  // incumbent's answer is always still an answer to the same question.
  for (const number of DILEMMAS) {
    if (state[`Op${number}Year`][step] !== 1) continue;
    const name = `Op${number}Selected`;

    if (pinned !== null && name in pinned) writes[name] = pinned[name];
    else if (preferred !== null) writes[name] = preferred[name];
    else writes[name] = rng.chance() ? 1 : 0;
  }

  return writes;
}

/**
 * Every decision one year could have gone differently, as `{ name, value }` pairs.
 *
 * A *move* is one item at one value it does not currently hold, so a slider offers up
 * to three and a policy exactly one — picking uniformly over these is picking
 * uniformly over the run's neighbours, rather than over the items, which would make a
 * four-position slider as likely to change as a binary policy.
 *
 * `value: null` is the move to *unwrite* an item, which is how "stop selecting this"
 * and "stop cancelling this" are expressed: neither is a write, because only what
 * changes is ever written.
 *
 * Affordability is judged against the ministry's whole pot, which is exact: a pinned
 * item is paid before anything else can claim it.
 */
function moves(step, state, writes) {
  const found = [];

  for (const ministry of MINISTRIES) {
    if (state[`${ministry}Enabled`] === 0) continue;
    const pot = state[`${ministry}AvaialbleToAllocate`][step];

    for (const name of [`${ministry}Slider1`, `${ministry}Slider2`]) {
      const level = writes[name] ?? 0;
      state.SliderCosts.forEach((cost, other) => {
        if (other !== level && cost <= pot) found.push({ name, value: other });
      });
    }

    for (let number = 3; number <= LAST_POLICY[ministry]; number++) {
      const name = `${ministry}Pro${number}`;
      const show = state[`${name}Show`][step];
      const written = name in writes;

      // Available: select it, or stop selecting it.
      if (show === 0 && (written || policyCost(state, name) <= pot)) {
        found.push({ name, value: written ? null : 1 });
      }
      // Active and cancellable: cancel it, or stop cancelling it.
      else if (show === 1 && state[`${name}CanCancel`] === 1) {
        found.push({ name, value: written ? null : 0 });
      }
    }
  }

  for (const number of DILEMMAS) {
    if (state[`Op${number}Year`][step] !== 1) continue;
    const name = `Op${number}Selected`;
    found.push({ name, value: writes[name] === 1 ? 0 : 1 });
  }

  return found;
}

/** The setup turn's one move: two values trade places in the ranking. */
function mutateSetup(writes, rng) {
  const [first, second] = rng.shuffle(RANKINGS).slice(0, 2);
  return { ...writes, [first]: writes[second], [second]: writes[first] };
}

/** @type {import('../core/simulate.js').Rules} */
export const aigov = {
  // The setup turn plus one turn per year, and the facilitator's slider allows 3 to 6 years.
  minSteps: 4,
  maxSteps: 7,

  settings: [
    "NumYears",
    "EcEnabled",
    "EnvEnabled",
    "DefEnabled",
    "EduEnabled",
    ...EVENTS.map((event) => event.name),
  ],

  // Every named range on the model's Results sheet, which is the sim's own answer to
  // which numbers are the outcome. All are 9-wide timelines but `Step`. The two data
  // centre ranges are left out: retired KPIs, still on the sheet, still reading "X".
  results: [
    "AIContributionToGDP",
    "AIFDIStock",
    "AILiteracy",
    "Accountability",
    "AutonomousSystemsSafteyIndex",
    "AverageMinistryScore",
    "CircularityIndex",
    "CybersecurityIndex",
    "DefenseExports",
    "DefenseImports",
    "DefenseScore",
    "EconomyScore",
    "EcosystemIntegrityIndex",
    "EducationScore",
    "EnvironmentScore",
    "EwasteCircularityIndex",
    "GrowthWB",
    "GrowthWellBeing",
    "HumanRights",
    "InnovationIndex",
    "InstitutionalAdoptionRate",
    "JobsCreated",
    "JobsDisplaced",
    "MilitaryTechnologyTradeBalance",
    "NetJobsFromAI",
    "PrivacyDP",
    "PrivacyDataProtection",
    "RenewableEnergyFactor",
    "SecuritySafety",
    "Step",
    "Time",
    "Transparency",
    "TrustInGovernment",
    "WaterCircularityIndex",
    "Year",
  ],

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

    // Settled at step 0 for the same reason. Saving the settings screen switches off
    // every event past the end of the run, so one left on is a run no facilitator
    // could have set up.
    for (const { name, year } of EVENTS) {
      if (before[name][0] === 1 && year > before.NumYears) {
        violations.push({
          name,
          reason: `fires in year ${year}, past the end of a ${before.NumYears}-year run`,
        });
      }
    }

    return violations;
  },

  sample(step, state, rng) {
    return step === 0 ? sampleSetup(rng) : decideYear(step, state, rng);
  },

  /**
   * One decision changed, and the rest of the year kept wherever it still fits.
   *
   * The changed item is pinned and paid first, then the year is re-allocated around
   * it — so a costlier choice pushes something else out rather than breaking the
   * budget, and a cheaper one leaves the freed money unspent rather than redrawing.
   *
   * Null when the year holds no decision at all, which a run with every ministry
   * disabled and no dilemma that year really does.
   */
  mutate(step, state, writes, rng) {
    if (step === 0) return mutateSetup(writes, rng);

    const available = moves(step, state, writes);
    if (available.length === 0) return null;

    const { name, value } = rng.pick(available);
    return decideYear(step, state, rng, writes, { [name]: value });
  },

  /**
   * Last year's decisions, replayed into a year that has moved underneath them.
   *
   * Never called at step 0: the ranking is a permutation, legal in every state, and a
   * mutation point is never before the first step.
   */
  repair(step, state, writes, rng) {
    return decideYear(step, state, rng, writes);
  },

  /**
   * The facilitator's own choices, drawn at random: how many years, which ministries
   * are in play, and which crises and breaking news fire. All four ministries may come
   * up disabled — the sim allows a run where only the ranking and the dilemmas move.
   *
   * Years are drawn first because an event past the end of the run is not a setting a
   * facilitator can save, so the length has to be known before the events are.
   */
  randomSettings: (rng) => {
    const NumYears = 3 + rng.int(4);
    return {
      NumYears,
      EcEnabled: rng.chance() ? 1 : 0,
      EnvEnabled: rng.chance() ? 1 : 0,
      DefEnabled: rng.chance() ? 1 : 0,
      EduEnabled: rng.chance() ? 1 : 0,
      ...Object.fromEntries(
        EVENTS.map(({ name, year }) => [
          name,
          year <= NumYears && rng.chance() ? 1 : 0,
        ])
      ),
    };
  },
};
