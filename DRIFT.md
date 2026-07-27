# Drift report — NOW vs SKYZ, as of 2026-07-27

Snapshot taken before any consolidation. `@nowui/kit/grid` v0.1.0 was extracted
from **NOW's** copy. This file records exactly what SKYZ has that the package
does not, so folding it in later is a known, bounded job rather than an
archaeology project.

**Nothing in `skyz-crm` was modified to produce this report.** A parallel
session ("סקיי 2") owns that repo — it is working on queries/projection and
linked-document display, and it touched the grid as recently as 2026-07-23.

## Summary

| File | NOW | SKYZ | Verdict |
|---|---|---|---|
| `DraggablePanels.tsx` | 2,773 | 2,773 | **byte-identical** |
| `bucketRows.ts` | 60 | 60 | identical |
| `responsiveGroups.ts` | 93 | 93 | identical |
| `columnAdapter.tsx` | 530 | 530 | identical |
| `MicroGrid.tsx` | 2,154 | 2,223 | +83 / −14 — one feature |
| `types.ts` | 211 | 223 | +12 — one field |
| `index.ts` | 29 | 32 | +3 — three re-exports |
| `CardGrid.tsx` | — | 127 | SKYZ only |
| `ColumnChooser.tsx` | — | 296 | SKYZ only |
| `ColumnFilter.tsx` | — | 167 | SKYZ only |

## The drift is one feature, and it is additive

Every one of the 83 added lines in `MicroGrid.tsx` belongs to **frozen /
pinned columns** — sticky leading-edge columns that survive horizontal scroll.
The SKYZ author already documented it as an intentional, backward-compatible
extension:

```
pinned?: "start";
```

> "absent `pinned` ⇒ rendering is unchanged."

That is the good case. It means the merge is a port, not a reconciliation:
there is no competing implementation in NOW to argue with, and no NOW consumer
whose behaviour changes when the field lands.

## The blocker

**Neither app consumes the package yet.** It has no git remote, and a `file:`
path cannot work — Vercel builds remotely from the git repo and the local path
does not exist on the build machine.

Until the repo is published and NOW is wired to it, `@nowui/kit` is a *third*
copy of both components, and it will drift from NOW exactly the way SKYZ did.
Publishing is the highest-value next action, not more extraction.

Wiring NOW is deliberately cheap: keep `components/microgrid/index.ts` and
`entity-view/DraggablePanels.tsx` as one-line shims re-exporting from the
package, and all 40 consuming files stay untouched. Eight files also import
`entity-view/grid-column-shapes` directly, so that needs a shim too.

## Consolidation plan

Coordinate with the סקיי 2 session before starting — steps 1 and 2 touch files
it has open.

1. Port `pinned?: "start"` and its `MicroGrid.tsx` rendering into
   `@nowui/kit/grid`. Pure addition; existing tests must stay green untouched.
2. Decide where the three SKYZ-only components belong:
   - `ColumnChooser.tsx` (296) — column arrange/show-hide. Almost certainly
     shared; NOW has an equivalent need in ערכת תצוגה.
   - `ColumnFilter.tsx` (167) — likely shared.
   - `CardGrid.tsx` (127) — check against NOW's card view first; there may
     already be an overlapping implementation.
3. Point SKYZ at the package and delete its local copy.
4. Only then is the fork closed.

## Why this was worth doing now

`DraggablePanels.tsx` is 2,773 lines duplicated byte-for-byte across two repos.
NOW's `CLAUDE.md` rules 16 and 17 exist because of real panel bugs that were
found and fixed — none of those fixes can reach SKYZ while the file is a copy.
The grid has already begun to diverge. 83 lines is a cheap merge; 830 would not
be.
