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

  /** Every timeline the workbook has. The three single cells are settings or bookkeeping. */
  results: ["Time", "transactionAmount", "Balance"],

  checkStep: () => [],

  /** Ranges picked to be plausible for a savings account and nothing more. */
  randomSettings: (rng) => ({
    initialBalance: rng.int(10001),
    interestRate: rng.int(11) / 100,
  }),

  /** Any amount is a legal transaction, overdraft included, so nothing constrains this. */
  sample: (step, state, rng) => ({ transactionAmount: rng.int(1001) - 500 }),

  /** The one decision a step has, redrawn. */
  mutate: (step, state, writes, rng) => ({ transactionAmount: rng.int(1001) - 500 }),

  /** Nothing here can become illegal, so the nearest legal writes are the given ones. */
  repair: (step, state, writes) => writes,
};
