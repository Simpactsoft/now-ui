"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { describeState, type SavedView, type ViewState } from "./viewState";
import { useMicroGridConfig } from "./config";

/**
 * §8 — the saved-views pill and its dropdown.
 *
 * Four positioning rules here are not stylistic; each was a bug in review:
 * - `position:fixed`, not absolute: an absolute dropdown inside the card's `overflow:hidden` gets
 *   clipped, hiding the save action exactly when the result set is small and the user wants to save.
 * - `max-height` computed from the pill's own rect, not a constant. A fixed `calc(100vh - 120px)`
 *   ignores the pill's offset and pushes the footer off-screen past ~10 views.
 * - It flips ABOVE the pill when the space below is both smaller and under ~300px, rather than
 *   shrinking to a stub.
 * - Only the LIST scrolls. The footer holds the primary action and must never move.
 */
export function SavedViews({
  views,
  activeId,
  dirty,
  state,
  onPick,
  onClearView,
  clearable = false,
  onRename,
  onDuplicate,
  onDelete,
  onToggleShared,
  onSaveNew,
}: {
  views: SavedView[];
  activeId: string | null;
  dirty: boolean;
  state: ViewState;
  onPick: (v: SavedView) => void;
  onClearView: () => void;
  /** Show the × — true whenever there is anything to leave: a saved view OR a live filter. */
  clearable?: boolean;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleShared: (id: string) => void;
  onSaveNew: (name: string) => void;
}) {
  const { labels } = useMicroGridConfig();
  const [open, setOpen] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [newName, setNewName] = useState("");
  const btnRef = useRef<HTMLButtonElement>(null);
  const [box, setBox] = useState<{ top?: number; bottom?: number; right: number; maxH: number } | null>(null);

  const active = views.find((v) => v.id === activeId) ?? null;

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    const below = window.innerHeight - r.bottom - 18;
    const above = r.top - 18;
    const flip = below < above && below < 300;
    setBox(
      flip
        ? { bottom: window.innerHeight - r.top + 6, right: Math.max(8, window.innerWidth - r.right), maxH: above }
        : { top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right), maxH: below },
    );
  }, [open, views.length]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  const tone = !active
    ? { bg: "var(--card)", fg: "var(--muted-foreground)", bd: "var(--border)" }
    : dirty
      ? { bg: "var(--warning-soft)", fg: "var(--warning)", bd: "var(--warning)" }
      : { bg: "var(--entity-person-soft)", fg: "var(--entity-person)", bd: "var(--primary)" };

  return (
    <>
      {/* Two controls in one shell, per the design: the name opens the menu, the × leaves the filter.
          Without the ×, exiting meant opening a menu and finding the right row — which is how a user
          ends up feeling stuck inside a filter they can see but not leave. */}
      <span
        className="inline-flex h-[26px] items-stretch overflow-hidden rounded-full border text-[12px] font-semibold leading-none"
        style={{ background: tone.bg, color: tone.fg, borderColor: tone.bd }}
      >
        <button
          ref={btnRef}
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          className="inline-flex items-center gap-1.5 border-0 bg-transparent px-2.5 text-inherit"
        >
          <span aria-hidden="true">▤</span>
          {active ? active.name : labels.viewsAll}
          {active && dirty && (
            <span className="rounded-full bg-[var(--warning)] px-1.5 py-px text-[9.5px] text-[var(--primary-foreground)]">{labels.viewsChangedBadge}</span>
          )}
          <span aria-hidden="true" className="text-[9px]">{open ? "▴" : "▾"}</span>
        </button>
        {clearable && (
          <button
            type="button"
            title={labels.viewsBackToAll}
            aria-label={labels.viewsBackToAll}
            onClick={() => { onClearView(); setOpen(false); }}
            className="grid place-items-center border-0 bg-transparent px-2 text-inherit"
            style={{ borderInlineStart: `1px solid ${tone.bd}` }}
          >
            ×
          </button>
        )}
      </span>

      {open && box && typeof document !== "undefined" &&
        createPortal(
          <>
            <div onClick={() => setOpen(false)} style={{ position: "fixed", inset: 0, zIndex: 70 }} />
            <div
              dir="rtl"
              role="dialog"
              aria-label={labels.viewsTitle}
              style={{
                position: "fixed",
                top: box.top,
                bottom: box.bottom,
                right: box.right,
                maxHeight: box.maxH,
                zIndex: 71,
              }}
              className="flex w-[340px] flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--card)] shadow-[var(--shadow)]"
            >
              <div className="flex-none border-b border-[var(--border)] px-3 py-2">
                <div className="text-[12.5px] font-bold">{labels.viewsTitle}</div>
                {/* Users hesitate to delete a view in case it deletes cards. Say what it is. */}
                <div className="text-[10.5px] text-[var(--muted-foreground)]">
                  {labels.viewsCaption}
                </div>
              </div>

              <button
                type="button"
                onClick={() => { onClearView(); setOpen(false); }}
                className="flex flex-none items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-start text-[12.5px] hover:bg-[var(--secondary)]"
              >
                <span className="w-3 text-[var(--primary)]">{!active ? "●" : ""}</span>
                <span className="flex flex-col gap-0.5">
                  <span>{labels.viewsAll}</span>
                  <span className="text-[10.5px] font-normal text-[var(--muted-foreground)]">
                    {labels.viewsAllHint}
                  </span>
                </span>
              </button>

              <div className="min-h-0 flex-1 overflow-y-auto">
                {views.length === 0 && (
                  <div className="px-3 py-3 text-[11.5px] text-[var(--muted-foreground)]">
                    {labels.viewsEmpty}
                  </div>
                )}
                {views.map((v) => (
                  <div key={v.id} className="group/view border-b border-[var(--border)] px-3 py-2 last:border-0 hover:bg-[var(--secondary)]">
                    <div className="flex items-center gap-1.5">
                      <span className="w-3 flex-none text-[var(--primary)]">{v.id === activeId ? "●" : ""}</span>
                      {renaming === v.id ? (
                        <input
                          autoFocus
                          value={draft}
                          onChange={(e) => setDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter" && draft.trim()) { onRename(v.id, draft.trim()); setRenaming(null); }
                            if (e.key === "Escape") setRenaming(null);
                          }}
                          onBlur={() => setRenaming(null)}
                          className="min-w-0 flex-1 rounded-[6px] border border-[var(--primary)] bg-[var(--card)] px-1.5 py-0.5 text-[12.5px] outline-none"
                        />
                      ) : (
                        <button type="button" onClick={() => { onPick(v); setOpen(false); }} className="min-w-0 flex-1 truncate text-start text-[12.5px] font-semibold">
                          {v.name}
                        </button>
                      )}
                      {/* the badge IS the toggle */}
                      <button
                        type="button"
                        onClick={() => onToggleShared(v.id)}
                        title={v.shared ? labels.viewsMakePrivate : labels.viewsMakeShared}
                        className="flex-none rounded-full border px-1.5 text-[9.5px] font-semibold leading-[15px]"
                        style={{
                          background: v.shared ? "var(--entity-person-soft)" : "var(--card)",
                          borderColor: v.shared ? "var(--primary)" : "var(--border)",
                          color: v.shared ? "var(--entity-person)" : "var(--muted-foreground)",
                        }}
                      >
                        {v.shared ? labels.viewsShared : labels.viewsPrivate}
                      </button>
                      <span className="flex flex-none items-center gap-0.5 opacity-0 transition group-hover/view:opacity-100">
                        <button type="button" title={labels.viewsRename} onClick={() => { setRenaming(v.id); setDraft(v.name); }} className="px-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)]">✎</button>
                        <button type="button" title={labels.viewsDuplicate} onClick={() => onDuplicate(v.id)} className="px-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--primary)]">⧉</button>
                        <button type="button" title={labels.viewsDelete} onClick={() => onDelete(v.id)} className="px-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--destructive)]">×</button>
                      </span>
                    </div>
                    {/* The highest-value line on this surface: what the view actually does. */}
                    <div className="ps-4 text-[10.5px] text-[var(--muted-foreground)]">{describeState(v.state, labels)}</div>
                    <div className="ps-4 text-[10px] text-[var(--muted-foreground)] opacity-70">{labels.viewsCreatedBy(v.by)}</div>
                  </div>
                ))}
              </div>

              <div className="flex-none border-t border-[var(--border)] p-2">
                <div className="mb-1 text-[10.5px] text-[var(--muted-foreground)]">{labels.viewsWillSave} {describeState(state, labels)}</div>
                <div className="flex items-center gap-1.5">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && newName.trim()) { onSaveNew(newName.trim()); setNewName(""); setOpen(false); } }}
                    placeholder={labels.viewsNamePlaceholder}
                    className="min-w-0 flex-1 rounded-[6px] border border-[var(--input)] bg-[var(--card)] px-2 py-1 text-[12px] outline-none focus:border-[var(--primary)]"
                  />
                  <button
                    type="button"
                    disabled={!newName.trim()}
                    onClick={() => { onSaveNew(newName.trim()); setNewName(""); setOpen(false); }}
                    className="flex-none rounded-[6px] px-2 py-1 text-[12px] font-bold disabled:opacity-40"
                    style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
                  >
                    + {labels.viewsSaveCurrent}
                  </button>
                </div>
              </div>
            </div>
          </>,
          document.body,
        )}
    </>
  );
}
