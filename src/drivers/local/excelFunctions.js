import { HyperFormula } from "hyperformula";

/**
 * Forio's behaviour, for the built-in functions where HyperFormula's differs.
 *
 * Forio computes as Excel does, and Excel deliberately looks at a number the way it
 * displays it — 15 significant digits — in places where HyperFormula uses the raw
 * double. Each function here reproduces one of those, and exists because a probe
 * against Forio showed the difference (`rounding.xlsx`). Add the next the same way,
 * not speculatively.
 *
 * Registration is global to HyperFormula, so it happens once, on import, and every
 * engine in the process gets it.
 */

/** Excel displays, and in places rounds, numbers at 15 significant digits. */
const EXCEL_DIGITS = 15;

/** Move a number's decimal point `places` to the right, exactly, via its decimal text. */
function shift(value, places) {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Number(`${mantissa}e${Number(exponent) + places}`);
}

/**
 * `ROUND` as Forio and Excel do it: on the number as displayed, half away from zero.
 *
 * A sum stored as 44.449999999999996 displays as 44.45, so Forio rounds it to one
 * place as 44.5 where HyperFormula, rounding the raw double, gives 44.4. Shifting
 * through the decimal text rather than multiplying keeps `ROUND(1.005, 2)` at
 * 1.01. A fractional `places` is truncated.
 */
function excelRound(number, places) {
  const digits = Math.trunc(places);
  const shown = Number(Math.abs(number).toPrecision(EXCEL_DIGITS));
  const rounded = shift(Math.round(shift(shown, digits)), -digits);
  // `0 - rounded`, not `-rounded`, so `ROUND(-0.4, 0)` is 0 rather than -0.
  return number < 0 ? 0 - rounded : rounded;
}

const RoundingPlugin = HyperFormula.getFunctionPlugin("ROUND");

class ExcelRoundingPlugin extends RoundingPlugin {
  round(ast, state) {
    return this.runFunction(ast.args, state, this.metadata("ROUND"), excelRound);
  }
}

HyperFormula.unregisterFunction("ROUND");
HyperFormula.registerFunction("ROUND", ExcelRoundingPlugin);
