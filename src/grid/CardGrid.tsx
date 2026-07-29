"use client";
import { useMemo, useState } from "react";
import { MicroGrid } from "./MicroGrid";
import { useMicroGridConfig } from "./config";
import type { MicroColumn, MicroGridDensity, MicroSortState } from "./types";

export type CardGridSortValue = string | number | null | undefined;

export interface CardGridColumn<T> extends MicroColumn<T> {
  /**
   * Value used for client-side sorting when the user clicks this column's
   * header. Omit to make the column non-sortable.
   *
   * **Only correct when the grid holds the FULL row set.** That is the case a
   * card panel is in — it loads all of one record's related rows. A paginated
   * list grid must sort on the server instead: sorting here would reorder the
   * loaded page and silently present it as the whole ordering.
   */
  sortValue?: (row: T) => CardGridSortValue;
}

/**
 * MicroGrid plus client-side sort.
 *
 * MicroGrid itself never sorts — it renders rows in the order it receives them.
 * This wrapper owns the sort state, feeds it sorted rows plus the `sort`
 * indicator, and injects sort buttons into sortable column headers.
 *
 * Sort cycle per column: unsorted → asc → desc → unsorted (back to the order
 * the host supplied). Blank / null values always sort last, in both directions,
 * because a column of blanks at the top tells the user nothing. Equal keys keep
 * their incoming order (stable).
 */
export function CardGrid<T>({
  rows,
  columns,
  getRowId,
  ariaLabel,
  initialSort = null,
  density = "compact",
  emptyMessage,
  className,
}: {
  rows: T[];
  columns: CardGridColumn<T>[];
  getRowId: (row: T) => string;
  ariaLabel: string;
  initialSort?: MicroSortState | null;
  density?: MicroGridDensity;
  emptyMessage?: string;
  className?: string;
}) {
  const { labels } = useMicroGridConfig();
  const [sort, setSort] = useState<MicroSortState | null>(initialSort);

  const sortValues = useMemo(() => {
    const m = new Map<string, (row: T) => CardGridSortValue>();
    for (const c of columns) if (c.sortValue) m.set(c.id, c.sortValue);
    return m;
  }, [columns]);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const getVal = sortValues.get(sort.columnId);
    if (!getVal) return rows;
    const dir = sort.direction === "asc" ? 1 : -1;
    const isNil = (v: CardGridSortValue) => v === null || v === undefined || v === "";
    // Decorate → sort → undecorate: a stable sort with an index tiebreak, so
    // blanks stay last and equal keys keep their incoming (Skyz) order.
    return rows
      .map((row, i) => ({ row, i, v: getVal(row) }))
      .sort((a, b) => {
        const aNil = isNil(a.v);
        const bNil = isNil(b.v);
        if (aNil && bNil) return a.i - b.i;
        if (aNil) return 1; // nils always last, regardless of direction
        if (bNil) return -1;
        const cmp =
          typeof a.v === "number" && typeof b.v === "number"
            ? a.v - b.v
            : String(a.v).localeCompare(String(b.v), "he");
        return cmp !== 0 ? cmp * dir : a.i - b.i;
      })
      .map((d) => d.row);
  }, [rows, sort, sortValues]);

  const toggleSort = (columnId: string) =>
    setSort((prev) => {
      if (prev?.columnId !== columnId) return { columnId, direction: "asc" };
      if (prev.direction === "asc") return { columnId, direction: "desc" };
      return null; // third click clears the sort
    });

  const gridColumns = useMemo<MicroColumn<T>[]>(
    () =>
      columns.map((c) => {
        if (!c.sortValue) return c;
        const active = sort?.columnId === c.id;
        const arrow = active ? (sort.direction === "asc" ? "▲" : "▼") : "↕";
        const label = typeof c.header === "string" ? c.header : c.id;
        return {
          ...c,
          header: (
            <button
              type="button"
              onClick={() => toggleSort(c.id)}
              aria-label={`${labels.sortBy} ${label}`}
              className={`group/sort -mx-1 inline-flex items-center gap-1 rounded px-1 py-0.5 font-semibold transition-colors hover:text-[var(--foreground)] ${active ? "text-[var(--primary)]" : ""}`}
            >
              <span>{c.header}</span>
              <span className={`text-[9px] leading-none ${active ? "opacity-100" : "opacity-40 group-hover/sort:opacity-70"}`}>{arrow}</span>
            </button>
          ),
        };
      }),
    // toggleSort is stable enough (only reads setSort); re-run when columns/sort change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [columns, sort, labels.sortBy],
  );

  return (
    <MicroGrid<T>
      rows={sortedRows}
      columns={gridColumns}
      getRowId={getRowId}
      ariaLabel={ariaLabel}
      sort={sort}
      density={density}
      emptyMessage={emptyMessage}
      // No skin class. The grid look is MicroGrid's own default, so a card panel and a browse list
      // cannot drift apart by one of them forgetting to opt in.
      className={className}
    />
  );
}
