"use client";

import { useEffect, useMemo, useState } from "react";
import { useMicroGridConfig } from "./config";

/**
 * The facet panel — one filter editor for every field, column or not.
 *
 * ── Why this exists rather than the column popover ───────────────────────────────────────────────
 * Filtering used to be reachable only by clicking a ▼ inside a column header. That made three things
 * impossible at once: filtering by a field that is not a column, filtering by a column the user has
 * hidden, and filtering at all on a phone (≤640px renders card rows, so there are no headers to
 * click). The design says as much in `facetRules[7]`:
 *
 *   "החלונית היא רצועה דביקה מתחת לשורת הכותרת, לא פופאובר מוחלט בתוך כרטיס עם overflow:hidden"
 *
 * So the panel is a sticky strip inside the grid's own scroll container, and a column header is just
 * one of two ways to open it — the other being "+ סינון". One editor, two doors. Two editors would
 * be two definitions of what "filtered" means, and they would drift the moment one learned about a
 * new field.
 *
 * ── The product rules, from "כללי חלונית הפיסוט" ─────────────────────────────────────────────────
 * They are rules, not styling, and each is load-bearing:
 *  - The search box appears only above `SEARCH_THRESHOLD` values. For מטפל (8) or סטטוס (4) it is noise.
 *  - Selected values sort FIRST and bold — an active filter must never hide behind a query.
 *  - The rest sort by descending count; show `PAGE`, then offer more and say how many stay hidden.
 *  - Every value is two controls in one shell: the body toggles, `רק` replaces the whole selection.
 *  - Counts come from the server, computed on the filtered set EXCLUDING this field — and the header
 *    says so, because a count the user cannot explain is a count they will not trust.
 *  - `—` is a legitimate value meaning "no value". Never filter it out; it IS the cleanup flow.
 *  - A vocabulary of ≤2 values raises a warning: a broken schema must be visible, not silent.
 */

/**
 * ≤640px is the project's phone breakpoint, derived in logic and not in a media query, because at
 * that width the panel becomes a different component (a bottom sheet), not a restyled one.
 * `null` until measured — the server has no viewport, and guessing one is a hydration mismatch.
 */
function useIsPhone(): boolean {
    const [w, setW] = useState<number | null>(null);
    useEffect(() => {
        const m = () => setW(window.innerWidth);
        m();
        window.addEventListener("resize", m);
        return () => window.removeEventListener("resize", m);
    }, []);
    return w !== null && w <= 640;
}

/** Above this many values the search box earns its space. Below it, it is chrome. */
const SEARCH_THRESHOLD = 10;
/** First page of values, then "הצג N נוספים". */
const PAGE = 12;
const PAGE_MORE = 24;

/** `count` is optional so a `ColumnFilterOption` from the shared kit drops straight in. A missing
    count renders as nothing rather than as a confident zero. */
export type FacetValue = { key: string; label: string; count?: number };

/** The nine presets, in the design's order (`Grid Filters.dc.html:692`). */
export type DatePresetId =
    | "today" | "yesterday" | "d7" | "d30"
    | "month" | "prevMonth" | "quarter" | "year"
    | "stale90" | "custom";

export type DateFilterValue = { preset: DatePresetId | null; from: string; to: string };

export const EMPTY_DATE: DateFilterValue = { preset: null, from: "", to: "" };

/** has / hasn't / don't care. `null` is "don't care" so an absent key means no filter. */
export type PresenceValue = true | false | null;

export type FacetFieldKind =
    | { kind: "values"; options: FacetValue[]; selected: string[]; onChange: (next: string[]) => void }
    | { kind: "date"; value: DateFilterValue; counts: Record<string, number>; onChange: (next: DateFilterValue) => void }
    | { kind: "presence"; value: PresenceValue; counts: { yes: number; no: number }; onChange: (next: PresenceValue) => void };

export type FacetField = { id: string; label: string; hint?: string } & FacetFieldKind;

/** Order matters — it is the order the pills render in. Labels come from the host's label set. */
export const DATE_PRESET_IDS: DatePresetId[] = [
    "today", "yesterday", "d7", "d30", "month", "prevMonth", "quarter", "year", "stale90",
];

/** The four that also sit inline in the search row (§4 of the handoff). */
export const QUICK_DATE_PRESETS: DatePresetId[] = ["today", "d7", "d30", "month"];

export const ALL_DATE_PRESETS: DatePresetId[] = DATE_PRESET_IDS;

const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const dayAdd = (d: Date, n: number) => {
    const x = new Date(d);
    x.setDate(x.getDate() + n);
    return x;
};

/**
 * Resolve a preset into a concrete window, HERE — on the client.
 *
 * "היום" is a question about the user's clock, and the server's clock is not it: a browser in Asia
 * and a database in UTC disagree about today for several hours a day. The server only ever receives
 * two dates. `stale90` is the one open-ended window — everything whose last activity is older than
 * 90 days, which is `{to}` with no `from`.
 */
export function resolveDateWindow(
    value: DateFilterValue,
    now = new Date(),
): { from?: string | null; to?: string | null } | undefined {
    const p = value.preset;
    if (!p) return undefined;
    if (p === "custom") return value.from || value.to ? { from: value.from || null, to: value.to || null } : undefined;
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (p) {
        case "today": return { from: iso(now), to: iso(now) };
        case "yesterday": return { from: iso(dayAdd(now, -1)), to: iso(dayAdd(now, -1)) };
        case "d7": return { from: iso(dayAdd(now, -6)), to: iso(now) };
        case "d30": return { from: iso(dayAdd(now, -29)), to: iso(now) };
        case "month": return { from: iso(new Date(y, m, 1)), to: iso(now) };
        case "prevMonth": return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
        case "quarter": return { from: iso(new Date(y, Math.floor(m / 3) * 3, 1)), to: iso(now) };
        case "year": return { from: iso(new Date(y, 0, 1)), to: iso(now) };
        case "stale90": return { to: iso(dayAdd(now, -90)) };
    }
}

/**
 * Human summary of an active date filter, for the chip. Takes the label set rather than reaching for
 * a module-level one: this runs outside React too (the host builds chip text from it).
 */
export function describeDate(v: DateFilterValue, labels?: { datePresets: Record<string, string>; dateCustomRange: string }): string | null {
    if (!v.preset) return null;
    if (v.preset !== "custom") return labels?.datePresets[v.preset] ?? v.preset;
    if (!v.from && !v.to) return null;
    return `${v.from || "…"} — ${v.to || "…"}`;
}

export function isDateActive(v: DateFilterValue | undefined): boolean {
    return !!v && !!v.preset && (v.preset !== "custom" || !!v.from || !!v.to);
}

/* ── The header trigger ──────────────────────────────────────────────────────────────────────── */

/**
 * The ▼ in a column header. It no longer owns a popover — it asks the shell to open the shared panel
 * on this field, which is what makes a header and "+ סינון" the same action.
 */
export function FacetTrigger({
    label,
    active,
    open,
    onOpen,
}: {
    label: string;
    active: boolean;
    open: boolean;
    onOpen: () => void;
}) {
    const { labels } = useMicroGridConfig();
    return (
        <button
            type="button"
            title={labels.filterBy(label)}
            aria-label={labels.filterBy(label)}
            aria-expanded={open}
            onClick={(e) => {
                // The header cell also sorts; a filter click must not become a sort click.
                e.stopPropagation();
                onOpen();
            }}
            style={{
                marginInlineStart: "auto",
                width: 18,
                height: 16,
                borderRadius: 4,
                fontSize: 9,
                cursor: "pointer",
                display: "grid",
                placeItems: "center",
                background: active ? "var(--entity-person-soft)" : "var(--card)",
                color: active ? "var(--primary)" : "var(--muted-foreground)",
                border: `1px solid ${active ? "var(--primary)" : "var(--border)"}`,
            }}
        >
            ▼
        </button>
    );
}

/* ── The panel ───────────────────────────────────────────────────────────────────────────────── */

export function FacetPanel({ field, onClose }: { field: FacetField | null; onClose: () => void }) {
    const { labels } = useMicroGridConfig();
    const isPhone = useIsPhone();
    const [query, setQuery] = useState("");
    const [shown, setShown] = useState(PAGE);

    // A fresh field is a fresh panel: keeping the previous query would silently hide values.
    useEffect(() => {
        setQuery("");
        setShown(PAGE);
    }, [field?.id]);

    useEffect(() => {
        if (!field) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                onClose();
            }
        };
        document.addEventListener("keydown", onKey);
        return () => document.removeEventListener("keydown", onKey);
    }, [field, onClose]);

    if (!field) return null;

    const shell: React.CSSProperties = isPhone
        ? {
              position: "fixed",
              insetInline: 0,
              bottom: 0,
              zIndex: 40,
              maxWidth: "none",
              borderRadius: "16px 16px 0 0",
              maxHeight: "82vh",
              overflow: "auto",
              boxShadow: "0 -8px 40px rgba(0,0,0,.3)",
          }
        : {
              position: "sticky",
              insetInlineStart: 0,
              top: 0,
              zIndex: 3,
              maxWidth: 700,
              borderRadius: 0,
              boxShadow: "var(--shadow)",
          };

    return (
        <>
            {/* The sheet needs its own scrim; the sticky strip does not — it is inside the flow. */}
            {isPhone && (
                <div
                    onClick={onClose}
                    style={{ position: "fixed", inset: 0, zIndex: 39, background: "rgba(10,11,15,.34)" }}
                />
            )}
            <div
                role="dialog"
                aria-label={labels.filterBy(field.label)}
                style={{
                    ...shell,
                    background: "var(--card)",
                    borderBottom: "1px solid var(--border)",
                    padding: "10px 12px",
                }}
            >
                {isPhone && (
                    <div
                        onClick={onClose}
                        style={{ display: "flex", justifyContent: "center", padding: "2px 0 8px", cursor: "pointer" }}
                    >
                        <span style={{ width: 38, height: 4, borderRadius: 3, background: "var(--input)", display: "block" }} />
                    </div>
                )}

                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <span style={{ fontWeight: 700 }}>{labels.filterBy(field.label)}</span>
                    {!isPhone && (
                        <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            {labels.filterCountsNote}
                        </span>
                    )}
                    <span style={{ marginInlineStart: "auto", display: "flex", alignItems: "center", gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => clearField(field)}
                            style={{
                                background: "transparent",
                                border: 0,
                                cursor: "pointer",
                                color: "var(--primary)",
                                textDecoration: "underline",
                                fontSize: "var(--fs-sm)",
                                padding: "6px 2px",
                            }}
                        >
                            {labels.filterClear}
                        </button>
                        <button
                            type="button"
                            onClick={onClose}
                            title={labels.browseClose}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 6,
                                background: "var(--surface-sunken)",
                                border: "1px solid var(--border)",
                                borderRadius: 7,
                                padding: isPhone ? "7px 14px" : "1px 6px",
                                fontSize: isPhone ? "var(--fs-sm)" : 10,
                                cursor: "pointer",
                            }}
                        >
                            {isPhone ? labels.browseClose : "esc"}
                        </button>
                    </span>
                </div>

                {field.kind === "date" && <DateBody field={field} />}
                {field.kind === "presence" && <PresenceBody field={field} />}
                {field.kind === "values" && (
                    <ValuesBody
                        field={field}
                        query={query}
                        setQuery={setQuery}
                        shown={shown}
                        setShown={setShown}
                    />
                )}
            </div>
        </>
    );
}

function clearField(field: FacetField) {
    if (field.kind === "values") field.onChange([]);
    else if (field.kind === "date") field.onChange(EMPTY_DATE);
    else field.onChange(null);
}

/* ── Date ────────────────────────────────────────────────────────────────────────────────────── */

function DateBody({ field }: { field: FacetField & { kind: "date" } }) {
    const { labels } = useMicroGridConfig();
    const { value, counts, onChange } = field;
    const custom = value.preset === "custom";
    return (
        <div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 9 }}>
                {DATE_PRESET_IDS.map((id) => {
                    const on = value.preset === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(on ? EMPTY_DATE : { preset: id, from: "", to: "" })}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                cursor: "pointer",
                                borderRadius: 20,
                                padding: "4px 12px",
                                fontSize: "var(--fs-sm)",
                                fontWeight: on ? 700 : 500,
                                background: on ? "var(--primary)" : "var(--card)",
                                color: on ? "var(--primary-foreground)" : "var(--foreground)",
                                border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                            }}
                        >
                            <span>{labels.datePresets[id] ?? id}</span>
                            <span className="mono" style={{ fontSize: "10.5px", opacity: 0.7 }}>
                                {counts[id] ?? 0}
                            </span>
                        </button>
                    );
                })}
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                    borderRadius: 8,
                    padding: "8px 10px",
                    background: custom ? "var(--entity-person-soft)" : "var(--surface-sunken)",
                    border: `1px solid ${custom ? "var(--primary)" : "var(--border)"}`,
                }}
            >
                <span style={{ fontSize: "var(--fs-sm)", fontWeight: 600 }}>{labels.dateCustomRange}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{labels.dateFrom}</span>
                    <input
                        type="date"
                        value={value.from}
                        onChange={(e) => onChange({ preset: "custom", from: e.target.value, to: value.to })}
                        style={dateInput}
                    />
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>{labels.dateTo}</span>
                    <input
                        type="date"
                        value={value.to}
                        onChange={(e) => onChange({ preset: "custom", from: value.from, to: e.target.value })}
                        style={dateInput}
                    />
                </span>
            </div>

            <div style={{ marginTop: 8, fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>
                {describeDate(value, labels) ? labels.dateShowing(describeDate(value, labels)!) : labels.dateNoRange}
                {" · "}
                {labels.dateRangeNote}
            </div>
        </div>
    );
}

const dateInput: React.CSSProperties = {
    border: "1px solid var(--input)",
    background: "var(--card)",
    color: "var(--foreground)",
    borderRadius: 6,
    padding: "3px 7px",
    fontSize: "var(--fs-sm)",
    fontFamily: "inherit",
};

/* ── Presence ────────────────────────────────────────────────────────────────────────────────── */

/**
 * Three states, not a checkbox. "יש טלפון" and "אין טלפון" are both real questions, and a two-state
 * control forces the second one to be spelled as the absence of the first — which reads as "no
 * filter" and is exactly the confusion this avoids.
 */
function PresenceBody({ field }: { field: FacetField & { kind: "presence" } }) {
    const { labels } = useMicroGridConfig();
    const { value, counts, onChange } = field;
    const options: { v: PresenceValue; label: string; count: number | null }[] = [
        { v: null, label: labels.presenceAny, count: null },
        { v: true, label: labels.presenceHas(field.label), count: counts.yes },
        { v: false, label: labels.presenceHasNot(field.label), count: counts.no },
    ];
    return (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {options.map((o) => {
                    const on = value === o.v;
                    return (
                        <button
                            key={String(o.v)}
                            type="button"
                            aria-pressed={on}
                            onClick={() => onChange(o.v)}
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: 7,
                                cursor: "pointer",
                                borderRadius: 20,
                                padding: "5px 13px",
                                minHeight: 32,
                                fontSize: "var(--fs-sm)",
                                fontWeight: on ? 700 : 500,
                                background: on ? "var(--primary)" : "var(--card)",
                                color: on ? "var(--primary-foreground)" : "var(--foreground)",
                                border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                            }}
                        >
                            <span>{o.label}</span>
                            {o.count !== null && (
                                <span className="mono" style={{ fontSize: "10.5px", opacity: 0.7 }}>
                                    {o.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            {field.hint && (
                <div style={{ fontSize: 11, color: "var(--muted-foreground)", lineHeight: 1.5 }}>{field.hint}</div>
            )}
        </div>
    );
}

/* ── Values ──────────────────────────────────────────────────────────────────────────────────── */

function ValuesBody({
    field,
    query,
    setQuery,
    shown,
    setShown,
}: {
    field: FacetField & { kind: "values" };
    query: string;
    setQuery: (s: string) => void;
    shown: number;
    setShown: (n: number) => void;
}) {
    const { labels } = useMicroGridConfig();
    const { options, selected, onChange } = field;
    const showSearch = options.length > SEARCH_THRESHOLD;
    const sparse = options.length > 0 && options.length <= 2;

    // Selected first and bold, then by descending count. Sorting the selection to the top is what
    // stops an active filter from disappearing behind a query the user just typed.
    const ordered = useMemo(() => {
        const sel = new Set(selected);
        return [...options].sort((a, b) => {
            const as = sel.has(a.key) ? 0 : 1;
            const bs = sel.has(b.key) ? 0 : 1;
            return as !== bs ? as - bs : (b.count ?? 0) - (a.count ?? 0);
        });
    }, [options, selected]);

    const matched = useMemo(() => {
        const q = query.trim().toLowerCase();
        return q ? ordered.filter((o) => o.label.toLowerCase().includes(q)) : ordered;
    }, [ordered, query]);

    const visible = matched.slice(0, shown);
    const hidden = matched.length - visible.length;

    const toggle = (key: string) =>
        onChange(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key]);

    return (
        <>
            {showSearch && (
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 6,
                            border: "1px solid var(--input)",
                            borderRadius: 7,
                            padding: "3px 8px",
                            flex: 1,
                            minWidth: 0,
                        }}
                    >
                        <span style={{ color: "var(--muted-foreground)", fontSize: 12 }}>⌕</span>
                        <input
                            value={query}
                            onChange={(e) => {
                                setQuery(e.target.value);
                                setShown(PAGE);
                            }}
                            placeholder={labels.filterSearchPlaceholder(options.length)}
                            style={{
                                border: 0,
                                outline: 0,
                                background: "transparent",
                                color: "var(--foreground)",
                                fontSize: "var(--fs-sm)",
                                flex: 1,
                                minWidth: 0,
                                fontFamily: "inherit",
                            }}
                        />
                    </div>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                        {labels.filterMatchCount(matched.length, options.length)}
                    </span>
                </div>
            )}

            {selected.length > 0 && (
                <div style={{ fontSize: 11, color: "var(--primary)", marginBottom: 6 }}>
                    {labels.filterSelectedNote(selected.length)}
                </div>
            )}

            {sparse && (
                <div
                    style={{
                        fontSize: 11,
                        color: "var(--warning)",
                        background: "var(--warning-soft)",
                        border: "1px solid var(--warning)",
                        borderRadius: 6,
                        padding: "5px 8px",
                        marginBottom: 7,
                        lineHeight: 1.45,
                    }}
                >
                    {labels.filterSparseWarning}
                </div>
            )}

            <div
                style={{
                    maxHeight: 238,
                    overflowY: "auto",
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                    padding: 1,
                }}
            >
                {visible.map((v) => {
                    const on = selected.includes(v.key);
                    return (
                        <span
                            key={v.key}
                            style={{
                                display: "flex",
                                alignItems: "stretch",
                                minHeight: 32,
                                flex: "0 0 auto",
                                border: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                background: on ? "var(--entity-person-soft)" : "var(--card)",
                                borderRadius: 7,
                                overflow: "hidden",
                            }}
                        >
                            <button
                                type="button"
                                onClick={() => toggle(v.key)}
                                aria-pressed={on}
                                style={{
                                    flex: 1,
                                    minWidth: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    gap: 9,
                                    background: "transparent",
                                    border: 0,
                                    cursor: "pointer",
                                    padding: "6px 10px",
                                    textAlign: "start",
                                }}
                            >
                                <span
                                    style={{
                                        width: 14,
                                        height: 14,
                                        flex: "0 0 14px",
                                        border: `1.5px solid ${on ? "var(--primary)" : "var(--input)"}`,
                                        background: on ? "var(--primary)" : "transparent",
                                        color: "var(--primary-foreground)",
                                        borderRadius: 4,
                                        display: "grid",
                                        placeItems: "center",
                                        fontSize: 10,
                                    }}
                                >
                                    {on ? "✓" : ""}
                                </span>
                                {/* dir=auto + isolate, and the ellipsis on THIS span — a mixed-script value
                                    truncated on the RTL parent loses the end, which is the identifying part. */}
                                <span
                                    dir="auto"
                                    style={{
                                        unicodeBidi: "isolate",
                                        fontWeight: on ? 700 : 500,
                                        whiteSpace: "nowrap",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        minWidth: 0,
                                    }}
                                >
                                    {v.label}
                                </span>
                                <span
                                    className="mono"
                                    style={{
                                        marginInlineStart: "auto",
                                        flex: "0 0 auto",
                                        paddingInlineStart: 8,
                                        fontSize: 11,
                                        color: "var(--muted-foreground)",
                                    }}
                                >
                                    {v.count ?? ""}
                                </span>
                            </button>
                            <button
                                type="button"
                                title={labels.filterOnlyTitle(v.label)}
                                onClick={() => onChange([v.key])}
                                style={{
                                    flex: "0 0 auto",
                                    background: "transparent",
                                    border: 0,
                                    borderInlineStart: `1px solid ${on ? "var(--primary)" : "var(--border)"}`,
                                    cursor: "pointer",
                                    padding: "0 11px",
                                    fontSize: 11,
                                    color: "var(--muted-foreground)",
                                }}
                            >
                                {labels.filterOnly}
                            </button>
                        </span>
                    );
                })}

                {matched.length === 0 && (
                    <div style={{ padding: "12px 4px", textAlign: "center", lineHeight: 1.6 }}>
                        <div style={{ fontWeight: 600 }}>{labels.filterNoMatch}</div>
                        <div style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                            {labels.filterNoMatchHint}
                        </div>
                    </div>
                )}
            </div>

            {hidden > 0 && (
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
                    <button
                        type="button"
                        onClick={() => setShown(shown + PAGE_MORE)}
                        style={{
                            background: "var(--surface-sunken)",
                            border: "1px solid var(--border)",
                            borderRadius: 7,
                            padding: "3px 10px",
                            cursor: "pointer",
                            fontSize: "var(--fs-sm)",
                        }}
                    >
                        {labels.filterShowMore(Math.min(PAGE_MORE, hidden))}
                    </button>
                    <span style={{ fontSize: 11, color: "var(--muted-foreground)" }}>
                        {labels.filterHiddenNote(hidden)}
                    </span>
                </div>
            )}
        </>
    );
}
