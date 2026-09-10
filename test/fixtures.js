import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';
import ExcelJS from 'exceljs';

/**
 * Build tiny, purpose-made `.xlsx` files at run time.
 *
 * `test.xlsx` is one sheet with six named ranges, so it cannot exercise the cases
 * that matter most for the model we are heading towards: several sheets, a 2-D
 * range, a missing `Step`, a modern `_xlfn.` formula. Rather than commit a folder
 * of opaque binaries, each test builds exactly the workbook it needs, in code you
 * can read next to the assertion.
 *
 * Files land in a temp directory that is removed when the test file finishes.
 * `readWorkbook` takes a path, so these are real files parsed by the real code
 * path — nothing is stubbed.
 */

/** Created on first use; one per test file, since each runs in its own process. */
let directory;

after(async () => {
    if (directory) await rm(directory, { recursive: true, force: true });
});

/**
 * Write a workbook and return its path.
 *
 * @param {string} name Basename for the file; also what `modelFile` will report.
 * @param {(workbook: ExcelJS.Workbook) => void} build Populates the workbook.
 * @returns {Promise<string>}
 */
export async function fixture(name, build) {
    directory ??= await mkdtemp(join(tmpdir(), 'modelkit-'));

    const workbook = new ExcelJS.Workbook();
    build(workbook);

    const path = join(directory, `${name}.xlsx`);
    await workbook.xlsx.writeFile(path);
    return path;
}

/**
 * Name a run of cells. ExcelJS takes one reference at a time and merges adjacent
 * ones into a single range, which is how a timeline or a 2-D block is declared.
 */
export function name(workbook, label, sheet, refs) {
    for (const ref of refs) workbook.definedNames.add(`'${sheet}'!${ref}`, label);
}
