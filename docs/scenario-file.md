# The scenario file

A **scenario file** describes the conditions a run happens under, without the
run. It is what you hand to a tool that *generates* decisions rather than
replaying them — [`sample`](../src/tools/sample.js) and
[`sweep`](../src/tools/sweep.js) today.

**A scenario is exactly a [run file](runFile/run-file.md) minus `steps`.** Same
`modelkit` version, same `simulation`, same exhaustive `settings`, same
`stepCount`. That is the whole definition, and it is deliberate: a generator is
handed everything a run declares except the decisions, which are the thing it is
about to invent.

```json
{
  "modelkit": 1,
  "simulation": "aigov",
  "stepCount": 6,
  "settings": {
    "NumYears": 5,
    "EcEnabled": 1
  }
}
```

`[runs/aigov.scenario.json](../runs/aigov.scenario.json)` is the real one, with
all sixteen AI-Gov settings.

## Fields

| Field        | Required | Type    | Meaning                                                           |
| ------------ | -------- | ------- | ----------------------------------------------------------------- |
| `modelkit`   | **yes**  | integer | Format version. Shared with the run file, currently `1`.          |
| `simulation` | **yes**  | string  | Which simulation this is a scenario for. Must match the model.    |
| `stepCount`  | **yes**  | integer | How many steps each generated run has.                            |
| `settings`   | **yes**  | object  | Named ranges written once, before stepping. Exhaustive.           |

Unknown top-level keys pass through untouched, exactly as in a run file, so a
future tool can carry its own section here without a format bump.

## Why `stepCount` lives here

Because for some simulations the length is not independent of the settings. AI-Gov
enforces `NumYears + 1 === stepCount` at step 0, so a `--steps` flag beside a
settings file is two halves of one fact — typed twice, and reconciled by hand
every time. Worse, the mismatch only surfaced *after* the workbook was parsed,
since only `checkStep` can see it.

One file cannot contradict itself in that way. There is no `--steps` override,
because an override would reinstate precisely the inconsistency this removes.

## Why `simulation` is required

The model already declares its own simulation in its `ModelKitID` named range, so
this looks redundant. It is not, for two reasons.

It makes a scenario the exact shape [`preflight`](../src/core/simulation.js)
takes, so every tool gets the model match, the ruleset lookup and
`assertDeclaration` from one call instead of keeping a local copy of two of the
three. Requiring the field deleted code rather than adding any.

And it means a scenario pointed at the wrong model is refused by name — *a run of
'savings' cannot be driven against AIGovModel.xlsx, which implements 'aigov'* —
rather than surfacing later as a baffling list of missing settings.

## Validation

Three layers, the same shape as the [run file's](runFile/run-file.md#validation)
and sharing its code:

1. **Structure** — [`validate`](../src/core/scenario.js). Fields present and the
   right type; every value in `settings` a finite number.
2. **Declaration** — [`assertDeclaration`](../src/core/runFile.js), via
   `preflight`. `stepCount` within the simulation's `minSteps`..`maxSteps`, and
   `settings` matching its declared list exactly — every missing and unexpected
   name reported at once.
3. **Legality** — the simulation's `checkStep`, once runs are being driven. This
   is where a `stepCount` that contradicts its own settings is caught, because
   only the model knows.

Layers 1 and 2 need no model run, so an incoherent scenario is refused before
anything is driven.
