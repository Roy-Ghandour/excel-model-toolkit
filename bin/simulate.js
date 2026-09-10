#!/usr/bin/env node
import { simulate } from '../src/tools/simulate.js';
import { MAX_STEP } from '../src/config.js';

const args = process.argv.slice(2);

function flag(name, fallback) {
    const i = args.indexOf(`--${name}`);
    if (i === -1) return fallback;
    const value = Number(args[i + 1]);
    if (!Number.isFinite(value)) {
        console.error(`--${name} needs a number`);
        process.exit(1);
    }
    return value;
}

const steps = flag('steps', MAX_STEP);
if (steps < 1 || steps > MAX_STEP) {
    console.error(`--steps must be between 1 and ${MAX_STEP} (the model's timeline is Time = 0..${MAX_STEP})`);
    process.exit(1);
}

try {
    await simulate({ steps, transaction: flag('transaction', 10) });
} catch (error) {
    console.error('\nsimulation failed:', error?.message ?? error);
    if (error?.information) console.error(error.information);
    process.exit(1);
}
