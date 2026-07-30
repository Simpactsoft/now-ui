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

## Update 2026-07-28 — the grid delta is closed, and the design landed in the package

Two things happened in one pass, in `@nowui/kit` **v0.2.0**:

1. **`pinned?: "start"` is ported** (consolidation step 1 below). The 83-line
   frozen-columns delta no longer exists — the package renders it, and SKYZ's
   copy of `MicroGrid.tsx` and `types.ts` is now byte-identical to the package
   apart from the six host seams (`next/link`, `@/lib/utils`, its own
   `translations` and `APPEARANCE_DENSITY_EVENT`). Verify with:

   ```
   diff now-ui/src/grid/MicroGrid.tsx skyz-crm/src/components/microgrid/MicroGrid.tsx
   ```

   Anything in that diff beyond the seams is new drift.

2. **The Skyz grid design (`GRID_AND_FILTERS.md` §1–§4, §10–§11) is now the
   grid's own default**, in the component rather than in a host stylesheet.
   It had been an opt-in `.mg-card` skin in SKYZ's `globals.css`; that skin and
   the `background-image` re-layering hack that went with it are deleted. Both
   are described in README → "What the host does NOT own: the grid's look".

   This changes NOW's grid appearance — that is the point, but it is worth
   naming: header no longer uppercase/letter-spaced and now sits on a sunken
   band at 28px; rows are 30/36/42px rather than 32/40/56; body cells default to
   middle alignment; empty cells render `—`; the checkbox is 15px.

Steps 2 and 3 below (the three SKYZ-only components, then pointing SKYZ at the
package) are still open. But the file that was drifting is no longer drifting.

## Status

| | consumes `@nowui/kit`? |
|---|---|
| NOW | ✅ since 2026-07-27 — merged to `main`, live on `dev.nowview.io`. Not on `release`/production. |
| SKYZ | ✅ since 2026-07-29 — grid **and** panels, on `feat/grid-design-and-app-shell`. |

Vercel builds it fine: the tag archive URL installs remotely with no auth, no
SSH and no build configuration (`added 23 packages ... in 2s`), and the full
Next build completed in 1m.

NOW's local copies are gone. `components/microgrid/index.ts`,
`entity-view/DraggablePanels.tsx` and `entity-view/grid-column-shapes.ts` are
now one-line re-exports, so all ~40 consuming modules stayed untouched — the
whole wiring is 3 shims + 1 provider + 2 config lines.

**There is no fork left.** SKYZ's `components/microgrid/index.ts` and
`entity-view/DraggablePanels.tsx` are one-line re-exports too, with two host
providers (`MicroGridHost`, `PanelsHost`) in its root layout. 7,052 duplicated
lines are gone from that repo — 4,279 of grid, 2,773 of panels.

## Consolidation plan

All four steps are done. Kept as a record of what moved and why.

1. ~~Port `pinned?: "start"` and its `MicroGrid.tsx` rendering into
   `@nowui/kit/grid`.~~ **Done 2026-07-28, v0.2.0.** All 85 existing tests
   stayed green; 11 more were added for the pinned group and the design rules.
2. ~~Decide where the three SKYZ-only components belong.~~ **Done 2026-07-29,
   v0.3.0.** All three moved in — `CardGrid`, `ColumnChooser` (with
   `useColumnArrangement`) and `ColumnFilter`. None had a competing NOW
   implementation, so again a port rather than a reconciliation, and no new
   dependency: `@radix-ui/react-popover` and `lucide-react` were already peers.

   The one real piece of work was language. All three were written straight
   into Hebrew — 30-odd literals between them, several interpolated. They now
   read every string from `MicroGridLabels`, which grew from 3 entries to 34
   and ships `he` and `en` sets. Interpolating strings are **functions**, not
   `{n}` templates: a placeholder cannot be moved for a language that puts the
   number somewhere else, and `filterSelectedNote` has to pick a different word
   at n=1 in both languages.

3. ~~Point SKYZ at the package and delete its local copy.~~ **Done 2026-07-29,
   `skyz-crm@4308896`.** 4,279 vendored lines deleted. All seven consuming
   modules were left alone: they import `@/components/microgrid`, which is now
   a single `export *`, plus a `MicroGridHost` provider in the root layout.

   Two host requirements fail **silently** and cost a debugging session each:
   `transpilePackages: ["@nowui/kit"]` (the package ships `.tsx`, and `tsc`
   passes either way) and the `@source` line for Tailwind (no CSS ships, so
   without it every grid renders unstyled with no error). Both are in the README
   under "Wiring the grid into a host app"; check them first when a host looks
   broken.

4. ~~Panels.~~ **Done 2026-07-29, `skyz-crm@562e446`.** Not in the original
   plan — `DraggablePanels.tsx` was byte-identical when this report was written,
   so it looked like it could wait. It could not: the diff had grown to 47 lines,
   all host seams, and every panel fix made on NOW's side was still stranded.
   SKYZ supplies them through a `PanelsHost` provider, including
   `usePanelLayoutDB` for the persistence seam — which is the whole hook, not a
   load/save pair, so presets and debounced saves crossed over untouched.

5. **The fork is closed.** NOW and SKYZ render the same grid *and the same
   panels* from the same source. From here a change is one PR, and the next
   consumer wires a handful of config values instead of copying a directory.

## Why this was worth doing now

`DraggablePanels.tsx` is 2,773 lines duplicated byte-for-byte across two repos.
NOW's `CLAUDE.md` rules 16 and 17 exist because of real panel bugs that were
found and fixed — none of those fixes can reach SKYZ while the file is a copy.
The grid has already begun to diverge. 83 lines is a cheap merge; 830 would not
be.


---

## 2026-07-30 — v0.4.0: the browse envelope moves in

The drift this file was written to track is closed for the grid, and a new surface
joined the package rather than being built twice.

`BrowseShell` + `FacetPanel` were built in `skyz-crm` first (the filter work), then
moved here. What moved and what deliberately did not:

| Moved into `@nowui/kit/grid` | Stayed in the host app |
|---|---|
| The `--card` envelope and its band order | Facet loading (the SQL, the counts) |
| The add-filter drawer | Saved-view persistence |
| The facet panel — values / date / presence | The bulk-action wiring |
| The four inline quick-date chips | What a "city" or an "owner" IS |
| The chips and "clear all" | |

`FacetField` is the seam: a description of a control plus its callbacks. The package
never learns a field's meaning, so nothing app-specific leaked in.

Both consumers are on v0.4.0. NOW gets the browse surface for free the next time it
bumps — it has never had one.

Labels: `MicroGridLabels` gained the nine date presets, the presence triple and the
shell chrome, in HE and EN. Nothing in the new components is hardcoded Hebrew.
