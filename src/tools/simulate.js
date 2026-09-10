import { createLocalDriver } from '../drivers/local/localDriver.js';
import { MAX_STEP, MODEL_PATH } from '../config.js';

/**
 * Drive one run of the test model: at every step write `transactionAmount = 10`
 * and report the `Balance` named range.
 *
 * This is the sweep tool in miniature — replace the fixed transaction with an
 * injected decision policy and wrap it in `for i in 1..N` and you have the real
 * thing. It talks only to the driver, never to Forio.
 */

/** The ranges we read back after each step. */
const REPORTED = ['Step', 'Balance', 'transactionAmount'];

/** The decision we make every step. Fixed for now; the sweep will randomise it. */
const TRANSACTION = 10;

const money = (n) => n.toFixed(2).padStart(10);

export async function simulate({ steps = MAX_STEP, transaction = TRANSACTION } = {}) {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });

    const run = driver.createRun();
    console.log(`run ${run.id}\n`);

    const initial = run.read(REPORTED);
    console.log('  step   transaction      balance');
    console.log('  ----   -----------   ----------');
    console.log(`  ${String(initial.Step).padStart(4)}             -   ${money(initial.Balance[initial.Step])}`);

    let state = initial;
    for (let current = 0; current < steps; current++) {
        // The transaction for year `current` goes into that year's column, and
        // shows up in the *next* year's balance:
        //   Balance[t] = (Balance[t-1] + transactionAmount[t-1]) * (1 + rate)
        run.write(current, { transactionAmount: transaction });
        run.step();

        state = run.read(REPORTED);
        const at = state.Step;
        console.log(`  ${String(at).padStart(4)}   ${String(transaction).padStart(11)}   ${money(state.Balance[at])}`);
    }

    console.log(`\nfinal Balance: [${state.Balance.map((b) => b.toFixed(2)).join(', ')}]`);
    console.log(`transactionAmount: [${state.transactionAmount.join(', ')}]`);

    return state;
}
