import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalDriver } from '../src/drivers/local/localDriver.js';
import { MODEL_PATH } from './model.js';
import { fixture, name } from './fixtures.js';

/**
 * Does the driver keep its own promises?
 *
 * The other two suites check the driver against something outside it — Excel's
 * cached values, and a recorded Epicenter run. This one checks the promises the
 * driver makes on its own account: that a step lands in the right column, that two
 * runs cannot see each other, that a bad decision is refused rather than written.
 *
 * Nothing here reads the golden trace. These properties have to hold for any model
 * on any day, not only for the twelve steps we happened to record.
 */

/** What we read back when checking a run of `test.xlsx`. */
const WATCHED = ['Step', 'Balance', 'transactionAmount'];

/** A driver on the savings model. */
const savings = () => createLocalDriver({ modelPath: MODEL_PATH });

/**
 * Two sheets, a cross-sheet formula, and a 2-D range — none of which `test.xlsx`
 * has, and all of which `AIGovModel.xlsx` does.
 */
function twoSheets() {
    return fixture('two-sheets', (workbook) => {
        const inputs = workbook.addWorksheet('Inputs');
        const model = workbook.addWorksheet('Model Sheet');

        inputs.getCell('B2').value = 2;
        name(workbook, 'Rate', 'Inputs', ['$B$2']);

        model.getCell('B1').value = 0;
        name(workbook, 'Step', 'Model Sheet', ['$B$1']);

        // Row 3 is the timeline of decisions; row 4 reads it and reaches the other
        // sheet through a named range — the only reason the driver registers named
        // expressions with the engine at all.
        for (const [i, column] of ['B', 'C', 'D'].entries()) {
            model.getCell(`${column}3`).value = i + 1;
            model.getCell(`${column}4`).value = { formula: `${column}3*Rate`, result: (i + 1) * 2 };
        }
        name(workbook, 'Dial', 'Model Sheet', ['$B$3', '$C$3', '$D$3']);
        name(workbook, 'Output', 'Model Sheet', ['$B$4', '$C$4', '$D$4']);

        model.getCell('F1').value = 1;
        model.getCell('G1').value = 2;
        model.getCell('F2').value = 3;
        model.getCell('G2').value = 4;
        name(workbook, 'Grid', 'Model Sheet', ['$F$1', '$G$1', '$F$2', '$G$2']);
    });
}

test('it reports the model it is bound to and the shape of every range', async () => {
    // `schema` is public: the sweep will read it to decide what it may write to.
    const driver = await savings();

    assert.equal(driver.modelFile, 'test.xlsx');
    assert.deepEqual(
        [...driver.schema.keys()].sort(),
        ['Balance', 'Step', 'Time', 'initialBalance', 'interestRate', 'transactionAmount']
    );
    assert.deepEqual(driver.schema.get('Balance'), {
        sheet: 'Savings account simulation',
        row: 7,
        col: 1,
        rows: 1,
        cols: 13,
        range: "'Savings account simulation'!$B$8:$N$8",
    });
});

test('a fresh run starts at the values the workbook was authored with', async () => {
    // A timeline comes back as an array and a single cell as a scalar. Everything
    // downstream indexes one and not the other, so the distinction is load-bearing.
    const driver = await savings();
    const run = driver.createRun();

    const state = run.read([...WATCHED, 'initialBalance', 'interestRate']);

    assert.equal(state.Step, 0);
    assert.equal(state.initialBalance, 500);
    assert.equal(state.interestRate, 0.05);
    assert.equal(state.Balance.length, 13);
    assert.equal(state.Balance[0], 500, 'Balance[0] is the initial balance');
    assert.deepEqual(state.transactionAmount, Array(13).fill(0));
});

test('a write lands in the column for that step, and single cells ignore the step', async () => {
    // The whole point of the driver. Getting this wrong does not throw — it produces
    // a sweep of plausible, wrong numbers, which is the failure worth paying for a
    // test to prevent.
    const driver = await savings();
    const run = driver.createRun();

    run.write(3, { transactionAmount: 100 });
    assert.deepEqual(
        run.read(['transactionAmount']).transactionAmount,
        [0, 0, 0, 100, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        'the decision goes to column 3 and nowhere else'
    );

    // `initialBalance` is a single cell: there is no column to choose, so the step
    // must be ignored rather than used as an offset.
    run.write(5, { initialBalance: 1000 });
    assert.equal(run.read(['initialBalance']).initialBalance, 1000);
    assert.equal(run.read(['Balance']).Balance[0], 1000, 'the model recalculated');
});

test('runs are independent of one another', async () => {
    // Forio hands out a separate server-side run per `createRun`; ours must not leak
    // state between engines, or a sweep's runs would contaminate each other.
    const driver = await savings();
    const [a, b] = [driver.createRun(), driver.createRun()];
    const before = b.read(WATCHED);

    a.write(0, { transactionAmount: 999 });
    a.step();

    assert.notEqual(a.id, b.id, 'each run identifies itself');
    assert.deepEqual(b.read(WATCHED), before, 'the second run is untouched');
    assert.deepEqual(
        driver.createRun().read(WATCHED),
        before,
        'and a run created afterwards still starts clean'
    );
});

test('batching writes is equivalent to recalculating after each one', async () => {
    // Epicenter recalculates on every write; `write()` batches and recalculates once.
    // That is only safe because recalculation is idempotent here — a pure function of
    // the input cells, with no circular references and no volatile functions to make a
    // second pass differ from the first.
    //
    // If a model later enables iterative calculation or uses `RAND`, this is the test
    // that should start failing.
    const driver = await savings();

    // Two inputs that feed the same formulas: `interestRate` reaches all 13 Balance
    // columns, `transactionAmount` reaches columns 1..12. A batch that genuinely
    // crosses the dependency graph rather than touching one leaf.
    const decisions = { transactionAmount: 10, interestRate: 0.07 };

    const batched = driver.createRun();
    batched.write(0, decisions);

    const sequential = driver.createRun();
    for (const [key, value] of Object.entries(decisions)) {
        sequential.write(0, { [key]: value });
    }

    const reversed = driver.createRun();
    for (const [key, value] of Object.entries(decisions).reverse()) {
        reversed.write(0, { [key]: value });
    }

    assert.deepEqual(batched.read(WATCHED), sequential.read(WATCHED), 'one batch === one write each');
    assert.deepEqual(sequential.read(WATCHED), reversed.read(WATCHED), 'write order does not matter');
});

test('it refuses a name or a step it cannot address', async () => {
    const driver = await savings();
    const run = driver.createRun();

    assert.throws(
        () => run.write(0, { notARange: 1 }),
        /'notARange' is not a named range in test\.xlsx\./
    );
    assert.throws(() => run.read(['notARange']), /'notARange' is not a named range/);
    assert.throws(
        () => run.write(1.5, { transactionAmount: 1 }),
        /step must be a non-negative integer, received: 1\.5/
    );
    assert.throws(
        () => run.write(-1, { transactionAmount: 1 }),
        /step must be a non-negative integer, received: -1/
    );
    assert.throws(
        () => run.write(13, { transactionAmount: 1 }),
        /step 13 is out of range for 'transactionAmount' \(expected 0-12\)/
    );
});

test('it refuses any decision that is not a finite number', async () => {
    const driver = await savings();

    // Every one of these is *accepted* by HyperFormula, and the first three change
    // the run silently: undefined and null blank the cell, true is coerced to 1.
    // The formula string replaces the decision with an expression. NaN and Infinity
    // read as #NUM! locally but serialise to null over the wire, so they are where
    // the two drivers would disagree. See `src/drivers/common.js`.
    for (const value of [undefined, null, true, 'hello', '=1/0', NaN, Infinity, '5']) {
        const run = driver.createRun();
        const before = run.read(WATCHED);

        assert.throws(
            () => run.write(0, { transactionAmount: value }),
            /'transactionAmount' must be written as a finite number, received: /,
            `write should refuse ${String(value)}`
        );
        assert.deepEqual(run.read(WATCHED), before, `${String(value)} left the run untouched`);
    }
});

test('a rejected value in a batch leaves the whole write undone', async () => {
    const driver = await savings();
    const run = driver.createRun();
    const before = run.read(WATCHED);

    // The good write comes first, so this only passes if nothing is applied until
    // every entry has been vetted.
    assert.throws(
        () => run.write(0, { transactionAmount: 999, initialBalance: NaN }),
        /'initialBalance' must be written as a finite number/
    );
    assert.deepEqual(run.read(WATCHED), before, 'no part of the batch landed');
});

test('stepping increments `Step` and reports where the run now is', async () => {
    const driver = await savings();
    const run = driver.createRun();

    assert.equal(run.step(), 1);
    assert.equal(run.step(), 2);
    assert.equal(run.read(['Step']).Step, 2, 'the model sees the same step we were told');
});

test('nothing stops a run stepping past the end of its timeline', async () => {
    // Documented, not endorsed. `Step` is a single cell with no bound, so the guard
    // lives in the caller — `bin/simulate.js` has one. A sweep will need its own.
    const driver = await savings();
    const run = driver.createRun();

    for (let i = 0; i < 14; i++) run.step();
    const state = run.read(WATCHED);

    assert.equal(state.Step, 14);
    assert.equal(state.Balance[state.Step], undefined, 'and reads past the end are undefined');
});

test('it drives a model whose ranges are spread across sheets', async () => {
    // `test.xlsx` is a single sheet, so nothing else proves the driver resolves a
    // range to the right sheet — or that a formula reaching across sheets through a
    // named range recalculates after a write. `AIGovModel.xlsx` is full of both.
    const driver = await createLocalDriver({ modelPath: await twoSheets() });
    const run = driver.createRun();

    assert.equal(driver.schema.get('Rate').sheet, 'Inputs');
    assert.equal(driver.schema.get('Output').sheet, 'Model Sheet');
    assert.deepEqual(run.read(['Rate', 'Output']), { Rate: 2, Output: [2, 4, 6] });

    run.write(0, { Rate: 10 });
    assert.deepEqual(run.read(['Output']).Output, [10, 20, 30], 'the other sheet recalculated');

    run.write(1, { Dial: 5 });
    assert.deepEqual(run.read(['Output']).Output, [10, 50, 30], 'at the right column');

    assert.equal(run.step(), 1, "`Step` is found wherever it lives");
});

test('it refuses a 2-D range rather than guessing which cell you meant', async () => {
    const driver = await createLocalDriver({ modelPath: await twoSheets() });
    const run = driver.createRun();

    assert.equal(driver.schema.get('Grid').rows, 2, 'the range is known, just not usable');
    assert.throws(() => run.read(['Grid']), /'Grid' is a 2x2 2-D range/);
    assert.throws(() => run.write(0, { Grid: 1 }), /'Grid' is a 2x2 2-D range/);
});

test('a model with no `Step` range says so instead of failing obscurely', async () => {
    const path = await fixture('no-step', (workbook) => {
        const sheet = workbook.addWorksheet('S');
        sheet.getCell('B1').value = 1;
        name(workbook, 'Dial', 'S', ['$B$1']);
    });

    const driver = await createLocalDriver({ modelPath: path });
    assert.throws(
        () => driver.createRun().step(),
        /no-step\.xlsx has no 'Step' named range, so it cannot be stepped\./
    );
});
