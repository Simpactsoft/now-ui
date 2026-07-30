"use client";

import { useState, type ReactNode } from "react";
import { useMicroGridConfig } from "./config";
import { SavedViews } from "./SavedViews";
import { FilterStateBar } from "./FilterStateBar";
import { hasAnyFilter, sameState, type SavedView, type ViewState } from "./viewState";
import {
    FacetPanel,
    QUICK_DATE_PRESETS,
    EMPTY_DATE,
    describeDate,
    isDateActive,
    type DatePresetId,
    type FacetField,
} from "./FacetPanel";

/**
 * Browse — the browse surface: a MicroGrid plus everything around it.
 *
 * ── Why the toolbar is inside the grid's box and not around it ───────────────────────────────────
 * The design draws ONE `--card` with `border-radius: var(--radius); overflow: hidden`, and puts the
 * saved-views strip, the filter strip, the add-filter drawer, the state bar, the selection bar, the
 * facet strip, the header, the rows and the paging footer inside it, in that order.
 *
 * That is not a styling preference. `facetRules[7]` settles it:
 *
 *   "החלונית היא רצועה דביקה מתחת לשורת הכותרת, לא פופאובר מוחלט בתוך כרטיס עם overflow:hidden"
 *
 * The facet panel is a sticky strip inside the grid's own scroll container. A host app cannot render
 * that around the grid — it has to be part of the grid's DOM. Which forces the toolbar in here too,
 * and is why this component exists at all rather than each app drawing its own chrome.
 *
 * ── What belongs here and what does not ──────────────────────────────────────────────────────────
 * This is PRESENTATIONAL. It owns the envelope, the add-filter drawer and the facet panel; it owns
 * no data. Facet loading, saved-view persistence, the SQL behind a filter and the bulk actions all
 * stay in the host and arrive as props or slots. A `FacetField` is a description of a control plus
 * the callbacks to drive it — the shell never learns what a "city" is.
 *
 * Every string goes through `MicroGridLabels`. Nothing here is Hebrew; a consumer that runs in
 * English gets English by swapping one label set.
 */

export type BrowseProps = {
    /** Every filterable field — column or not. This one list drives the drawer, the chips and the panel. */
    fields: FacetField[];
    /** Free-text search over the list. Omit to hide the search box entirely. */
    search?: { value: string; onChange: (next: string) => void; placeholder?: string };
    /** The "hide machine-created rows" toggle. Omit if the host has no such notion. */
    junk?: { active: boolean; count: number; label: string; onToggle: () => void };
    /** The field id carrying dates that the four inline quick-chips should drive. */
    quickDateFieldId?: string;
    /** Clears everything. Shown next to the chips whenever anything is active. */
    onClearAll?: () => void;
    /**
     * Which field's panel is open. OPTIONAL and controlled-if-passed: the shell keeps its own state
     * when omitted, but a host that puts a ▼ in a column header needs to open the panel from outside
     * the shell, and lifting the state is how a header and "+ סינון" stay one action instead of two.
     */
    openFacetId?: string | null;
    onOpenFacet?: (fieldId: string | null) => void;

    /**
     * Saved views. Pass the list and the callbacks; WHERE they are stored stays yours — one app uses
     * localStorage, another a server. Omit to render no views strip at all.
     */
    views?: {
        list: SavedView[];
        activeId: string | null;
        state: ViewState;
        savedSnapshot: ViewState | null;
        onPick: (v: SavedView) => void;
        onClearAll: () => void;
        onSaveNew: (name: string) => void;
        onSaveChange: () => void;
        onRestore: () => void;
        onRename: (id: string, name: string) => void;
        onDuplicate: (id: string) => void;
        onDelete: (id: string) => void;
        onToggleShared: (id: string) => void;
    };
    /** Slots, in the design's order. Each is optional; an absent slot renders no band at all. */
    selectionBar?: ReactNode;
    toolbarEnd?: ReactNode;
    footer?: ReactNode;

    /** The grid itself. */
    children: ReactNode;
};

const STRIP: React.CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "9px 12px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
};

export function Browse({
    fields,
    search,
    junk,
    quickDateFieldId,
    onClearAll,
    views,
    openFacetId,
    onOpenFacet,
    selectionBar,
    toolbarEnd,
    footer,
    children,
}: BrowseProps) {
    const { labels } = useMicroGridConfig();
    const [addOpen, setAddOpen] = useState(false);
    const [ownFacet, setOwnFacet] = useState<string | null>(null);
    const controlled = openFacetId !== undefined;
    const openFacet = controlled ? openFacetId : ownFacet;
    const setOpenFacet = (id: string | null) => (controlled ? onOpenFacet?.(id) : setOwnFacet(id));

    const isActive = (f: FacetField) =>
        f.kind === "values" ? f.selected.length > 0 : f.kind === "date" ? isDateActive(f.value) : f.value !== null;

    const summary = (f: FacetField): string => {
        if (f.kind === "values") {
            return f.selected.map((k) => f.options.find((o) => o.key === k)?.label ?? k).join(", ");
        }
        if (f.kind === "date") return describeDate(f.value, labels) ?? "";
        return f.value ? labels.presenceHas(f.label) : labels.presenceHasNot(f.label);
    };

    const clearField = (f: FacetField) => {
        if (f.kind === "values") f.onChange([]);
        else if (f.kind === "date") f.onChange(EMPTY_DATE);
        else f.onChange(null);
    };

    const hint = (f: FacetField) =>
        f.kind === "values" ? labels.browseHintValues
        : f.kind === "date" ? labels.browseHintDate
        : labels.browseHintPresence;

    // Dirty is COMPUTED from current-vs-saved, never counted: undoing an edit by hand has to clear
    // the "changed" badge on its own, or the badge becomes noise the user learns to ignore.
    const dirty = !!views?.savedSnapshot && !sameState(views.state, views.savedSnapshot);

    const active = fields.filter(isActive);
    const quickField = fields.find((f) => f.id === quickDateFieldId && f.kind === "date") as
        | (FacetField & { kind: "date" })
        | undefined;

    return (
        <div
            style={{
                background: "var(--card)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius)",
                boxShadow: "var(--shadow)",
                overflow: "hidden",
            }}
        >
            {views && (
                <div style={{ ...STRIP, background: "var(--surface-2)" }}>
                    <SavedViews
                        views={views.list}
                        activeId={views.activeId}
                        dirty={dirty}
                        state={views.state}
                        clearable={hasAnyFilter(views.state) || !!views.activeId}
                        onPick={views.onPick}
                        onClearView={views.onClearAll}
                        onRename={views.onRename}
                        onDuplicate={views.onDuplicate}
                        onDelete={views.onDelete}
                        onToggleShared={views.onToggleShared}
                        onSaveNew={views.onSaveNew}
                    />
                </div>
            )}

            <div style={STRIP}>
                {search && (
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--input)",
                            background: "var(--card)",
                            borderRadius: 8,
                            padding: "5px 9px",
                            flex: 1,
                            minWidth: 230,
                        }}
                    >
                        <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>⌕</span>
                        <input
                            value={search.value}
                            onChange={(e) => search.onChange(e.target.value)}
                            placeholder={search.placeholder ?? labels.browseSearchPlaceholder}
                            style={{
                                border: 0,
                                outline: 0,
                                background: "transparent",
                                color: "var(--foreground)",
                                fontSize: "var(--fs)",
                                padding: "2px 0",
                                flex: 1,
                                minWidth: 0,
                                fontFamily: "inherit",
                            }}
                        />
                        {search.value && (
                            <button
                                type="button"
                                onClick={() => search.onChange("")}
                                title={labels.browseClearSearch}
                                style={{ border: 0, background: "transparent", cursor: "pointer", color: "var(--muted-foreground)", padding: "0 2px" }}
                            >
                                ×
                            </button>
                        )}
                    </div>
                )}

                {junk && (
                    <button
                        type="button"
                        onClick={junk.onToggle}
                        aria-pressed={junk.active}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            borderRadius: 8,
                            padding: "4px 10px",
                            cursor: "pointer",
                            fontSize: "var(--fs-sm)",
                            background: junk.active ? "var(--entity-person-soft)" : "var(--card)",
                            color: junk.active ? "var(--primary)" : "var(--muted-foreground)",
                            border: `1px solid ${junk.active ? "var(--primary)" : "var(--border)"}`,
                        }}
                    >
                        <span>⚠</span>
                        <span>{junk.label}</span>
                        <span className="mono" style={{ fontSize: 11, opacity: 0.85 }}>{junk.count}</span>
                    </button>
                )}

                <button
                    type="button"
                    onClick={() => setAddOpen((v) => !v)}
                    aria-expanded={addOpen}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 6,
                        borderRadius: 8,
                        padding: "4px 10px",
                        cursor: "pointer",
                        background: "var(--card)",
                        border: "1px dashed var(--input)",
                        color: "var(--foreground)",
                        fontSize: "var(--fs-sm)",
                        fontWeight: 600,
                    }}
                >
                    <span style={{ color: "var(--primary)", fontSize: 13, lineHeight: 1 }}>+</span>
                    <span>{labels.browseAddFilter}</span>
                </button>

                {/* The four most common date windows, in the row itself — reaching them should not
                    cost a drawer and a panel. They drive the same field the panel does. */}
                {quickField && (
                    <span
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 4,
                            paddingInlineStart: 2,
                            borderInlineStart: "1px solid var(--border)",
                            flexWrap: "wrap",
                            maxWidth: "100%",
                        }}
                    >
                        <span style={{ fontSize: "10.5px", color: "var(--muted-foreground)", paddingInline: "6px 2px" }}>
                            {labels.browseQuickDates}
                        </span>
                        {QUICK_DATE_PRESETS.map((id: DatePresetId) => {
                            const on = quickField.value.preset === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    aria-pressed={on}
                                    onClick={() => quickField.onChange(on ? EMPTY_DATE : { preset: id, from: "", to: "" })}
                                    style={{
                                        cursor: "pointer",
                                        borderRadius: 20,
                                        padding: "2px 10px",
                                        fontSize: "11.5px",
                                        whiteSpace: "nowrap",
                                        background: on ? "var(--primary)" : "var(--card)",
                                        color: on ? "var(--primary-foreground)" : "var(--foreground)",
                                        border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                    }}
                                >
                                    {labels.datePresets[id] ?? id}
                                </button>
                            );
                        })}
                    </span>
                )}

                {/* Chips carry the VALUES, and clearing one is a separate hit area from inspecting it. */}
                {active.map((f) => (
                    <span
                        key={f.id}
                        title={`${f.label}: ${summary(f)}`}
                        style={{
                            display: "inline-flex",
                            alignItems: "stretch",
                            borderRadius: 8,
                            overflow: "hidden",
                            border: "1px solid var(--primary)",
                            background: "var(--entity-person-soft)",
                            color: "var(--primary)",
                            fontSize: "var(--fs-sm)",
                            maxWidth: 280,
                        }}
                    >
                        <button
                            type="button"
                            onClick={() => setOpenFacet(f.id)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                padding: "4px 9px",
                                minWidth: 0,
                                color: "inherit",
                            }}
                        >
                            <span style={{ opacity: 0.7, fontSize: 10 }}>▾</span>
                            <span style={{ fontWeight: 600, whiteSpace: "nowrap" }}>{f.label}</span>
                            <span style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", opacity: 0.9 }}>
                                {summary(f)}
                            </span>
                        </button>
                        <button
                            type="button"
                            onClick={() => clearField(f)}
                            title={labels.filterClear}
                            style={{
                                background: "transparent",
                                border: 0,
                                borderInlineStart: "1px solid var(--primary)",
                                cursor: "pointer",
                                padding: "0 8px",
                                lineHeight: 1,
                                display: "grid",
                                placeItems: "center",
                                color: "inherit",
                            }}
                        >
                            ×
                        </button>
                    </span>
                ))}

                <span style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8, flex: "0 0 auto" }}>
                    {active.length > 0 && onClearAll && (
                        <button
                            type="button"
                            onClick={onClearAll}
                            style={{
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                color: "var(--muted-foreground)",
                                textDecoration: "underline",
                                fontSize: "var(--fs-sm)",
                                padding: "4px 2px",
                            }}
                        >
                            {labels.browseClearAll}
                        </button>
                    )}
                    {toolbarEnd}
                </span>
            </div>

            {addOpen && (
                <div
                    style={{
                        padding: "9px 12px",
                        borderBottom: "1px solid var(--border)",
                        background: "var(--surface-sunken)",
                        animation: "pop .12s ease-out",
                    }}
                >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 7 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 11, color: "var(--muted-foreground)" }}>
                            {labels.browseAddFilterHint}
                        </span>
                        <button
                            type="button"
                            onClick={() => setAddOpen(false)}
                            style={{
                                flex: "0 0 auto",
                                background: "var(--card)",
                                border: "1px solid var(--border)",
                                borderRadius: 7,
                                padding: "5px 11px",
                                cursor: "pointer",
                                fontSize: "var(--fs-sm)",
                                color: "var(--muted-foreground)",
                            }}
                        >
                            {labels.browseClose}
                        </button>
                    </div>
                    <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
                        {fields.map((f) => {
                            const on = isActive(f);
                            return (
                                <button
                                    key={f.id}
                                    type="button"
                                    onClick={() => {
                                        setAddOpen(false);
                                        setOpenFacet(f.id);
                                    }}
                                    style={{
                                        textAlign: "start",
                                        cursor: "pointer",
                                        borderRadius: 9,
                                        padding: "7px 11px",
                                        minWidth: 150,
                                        background: on ? "var(--entity-person-soft)" : "var(--card)",
                                        border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                    }}
                                >
                                    <span style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 600, fontSize: "var(--fs-sm)" }}>
                                        {f.label}
                                        {on && <span style={{ color: "var(--primary)", fontSize: 10 }}>●</span>}
                                    </span>
                                    <span style={{ display: "block", fontSize: "10.5px", color: "var(--muted-foreground)", lineHeight: 1.45 }}>
                                        {f.hint ?? hint(f)}
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}

            {views && (
                <FilterStateBar
                    state={views.state}
                    hasView={!!views.activeId}
                    dirty={dirty}
                    onSaveNew={views.onSaveNew}
                    onSaveChange={views.onSaveChange}
                    onSaveAsNew={views.onSaveNew}
                    onRestore={views.onRestore}
                    onClear={views.onClearAll}
                />
            )}
            {selectionBar}

            {/* The facet strip sits with the rows, inside the same scroll container — see the note at
                the top. Everything below this line is the grid's own territory. */}
            <FacetPanel field={fields.find((f) => f.id === openFacet) ?? null} onClose={() => setOpenFacet(null)} />

            {children}

            {footer && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "9px 12px",
                        borderTop: "1px solid var(--border)",
                        background: "var(--surface-2)",
                        flexWrap: "wrap",
                    }}
                >
                    {footer}
                </div>
            )}
        </div>
    );
}

