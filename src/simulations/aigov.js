/**
 * The rules of the AI-Governance simulation.
 *
 * The only place in modelkit that knows what an AI-Gov named range means. Rules are
 * the simulation's own, as its interface enforces them — a run that breaks one is a
 * run no player could have made.
 */

/** The two budget sliders each ministry has: `EcSlider1`, `EnvSlider2`, and so on. */
const SLIDER = /^(Ec|Env|Def|Edu)Slider[12]$/;

/** A slider has four positions. */
const legalSlider = (value) => Number.isInteger(value) && value >= 0 && value <= 3;

/** @type {import('../core/simulate.js').Rules} */
export const aigov = {
  // A run is `NumYears + 1` steps, and the facilitator's slider allows 3 to 6 years.
  minSteps: 4,
  maxSteps: 7,

  settings: ["NumYears", "EcEnabled", "EnvEnabled", "DefEnabled", "EduEnabled"],

  checkStep({ step, length, writes, before }) {
    const violations = Object.entries(writes)
      .filter(([name, value]) => SLIDER.test(name) && !legalSlider(value))
      .map(([name, value]) => ({
        name,
        reason: `${value} is not a whole number from 0 to 3`,
      }));

    // `NumYears` is a single cell written with the settings, so its value is already
    // known at the first step — no reason to replay the whole run to find this out.
    if (step === 0 && before.NumYears + 1 !== length) {
      violations.push({
        name: "NumYears",
        reason: `${before.NumYears} means a run of ${
          before.NumYears + 1
        } steps, but this run has ${length}`,
      });
    }

    return violations;
  },
};
