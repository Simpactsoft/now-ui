# Reconciling the MicroGrid design addendum — 2026-07-28

The addendum (`ADDENDUM_microgrid_states.md`, Claude Design, in the Skyz handoff package) reviews
**NOW's** spec — `now/docs/microgrid-design.md` — not the Skyz card handoff. Its section numbers
(§4.6, §5.2, §7…) and bucket names (A/B/C) are that document's.

That matters, because the spec it reviews predates the package. `@nowui/kit/grid` shipped in
2026-07, and the shipped code has already resolved some of what the addendum raises — differently
in one case, and better. So this is not a to-do list to execute top to bottom. Below, each item is
checked against **the spec, the shipped code, and the two consuming apps**, and lands in one of:
*already resolved* · *adopt* · *decide* · *stage*.

Nothing here is implemented yet.

---

## A — the sort contradiction · VERIFIED, and already resolved in code

The addendum is right, and I confirmed both halves in the spec:

- §4.6: *"All sort is client-side. If a host needs server-side sort, it should use EntityAgGrid."*
- §1: sort already lives in `useEntityView`, server-side, and the grid renders a page it is given.
- §10 Phase 5: deletes `EntityAgGrid.tsx` outright.

So §4.6 forwards a requirement to a component the same document removes.

**But the shipped package already does the right thing.** `MicroGridProps.sort` is host-owned state,
`onSortChange` is marked deprecated, and the header renders no sort control — "MicroGrid renders
rows in the order it receives them". SKYZ's `CardGrid` adds in-memory sort as a *host wrapper*,
which is exactly the split the addendum proposes.

**Action: spec text only.** Delete the two EntityAgGrid sentences from §4.6 and §2. Do **not** add
`defaultSort` — `CardGrid` shows a 40-line host wrapper already covers it, and an in-grid sort mode
would put two sources of truth back into the component this package exists to keep small.

## B — `MicroCellState` · the real gap · STAGE (this is the work)

The centrepiece, and it is correct. A cell's public API today is binary: `edit` present or absent.
The EAV engine answers with far more than that, and I hit this personally today building on it:

- the create-from-query form hand-rolls its own refusal copy and destructive styling;
- the card's sale-documents panel hand-rolls `🔒` for locked rows and `—` for engine-allocated
  values that cannot be typed;
- the card header hand-rolls the dashed `ƒ` derived treatment.

Three surfaces, three local re-inventions of the same eleven states — precisely the duplication the
spec's Bucket A exists to end.

The changed commit signature is the other half and is right to be part of the same change:

```ts
onCellChange?: (rowId, columnId, next) =>
  void | Promise<true | { error: string } | { refused: string }>
```

`error` (local validation — typed value stays, user fixes it) and `refused` (the engine said no —
value reverts, reason persists) are genuinely different outcomes, and today they collapse into one
string return.

**Action: stage it as its own minor version.** Additive on `MicroColumn`; the `onCellChange` return
widens, so existing `string` returns must keep meaning `error`.

## C — the destructive default · VERIFIED · ADOPT (cheap, do first)

Confirmed in the shipped component: `InlineConfirm` hardcodes **"בטל / מחק"** and row actions
default to a destructive variant with that built-in confirm. SKYZ has no delete at all — the
equivalents are *freeze* (a status change) and *detach* (removing a link, not a record). A grid that
ships the word "מחק" invites a host to promise something the engine will refuse.

**Action: `confirmLabel` required when `variant: 'destructive'`; remove the built-in wording and the
default trash icon; the confirm tone becomes `--warning`, not `--destructive`, because these actions
are reversible.**

## D — two edit models for one component · DECIDE · agree with the addendum

§4.3 (click a cell → edit that cell) versus §7 (tap a row → stacked form of every editable field).
The addendum recommends single-cell in both, and that is right: a stacked row form needs row-level
state, cross-field validation and save/cancel — that is `EntityForm`, not a grid. It also matches
what the package already does on mobile.

**Action: spec text only.** Update §7.

## E — the missing third layout · REAL · STAGE (after B)

The package has three tiers already (mobile cards, medium grouped table, wide table) — but they key
off **viewport width**. Inside a draggable panel the real constraint is the *panel's* width and the
row count, which is why a 400px-wide panel and a 900px-wide panel on the same card currently make
the same layout decision.

The addendum's `span`+row-count matrix and a `layout` prop with explicit pinning is the right shape.
Note the prerequisite: the panel-width signal has to reach the grid. SKYZ's card already measures it
(`usePanelWidth`); the grid does not receive it.

**Action: stage after B.** Pinning must be visible in the UI ("auto · grid" vs "pinned"), not only
in code — an invisible mode that stops responding to resize reads as a bug.

## F — the generic empty state · VERIFIED · ADOPT

`DefaultEmpty` renders "אין שורות להצגה" and nothing else. That cannot distinguish *no data* from
*a filter is hiding everything* from *the engine did not answer* — and I shipped the third case
today in the search bar precisely because the difference matters: "no results" when the query never
ran sends the user to reword a fine query.

**Action: build the sibling `GridEmpty` the addendum proposes (`reason` / `count` / `action`), keep
the default only for sub-tables inside a form, and document `emptyState` as required for primary
grids.** It cannot be enforced in the type system without splitting the props union; a documented
requirement plus the sibling component is the honest version.

## G — the keyboard boundary · REAL, and currently true only by luck · ADOPT

Traced end to end. `CellEditor` handles `Escape` on the cell's own `onKeyDown` and calls
`preventDefault()` but **not** `stopPropagation()`. SKYZ's `KeyboardLayer` listens for `Escape` at
the document level, before its own in-field guard.

So today an Escape that cancels a cell edit *also* reaches the shell. It is harmless right now only
because the shell's Escape merely closes its own help sheet. The moment the shell's Escape does
something real — close the card, exit a mode — cancelling an edit will do both.

**Action: MicroGrid stops propagation for keys it consumed.** That turns the ordering from an
accident into the contract the addendum asks for. Cheap, and it should land before anyone adds a
shell-level Escape.

## H — the state matrix in the sandbox · ADOPT, alongside B

13 cell states × RTL/LTR × light/dark × compact/cozy. This is not gold-plating: B adds eleven states
that are individually small and collectively where a grid rots silently. There is nowhere to see a
visual regression today.

**Action: build it in the same change as B — it is how B gets reviewed at all.**

---

## Suggested order

| Stage | Items | Why here |
|---|---|---|
| 1 · patch | A, C, D, F, G | No API change or purely additive; two are latent bugs (C, G). Spec text fixed in the same PR. |
| 2 · minor | B + H | The real work, and the matrix is how it is reviewed. `onCellChange` widens compatibly. |
| 3 · minor | E | Needs the panel-width signal plumbed from the host first. |

Blocked on nothing except publishing: every item lands in this package, and as of today it cannot be
pushed — `Simpactsoft/now-ui` grants neither local account write access, so **v0.2.0 has not reached
NOW**. That is the prerequisite for any of this being worth doing.
