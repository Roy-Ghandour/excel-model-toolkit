import { randomUUID } from "node:crypto";
import { HyperFormula } from "hyperformula";
import { readWorkbook } from "./workbook.js";
import { assertWritable } from "../common.js";

/**
 * Drive an Excel model entirely in this process, on the local machine.
 */

/**
 * Engine configuration. Both fields are load-bearing.
 *
 * `licenseKey: 'gpl-v3'` selects HyperFormula's open-source licence, as the library
 * requires an explicit choice. This is the only free choice and requires the programme be open source
 */
const ENGINE_OPTIONS = { licenseKey: "gpl-v3", smartRounding: false };

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

  /** Build a fresh engine at the workbook's authored state. */
  function buildEngine() {
    const engine = HyperFormula.buildFromSheets(
      workbook.sheets,
      ENGINE_OPTIONS
    );
    // Feed the engine the named ranges from the sheet
    for (const [name, { range }] of workbook.names) {
      engine.addNamedExpression(name, `=${range}`);
    }
    return engine;
  }

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
     * Create a fresh run: a new engine at Step 0.
     *
     * The returned run owns its engine outright. Nothing here refers to it, so the
     * run's lifetime is exactly as long as the caller keeps a reference.
     */
    createRun() {
      const engine = buildEngine();

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
          const next = Number(engine.getCellValue(address)) + 1;
          engine.setCellContents(address, next);
          return next;
        },
      };
    },
  };
}
