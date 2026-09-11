#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { createForioDriver } from '../src/drivers/forio/forioDriver.js';
import { FORIO, GOLDEN_PATH, MAX_STEP, MODEL_FILE, REPORTED, TRANSACTION } from './model.js';

/**
 * Record a real Forio run to `test/golden/test.xlsx.trace.json`.
 *
 * **The only thing in this repo that touches the network.** Everything else — the
 * driver, both test suites — runs offline against what this produces. That is the
 * point: pay for one authoritative run, then assert against it forever.
 *
 * The sequence below — write the transaction into the current step's column, step,
 * read everything back — is the sequence a sweep performs. It is defined here and
 * nowhere else: `test/` deliberately owns its own copy of the loop rather than
 * importing one from `src/`, which is still changing shape week to week.
 *
 * Re-record only when `test.xlsx` changes — which is manual and rare, since the tool
 * cares about exactly one model file at a time.
 *
 * Logs in as a team-account admin: FORIO_HANDLE / FORIO_PASSWORD from `.env`.
 *
 *     bun run record-golden
 */
async function recordGolden() {
    const driver = await createForioDriver({
        ...FORIO,
        modelFile: MODEL_FILE,
        credentials: { handle: process.env.FORIO_HANDLE, password: process.env.FORIO_PASSWORD },
    });
    const run = await driver.createRun();
    console.log(`recording run ${run.id} against ${FORIO.account}/${FORIO.project}`);

    try {
        const initial = await run.read(REPORTED);
        const frames = [];

        for (let current = 0; current < MAX_STEP; current++) {
            await run.write(current, { transactionAmount: TRANSACTION });
            await run.step();
            frames.push({
                wroteAtStep: current,
                updates: { transactionAmount: TRANSACTION },
                state: await run.read(REPORTED),
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
        await run.dispose();
    }
}

await recordGolden();
