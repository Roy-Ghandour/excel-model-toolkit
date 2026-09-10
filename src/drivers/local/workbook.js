import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

/**
 * Read an `.xlsx` into the plain description the local engine needs.
 *
 * The only module that knows about the OOXML file format. It answers three
 * questions and nothing else: what is in each cell, where does each named range
 * live, and what did Excel itself last compute. Everything downstream works from
 * that description, never from the file.
 *
 * **It refuses rather than guesses.** A workbook feature we cannot represent
 * faithfully throws here, at load time. The alternative — parsing it "mostly" and
 * carrying on — produces a sweep full of plausible, wrong numbers, which is worse
 * than no sweep at all.
 */

/** ExcelJS is 1-based in both axes; HyperFormula (and we) are 0-based. */
const ORIGIN = 1;

/**
 * Excel writes modern functions with an `_xlfn.` prefix so older versions fail
 * loudly instead of silently. Engines see it as an unknown name and yield `#NAME?`,
 * so strip it. Unused by the savings model, but `AIGovModel.xlsx` has 6,292 such
 * cells and the fix is one regex.
 */
function normaliseFormula(formula) {
    return `=${formula.replace(/_xlfn\./g, '').replace(/^=/, '')}`;
}

/** `$B$8` / `B8` → `{ row, col }`, 0-indexed. */
function parseRef(ref) {
    const match = /^\$?([A-Z]+)\$?(\d+)$/.exec(ref.trim());
    if (!match) throw new Error(`could not parse cell reference '${ref}'`);

    const [, letters, digits] = match;
    let col = 0;
    for (const letter of letters) col = col * 26 + (letter.charCodeAt(0) - 64);
    return { row: Number(digits) - ORIGIN, col: col - ORIGIN };
}

/**
 * `'Savings account simulation'!$B$8:$N$8` → sheet name plus the two corners.
 *
 * Splits on the *last* `!` because a quoted sheet name may legally contain one.
 */
function parseRange(range, name) {
    const split = range.lastIndexOf('!');
    if (split === -1) {
        throw new Error(`named range '${name}' has no sheet in '${range}'`);
    }

    let sheet = range.slice(0, split);
    if (sheet.startsWith("'") && sheet.endsWith("'")) {
        sheet = sheet.slice(1, -1).replace(/''/g, "'");
    }
    if (sheet.includes('[')) {
        throw new Error(
            `named range '${name}' points at another workbook ('${range}'); external references are not supported`
        );
    }

    const [from, to = from] = range.slice(split + 1).split(':');
    const start = parseRef(from);
    const end = parseRef(to);
    return {
        sheet,
        row: start.row,
        col: start.col,
        rows: end.row - start.row + 1,
        cols: end.col - start.col + 1,
    };
}

/**
 * Flatten one ExcelJS cell to something the engine accepts.
 *
 * Returns `null` for anything empty — a hole in the grid, which the engine treats
 * as Excel does. Formula cells come back as `'=…'` strings.
 */
function cellContent(cell) {
    const { value } = cell;
    if (value === null || value === undefined) return null;

    if (cell.type === ExcelJS.ValueType.Formula) {
        // ExcelJS materialises shared formulas into each cell, so `formula` is
        // normally present even for a member of a shared group. When it is not, we
        // would have to reconstruct it by translating the master's relative
        // references — so refuse instead of shipping a silently empty cell.
        if (typeof cell.formula !== 'string' || cell.formula === '') {
            throw new Error(
                `${cell.address}: formula cell whose formula ExcelJS could not resolve` +
                    ` (shareType '${value.shareType ?? 'none'}'); refusing to guess at its value`
            );
        }
        if (value.shareType === 'array') {
            throw new Error(
                `${cell.address}: array formulas are not supported yet ('${cell.formula}')`
            );
        }
        return normaliseFormula(cell.formula);
    }

    // Rich text is a formatted label; the engine only needs the words.
    if (cell.type === ExcelJS.ValueType.RichText) return cell.text;
    if (typeof value === 'object' && !(value instanceof Date)) return cell.text ?? null;
    return value;
}

/**
 * Parse the workbook at `modelPath` (a path or `file:` URL).
 *
 * @returns {Promise<{
 *   modelFile: string,
 *   sheets: Record<string, Array<Array<unknown>>>,
 *   names: Map<string, { sheet: string, row: number, col: number, rows: number, cols: number, range: string }>,
 *   formulaCells: Array<{ sheet: string, row: number, col: number, ref: string, cached: unknown }>
 * }>}
 */
export async function readWorkbook(modelPath) {
    const path = modelPath instanceof URL ? fileURLToPath(modelPath) : String(modelPath);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(path);

    const sheets = {};
    const formulaCells = [];

    for (const sheet of workbook.worksheets) {
        // A dense rectangle: HyperFormula wants an array of arrays, and a sparse one
        // (holes from `Array()`) is rejected outright.
        const grid = Array.from({ length: sheet.rowCount }, () =>
            Array.from({ length: sheet.columnCount }, () => null)
        );

        sheet.eachRow({ includeEmpty: false }, (row) => {
            row.eachCell({ includeEmpty: false }, (cell) => {
                const at = { row: cell.row - ORIGIN, col: cell.col - ORIGIN };
                const content = cellContent(cell);
                grid[at.row][at.col] = content;

                if (cell.type === ExcelJS.ValueType.Formula) {
                    formulaCells.push({
                        sheet: sheet.name,
                        ...at,
                        ref: cell.address,
                        cached: cell.result,
                    });
                }
            });
        });

        sheets[sheet.name] = grid;
    }

    const names = new Map();
    for (const { name, ranges } of workbook.definedNames.model) {
        if (ranges.length !== 1) {
            throw new Error(
                `named range '${name}' covers ${ranges.length} ranges; only single-range names are supported`
            );
        }
        const parsed = parseRange(ranges[0], name);
        if (!(parsed.sheet in sheets)) {
            throw new Error(`named range '${name}' refers to unknown sheet '${parsed.sheet}'`);
        }
        // `range` is kept verbatim so the engine can be handed the reference exactly
        // as Excel wrote it, quoting and all, rather than one we reassemble.
        names.set(name, { ...parsed, range: ranges[0] });
    }

    return { modelFile: basename(path), sheets, names, formulaCells };
}
