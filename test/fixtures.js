import { rmSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";

/**
 * Build tiny, purpose-made `.xlsx` files at run time.
 *
 * `test.xlsx` is one sheet with six named ranges, so it cannot exercise the cases
 * that matter most for the model we are heading towards: several sheets, a 2-D
 * range, a missing `Step`, a modern `_xlfn.` formula. Rather than commit a folder
 * of opaque binaries, each test builds exactly the workbook it needs, in code you
 * can read next to the assertion.
 *
 * Files land in a temp directory that is removed when the process exits.
 * `readWorkbook` takes a path, so these are real files parsed by the real code
 * path — nothing is stubbed.
 */

/** Created on first use, then shared for the life of the process. */
let directory;

/**
 * Clean up when the *process* ends, not when a test file does.
 *
 * This used to be an `after()` hook, which was only ever correct by accident:
 * `node --test` forks a process per test file, so "the file finished" and "the
 * process is ending" were the same moment. `bun test` runs every file in one
 * process, and the hook then fired at the end of whichever file imported this
 * module first — deleting the directory out from under every file after it.
 *
 * The directory is process-scoped, so its cleanup has to be too. `exit` cannot
 * await, hence `rmSync`.
 */
process.on("exit", () => {
  if (directory) rmSync(directory, { recursive: true, force: true });
});

/**
 * Write a workbook and return its path.
 *
 * @param {string} name Basename for the file; also what `modelFile` will report.
 * @param {(workbook: ExcelJS.Workbook) => void} build Populates the workbook.
 * @returns {Promise<string>}
 */
export async function fixture(name, build) {
  directory ??= await mkdtemp(join(tmpdir(), "modelkit-"));

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
