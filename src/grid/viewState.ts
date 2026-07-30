/**
 * A saved view — a named filter/sort/hidden-columns state — and the pure logic over it.
 *
 * The SHAPE lives here because two apps must agree on it: a view saved by one and read by the other
 * has to mean the same thing. WHERE a view is stored does not — one app may keep it in localStorage,
 * another on a server, a third per workspace — so `loadViews` / `saveViews` deliberately stay in the
 * host. This file has no side effects and touches no storage.
 *
 * A view stores FILTERING, SORTING and HIDDEN COLUMNS. Never data.
 */

export type ViewKind = string;

export type ViewState = {
  q: string;
  facet: { status: string[]; city: string[]; owner: string[] };
  hideJunk: boolean;
  sort: { col: string; dir: "asc" | "desc" };
  /**
   * Every server-side filter, verbatim — including the ones with no slot in `facet` (dates, the
   * has/hasn't triples). `facet` stays because views saved before this field exist in users'
   * localStorage and must keep working; it is now a mirror of the three list filters, not the store.
   *
   * Optional for that same reason: an older saved view simply has no `filters`, and reads as one.
   */
  filters?: Record<string, unknown>;
};

export type SavedView = {
  id: string;
  name: string;
  kind: ViewKind;
  shared: boolean;
  by: string;
  state: ViewState;
};

const KEY = "skyz-saved-views";

export const emptyState = (): ViewState => ({
  q: "",
  facet: { status: [], city: [], owner: [] },
  hideJunk: false,
  sort: { col: "name", dir: "asc" },
});

export function sameState(a: ViewState, b: ViewState): boolean {
  if (a.q.trim() !== b.q.trim()) return false;
  if (a.hideJunk !== b.hideJunk) return false;
  if (a.sort.col !== b.sort.col || a.sort.dir !== b.sort.dir) return false;
  const keys = ["status", "city", "owner"] as const;
  return keys.every((k) => {
    const x = [...a.facet[k]].sort();
    const y = [...b.facet[k]].sort();
    return x.length === y.length && x.every((v, i) => v === y[i]);
  });
}

/** Anything at all narrowing the list — the test behind "is there something to leave". */
export const hasAnyFilter = (s: ViewState) =>
  s.q.trim() !== "" ||
  s.hideJunk ||
  s.facet.status.length > 0 ||
  s.facet.city.length > 0 ||
  s.facet.owner.length > 0 ||
  Object.values(s.filters ?? {}).some((v) => v !== undefined && !(Array.isArray(v) && v.length === 0));

/**
 * How many conditions are active — the "one condition" / "N conditions" copy.
 *
 * Counts the FILTER BAG, which since v0.5.0 already holds status/city/owner alongside every other
 * field; `facet` is only consulted for views saved before the bag existed. Counting both would
 * double every list filter.
 */
export const conditionCount = (s: ViewState) => {
    const live = Object.values(s.filters ?? {}).filter(
        (v) => v !== undefined && v !== null && !(Array.isArray(v) && v.length === 0),
    ).length;
    const legacy =
        (s.facet.status.length ? 1 : 0) + (s.facet.city.length ? 1 : 0) + (s.facet.owner.length ? 1 : 0);
    return (s.q.trim() ? 1 : 0) + (s.hideJunk ? 1 : 0) + (s.filters ? live : legacy);
};

/**
 * A one-line summary of a view, for the pill and the state bar.
 *
 * Neutral by design: the package knows a view has N conditions and a sort column, but it does not
 * know that a filter key means "city" — that is the host's vocabulary. A host that wants
 * "עיר (2) · מיון: שם ↑" passes `describeView` to `Browse`; without one, this is what shows.
 */
export function describeState(s: ViewState, labels: { viewsConditions: (n: number) => string; sortBy: string }): string {
    const parts: string[] = [];
    const n = conditionCount(s);
    if (n > 0) parts.push(labels.viewsConditions(n));
    parts.push(`${labels.sortBy}: ${s.sort.col} ${s.sort.dir === "asc" ? "↑" : "↓"}`);
    return parts.join(" · ");
}

