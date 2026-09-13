/**
 * The rules of the savings model: none beyond its own shape.
 *
 * It is a six-range test workbook with no simulation behind it, so every decision in
 * a run of it is legal. The entry exists because every tool validates, and a
 * simulation with no rules is different from one modelkit has never heard of.
 */

/** @type {import('../core/simulate.js').Rules} */
export const savings = {
  minSteps: 0,
  maxSteps: 12,

  settings: ["initialBalance", "interestRate"],

  checkStep: () => [],
};
