import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createLocalDriver } from '../src/drivers/local/localDriver.js';
import { GOLDEN_PATH, MODEL_PATH, REPORTED } from './model.js';

/**
 * Does the local driver agree with **Forio**?
 *
 * `test/record-golden.js` drove one real Epicenter run and recorded every value it
 * returned. This replays that exact sequence against the local driver and demands
 * the same numbers at every step — offline, in milliseconds, forever.
 *
 * Where `excel-oracle.test.js` proves the *engine* is right, this proves the
 * *driver* is: that our cell addressing, write batching and step semantics
 * reproduce what Epicenter actually did, not just what its docs say it does.
 *
 * Nothing here touches the network. Re-recording does — see `record-golden.js`.
 */

const golden = JSON.parse(readFileSync(GOLDEN_PATH));

test('the local driver reproduces the recorded Forio run exactly', async () => {
    const driver = await createLocalDriver({ modelPath: MODEL_PATH });
    const run = driver.createRun();

    // The trace is only evidence about the model it was recorded against.
    assert.equal(driver.modelFile, golden.source.modelFile, 'same model file');
    assert.deepEqual(
        run.read(REPORTED),
        golden.initial,
        "a fresh run starts where Forio's fresh run started"
    );

    for (const { wroteAtStep, updates, state } of golden.frames) {
        run.write(wroteAtStep, updates);
        const step = run.step();

        assert.equal(step, state.Step, `step() returned the new Step at step ${wroteAtStep}`);
        assert.deepEqual(run.read(REPORTED), state, `state after writing at step ${wroteAtStep}`);
    }
});
