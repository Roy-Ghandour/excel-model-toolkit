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
  checkStep({ writes }) {
    return Object.entries(writes)
      .filter(([name, value]) => SLIDER.test(name) && !legalSlider(value))
      .map(([name, value]) => ({
        name,
        reason: `${value} is not a whole number from 0 to 3`,
      }));
  },
};
