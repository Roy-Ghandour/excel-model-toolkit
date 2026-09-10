#!/usr/bin/env node
import { loadRunFile } from '../src/core/runFile.js';
import { replay } from '../src/core/replay.js';
import { createLocalDriver } from '../src/drivers/local/localDriver.js';

/**
 * Run a run file.
 *
 *     node bin/simulate.js runs/savings-golden.run.json
 *
 * Everything about the run comes from the file: which model, what to write, and
 * how many steps to take. This script only decides *how* to reach the model — it
 * picks the local driver — and how to print what came back.
 */

/** The repo root, where model files sit. Resolved from this file so the path holds however it is invoked. */
const ROOT = new URL('../', import.meta.url);

const [path] = process.argv.slice(2);

if (!path || path === '--help' || path === '-h') {
    console.error('usage: node bin/simulate.js <run-file.json>');
    console.error('  e.g. node bin/simulate.js runs/savings-golden.run.json');
    process.exit(path ? 0 : 1);
}

/** Render a read-back value: timelines as a list, single cells as themselves. */
const show = (value) => (Array.isArray(value) ? `[${value.join(', ')}]` : String(value));

/** Render one step's decisions the way they read in the run file. */
const decisions = (writes) =>
    Object.entries(writes)
        .map(([name, value]) => `${name}=${value}`)
        .join('  ');

try {
    const run = await loadRunFile(path);
    const driver = await createLocalDriver({ modelPath: new URL(run.model.file, ROOT) });

    console.log(`run ${run.id} · ${run.model.file}`);
    if (run.label) console.log(run.label);
    if (run.settings) console.log(`\nsettings   ${decisions(run.settings)}`);

    const trace = replay(driver, run);

    console.log('\n  step   decisions');
    console.log('  ----   ---------');
    for (const taken of trace.steps) {
        console.log(`  ${String(taken.state.Step ?? taken.step + 1).padStart(4)}   ${decisions(taken.writes)}`);
    }

    // The full final state rather than a chosen few: which ranges matter is a
    // question for whatever analyses the numbers, not for the thing producing them.
    const width = Math.max(...trace.namedRanges.map((name) => name.length));
    console.log('\nfinal state');
    for (const name of trace.namedRanges) {
        console.log(`  ${name.padEnd(width)}   ${show(trace.final[name])}`);
    }
} catch (error) {
    console.error('\nsimulation failed:', error?.message ?? error);
    if (error?.information) console.error(error.information);
    process.exit(1);
}
