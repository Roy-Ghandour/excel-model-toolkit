# The test suite

```bash
bun test              # 22 tests, ~1.5s, entirely offline
```

Everything here runs against the local driver. Nothing in `bun test` touches the
network, needs a Forio account, or needs an internet connection. One file —
`record-golden.js` — does talk to Forio, and it is never run by `bun test`.

## It stands alone

`test/` imports **three things** from the rest of the project: `localDriver.js`,
`workbook.js`, and (for recording only) `forioDriver.js`. Those are the code under
test. Everything else it needs it owns: its own copy of the model file, its own
constants, its own copy of the record/replay loop.

That is deliberate. This project is days old and the scaffolding around the drivers
— `src/config.js`, `src/tools/execute.js`, where the model file lives — is
temporary and will be rearranged repeatedly. When that happens the suite should
either keep working or fail for a real reason, never because a constant moved or a
temporary module was deleted. Deleting `test/` removes the harness entirely and
leaves `src/` untouched; the reverse should stay true too.

**So: no test may import from `src/` except a driver.** If a test needs a value,
it goes in `model.js`.

## The three questions it answers

**1. Is the maths right?** — `excel-oracle.test.js`
We recalculate the whole workbook ourselves and compare against the numbers
Microsoft Excel last computed for it. Excel is the authority, so this says our
engine is *right*, not merely consistent with someone else's emulator.

**2. Is the driver right?** — `forio-conformance.test.js`
Being right about arithmetic is not enough: we also have to write to the same cell
Forio would, and step the model the way Forio does. So we recorded one real
Epicenter run and replay it offline, demanding identical numbers at every step.

**3. Does the driver keep its own promises?** — `local-driver.test.js`, `workbook.test.js`
The first two questions are answered against `test.xlsx`, a six-range savings model.
The properties that must hold for *any* model on *any* day — runs not leaking into
one another, a bad decision being refused rather than written, a range on another
sheet resolving correctly — are pinned directly.

## The files

| File | Runs in `bun test` | What it proves |
| --- | --- | --- |
| `excel-oracle.test.js` | yes | our engine agrees with Excel itself |
| `forio-conformance.test.js` | yes | the driver reproduces a real Epicenter run |
| `local-driver.test.js` | yes | the driver's own contract |
| `workbook.test.js` | yes | the `.xlsx` parser reads what is there, and refuses what it can't represent |
| `model.js` | helper | every constant the suite needs, in one place |
| `fixtures.js` | helper | builds small purpose-made `.xlsx` files at run time |
| `record-golden.js` | **no — network** | records the Epicenter run the replay uses |
| `model/test.xlsx` | data | the model under test |
| `golden/*.trace.json` | data | the recording |

**`excel-oracle.test.js`** — every formula cell in an `.xlsx` carries the value Excel
last computed for it, which makes the model file its own answer key. We rebuild the
workbook from scratch and check every one of `test.xlsx`'s 13 formula cells matches
Excel's number *exactly* — same double, no tolerance. Its second test is not about
our code at all: it shows that turning HyperFormula's `smartRounding` on visibly
corrupts the compounding chain, which is the reason the driver turns it off.

**`forio-conformance.test.js`** — replays the recorded run: write, step, read, twelve
times over, comparing every value. This is the only evidence that our cell
addressing and step semantics match production, and the only thing standing between
a change to the driver and a sample full of numbers that look plausible and are
wrong.

**`local-driver.test.js`** — thirteen properties of the driver, stated directly:
what `schema` reports, that a write lands in the column for that step (and that a
single-cell range ignores the step rather than sliding sideways), that two runs
cannot see each other, that batching a write is equivalent to writing one at a
time in any order, that non-numbers and bad steps are refused, that a rejected
value leaves the whole batch undone, that stepping works — and that ranges spread
across several sheets resolve correctly, which `test.xlsx` cannot show.

**`workbook.test.js`** — the parser is upstream of every number the tool produces.
This checks it finds each named range at the right sheet, row, column and shape
(including columns past Z and 2-D blocks), records each formula cell with Excel's
cached result, strips the `_xlfn.` prefix Excel puts on modern functions, survives a
sheet with no cells, and refuses a name covering two separate ranges instead of
guessing.

**`model.js`** — the model's path and name, how many steps its timeline has, which
ranges the trace records, and the Forio project it was recorded from. One place to
change when the model changes.

## Fixtures

`test.xlsx` is one sheet with six named ranges. The cases that matter most for
`AIGovModel.xlsx` — several sheets, a 2-D range, a missing `Step`, a modern
function — simply do not occur in it.

So `fixtures.js` builds small workbooks at run time and writes them to a temp
directory that is deleted when the test file finishes. They are real `.xlsx` files
read by the real parser; nothing is stubbed. The point is that you can read what is
in a fixture next to the assertion about it, instead of opening a binary.

## Changing the model

`test/model/test.xlsx` is the suite's own copy, and the one the golden trace was
recorded against. It matches `models/test.xlsx` except that `models/test.xlsx`
also carries the `ModelKitID` named range, which no test reads. Keeping the two
in sync is manual, and only matters when the model itself is edited.

If you do edit the model, the trace stops describing it, and every value in it has
to be earned again:

```bash
# 1. upload the new model to the Forio project (manual, via the Epicenter UI)
# 2. copy it over both test/model/test.xlsx and models/test.xlsx
bun run record-golden     # 3. talks to Forio, overwrites golden/test.xlsx.trace.json
bun test                  # 4. everything should pass again
```

Upload **before** recording, or the recording describes a different model from the
one the tests replay it against. The trace stores which model file, account and
project it came from, and the replay refuses to run if the model file no longer
matches.

## What is deliberately not tested

Stated plainly so nobody mistakes silence for coverage.

- **Anything against live Forio.** The Forio driver has no tests; it is exercised
  only by `record-golden.js`, by hand. Everything we know about its behaviour is
  frozen in the trace.
- **Array formulas spanning several cells** are refused at load time, not supported.
  Single-cell ones (how modern Excel saves ordinary formulas) load as plain formulas.
- **Named ranges HyperFormula refuses** (shaped like a cell address, e.g. `EcPro7`)
  are not registered with the engine; read and write still reach them. A formula
  that mentions one fails the load.
- **Matching Forio's rounding.** `excelFunctions.js` (`ROUND`) and the driver's
  `smartRounding` handling were checked by hand against a live Forio run of
  `rounding.xlsx`, not by the suite.
- **The "shared formula ExcelJS could not resolve" branch** in `workbook.js`. ExcelJS
  writes the formula into every cell of a shared group, so the branch does not
  appear to be reachable — it is a guard against a case we could not construct.
- **Writing over a formula cell.** Nothing stops a caller writing to `Balance` and
  destroying the formula in it. That is the decision policy's job to avoid.
- **Stepping past the end of the timeline.** Not prevented — there is a test that
  documents it. In practice a run that overruns is caught by `write`, which refuses
  a step past a timeline's last column; only a run writing single cells alone could
  step off the end unnoticed. A sample will want its own bound.
- **Dates.** HyperFormula turns a date cell into a serial number in the local
  timezone, so two machines could read one differently. Harmless as long as dates
  are only ever stored and displayed, which is the case today — the tool is
  concerned with numbers. It would stop being harmless the day a date feeds a
  calculation.
