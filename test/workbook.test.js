import assert from 'node:assert/strict';
import test from 'node:test';
import { HyperFormula } from 'hyperformula';
import { readWorkbook } from '../src/drivers/local/workbook.js';
import { MODEL_PATH } from './model.js';
import { fixture, name } from './fixtures.js';

/**
 * Does the parser read what is actually in the file?
 *
 * `workbook.js` is the only module that knows about the `.xlsx` format, and every
 * number the tool ever produces is downstream of it. `excel-oracle.test.js` proves
 * the *formulas* survive the trip; this proves the rest of the file does — where
 * each named range lives, what shape it is, and which cells carry formulas.
 *
 * It works from fixtures rather than `test.xlsx` because the cases that matter for
 * `AIGovModel.xlsx` — several sheets, a 2-D range, columns past Z, modern
 * functions — simply do not occur in the savings model.
 */

/** A workbook holding one of each thing the parser has to get right. */
function shapes() {
    return fixture('shapes', (workbook) => {
        const inputs = workbook.addWorksheet('Inputs');
        const model = workbook.addWorksheet('Model Sheet');
        workbook.addWorksheet('Blank');

        inputs.getCell('B2').value = 3;
        name(workbook, 'Rate', 'Inputs', ['$B$2']);

        // A formula that reaches across sheets, with the value Excel would cache.
        model.getCell('B1').value = { formula: 'Inputs!B2*2', result: 6 };
        name(workbook, 'Doubled', 'Model Sheet', ['$B$1']);

        // Column AA: two letters, so it only parses if the base-26 loop is right.
        model.getCell('AA5').value = 42;
        name(workbook, 'Far', 'Model Sheet', ['$AA$5']);

        // Four adjacent cells become one 2x2 range — a shape the drivers refuse.
        model.getCell('F1').value = 1;
        model.getCell('G1').value = 2;
        model.getCell('F2').value = 3;
        model.getCell('G2').value = 4;
        name(workbook, 'Grid', 'Model Sheet', ['$F$1', '$G$1', '$F$2', '$G$2']);

        // How Excel writes a function older versions lack.
        model.getCell('C7').value = { formula: '_xlfn.SUM(1,2)', result: 3 };
        name(workbook, 'Modern', 'Model Sheet', ['$C$7']);
    });
}

test('it locates every named range, whatever its shape or sheet', async () => {
    const workbook = await readWorkbook(await shapes());

    assert.equal(workbook.modelFile, 'shapes.xlsx');
    assert.deepEqual(Object.keys(workbook.sheets), ['Inputs', 'Model Sheet', 'Blank']);

    // 0-indexed from the top-left: B2 is row 1, column 1.
    assert.deepEqual(workbook.names.get('Rate'), {
        sheet: 'Inputs',
        row: 1,
        col: 1,
        rows: 1,
        cols: 1,
        range: 'Inputs!$B$2',
    });

    // The sheet name contains a space, so Excel quotes it; the quotes must come off
    // the sheet name but stay in `range`, which is handed to the engine verbatim.
    const doubled = workbook.names.get('Doubled');
    assert.equal(doubled.sheet, 'Model Sheet');
    assert.equal(doubled.range, "'Model Sheet'!$B$1");

    // Column AA is 26 only if the base-26 conversion carries; a naive parser says 0.
    assert.deepEqual(workbook.names.get('Far'), {
        sheet: 'Model Sheet',
        row: 4,
        col: 26,
        rows: 1,
        cols: 1,
        range: "'Model Sheet'!$AA$5",
    });

    // The corners of the block, not just its top-left.
    assert.deepEqual(workbook.names.get('Grid'), {
        sheet: 'Model Sheet',
        row: 0,
        col: 5,
        rows: 2,
        cols: 2,
        range: "'Model Sheet'!$F$1:$G$2",
    });
});

test('it records every formula cell with the value Excel cached for it', async () => {
    const workbook = await readWorkbook(await shapes());

    // The pair that `excel-oracle.test.js` compares. Without `cached` there is
    // nothing to check the engine against, so a missing one is a silent hole.
    assert.deepEqual(
        workbook.formulaCells.map(({ ref, cached }) => ({ ref, cached })),
        [
            { ref: 'B1', cached: 6 },
            { ref: 'C7', cached: 3 },
        ]
    );
});

test('it strips the `_xlfn.` prefix Excel puts on modern functions', async () => {
    const workbook = await readWorkbook(await shapes());
    const { row, col } = workbook.names.get('Modern');

    assert.equal(workbook.sheets['Model Sheet'][row][col], '=SUM(1,2)');

    // Two-sided, because the strip is easy to lose and hard to miss: fed to the
    // engine unstripped, the same formula does not merely give a wrong number — it
    // fails to parse. `AIGovModel.xlsx` has 6,292 of these cells.
    const engine = HyperFormula.buildFromSheets(
        { S: [['=_xlfn.SUM(1,2)']] },
        { licenseKey: 'gpl-v3' }
    );
    assert.equal(engine.getCellValue({ sheet: 0, row: 0, col: 0 }).type, 'ERROR');
    engine.destroy();
});

test('a sheet with no cells does not stop the workbook loading', async () => {
    // HyperFormula rejects a sparse grid outright, so an empty sheet is the case
    // most likely to blow up on a real model. It must come back as an empty grid,
    // not as a hole.
    const workbook = await readWorkbook(await shapes());

    assert.deepEqual(workbook.sheets.Blank, []);
    assert.equal(workbook.sheets['Model Sheet'].length, 7, 'other sheets are unaffected');
});

test('it refuses a name that covers more than one range', async () => {
    // Excel allows it; we have no shape to report for it and no way to address it,
    // so the only honest answer is to stop at load time.
    const path = await fixture('multi-range', (workbook) => {
        const sheet = workbook.addWorksheet('S');
        sheet.getCell('B1').value = 1;
        sheet.getCell('Z9').value = 2;
        name(workbook, 'Spread', 'S', ['$B$1', '$Z$9']);
    });

    await assert.rejects(
        readWorkbook(path),
        /named range 'Spread' covers 2 ranges; only single-range names are supported/
    );
});

test('a formatted label comes through as plain words', async () => {
    // `test.xlsx` ends with two rich-text notes. The engine has no use for the
    // formatting, but dropping the cell to `null` would change the grid.
    const workbook = await readWorkbook(MODEL_PATH);
    const cell = workbook.sheets['Savings account simulation'][12][0];

    assert.match(cell, /^\*\* Note: Use named ranges/);
});
