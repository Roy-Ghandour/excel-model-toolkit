/**
 * The model this suite is about, and the facts every part of it must agree on.
 *
 * `test/` is deliberately self-contained. It keeps its own copy of the model file
 * and its own coordinates, and imports nothing from `src/` except the drivers it
 * exists to test. The rest of the project is days old and will change shape
 * repeatedly; when it does, this suite should keep working, or fail for a real
 * reason — never because a constant moved or a temporary module was deleted.
 *
 * Deleting `test/` removes the harness entirely and leaves `src/` untouched.
 */

/** The name Forio knows the model by, and what `driver.modelFile` should report. */
export const MODEL_FILE = 'test.xlsx';

/**
 * Our own copy, beside this file rather than at the repo root.
 *
 * It is the same workbook the golden trace was recorded against. The root
 * `test.xlsx` is what the temporary `simulate` tool reads; keeping the two in step
 * is manual, and only matters when the model itself is edited — at which point the
 * trace has to be re-recorded anyway.
 */
export const MODEL_PATH = new URL('./model/test.xlsx', import.meta.url);

/**
 * How many steps the model's timeline supports.
 * `Time` is B6:N6 → columns 0..12, so 12 steps can be taken from step 0.
 */
export const MAX_STEP = 12;

/**
 * The Forio project the golden trace is recorded from. Read only by
 * `record-golden.js` — nothing in `npm test` touches the network.
 * No secrets: the project is PUBLIC, so driving runs is anonymous.
 */
export const FORIO = {
    account: 'ghandourroy',
    project: 'model-toolkit-project',
};

/** The named ranges captured at every step while recording, and replayed against. */
export const REPORTED = ['Step', 'Balance', 'transactionAmount'];

/** The decision written at every step while recording. */
export const TRANSACTION = 10;

/** Where the recording lives. One trace per model file. */
export const GOLDEN_PATH = new URL('./golden/test.xlsx.trace.json', import.meta.url);
