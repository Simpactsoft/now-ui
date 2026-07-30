"use client";
import { useState } from "react";
import { conditionCount, describeState, type ViewState } from "./viewState";
import { useMicroGridConfig } from "./config";


export function FilterStateBar({
  state,
  hasView,
  dirty,
  onSaveNew,
  onSaveChange,
  onSaveAsNew,
  onRestore,
  onClear,
}: {
  state: ViewState;
  hasView: boolean;
  dirty: boolean;
  onSaveNew: (name: string) => void;
  onSaveChange: () => void;
  onSaveAsNew: (name: string) => void;
  onRestore: () => void;
  onClear: () => void;
}) {
  const { labels } = useMicroGridConfig();
  /**
   * Naming happens HERE, inline, never by sending the user to the views menu. The first build asked
   * for a name with a toast and offered no field — a primary action that ends in an instruction to
   * go look elsewhere is a dead end, and the user hit exactly that.
   *
   * `naming` is which save is being named, so one input serves both bars: "new" from the unsaved
   * bar, "copy" from the dirty bar's save-as-new.
   */
  const [naming, setNaming] = useState<null | "new" | "copy">(null);
  const [name, setName] = useState("");

  const commit = () => {
    const v = name.trim();
    if (!v) return;
    (naming === "copy" ? onSaveAsNew : onSaveNew)(v);
    setName("");
    setNaming(null);
  };

  const nameField = (
    <span className="ms-auto flex items-center gap-1.5">
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") { setName(""); setNaming(null); }
        }}
        placeholder={labels.viewsNamePlaceholder}
        aria-label={labels.viewsNamePlaceholder}
        className="h-[24px] w-[180px] rounded-[6px] border bg-[var(--card)] px-2 text-[12px] text-[var(--foreground)] outline-none"
        style={{ borderColor: "var(--warning)" }}
      />
      <BarBtn onClick={commit} primary disabled={!name.trim()}>{labels.stateSave}</BarBtn>
      <BarBtn onClick={() => { setName(""); setNaming(null); }}>{labels.stateCancel}</BarBtn>
    </span>
  );

  // ONE definition of "is there a filter", shared with the pill and the chips. This used to be a
  // hand-written sum here that listed status/city/owner and nothing else, so a date or presence
  // filter left the bar showing "pick a saved view" while the grid was plainly filtered.
  const n = conditionCount(state);

  if (hasView && dirty)
    return (
      <div
        className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-[12px]"
        style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
      >
        <span aria-hidden="true">⬤</span>
        <span className="font-semibold">{labels.stateDrifted}</span>
        <span className="opacity-80">{describeState(state, labels)}</span>
        {naming ? nameField : (
          <span className="ms-auto flex items-center gap-1.5">
            <BarBtn onClick={onSaveChange} primary>{labels.stateSaveChange}</BarBtn>
            <BarBtn onClick={() => setNaming("copy")} primary>{labels.stateSaveAsNew}</BarBtn>
            <BarBtn onClick={onRestore}>{labels.stateRestore}</BarBtn>
          </span>
        )}
      </div>
    );

  if (!hasView && n > 0)
    return (
      <div
        className="mb-2 flex flex-wrap items-center gap-2 rounded-[var(--radius)] px-3 py-1.5 text-[12px]"
        style={{ background: "var(--warning-soft)", color: "var(--warning)" }}
      >
        <span aria-hidden="true">⬤</span>
        <span className="font-semibold">{labels.stateUnsaved} · {labels.viewsConditions(n)}</span>
        <span className="opacity-80">{describeState(state, labels)}</span>
        {naming ? nameField : (
          <span className="ms-auto flex items-center gap-1.5">
            <BarBtn onClick={() => setNaming("new")} primary>{labels.stateSaveAsView}</BarBtn>
            <BarBtn onClick={onClear}>{labels.stateClear}</BarBtn>
          </span>
        )}
      </div>
    );

  // No filter at all — a hint, never a dead-looking button.
  return (
    <div className="mb-2 text-[11.5px] text-[var(--muted-foreground)]">
      {labels.stateNoFilterHint}
    </div>
  );
}

function BarBtn({ children, onClick, primary, disabled }: { children: React.ReactNode; onClick: () => void; primary?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded-[6px] border px-2 py-0.5 text-[11.5px] font-bold disabled:opacity-40"
      style={{
        background: primary ? "var(--warning)" : "transparent",
        color: primary ? "var(--primary-foreground)" : "inherit",
        borderColor: "currentColor",
      }}
    >
      {children}
    </button>
  );
}
