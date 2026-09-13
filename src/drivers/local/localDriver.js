import { randomUUID } from "node:crypto";
import { HyperFormula } from "hyperformula";
import "./excelFunctions.js";
import { readWorkbook } from "./workbook.js";
import { assertWritable } from "../common.js";

/**
 * Drive an Excel model entirely in this process, on the local machine.
 */

/**
 * Engine configuration. Every field is load-bearing.
 *
 * `licenseKey: 'gpl-v3'` selects HyperFormula's open-source licence, as the library
 * requires an explicit choice. This is the only free choice and requires the programme be open source
 *
 * `evaluateNullToZero` makes a formula that points at an empty cell (`=K110`) read 0,
 * as Excel and Forio do; HyperFormula otherwise returns null. Empty cells stay null.
 *
 * `smartRounding` switches on two separate things, and Forio does only the first:
 * - comparisons and sums tolerate the last bits of a double, so `0.1+0.2=0.3` is
 *   TRUE and `0.1+0.2-0.3` is 0. The engine fixes this when it is built.
 * - every value read back is rounded to 10 significant digits. Forio returns the
 *   full double.
 * So engines are built with it on and it is switched off straight after, in
 * `buildEngine` — the only way to get the first without the second.
 */
const ENGINE_OPTIONS = {
  licenseKey: "gpl-v3",
  smartRounding: true,
  evaluateNullToZero: true,
};

/**
 * How many rewound engines to keep for reuse. An engine of AIGovModel is ~460MB, and
 * runs are driven one at a time, so one is the number that matters; the rest is slack
 * for a caller driving several at once.
 */
const IDLE_LIMIT = 4;

/**
 * The named ranges to register with the engine, as `[name, shape]` pairs.
 *
 * HyperFormula refuses any name shaped like a cell address — letters then digits,
 * e.g. `EcPro7` — even where Excel allows it because the "column" is past `XFD`.
 * Reading and writing never need the engine to know a name: both go through
 * `schema` and address the cell directly. Only a formula that mentions the name
 * does, so skip a refused name unless one does, and throw in that case rather than
 * let it evaluate to `#NAME?`.
 */
function registrableNames(workbook) {
  const probe = HyperFormula.buildEmpty(ENGINE_OPTIONS);
  const refused = [...workbook.names.keys()].filter(
    (name) => !probe.isItPossibleToAddNamedExpression(name, "=0")
  );
  if (refused.length === 0) return [...workbook.names];

  // Every word in every formula, gathered in one pass: a regex per name costs
  // seconds on a large model. Excel names are case-insensitive, and a word followed
  // by `(` or `!` is a function or a sheet, not a name.
  const formulaOf = ({ sheet, row, col }) => workbook.sheets[sheet][row][col];
  const allFormulas = workbook.formulaCells.map(formulaOf).join("\n");
  const words = new Set();
  for (const [word] of allFormulas.matchAll(/[\w.]+(?![\w.(!])/g)) {
    words.add(word.toLowerCase());
  }

  const used = refused.find((name) => words.has(name.toLowerCase()));
  if (used) {
    const mention = new RegExp(`(?<![\\w.])${used}(?![\\w.(!])`, "i");
    const cell = workbook.formulaCells.find((c) => mention.test(formulaOf(c)));
    throw new Error(
      `${workbook.modelFile}: ${cell.sheet}!${cell.ref} uses named range '${used}', which HyperFormula cannot register because it is shaped like a cell address`
    );
  }
  return [...workbook.names].filter(([name]) => !refused.includes(name));
}

/**
 * Connect to a model file and return a driver bound to it.
 *
 * The workbook is parsed exactly once; each run then gets its own engine built from
 * that parse, so runs never share state and creating one costs no file I/O.
 *
 * @param {{ modelPath: string | URL }} options Path to the `.xlsx` on disk.
 */
export async function createLocalDriver({ modelPath }) {
  const workbook = await readWorkbook(modelPath);
  const schema = workbook.names;
  const engineNames = registrableNames(workbook);

  /** Build a fresh engine at the workbook's authored state. */
  function buildEngine() {
    const engine = HyperFormula.buildFromSheets(
      workbook.sheets,
      ENGINE_OPTIONS
    );

    // Keep smartRounding's comparison tolerance, drop its output rounding (see ENGINE_OPTIONS).
    engine._config.smartRounding = false;

    // Feed the engine the named ranges its formulas can refer to
    for (const [name, { range }] of engineNames) {
      engine.addNamedExpression(name, `=${range}`);
    }
    return engine;
  }

  /**
   * Engines rewound by `dispose` and ready to be handed out again.
   *
   * A run takes one for its lifetime and gives it back, so this is never a *shared*
   * engine — it is the same isolation as before, without paying to rebuild it.
   */
  const idle = [];

  /**
   * Look up a named range and locate its sheet. While ensuring the shape is supported.
   */
  function resolve(engine, name) {
    const shape = schema.get(name);
    if (!shape) {
      throw new Error(
        `'${name}' is not a named range in ${workbook.modelFile}.`
      );
    }
    if (shape.rows > 1) {
      throw new Error(
        `'${name}' is a ${shape.rows}x${shape.cols} 2-D range; only single cells and single-row timelines are supported`
      );
    }
    return { shape, sheet: engine.getSheetId(shape.sheet) };
  }

  /**
   * Resolve a named range and a step into an engine cell address.
   */
  function cellFor(engine, name, step) {
    const { shape, sheet } = resolve(engine, name);

    // Return early for single cell
    if (shape.cols === 1) return { sheet, row: shape.row, col: shape.col };

    const last = shape.cols - 1;
    if (step > last) {
      throw new Error(
        `step ${step} is out of range for '${name}' (expected 0-${last})`
      );
    }
    return { sheet, row: shape.row, col: shape.col + step };
  }

  return {
    modelFile: workbook.modelFile,
    schema,

    /**
     * Read a single-cell named range's value as saved in the file. No calculation, so only
     * meaningful for values typed into the cell.
     */
    readFromFile(name) {
      const { sheet, row, col } = schema.get(name);
      return workbook.sheets[sheet][row][col];
    },

    /**
     * Create a fresh run: an engine at Step 0.
     *
     * The run owns its engine for its whole lifetime — nothing else touches it until
     * `dispose`, so two live runs never share state. What it no longer owns is the
     * engine *afterwards*: `dispose` rewinds it and hands it back to the pool.
     *
     * **So `dispose` is load-bearing here, not cleanup.** A run that is never disposed
     * costs a rebuild for the next one; that is the only penalty, and it is why
     * `simulate` calls it in a `finally`.
     */
    createRun() {
      const engine = idle.pop() ?? buildEngine();

      // What this run has changed, and what each cell held before it did. The first
      // sighting of a cell is the authored one, so later writes to it are ignored.
      const touched = new Map();
      let disposed = false;

      function remember(address) {
        const key = `${address.sheet}:${address.row}:${address.col}`;
        if (!touched.has(key)) {
          touched.set(key, [address, engine.getCellSerialized(address)]);
        }
      }

      return {
        id: randomUUID(),

        /**
         * Read named ranges. Timelines come back as arrays, single cells as scalars.
         */
        read(names) {
          return Object.fromEntries(
            names.map((name) => {
              const { shape, sheet } = resolve(engine, name);

              // Single Cell
              if (shape.cols === 1) {
                return [
                  name,
                  engine.getCellValue({
                    sheet,
                    row: shape.row,
                    col: shape.col,
                  }),
                ];
              }

              // Named Range (destructure, to match type)
              const [timeline] = engine.getRangeValues({
                start: { sheet, row: shape.row, col: shape.col },
                end: { sheet, row: shape.row, col: shape.col + shape.cols - 1 },
              });
              return [name, timeline];
            })
          );
        },

        /**
         * Write any number of named ranges at a given step in one call, mixing timelines and single
         * cells freely.
         */
        write(step, updates) {
          if (!Number.isInteger(step) || step < 0) {
            throw new Error(
              `write(step, updates): step must be a non-negative integer, received: ${step}`
            );
          }

          // Vet every name and value before changing anything, so a bad update
          // leaves the run untouched instead of half-written.
          const writes = Object.entries(updates).map(([name, value]) => {
            assertWritable(name, value);
            return [cellFor(engine, name, step), value];
          });

          // After the vetting pass, so a rejected update records nothing either.
          for (const [address] of writes) remember(address);

          engine.batch(() => {
            for (const [address, value] of writes)
              engine.setCellContents(address, value);
          });
          return updates;
        },

        /**
         * Advance the model one step by incrementing the `Step` named range, mimicking Epicenters behavior
         */
        step() {
          if (!schema.has("Step")) {
            throw new Error(
              `${workbook.modelFile} has no 'Step' named range, so it cannot be stepped.`
            );
          }

          const address = cellFor(engine, "Step", 0);
          remember(address);
          const next = Number(engine.getCellValue(address)) + 1;
          engine.setCellContents(address, next);
          return next;
        },

        /**
         * Rewind the engine to the workbook's authored state and hand it back.
         *
         * Building an engine is 87% of a run's cost, so a sample that rebuilt one per
         * run spent almost all its time reconstructing a workbook that never changed.
         * Putting back the cells this run wrote is the same state for a fraction of
         * the work: `getCellSerialized` returns the formula or literal the cell was
         * built from, so restoring it is handing `buildFromSheets` its own input back.
         * One `batch` for the lot, so the model recalculates once rather than per cell.
         *
         * A failed restore leaves an engine nobody can trust, so it is dropped rather
         * than pooled — the cost of that is a rebuild, and the cost of the alternative
         * is every later run being quietly wrong.
         */
        dispose() {
          if (disposed) return;
          disposed = true;

          try {
            engine.batch(() => {
              for (const [address, content] of touched.values()) {
                engine.setCellContents(address, content);
              }
            });
          } catch {
            return;
          }
          // A sample only ever needs one. The cap is so a burst of concurrent runs
          // cannot pin half a gigabyte each for the life of the process.
          if (idle.length < IDLE_LIMIT) idle.push(engine);
        },
      };
    },
  };
}
