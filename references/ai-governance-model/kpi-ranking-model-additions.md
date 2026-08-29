# KPI Ranking — Model Additions Needed for Pass 2

This document lists the model-side and run-metadata changes required to make the
new Ministry / Government KPI Ranking flow fully functional. Pass 1 ships the
UI only, with hardcoded example data and a local-only section-to-section gate.
Pass 2 — described here — is where the model/spreadsheet and/or
`epicenter-libs` run metadata shape must change.

## Why two sections exist

- **Ministry KPI Ranking (section 1):** every minister (PM included) submits
  their own personal ranking of the six AI values. Each minister drags their
  own independent list.
- **Government KPI Ranking (section 2):** only the Prime Minister edits. All
  ministers see the PM's ranking on the left and a table of every minister's
  personal (section-1) ranking on the right, bucketed into `Low` / `Medium` /
  `High`.

Section 2 reveals for a player only after that player has locked in their own
section 1.

## What pass 1 cannot do with today's model

Today's values storage is a single shared vector:

| Variable | Shape | Used by |
|---|---|---|
| `Value1Position` … `Value6Position` | 6 scalars (1..6) | Shared across every player; read/written by `ValuesOrdering` (`src/components/mui/values-ordering.jsx`). |
| `ValuesConfirmed` | scalar `0 | 1` | Single global "values have been locked in" flag. |

Consequences in pass 1:

1. Every minister who drags section 1 overwrites the same six scalars. The
   drag-and-drop is per-player in intent but global in storage — the last
   player to drag wins.
2. The ministers' votes table in section 2 is hardcoded in
   [src/pages/player/welcome/components/ministers-kpi-table.jsx](src/pages/player/welcome/components/ministers-kpi-table.jsx)
   (`EXAMPLE_MINISTER_VOTES`). It reflects neither real rankings nor the
   active roles.
3. The section-1 → section-2 reveal is local React state
   (`ministryConfirmed` in `welcome.jsx`). A page refresh re-locks section 2.

## Model / metadata additions required for pass 2

### 1. Per-minister personal rankings

**Recommended shape — run metadata** (mirrors the existing `editorMinistry1`
metadata pattern at [src/pages/player/decisions/economy/economy.jsx:75](src/pages/player/decisions/economy/economy.jsx#L75)):

```
run.metadata.ministryRankings = {
    // roleIdx (0..4) → array of 6 positions indexed by valueId-1
    // example: minister 0 ranks Value1 3rd, Value2 1st, …
    0: [3, 1, 4, 6, 2, 5],
    1: [...],
    2: [...],
    3: [...],
    4: [...]
}
```

Why metadata rather than new model scalars:
- No schema change to the spreadsheet model.
- `runAdapter.updateMetadata` already used in this codebase for per-player data.
- Scales to any future `{ minister: data }` shapes without more model vars.

**Alternative — model-native scalars:** 30 new scalars
`MinisterValuePos_<roleIdx>_<valueIdx>` (5 × 6). Only choose this if the
spreadsheet simulation itself needs to consume per-minister rankings as inputs
(which is not required by the UI).

### 2. Per-minister "section 1 confirmed" flag

Required so each minister's section 2 reveal survives reloads and so the
facilitator can see who has voted.

**Recommended shape — run metadata:**

```
run.metadata.ministryConfirmed = {
    0: true,   // PM has locked their personal ranking
    1: false,  // Minister of Economy has not
    ...
}
```

Pass 2 wires `welcome.jsx` to read `ministryConfirmed[myRoleIdx]` instead of
the current local `useState` flag, and writes the flag via `setMetadata` when
the player submits section 1.

### 3. Rename `ValuesConfirmed` (optional but recommended)

`ValuesConfirmed` now exclusively means "the PM has finalized the *government*
ranking." Consider renaming to `GovernmentValuesConfirmed` for clarity. This
is a pure rename touching:

- `model/` spreadsheet cells
- `welcome.jsx` (currently line ~82 in this branch)
- `government-kpi-ranking.jsx` (`onConfirm` body in the welcome page)
- Any selector or action referencing it

If rename is too disruptive, leaving the existing name is fine — functionality
is unchanged.

### 4. Section 2's drag-and-drop

No change needed. Section 2 continues to write the existing
`Value*Position` scalars. The PM's government-level ranking is the shared
ranking that the rest of the simulation reads — same as today.

## Derivation logic (front-end only, no model work)

Low / Medium / High in the ministers-votes table is derived from each
minister's rank for that value:

| Rank position | Bucket |
|---|---|
| 1–2 | High |
| 3–4 | Medium |
| 5–6 | Low |

This mapping lives in the front-end alone. Once `ministryRankings` is
available (item 1 above), the table component's `ministers` prop becomes a
selector-derived array:

```js
const ministers = useSelector(selectMinistryRankingsAsTableRows);
// Each entry: { roleName, votes: { '1': 'High', '2': 'Low', ... } }
```

The table component (`ministers-kpi-table.jsx`) needs no internal changes —
just a real `ministers` prop instead of the hardcoded `EXAMPLE_MINISTER_VOTES`.

## Touchpoints in the pass-1 codebase

| File | Pass-2 change |
|---|---|
| [src/pages/player/welcome/welcome.jsx](src/pages/player/welcome/welcome.jsx) | Replace `useState(false)` gate with `metadata.ministryConfirmed[myRoleIdx]`; wire `setMetadata` on ministry submit. |
| [src/pages/player/welcome/components/ministry-kpi-ranking.jsx](src/pages/player/welcome/components/ministry-kpi-ranking.jsx) | Feed `ValuesOrdering` per-minister data and write back into `metadata.ministryRankings[myRoleIdx]` instead of shared `Value*Position`. |
| [src/pages/player/welcome/components/government-kpi-ranking.jsx](src/pages/player/welcome/components/government-kpi-ranking.jsx) | Drop the `EXAMPLE_MINISTER_VOTES` import; pull `ministers` from a selector. |
| [src/pages/player/welcome/components/ministers-kpi-table.jsx](src/pages/player/welcome/components/ministers-kpi-table.jsx) | Table internals unchanged. Remove `EXAMPLE_MINISTER_VOTES` once selector is live. |
| New selector (e.g. `src/selectors/ministry-rankings-selectors.js`) | Combines roles from `RoleUser0..4` with `ministryRankings` metadata and applies the rank → LMH bucket mapping. |

## Out of scope for pass 2 (listed so we don't rescope by accident)

- Facilitator-side dashboard of per-minister rankings
- Any visual polish on the LMH cells (chips, color coding, tooltips)
- Preventing non-PMs from attempting to drag in section 2 via server-side
  enforcement (UI already hides the controls)
