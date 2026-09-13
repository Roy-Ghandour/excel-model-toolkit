/**
 * Turn what a model computed into a table.
 *
 * Pure: no driver, no registry, no simulation. It is handed the names to report and
 * the state to report them from, and knows nothing about what either means.
 */

/** The three rows `summarize` appends, in the order they are written. */
const SUMMARIES = {
  max: (values) => Math.max(...values),
  min: (values) => Math.min(...values),
  average: (values) => values.reduce((total, value) => total + value, 0) / values.length,
};

/**
 * One run's reportable values, taken at the end of the run.
 *
 * **A timeline is read at `length - 1`, not at its end.** Step 0 is the setup turn in
 * column 0, so a run of `length` steps last wrote column `length - 1`; the model still
 * computes every column past it from the workbook's authored contents, and those are
 * not part of the run. `.at(-1)` reads that tail, and looks right on a full-length run.
 *
 * @param {Record<string, unknown>} final State after the last step, as `simulate` returns it.
 * @param {string[]} names The named ranges to report.
 * @param {number} length How many steps the run took.
 * @returns {Record<string, unknown>}
 */
export function endOfRun(final, names, length) {
  return Object.fromEntries(
    names.map((name) => {
      const value = final[name];
      return [name, Array.isArray(value) ? value[length - 1] : value];
    })
  );
}

/**
 * The max, min and average of every numeric column, as three trailing rows.
 *
 * Constant columns are summarized too. Their three rows just restate the value, which
 * is the point: reading the bottom of the table should not require knowing in advance
 * which columns vary.
 *
 * @param {Array<Record<string, unknown>>} rows The data rows.
 * @param {string[]} columns Every column, `label` included.
 * @param {string} label The column the summary's name goes in.
 * @returns {Array<Record<string, unknown>>} Empty when there is nothing to summarize.
 */
export function summarize(rows, columns, label) {
  if (rows.length === 0) return [];

  return Object.entries(SUMMARIES).map(([name, reduce]) =>
    Object.fromEntries(
      columns.map((column) => {
        if (column === label) return [column, name];
        const values = rows.map((row) => row[column]).filter(Number.isFinite);
        // A column of ids or seeds has nothing to summarize, and neither does one the
        // model left blank.
        return [column, values.length === rows.length ? reduce(values) : ""];
      })
    )
  );
}

/**
 * Render one field: numbers to at most two decimals, everything else as it stands.
 *
 * `String` after the rounding is what keeps whole numbers whole — 5 stays `5` rather
 * than becoming `5.00`, and 62.40 renders as `62.4`. A value the model returned as
 * text, or as an error object, passes through instead of turning into `NaN`.
 */
const field = (value) =>
  Number.isFinite(value) ? String(Math.round(value * 100) / 100) : String(value ?? "");

/** Quote a field only where CSV requires it. */
const quote = (text) =>
  /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;

/**
 * A CSV: one header row, then one row per record.
 *
 * @param {string[]} columns Column names, in order.
 * @param {Array<Record<string, unknown>>} rows
 * @returns {string}
 */
export function toCsv(columns, rows) {
  const lines = [columns.map(quote).join(",")];
  for (const row of rows) {
    lines.push(columns.map((column) => quote(field(row[column]))).join(","));
  }
  return `${lines.join("\n")}\n`;
}
