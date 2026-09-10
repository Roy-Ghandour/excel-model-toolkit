import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLocalDriver } from '../src/drivers/local/localDriver.js';
import { MODEL_PATH } from '../src/config.js';
import { GOLDEN_PATH, REPORTED } from './trace.js';

/**
 * Oracle 1: does the local driver agree with **Forio**?
 *
 * `test/record-golden.js` drove one real Epicenter run and recorded every value it
 * returned. This replays that exact sequence against the local driver and demands
 * the same numbers at every step — offline, in milliseconds, forever.
 *
 * Where `oracle.test.js` proves the *engine* is right, this proves the *driver* is:
 * that our cell addressing, write batching and step semantics reproduce what
 * Epicenter actually did, not just what its docs say it does.
 */

const golden = JSON.parse(readFileSync(GOLDEN_PATH));

test('the local driver reproduces the recorded Forio run exactly', async () => {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });
    const run = driver.createRun();

    assert.equal(driver.modelFile, golden.source.modelFile, 'same model file');
    assert.deepEqual(
        run.read(REPORTED),
        golden.initial,
        'a fresh run starts where Forio\'s fresh run started'
    );

    for (const { wroteAtStep, updates, state } of golden.frames) {
        run.write(wroteAtStep, updates);
        const step = run.step();

        assert.equal(step, state.Step, `step() returned the new Step at step ${wroteAtStep}`);
        assert.deepEqual(
            run.read(REPORTED),
            state,
            `state after writing at step ${wroteAtStep}`
        );
    }
});

test('runs are independent of one another', async () => {
    // Forio hands out a separate server-side run per `createRun`; ours must not leak
    // state between engines, or a sweep's runs would contaminate each other.
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });
    const [a, b] = [driver.createRun(), driver.createRun()];

    a.write(0, { transactionAmount: 999 });
    a.step();

    assert.deepEqual(b.read(REPORTED), golden.initial, 'the second run is untouched');
});

test('batching writes is equivalent to recalculating after each one', async () => {
    // Epicenter recalculates on every write; `write()` batches and recalculates once.
    // That is only safe because recalculation is idempotent here — a pure function of
    // the input cells, with no circular references and no volatile functions to make a
    // second pass differ from the first.
    //
    // The recorded trace cannot prove this: it only ever writes one cell per call. So
    // pin the property directly. If a model later enables iterative calculation or
    // uses `RAND`, this is the test that should start failing.
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });

    // Two inputs that feed the same formulas: `interestRate` reaches all 13 Balance
    // columns, `transactionAmount` reaches columns 1..12. A batch that genuinely
    // crosses the dependency graph rather than touching one leaf.
    const decisions = { transactionAmount: 10, interestRate: 0.07 };

    const batched = driver.createRun();
    batched.write(0, decisions);

    const sequential = driver.createRun();
    for (const [name, value] of Object.entries(decisions)) {
        sequential.write(0, { [name]: value });
    }

    const reversed = driver.createRun();
    for (const [name, value] of Object.entries(decisions).reverse()) {
        reversed.write(0, { [name]: value });
    }

    assert.deepEqual(batched.read(REPORTED), sequential.read(REPORTED), 'one batch === one write each');
    assert.deepEqual(sequential.read(REPORTED), reversed.read(REPORTED), 'write order does not matter');
});

test('it refuses bad arguments the way the Forio driver does', async () => {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });
    const run = driver.createRun();

    assert.throws(
        () => run.write(0, { notARange: 1 }),
        /'notARange' is not a named range in test\.xlsx\./
    );
    assert.throws(
        () => run.write(1.5, { transactionAmount: 1 }),
        /step must be a non-negative integer, received: 1\.5/
    );
    assert.throws(
        () => run.write(13, { transactionAmount: 1 }),
        /step 13 is out of range for 'transactionAmount' \(expected 0-12\)/
    );
});

test('it refuses any decision that is not a finite number', async () => {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });

    // Every one of these is *accepted* by HyperFormula, and the first three change
    // the run silently: undefined and null blank the cell, true is coerced to 1.
    // The formula string replaces the decision with an expression. NaN and Infinity
    // read as #NUM! locally but serialise to null over the wire, so they are where
    // the two drivers would disagree. See `src/drivers/common.js`.
    for (const value of [undefined, null, true, 'hello', '=1/0', NaN, Infinity, '5']) {
        const run = driver.createRun();
        const before = run.read(REPORTED);

        assert.throws(
            () => run.write(0, { transactionAmount: value }),
            /'transactionAmount' must be written as a finite number, received: /,
            `write should refuse ${String(value)}`
        );
        assert.deepEqual(run.read(REPORTED), before, `${String(value)} left the run untouched`);
    }
});

test('a rejected value in a batch leaves the whole write undone', async () => {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });
    const run = driver.createRun();
    const before = run.read(REPORTED);

    // The good write comes first, so this only passes if nothing is applied until
    // every entry has been vetted.
    assert.throws(
        () => run.write(0, { transactionAmount: 999, initialBalance: NaN }),
        /'initialBalance' must be written as a finite number/
    );
    assert.deepEqual(run.read(REPORTED), before, 'no part of the batch landed');
});
