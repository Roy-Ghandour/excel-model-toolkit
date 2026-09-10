import assert from 'node:assert/strict';
import test from 'node:test';
import { HyperFormula } from 'hyperformula';
import { readWorkbook } from '../src/drivers/local/workbook.js';
import { MODEL_PATH } from '../src/config.js';

/**
 * Oracle 0: does our engine agree with **Excel itself**?
 *
 * Every formula cell in an `.xlsx` carries the value Microsoft Excel last computed
 * for it. That makes the model file its own answer key — we can recalculate the
 * whole workbook from scratch and check our result against Excel's, offline, with
 * no Forio account and no network.
 *
 * This is a stronger claim than "we match Forio": it says the engine is right, not
 * merely consistent with another emulator. It is also the cheapest test we have, so
 * it runs first.
 */

/**
 * Build an engine the same way the driver does, but from a parse we can inspect.
 * Kept deliberately separate from `createLocalDriver` so that a bug in the driver
 * cannot make this test pass.
 */
function buildEngine(workbook, options) {
    const engine = HyperFormula.buildFromSheets(workbook.sheets, {
        licenseKey: 'gpl-v3',
        ...options,
    });
    for (const [name, { range }] of workbook.names) {
        engine.addNamedExpression(name, `=${range}`);
    }
    return engine;
}

test('the engine reproduces Excel\'s own cached values bit for bit', async () => {
    const workbook = await readWorkbook(MODEL_PATH);
    const engine = buildEngine(workbook, { smartRounding: false });

    assert.equal(workbook.formulaCells.length, 13, 'test.xlsx has 13 formula cells');

    const mismatches = [];
    for (const { sheet, row, col, ref, cached } of workbook.formulaCells) {
        const computed = engine.getCellValue({ sheet: engine.getSheetId(sheet), row, col });
        // `Object.is`, not `assert.equal`: this asserts the exact same double, which
        // is the claim worth making. A tolerance here would hide the smartRounding
        // failure the next test documents.
        if (!Object.is(computed, cached)) {
            mismatches.push(`${ref}: computed ${computed}, Excel cached ${cached}`);
        }
    }

    engine.destroy();
    assert.deepEqual(mismatches, [], `cells disagreeing with Excel:\n  ${mismatches.join('\n  ')}`);
});

test('smartRounding would silently corrupt the compounding chain', async () => {
    // Not a test of our code — a test of the assumption behind one config line, so
    // that if a future HyperFormula changes the default we find out here rather than
    // in a sweep. The savings model compounds 12 deep, so a rounded intermediate is
    // fed forward and the error grows rather than cancelling.
    const workbook = await readWorkbook(MODEL_PATH);
    const engine = buildEngine(workbook, { smartRounding: true });

    const worst = workbook.formulaCells
        .map(({ sheet, row, col, cached }) =>
            Math.abs(engine.getCellValue({ sheet: engine.getSheetId(sheet), row, col }) - cached)
        )
        .reduce((a, b) => Math.max(a, b), 0);

    engine.destroy();
    assert.ok(
        worst > 1e-10,
        `expected smartRounding to visibly diverge from Excel, but the worst error was ${worst}`
    );
});
