/**
 * Shared vocabulary for the conformance harness.
 *
 * The recorder and the test that replays its output have to agree on exactly what
 * was recorded, so both read those facts from here rather than restating them.
 *
 * This whole `test/` directory is self-contained: deleting it, plus the two script
 * entries in `package.json`, removes the harness entirely without touching `src/`.
 */

/**
 * The named ranges captured at every step. Deliberately the same list
 * `simulate()` reports, so the golden trace is evidence about the run we actually
 * perform rather than a parallel one.
 */
export const REPORTED = ['Step', 'Balance', 'transactionAmount'];

/** The decision written at every step while recording. Matches `simulate`'s default. */
export const TRANSACTION = 10;

/** Where the recording lives. One trace per model file. */
export const GOLDEN_PATH = new URL('./golden/test.xlsx.trace.json', import.meta.url);
