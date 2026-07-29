"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useMicroGridConfig } from "./config";

const PAGE = 12;        // how many facet values the popover opens with
const MORE = 24;        // how many more each "show more" reveals
const SEARCH_FROM = 10; // below this a search field is noise — a facet of 4 is read, not searched

export interface ColumnFilterOption {
  key: string;
  label: string;
  /** Optional right-aligned count/hint. */
  count?: number;
}

/**
 * A column-header filter affordance for MicroGrid (drop into a column's `headerSlot`).
 * Presentational + controlled: the host owns `selected` and re-queries the server on `onChange`
 * (an empty array = no filter). Renders through a portal with fixed positioning so the popover is
 * never clipped by the grid's overflow. RTL, theme-aware, keyboard-accessible (Esc / click-outside).
 */
export function ColumnFilter({
  label,
  options,
  selected,
  onChange,
  multi = true,
}: {
  label: string;
  options: ColumnFilterOption[];
  selected: string[];
  onChange: (keys: string[]) => void;
  multi?: boolean;
}) {
  const { labels } = useMicroGridConfig();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [visible, setVisible] = useState(PAGE);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const active = selected.length > 0;

  /**
   * Selected values ALWAYS sort first, whatever the search term, so an active filter can never
   * disappear behind a query; everything else falls back to count descending. Then the list is
   * paged, because a vocabulary of 61 cities (the real dataset has more) is not a scroll problem,
   * it is a "the user cannot find לוד" problem.
   */
  const matched = q.trim() ? options.filter((o) => o.label.includes(q.trim())) : options;
  const ordered = [...matched].sort((a, b) => {
    const sa = selected.includes(a.key) ? 1 : 0;
    const sb = selected.includes(b.key) ? 1 : 0;
    if (sa !== sb) return sb - sa;
    return (b.count ?? 0) - (a.count ?? 0);
  });
  const shown = ordered.slice(0, visible);
  const hidden = ordered.length - shown.length;
  const searchable = options.length > SEARCH_FROM;
  const sparse = options.length > 0 && options.length <= 2;

  // A new query starts a new page — otherwise "show 24 more" silently carries across searches.
  useEffect(() => { setVisible(PAGE); }, [q, open]);

  // Position the popover under the button (viewport coords for position:fixed).
  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, right: Math.max(8, window.innerWidth - r.right) });
  }, [open]);

  // Close on outside-click / Escape.
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (popRef.current?.contains(e.target as Node) || btnRef.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (key: string) => {
    if (!multi) {
      onChange(selected.includes(key) ? [] : [key]);
      setOpen(false);
      return;
    }
    onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${labels.filterBy(label)}${active ? ` (${labels.filterActive(selected.length)})` : ""}`}
        aria-expanded={open}
        className={`inline-flex h-5 w-5 items-center justify-center rounded transition-colors ${
          active
            ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
            : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
        }`}
      >
        {/* funnel glyph */}
        <span className="text-[11px] leading-none">⧩</span>
      </button>

      {open && pos && typeof document !== "undefined" &&
        createPortal(
          <div
            ref={popRef}
            dir="rtl"
            role="dialog"
            aria-label={labels.filterBy(label)}
            style={{ position: "fixed", top: pos.top, right: pos.right, zIndex: 60 }}
            className="w-[268px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-1 text-[13px] shadow-lg"
          >
            <div className="flex items-center justify-between px-2 pt-1.5">
              <span className="font-semibold text-[var(--muted-foreground)]">{labels.filterBy(label)}</span>
              <span className="flex items-center gap-2">
                {multi && shown.length > 1 && (
                  <button
                    type="button"
                    onClick={() => onChange(Array.from(new Set([...selected, ...shown.map((o) => o.key)])))}
                    className="text-[11.5px] font-semibold text-[var(--primary)] hover:underline"
                  >
                    {labels.filterSelectAll}
                  </button>
                )}
                {active && (
                  <button
                    type="button"
                    onClick={() => {
                      onChange([]);
                      if (!multi) setOpen(false);
                    }}
                    className="text-[11.5px] font-semibold text-[var(--primary)] hover:underline"
                  >
                    {labels.filterClear}
                  </button>
                )}
              </span>
            </div>
            <div className="px-2 pb-1 text-[10.5px] text-[var(--muted-foreground)]">
              {labels.filterCountsNote}
            </div>
            {searchable && (
              <div className="mb-1 flex items-center gap-1.5 px-1">
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder={labels.filterSearchPlaceholder(options.length)}
                  className="min-w-0 flex-1 rounded-[7px] border border-[var(--input)] bg-[var(--card)] px-2 py-1 text-[12.5px] outline-none focus:border-[var(--primary)]"
                />
                <span className="mono flex-none text-[10px] text-[var(--muted-foreground)]">
                  {labels.filterMatchCount(ordered.length, options.length)}
                </span>
              </div>
            )}
            {/* A two-value vocabulary is usually a schema problem, not a real choice — one real
                lookup held two entries, one of which was a country NAME. Say so. */}
            {sparse && (
              <div className="mx-1 mb-1 rounded-[6px] px-2 py-1 text-[10.5px]" style={{ background: "var(--warning-soft)", color: "var(--warning)" }}>
                {labels.filterSparseWarning}
              </div>
            )}
            {active && (
              <div className="px-2 pb-1 text-[10.5px] text-[var(--muted-foreground)]">
                {labels.filterSelectedNote(selected.length)}
              </div>
            )}
            {shown.length === 0 && (
              <div className="px-2 py-2 text-[12px] text-[var(--muted-foreground)]">
                {options.length ? (
                  <>
                    {labels.filterNoMatch}
                    <div className="mt-0.5 text-[10.5px]">{labels.filterNoMatchHint}</div>
                  </>
                ) : (
                  labels.filterNoOptions
                )}
              </div>
            )}
            <div className="max-h-[172px] overflow-y-auto">
            {shown.map((o) => {
              const on = selected.includes(o.key);
              return (
                <span key={o.key} className="group/facet flex w-full items-stretch rounded-[7px] hover:bg-[var(--secondary)]">
                <button
                  type="button"
                  onClick={() => toggle(o.key)}
                  className={`flex min-w-0 flex-1 items-center gap-2 rounded-[7px] px-2 py-1.5 text-start transition-colors ${on ? "text-[var(--primary)]" : "text-[var(--foreground)]"}`}
                >
                  <span
                    className={`flex h-4 w-4 flex-none items-center justify-center rounded-[5px] border text-[10px] ${
                      on ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]" : "border-[var(--input)]"
                    }`}
                  >
                    {on ? "✓" : ""}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{o.label}</span>
                  {o.count != null && (
                    <span className="flex-none text-[11px] text-[var(--muted-foreground)] tabular-nums">{o.count}</span>
                  )}
                </button>
                {multi && (
                  // "Only this" is what a fast user wants most of the time; getting there by
                  // toggling a multi-select costs one click per value.
                  <button
                    type="button"
                    onClick={() => onChange([o.key])}
                    title={labels.filterOnlyTitle(o.label)}
                    className="flex-none border-s border-[var(--border)] px-1.5 text-[10.5px] font-semibold text-[var(--muted-foreground)] opacity-0 transition group-hover/facet:opacity-100 hover:text-[var(--primary)]"
                  >
                    {labels.filterOnly}
                  </button>
                )}
                </span>
              );
            })}
            </div>
            {hidden > 0 && (
              <div className="px-1 pb-1 pt-0.5">
                <button
                  type="button"
                  onClick={() => setVisible((v) => v + MORE)}
                  className="w-full rounded-[6px] border border-dashed border-[var(--border)] py-1 text-[11.5px] font-semibold text-[var(--primary)] hover:border-[var(--primary)]"
                >
                  {labels.filterShowMore(Math.min(MORE, hidden))}
                </button>
                <div className="px-1 pt-1 text-[10.5px] text-[var(--muted-foreground)]">
                  {labels.filterHiddenNote(hidden)}
                </div>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
