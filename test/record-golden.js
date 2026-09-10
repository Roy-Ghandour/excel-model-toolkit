#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { createForioDriver } from '../src/drivers/forio/forioDriver.js';
import { FORIO, MAX_STEP, MODEL_FILE } from '../src/config.js';
import { GOLDEN_PATH, REPORTED, TRANSACTION } from './trace.js';

/**
 * Record a real Forio run to `test/golden/test.xlsx.trace.json`.
 *
 * **The only thing in this repo that touches the network.** Everything else — the
 * driver, both test suites — runs offline against what this produces. That is the
 * point: pay for one authoritative run, then assert against it forever.
 *
 * The sequence below deliberately mirrors `simulate()` exactly (write the
 * transaction into the current year's column, step, read). If `simulate` ever
 * changes shape, this must change with it or the golden file stops being evidence
 * about the thing we actually run.
 *
 * Re-record only when `test.xlsx` changes — which is manual and rare, since the tool
 * cares about exactly one model file at a time.
 *
 *     npm run record-golden
 */
async function recordGolden() {
    const driver = await createForioDriver({ ...FORIO, modelFile: MODEL_FILE });
    const runKey = await driver.createRun();
    console.log(`recording run ${runKey} against ${FORIO.account}/${FORIO.project}`);

    try {
        const initial = await driver.read(runKey, REPORTED);
        const frames = [];

        for (let current = 0; current < MAX_STEP; current++) {
            await driver.write(runKey, current, { transactionAmount: TRANSACTION });
            await driver.step(runKey);
            frames.push({
                wroteAtStep: current,
                updates: { transactionAmount: TRANSACTION },
                state: await driver.read(runKey, REPORTED),
            });
            process.stdout.write('.');
        }
        console.log();

        const trace = {
            recordedAt: new Date().toISOString(),
            source: { driver: 'forio', ...FORIO, modelFile: MODEL_FILE },
            reported: REPORTED,
            transaction: TRANSACTION,
            steps: MAX_STEP,
            initial,
            frames,
        };

        await writeFile(GOLDEN_PATH, `${JSON.stringify(trace, null, 2)}\n`);
        console.log(`wrote ${frames.length} frames to ${GOLDEN_PATH.pathname}`);
        console.log(`final Balance: ${frames.at(-1).state.Balance.at(-1)}`);
    } finally {
        await driver.dispose(runKey);
    }
}

await recordGolden();
