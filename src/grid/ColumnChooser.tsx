"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { Columns3, GripVertical, Pin, RotateCcw } from "lucide-react";
import { useMicroGridConfig } from "./config";
import type { MicroColumn } from "./types";

export interface ColumnDef {
  id: string;
  /** Plain-text label for the chooser (the grid header may be a control, not text). */
  label: string;
  /** Locked columns can't be hidden or moved (e.g. the primary name column). */
  locked?: boolean;
}

interface Arrangement {
  order: string[];
  hidden: string[];
  /** Column ids frozen to the grid's leading edge (added 2026-07-23). Absent in older payloads. */
  pinned?: string[];
}

const load = (key: string): Arrangement | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Arrangement) : null;
  } catch {
    return null;
  }
};

/**
 * Per-grid column arrangement: which columns show, in what order, and which are pinned (frozen to the
 * leading edge), persisted to localStorage under `storageKey`. Returns the arranged MicroGrid columns
 * + the controls to render a column chooser. New columns added to the app later append at the end
 * (never lost); locked columns stay first + shown. Pinned columns lead and carry `pinned: "start"`.
 */
export function useColumnArrangement<T>(
  storageKey: string,
  defs: ColumnDef[],
  columns: MicroColumn<T>[],
  opts?: { defaultPinned?: string[] },
) {
  const defIds = useMemo(() => defs.map((d) => d.id), [defs]);
  const defaultPinned = opts?.defaultPinned;
  const [order, setOrder] = useState<string[]>(defIds);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [pinned, setPinned] = useState<Set<string>>(new Set());

  // Hydrate from storage once mounted (client-only), reconciling with the current column set.
  useEffect(() => {
    const saved = load(storageKey);
    const known = new Set(defIds);
    const nextOrder = saved
      ? [...saved.order.filter((id) => known.has(id)), ...defIds.filter((id) => !saved.order.includes(id))]
      : defIds;
    setOrder(nextOrder);
    setHidden(new Set((saved?.hidden ?? []).filter((id) => known.has(id) && !defs.find((d) => d.id === id)?.locked)));
    // Saved pins win; if the payload predates pinning (or none saved), fall back to defaultPinned.
    // Capped to one (single-pin invariant — see togglePin).
    setPinned(new Set((saved?.pinned ?? defaultPinned ?? []).filter((id) => known.has(id)).slice(0, 1)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey, defIds.join(",")]);

  const persist = useCallback(
    (o: string[], h: Set<string>, p: Set<string>) => {
      try {
        localStorage.setItem(storageKey, JSON.stringify({ order: o, hidden: [...h], pinned: [...p] }));
      } catch {
        /* storage unavailable — arrangement is best-effort */
      }
    },
    [storageKey],
  );

  const toggle = useCallback(
    (id: string) => {
      if (defs.find((d) => d.id === id)?.locked) return;
      const willHide = !hidden.has(id);
      const nextHidden = new Set(hidden);
      willHide ? nextHidden.add(id) : nextHidden.delete(id);
      // A hidden column can't be frozen — hiding it drops any pin.
      const nextPinned = new Set(pinned);
      if (willHide) nextPinned.delete(id);
      setHidden(nextHidden);
      setPinned(nextPinned);
      persist(order, nextHidden, nextPinned);
    },
    [defs, order, hidden, pinned, persist],
  );

  // Toggle a column's frozen (leading-edge sticky) state. SINGLE-PIN: freezing a column replaces any
  // existing pin (at most one frozen column). This keeps the sticky inline-start offset exact — it is
  // just the selection-column width — so it never depends on a column's *rendered* width, which an
  // auto-layout table doesn't guarantee equals the declared `width`. (Multi-pin would need runtime
  // width measurement to avoid frozen columns overlapping.) Pinning force-shows the column.
  const togglePin = useCallback(
    (id: string) => {
      const willPin = !pinned.has(id);
      const nextPinned = willPin ? new Set([id]) : new Set<string>();
      const nextHidden = new Set(hidden);
      if (willPin) nextHidden.delete(id);
      setPinned(nextPinned);
      setHidden(nextHidden);
      persist(order, nextHidden, nextPinned);
    },
    [order, hidden, pinned, persist],
  );

  const move = useCallback(
    (id: string, dir: -1 | 1) => {
      setOrder((prev) => {
        const i = prev.indexOf(id);
        const j = i + dir;
        if (i < 0 || j < 0 || j >= prev.length) return prev;
        const next = [...prev];
        [next[i], next[j]] = [next[j], next[i]];
        persist(next, hidden, pinned);
        return next;
      });
    },
    [hidden, pinned, persist],
  );

  // Drag-and-drop reorder (matches NOW's EntityViewLayout row-DnD): splice from → to.
  const reorder = useCallback(
    (from: number, to: number) => {
      setOrder((prev) => {
        if (from === to || from < 0 || to < 0 || from >= prev.length || to >= prev.length) return prev;
        const next = [...prev];
        const [moved] = next.splice(from, 1);
        next.splice(to, 0, moved);
        persist(next, hidden, pinned);
        return next;
      });
    },
    [hidden, pinned, persist],
  );

  const reset = useCallback(() => {
    setOrder(defIds);
    setHidden(new Set());
    // Restore the same default a fresh (no-payload) mount produces, so post-reset == post-reload.
    setPinned(new Set((defaultPinned ?? []).slice(0, 1)));
    try {
      localStorage.removeItem(storageKey);
    } catch {
      /* ignore */
    }
  }, [defIds, defaultPinned, storageKey]);

  // Arrange the real MicroGrid columns: pinned columns lead (carrying `pinned: "start"`), then the
  // rest in `order`; hidden columns dropped. Pinned order among themselves follows `order`.
  const arranged = useMemo(() => {
    const byId = new Map(columns.map((c) => [c.id, c]));
    const visible = order.filter((id) => !hidden.has(id));
    const ids = [...visible.filter((id) => pinned.has(id)), ...visible.filter((id) => !pinned.has(id))];
    return ids
      .map((id) => {
        const col = byId.get(id);
        if (!col) return undefined;
        return pinned.has(id) ? { ...col, pinned: "start" as const } : col;
      })
      .filter((c): c is MicroColumn<T> => Boolean(c));
  }, [columns, order, hidden, pinned]);

  return { arranged, order, hidden, pinned, toggle, togglePin, move, reorder, reset, defs };
}

/** The column-chooser button + popover (show/hide + reorder). Pairs with useColumnArrangement. */
export function ColumnChooser({
  order,
  hidden,
  pinned,
  toggle,
  togglePin,
  move,
  reorder,
  reset,
  defs,
}: Pick<
  ReturnType<typeof useColumnArrangement>,
  "order" | "hidden" | "pinned" | "toggle" | "togglePin" | "move" | "reorder" | "reset" | "defs"
>) {
  const { labels } = useMicroGridConfig();
  const [open, setOpen] = useState(false);
  const [dragSrc, setDragSrc] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const labelOf = (id: string) => defs.find((d) => d.id === id)?.label ?? id;
  const isLocked = (id: string) => Boolean(defs.find((d) => d.id === id)?.locked);
  const visibleCount = order.filter((id) => !hidden.has(id)).length;

  // Reset drag state whenever the popover closes so a re-open starts clean.
  useEffect(() => {
    if (!open) {
      setDragSrc(null);
      setDragOver(null);
    }
  }, [open]);

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          aria-label={labels.chooserTriggerAria}
          className="inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[12.5px] font-semibold text-[var(--muted-foreground)] transition-colors hover:bg-[var(--secondary)] hover:text-[var(--foreground)] data-[state=open]:bg-[var(--secondary)] data-[state=open]:text-[var(--foreground)]"
        >
          <Columns3 className="h-3.5 w-3.5" />
          {labels.chooserTrigger}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        <Popover.Content
          dir="rtl"
          align="end"
          sideOffset={4}
          aria-label={labels.chooserTrigger}
          className="z-[70] w-[280px] rounded-lg border border-[var(--border)] bg-[var(--card)] p-3 text-[13px] text-[var(--card-foreground)] shadow-lg outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95"
        >
          <div className="mb-2 flex items-center justify-between border-b border-[var(--border)] pb-2">
            <h4 className="m-0 text-sm font-semibold text-[var(--foreground)]">{labels.chooserTitle(visibleCount)}</h4>
            <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-[11.5px] font-semibold text-[var(--muted-foreground)] hover:text-[var(--primary)]">
              <RotateCcw className="h-3 w-3" /> {labels.chooserReset}
            </button>
          </div>
          <div className="max-h-[300px] overflow-auto">
            {order.map((id, i) => {
              const on = !hidden.has(id);
              const locked = isLocked(id);
              const isPinned = pinned.has(id);
              return (
                <div
                  key={id}
                  dir="ltr"
                  draggable={!locked}
                  onDragStart={() => setDragSrc(i)}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDragOver(i);
                  }}
                  onDrop={() => {
                    if (dragSrc !== null) reorder(dragSrc, i);
                    setDragSrc(null);
                    setDragOver(null);
                  }}
                  onDragEnd={() => {
                    setDragSrc(null);
                    setDragOver(null);
                  }}
                  className={`group/row flex items-center gap-2 rounded-md px-1 py-1 text-sm hover:bg-[var(--secondary)] ${
                    dragOver === i && dragSrc !== null && dragSrc !== i ? "outline outline-1 outline-[var(--primary)]" : ""
                  } ${locked ? "opacity-60" : ""}`}
                >
                  <GripVertical
                    className={`h-3.5 w-3.5 flex-shrink-0 text-[var(--muted-foreground)] ${locked ? "" : "cursor-grab"}`}
                    aria-hidden="true"
                  />
                  <input
                    type="checkbox"
                    checked={on}
                    disabled={locked}
                    onChange={() => toggle(id)}
                    aria-label={`${on ? labels.chooserHide : labels.chooserShow} ${labelOf(id)}`}
                    className="h-4 w-4 flex-shrink-0 rounded border-[var(--border)] accent-[var(--primary)]"
                  />
                  <span dir="rtl" className={`min-w-0 flex-1 select-none truncate text-start ${on ? "text-[var(--foreground)]" : "text-[var(--muted-foreground)]"}`}>
                    {labelOf(id)}
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePin(id)}
                    disabled={!on}
                    aria-pressed={isPinned}
                    aria-label={`${isPinned ? labels.chooserUnpin : labels.chooserPin} ${labelOf(id)}`}
                    title={isPinned ? labels.chooserUnpinTitle : labels.chooserPinTitle}
                    className={`flex-none rounded p-0.5 transition disabled:opacity-30 ${
                      isPinned
                        ? "text-[var(--primary)] opacity-100"
                        : "text-[var(--muted-foreground)] opacity-0 hover:text-[var(--primary)] group-hover/row:opacity-100"
                    }`}
                  >
                    <Pin className={`h-3.5 w-3.5 ${isPinned ? "fill-current" : ""}`} />
                  </button>
                  <span className="flex flex-none items-center opacity-0 transition group-hover/row:opacity-100">
                    <button type="button" onClick={() => move(id, -1)} disabled={i === 0} aria-label={labels.chooserMoveUp} className="px-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)] disabled:opacity-30">↑</button>
                    <button type="button" onClick={() => move(id, 1)} disabled={i === order.length - 1} aria-label={labels.chooserMoveDown} className="px-0.5 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)] disabled:opacity-30">↓</button>
                  </span>
                </div>
              );
            })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
