"use client";

// MicroGrid — production component
// --------------------------------
// Lightweight grid renderer. Receives already-filtered/sorted/paged rows from
// the host. Owns: selection state (controlled),
// inline edit, row actions, mobile-card auto-switch.
//
// Does NOT own: data fetching, server filtering, pagination UI, saved views.
// Those live outside the grid (see docs/microgrid-design.md §1).

import { Fragment, useCallback, useMemo, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { Check, ChevronDown, ChevronRight, Inbox, MoreHorizontal, Pencil } from "lucide-react";
import { cn } from "./utils";
import { useMicroGridConfig } from "./config";
import { cellStateAria, cellStateTreatment, MESSAGE_TONE, NON_EDITABLE, type MicroCellMeta } from "./cellState";
import type {
    MicroColumn,
    MicroGroup,
    MicroGridDensity,
    MicroGridProps,
    MicroRowAction,
    MicroRowTone,
} from "./types";
import {
    resolveResponsiveColumns,
    type ResolvedResponsiveColumn,
    type ResolvedResponsiveColumns,
    type ResolvedResponsiveField,
} from "./responsiveGroups";
import { CellEditor } from "./internals/CellEditor";
import { useIsBelow } from "./internals/useIsMobile";

// ─── Design tokens ────────────────────────────────────────────────────────
// The grid's look is the Skyz design handoff (GRID_AND_FILTERS §1–§4, §10–§11), applied here in
// the component rather than in any host stylesheet — the package ships no CSS, so this is what
// makes the design travel to every consumer instead of being re-skinned per app.
//
// Each value reads a host design token and falls back to something derived from the base palette.
// A host that has adopted the Skyz token set (--surface-sunken, --fs-sm, --surface-2) gets the
// handoff's exact colours and density scale; a host that has not still gets its structure — sunken
// header, hairline rules, centred fixed-height rows — in its own palette.

/** Header band. Sunken, not the row surface: the header is chrome, not data. */
const HEAD_BG = "var(--surface-sunken, color-mix(in oklab, var(--muted) 55%, var(--card)))";
/** Header type: --fs-sm at 700, no case transform and no letter-spacing (§1). */
const HEAD_FS = "var(--fs-sm, 12px)";
/** Body type. Density-driven where the host defines the scale. */
const BODY_FS = "var(--fs-sm, 13px)";
/** Ordinary row surface. Must be opaque (§4b) — a transparent row loses the frozen columns. */
const ROW_BG_BASE = "var(--card)";
// Hover is `color-mix(in oklab, var(--muted) 45%, var(--card))`, but it lives inline in the row's
// class string (see rowClass) rather than here: Tailwind's scanner reads source text, so an
// arbitrary value assembled from a constant would never make it into the stylesheet.
/** Checkbox-selected row. */
const ROW_BG_SELECTED = "color-mix(in srgb, var(--primary) 10%, var(--card))";
/** The row currently open in a split-preview panel — distinct from selection. */
const ROW_BG_ACTIVE = "color-mix(in srgb, var(--primary) 16%, var(--card))";

const ROW_TONE_BG: Record<MicroRowTone, string> = {
    muted: "var(--surface-2, color-mix(in oklab, var(--muted) 35%, var(--card)))",
    warning: "var(--warning-soft, color-mix(in oklab, var(--warning) 14%, var(--card)))",
    danger: "color-mix(in oklab, var(--destructive) 12%, var(--card))",
};

/**
 * The scroll track, when there is one. A grid lives inside a panel, so the browser's default 15px
 * chrome is a slab of grey across the bottom of the card. Thin, token-tinted, and it darkens on
 * hover so it is findable without being loud. Written as utilities rather than a stylesheet rule
 * because this component ships without CSS — see the design-token block above.
 */
const SCROLLBAR_CLASS = cn(
    "[scrollbar-width:thin]",
    "[scrollbar-color:color-mix(in_oklab,var(--muted-foreground)_30%,transparent)_transparent]",
    "[&::-webkit-scrollbar]:h-1.5",
    "[&::-webkit-scrollbar-track]:bg-transparent",
    "[&::-webkit-scrollbar-thumb]:rounded-full",
    "[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_oklab,var(--muted-foreground)_30%,transparent)]",
    "hover:[&::-webkit-scrollbar-thumb]:bg-[color-mix(in_oklab,var(--muted-foreground)_55%,transparent)]",
);

/** Header row height (§1). Fixed across densities — it is chrome, and it should not grow. */
const HEAD_HEIGHT = 28;

// ─── Constants ────────────────────────────────────────────────────────────

// Row height per density — the design bundle's --rowh values, used as the FALLBACK for the host
// token so an app that ships the density scale drives it from there instead.
const DENSITY_ROW_HEIGHT: Record<MicroGridDensity, number> = {
    compact: 32,
    cozy: 42,
};

/** `height: var(--rowh, <density>)` — the host's density token wins where it exists. */
function rowHeightCss(density: MicroGridDensity): string {
    return `var(--rowh, ${DENSITY_ROW_HEIGHT[density]}px)`;
}

/**
 * Cell padding comes from `--cellpad`, not from a density class.
 *
 * That is what makes the four TEXT SCALES work: a scale re-declares --cellpad along with --rowh and
 * --fs, so the cell breathes with the type. Tailwind classes keyed off density could not — they only
 * know two steps and nothing about scale, so at 150% the text grew and the padding did not.
 *
 * The per-density numbers survive as the fallback for a host that ships no token.
 */
const DENSITY_CELL_PAD: Record<MicroGridDensity, string> = {
    compact: "8px",
    cozy: "12px",
};

/** Horizontal padding — the full --cellpad. */
function cellPadX(density: MicroGridDensity): string {
    return `var(--cellpad, ${DENSITY_CELL_PAD[density]})`;
}

/**
 * Vertical padding is HALF the token: the row already has a fixed height from --rowh, so applying the
 * full value top and bottom overflows a compact row (8+8 padding inside a 32px row leaves 16px for
 * 13.5px text plus its line-height). Halving keeps the cell centred at every scale.
 */
function cellPadY(density: MicroGridDensity): string {
    return `calc(var(--cellpad, ${DENSITY_CELL_PAD[density]}) / 2)`;
}

const MEDIUM_RESPONSIVE_FIELD_WIDTH_CLASS = "w-[180px] max-w-[180px]";
const EMPTY_COLLAPSED_GROUPS = new Set<string>();

// ─── Helpers ──────────────────────────────────────────────────────────────

function resolveValue<T>(row: T, accessor: MicroColumn<T>["accessor"]): unknown {
    if (typeof accessor === "function") return accessor(row);
    return (row as Record<string, unknown>)[accessor as string];
}

function titleFromValue(value: unknown): string | undefined {
    if (typeof value === "string") {
        const trimmed = value.trim();
        return trimmed.length > 0 ? trimmed : undefined;
    }
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return undefined;
}

/**
 * GRID_AND_FILTERS §3: never an empty cell. A blank reads as a render bug; `—` reads as "this card
 * has no city", which is information. Opt a column out with `noEmptyDash` when its blank state is
 * meaningful on its own (icon and action columns).
 */
function isEmptyContent(node: ReactNode): boolean {
    return node === null || node === undefined || node === "" || node === false;
}

function EmptyDash() {
    return (
        <span aria-hidden className="text-muted-foreground">
            —
        </span>
    );
}

function navigableDisplayValue(value: unknown): ReactNode {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
    if (value instanceof Date) return value.toLocaleDateString();
    return null;
}

function alignClass(align: MicroColumn<unknown>["align"]): string {
    if (align === "center") return "text-center justify-center";
    if (align === "end") return "text-end justify-end";
    return "text-start justify-start";
}

// ─── Row background: one inherited custom property ────────────────────────
// GRID_AND_FILTERS §4b. Frozen cells need an opaque background of their own or scrolling content
// slides under them — but a per-cell background breaks row hover, because `:hover` matches only
// the element under the pointer: hovering an unpinned cell highlights the row while the frozen
// name cell stays card-white, and the row renders two-tone.
//
// So there is exactly one source of truth per row: `--mg-row-bg`, set on the <tr>. The row paints
// from it and so does every frozen cell. Custom properties inherit, so hovering anywhere in the
// row repaints all of them in step, and skeleton rows get the same treatment for free.
//
// Hover is a SECOND property, `--mg-row-tint`, and that split is not cosmetic. `--mg-row-bg` is an
// inline style, and an inline declaration outranks any stylesheet rule that is not !important — a
// `:hover { --mg-row-bg: … }` rule would simply never win. So hover sets its own property and
// everything paints `var(--mg-row-tint, var(--mg-row-bg))`: the tint when one exists, the row's
// resolved background otherwise.
const ROW_BG_VAR = "--mg-row-bg";
/** What a frozen cell paints: the hover tint if there is one, else the row's own background. */
const ROW_PAINT = `var(--mg-row-tint, var(${ROW_BG_VAR}, ${ROW_BG_BASE}))`;

// The split-preview "active row" marker has the same problem as the background, one layer up: a
// box-shadow on the <tr> is painted UNDER the frozen cells, which are opaque and positioned, so the
// ring is sliced off at the frozen boundary and the marked row looks broken exactly when the user
// scrolls sideways to read it.
//
// So the ring is inherited too — `--mg-row-ring`, set on the row and drawn by every cell. Top and
// bottom edges only: those tile seamlessly across cell boundaries, where a full per-cell ring would
// draw a vertical rule between every pair of columns.
const ROW_RING_VAR = "--mg-row-ring";
const ROW_RING_ACTIVE = "inset 0 1.5px 0 0 var(--primary), inset 0 -1.5px 0 0 var(--primary)";
/** Body-cell box-shadow: the row's ring when it has one, an invisible shadow when it does not. */
const CELL_RING = `var(${ROW_RING_VAR}, 0 0 transparent)`;

/** Style for an ordinary (unfrozen) body cell. */
function bodyCellStyle(density: MicroGridDensity, extra?: CSSProperties): CSSProperties {
    return {
        boxShadow: CELL_RING,
        paddingInline: cellPadX(density),
        paddingBlock: cellPadY(density),
        ...extra,
    };
}

/** Resolved row background, highest-priority state first. */
function rowBackground(state: {
    active?: boolean;
    selected?: boolean;
    tone?: MicroRowTone;
}): string {
    if (state.active) return ROW_BG_ACTIVE;
    if (state.selected) return ROW_BG_SELECTED;
    if (state.tone) return ROW_TONE_BG[state.tone];
    return ROW_BG_BASE;
}

/** <tr> style: fixed density-driven height, the row's own `--mg-row-bg`, and its ring if active. */
function rowStyle(density: MicroGridDensity, background: string, active = false): CSSProperties {
    return {
        height: rowHeightCss(density),
        [ROW_BG_VAR]: background,
        ...(active ? { [ROW_RING_VAR]: ROW_RING_ACTIVE } : null),
    } as CSSProperties;
}

/**
 * Row classes. Hover is a custom-property override rather than a `bg-*` utility so it reaches the
 * frozen cells too — and it is only applied when no higher-priority state owns the row, so hovering
 * a selected or junk row does not wash its meaning out.
 */
function rowClass(interactive: boolean, hoverable: boolean): string {
    return cn(
        "group border-b border-border bg-[var(--mg-row-tint,var(--mg-row-bg))] transition-colors",
        hoverable && "hover:[--mg-row-tint:color-mix(in_oklab,var(--muted)_45%,var(--card))]",
        interactive && "cursor-pointer",
    );
}

/** Header cell: sunken band, --fs-sm at 700, no case transform, fixed 28px (§1). */
const HEAD_CELL_CLASS =
    "border-b border-border align-middle font-bold normal-case tracking-normal text-muted-foreground";

function headCellStyle(extra?: CSSProperties): CSSProperties {
    return {
        background: HEAD_BG,
        fontSize: HEAD_FS,
        height: HEAD_HEIGHT,
        paddingTop: 0,
        paddingBottom: 0,
        ...extra,
    };
}

// ─── Pinned (frozen leading) columns ──────────────────────────────────────
// GRID_AND_FILTERS §4. Freezes contiguous leading columns to the inline-start edge during
// horizontal scroll. Desktop table layout only; mobile/card layouts ignore it.
const PIN_SELECTION_WIDTH = 40; // selection column is w-10 (2.5rem)
// Separating shadow on the trailing edge of the last frozen column. In RTL the scrolling content
// sits to the physical LEFT of the frozen block ⇒ shadow on the -x side.
const PIN_EDGE_SHADOW = "-8px 0 8px -8px color-mix(in srgb, var(--foreground) 22%, transparent)";

/**
 * Sticky style for a pinned column at `index` within the ordered visible columns, or null when the
 * column is not pinned. The inline-start offset accumulates the selection column (if shown) plus the
 * declared widths of the pinned columns before it. `isLast` flags the final pinned column so its
 * cells can carry the divider. RTL-safe via the logical `insetInlineStart`.
 *
 * Body cells paint from the row's inherited `--mg-row-bg` (§4b) so the frozen block tracks hover,
 * selection and row tone with the rest of the row instead of staying card-white. Header cells paint
 * the header band, and sit above body cells (§4c: z-4 vs z-2) so a vertically-scrolled row passes
 * under the frozen header corner rather than through it.
 */
function pinnedColumnSticky<T>(
    columns: MicroColumn<T>[],
    index: number,
    showSelection: boolean,
    variant: "header" | "cell",
): CSSProperties | undefined {
    const col = columns[index];
    if (col?.pinned !== "start") return undefined;
    let offset = showSelection ? PIN_SELECTION_WIDTH : 0;
    for (let i = 0; i < index; i++) {
        if (columns[i]?.pinned !== "start") break; // contiguity guard — stop at first non-pinned
        const w = columns[i]?.width;
        offset += typeof w === "number" ? w : Number.parseFloat(String(w ?? "")) || 0;
    }
    const isLast = columns[index + 1]?.pinned !== "start";
    return {
        position: "sticky",
        insetInlineStart: offset,
        zIndex: variant === "header" ? 4 : 2,
        background: variant === "header" ? HEAD_BG : ROW_PAINT,
        ...(variant === "cell" ? { boxShadow: isLast ? `${CELL_RING}, ${PIN_EDGE_SHADOW}` : CELL_RING } : null),
        ...(isLast ? { borderInlineEnd: "1px solid var(--border)" } : null),
        ...(variant === "header" && isLast ? { boxShadow: PIN_EDGE_SHADOW } : null),
    };
}

/**
 * Sticky style for the selection column when any data column is pinned (it freezes at offset 0).
 * §4a: both cells of the pinned group must be sticky, or neither. A static checkbox beside a sticky
 * name cell does not merely stay put — the sticky sibling slides *over* it, and at laptop width the
 * checkbox leaves the viewport entirely, taking the selection → merge flow with it.
 */
function selectionColumnSticky(hasPinned: boolean, variant: "header" | "cell"): CSSProperties | undefined {
    if (!hasPinned) return undefined;
    return {
        position: "sticky",
        insetInlineStart: 0,
        zIndex: variant === "header" ? 4 : 2,
        background: variant === "header" ? HEAD_BG : ROW_PAINT,
        ...(variant === "cell" ? { boxShadow: CELL_RING } : null),
    };
}

function EditPencilButton({ onClick, className }: { onClick: () => void; className?: string }) {
    return (
        <button
            type="button"
            data-action="edit"
            aria-label="עריכה"
            title="עריכה"
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onClick();
            }}
            className={cn(
                "inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border-none bg-transparent text-muted-foreground/70 outline-none transition-colors hover:bg-primary/10 hover:text-primary focus-visible:ring-2 focus-visible:ring-primary",
                "opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100",
                className,
            )}
        >
            <Pencil className="h-3.5 w-3.5 pointer-events-none" aria-hidden />
        </button>
    );
}

// ─── Selection cell ───────────────────────────────────────────────────────

function SelectionBox({
    checked,
    indeterminate,
    onToggle,
    ariaLabel,
}: {
    checked: boolean;
    indeterminate?: boolean;
    onToggle: (e: React.MouseEvent | React.KeyboardEvent) => void;
    ariaLabel: string;
}) {
    return (
        <button
            type="button"
            role="checkbox"
            aria-checked={indeterminate ? "mixed" : checked}
            aria-label={ariaLabel}
            onClick={(e) => {
                e.stopPropagation();
                onToggle(e);
            }}
            // §10: 15px box, 4px radius, 1.5px rule in --input. Sized against the 30px row rather
            // than the 4px grid — at h-4 it crowds a compact row.
            className={cn(
                "flex h-[15px] w-[15px] items-center justify-center rounded-[4px] border-[1.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1",
                checked || indeterminate
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-input bg-background hover:border-primary/60",
            )}
        >
            {indeterminate ? (
                <span className="h-0.5 w-2 rounded bg-current" />
            ) : checked ? (
                <Check className="h-3 w-3" strokeWidth={3} />
            ) : null}
        </button>
    );
}

// ─── Default empty state ──────────────────────────────────────────────────

function DefaultEmpty({ message }: { message?: string }) {
    const { labels } = useMicroGridConfig();
    return (
        <div className="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
            <Inbox className="h-10 w-10 opacity-30" aria-hidden />
            <p className="text-sm">{message ?? labels.empty}</p>
        </div>
    );
}

function readGlobalDensity(): MicroGridDensity {
    if (typeof document === "undefined") return "cozy";
    const density = document.documentElement.dataset.density;
    // Two steps, matching the design bundle. This used to accept "comfortable" and REJECT "cozy",
    // so a host stamping the design's own cozy value silently got the default instead.
    if (density === "compact" || density === "cozy") return density;
    return "cozy";
}

function useGlobalMicroGridDensity(): MicroGridDensity {
    const { densityEventName } = useMicroGridConfig();
    // Must be stable across renders — a fresh subscribe function on every render
    // makes useSyncExternalStore tear down and re-add the listener each time.
    const subscribe = useCallback(
        (onStoreChange: () => void) => {
            window.addEventListener(densityEventName, onStoreChange);
            return () => window.removeEventListener(densityEventName, onStoreChange);
        },
        [densityEventName],
    );
    return useSyncExternalStore(subscribe, readGlobalDensity, () => "cozy");
}

function GroupCollapseToggle({
    collapsed,
    onToggle,
    label,
}: {
    collapsed: boolean;
    onToggle?: () => void;
    label: string;
}) {
    const Icon = collapsed ? ChevronRight : ChevronDown;
    return (
        <button
            type="button"
            data-testid="group-collapse-toggle"
            aria-label={label}
            aria-expanded={!collapsed}
            onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggle?.();
            }}
            className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-background/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary"
        >
            <Icon className={cn("h-4 w-4", collapsed && "rtl:rotate-180")} aria-hidden />
        </button>
    );
}

function GroupDividerContent({
    label,
    count,
    collapsed,
    onToggle,
    toggleLabel,
}: {
    label: string;
    count: number;
    collapsed: boolean;
    onToggle?: () => void;
    toggleLabel: string;
}) {
    return (
        <div className="flex items-center gap-2 text-start text-xs font-semibold text-muted-foreground">
            <GroupCollapseToggle collapsed={collapsed} onToggle={onToggle} label={toggleLabel} />
            <span>{label}</span>
            <span className="rounded-full bg-background/70 px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground">
                ({count})
            </span>
        </div>
    );
}

function TableGroupDivider({
    label,
    count,
    colSpan,
    collapsed,
    onToggle,
    toggleLabel,
}: {
    label: string;
    count: number;
    colSpan: number;
    collapsed: boolean;
    onToggle?: () => void;
    toggleLabel: string;
}) {
    return (
        <tr data-group-divider="true" className="border-b border-border bg-[var(--surface-sunken,color-mix(in_oklab,var(--muted)_55%,var(--card)))]">
            <td colSpan={colSpan} className="px-3 py-1.5">
                <GroupDividerContent
                    label={label}
                    count={count}
                    collapsed={collapsed}
                    onToggle={onToggle}
                    toggleLabel={toggleLabel}
                />
            </td>
        </tr>
    );
}

function MobileGroupDivider({
    label,
    count,
    collapsed,
    onToggle,
    toggleLabel,
}: {
    label: string;
    count: number;
    collapsed: boolean;
    onToggle?: () => void;
    toggleLabel: string;
}) {
    return (
        <div data-group-divider="true" className="rounded-md bg-muted/50 px-3 py-1.5">
            <GroupDividerContent
                label={label}
                count={count}
                collapsed={collapsed}
                onToggle={onToggle}
                toggleLabel={toggleLabel}
            />
        </div>
    );
}

function visibleGroups<T>(groups: MicroGroup<T>[] | undefined, hideEmptyGroups: boolean): MicroGroup<T>[] | null {
    if (groups === undefined) return null;
    return hideEmptyGroups ? groups.filter((group) => group.rows.length > 0) : groups;
}

// ─── Main component ───────────────────────────────────────────────────────

export function MicroGrid<T>(props: MicroGridProps<T>) {
    const {
        rows,
        groups,
        hideEmptyGroups = false,
        collapsedGroups = EMPTY_COLLAPSED_GROUPS,
        onToggleGroup,
        columns,
        narrowColumns,
        getRowId,
        ariaLabel,
        selection = "none",
        selectedIds = [],
        onSelectionChange,
        onCellChange,
        rowActions,
        onRowClick,
        getRowTone,
        previewOnNavigableClick,
        activeRowId,
        density: densityProp,
        loading,
        emptyState,
        emptyMessage,
        className,
        mobileBreakpoint = 640,
        mediumBreakpoint,
        narrowBreakpoint = 720,
        forceMobile,
        forceNarrow,
        responsiveGroups,
    } = props;
    const globalDensity = useGlobalMicroGridDensity();
    const density = densityProp ?? globalDensity;
    const warnedGroupsRowsRef = useRef(false);
    if (
        groups !== undefined &&
        rows.length > 0 &&
        process.env.NODE_ENV !== "production" &&
        !warnedGroupsRowsRef.current
    ) {
        console.warn("MicroGrid: `groups` and `rows` were both provided; grouped rendering wins.");
        warnedGroupsRowsRef.current = true;
    }
    const groupedRows = useMemo(() => visibleGroups(groups, hideEmptyGroups), [groups, hideEmptyGroups]);
    const { labels: groupToggleLabels } = useMicroGridConfig();
    const displayRows = useMemo(
        () => groupedRows?.flatMap((group) => (collapsedGroups.has(group.key) ? [] : group.rows)) ?? rows,
        [collapsedGroups, groupedRows, rows],
    );

    // Viewport detection. Breakpoints feed a 3-tier layout:
    //   mobile (< mobileBreakpoint)  → card layout
    //   medium (< mediumBreakpoint) → grouped table when responsiveGroups are provided
    //   narrow (< narrowBreakpoint) → legacy table using `narrowColumns` if provided
    //   wide                       → desktop table using `columns`
    const detectedMobile = useIsBelow(mobileBreakpoint);
    const detectedMedium = useIsBelow(mediumBreakpoint ?? 1);
    const detectedNarrow = useIsBelow(narrowBreakpoint);
    const isMobile = forceMobile ?? detectedMobile;
    const isResponsiveMedium = !isMobile && !!responsiveGroups?.length && (forceNarrow ?? (mediumBreakpoint ? detectedMedium : false));
    const isNarrow = !isResponsiveMedium && (forceNarrow ?? detectedNarrow);
    const responsiveTier = isMobile ? "narrow" : isResponsiveMedium ? "medium" : null;
    const responsiveColumns = useMemo<ResolvedResponsiveColumns<T> | null>(() => {
        if (!responsiveGroups?.length || !responsiveTier) return null;
        return resolveResponsiveColumns(columns, responsiveGroups, responsiveTier);
    }, [columns, responsiveGroups, responsiveTier]);
    const hasResponsiveColumns = !!responsiveColumns && (responsiveColumns.grouped.length > 0 || responsiveColumns.ungrouped.length > 0);
    // narrowColumns wins below the narrow breakpoint AND feeds the mobile cards'
    // title/subtitle/hide-on-mobile flags (cards work like narrow + stacked).
    const effectiveColumns =
        !hasResponsiveColumns && (isMobile || isNarrow) && narrowColumns && narrowColumns.length > 0
            ? narrowColumns
            : columns;

    // Edit state.
    const [editingCell, setEditingCell] = useState<{ rowId: string; columnId: string } | null>(null);
    const [editError, setEditError] = useState<{ rowId: string; columnId: string; message: string } | null>(null);

    // Destructive-confirm state.
    const [confirmingDelete, setConfirmingDelete] = useState<{ rowId: string; actionId: string } | null>(null);

    // Anchor for shift-range selection.
    const lastSelectedRef = useRef<string | null>(null);

    // ─── Selection helpers. ───
    const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);
    const visibleRowIds = useMemo(() => displayRows.map(getRowId), [displayRows, getRowId]);
    const allSelected = visibleRowIds.length > 0 && visibleRowIds.every((id) => selectedSet.has(id));
    const someSelected = visibleRowIds.some((id) => selectedSet.has(id));

    const toggleRow = useCallback(
        (rowId: string, shiftKey: boolean) => {
            if (!onSelectionChange || selection === "none") return;
            if (selection === "single") {
                onSelectionChange(selectedSet.has(rowId) ? [] : [rowId]);
                lastSelectedRef.current = rowId;
                return;
            }
            // multi: Shift+click operates only on rows currently visible in the rendered grid.
            if (shiftKey && lastSelectedRef.current) {
                const a = visibleRowIds.indexOf(lastSelectedRef.current);
                const b = visibleRowIds.indexOf(rowId);
                if (a >= 0 && b >= 0) {
                    const [lo, hi] = a < b ? [a, b] : [b, a];
                    const range = visibleRowIds.slice(lo, hi + 1);
                    const next = new Set(selectedSet);
                    const adding = !selectedSet.has(rowId);
                    for (const id of range) {
                        if (adding) next.add(id);
                        else next.delete(id);
                    }
                    onSelectionChange([...next]);
                    lastSelectedRef.current = rowId;
                    return;
                }
            }
            const next = new Set(selectedSet);
            if (next.has(rowId)) next.delete(rowId);
            else next.add(rowId);
            onSelectionChange([...next]);
            lastSelectedRef.current = rowId;
        },
        [onSelectionChange, selection, selectedSet, visibleRowIds],
    );

    const toggleAll = useCallback(() => {
        if (!onSelectionChange || selection !== "multi") return;
        onSelectionChange(allSelected ? [] : visibleRowIds);
    }, [onSelectionChange, selection, allSelected, visibleRowIds]);

    // ─── Edit lifecycle. ───
    const commitEdit = useCallback(
        async (rowId: string, columnId: string, next: unknown) => {
            setEditingCell(null);
            if (!onCellChange) return;
            try {
                const res = await onCellChange(rowId, columnId, next);
                if (typeof res === "string") {
                    setEditError({ rowId, columnId, message: res });
                } else {
                    setEditError((prev) =>
                        prev && prev.rowId === rowId && prev.columnId === columnId ? null : prev,
                    );
                }
            } catch (err) {
                setEditError({
                    rowId,
                    columnId,
                    message: err instanceof Error ? err.message : "שגיאה",
                });
            }
        },
        [onCellChange],
    );

    const cancelEdit = useCallback(() => setEditingCell(null), []);

    // ─── Row-action handlers. ───
    const handleActionClick = useCallback(
        (action: MicroRowAction<T>, row: T, rowId: string) => {
            if (action.variant === "destructive" && confirmingDelete?.rowId !== rowId) {
                setConfirmingDelete({ rowId, actionId: action.id });
                return;
            }
            setConfirmingDelete(null);
            action.onClick?.(row);
        },
        [confirmingDelete],
    );

    // ─── Render. ───
    if (isMobile && responsiveColumns && hasResponsiveColumns) {
        return (
            <ResponsiveMobileLayout
                rows={displayRows}
                groups={groupedRows}
                collapsedGroups={collapsedGroups}
                onToggleGroup={onToggleGroup}
                collapseGroupLabel={groupToggleLabels.collapseGroup}
                expandGroupLabel={groupToggleLabels.expandGroup}
                responsiveColumns={responsiveColumns}
                getRowId={getRowId}
                ariaLabel={ariaLabel}
                selection={selection}
                selectedSet={selectedSet}
                onToggleRow={toggleRow}
                rowActions={rowActions}
                onRowClick={onRowClick}
                loading={loading}
                emptyState={emptyState}
                emptyMessage={emptyMessage}
                className={className}
                editingCell={editingCell}
                editError={editError}
                onStartEdit={(rowId, columnId) => setEditingCell({ rowId, columnId })}
                onCommit={commitEdit}
                onCancel={cancelEdit}
            />
        );
    }

    if (isMobile) {
        return (
            <MobileLayout
                rows={displayRows}
                groups={groupedRows}
                collapsedGroups={collapsedGroups}
                onToggleGroup={onToggleGroup}
                collapseGroupLabel={groupToggleLabels.collapseGroup}
                expandGroupLabel={groupToggleLabels.expandGroup}
                columns={effectiveColumns}
                getRowId={getRowId}
                ariaLabel={ariaLabel}
                selection={selection}
                selectedSet={selectedSet}
                onToggleRow={toggleRow}
                rowActions={rowActions}
                onRowClick={onRowClick}
                loading={loading}
                emptyState={emptyState}
                emptyMessage={emptyMessage}
                className={className}
            />
        );
    }

    const showSelection = selection !== "none";
    const showActions = !!(rowActions && rowActions.length > 0);
    if (isResponsiveMedium && responsiveColumns && hasResponsiveColumns) {
        return (
            <ResponsiveTableLayout
                rows={displayRows}
                groups={groupedRows}
                collapsedGroups={collapsedGroups}
                onToggleGroup={onToggleGroup}
                collapseGroupLabel={groupToggleLabels.collapseGroup}
                expandGroupLabel={groupToggleLabels.expandGroup}
                responsiveColumns={responsiveColumns}
                getRowId={getRowId}
                ariaLabel={ariaLabel}
                selection={selection}
                selectedSet={selectedSet}
                onToggleRow={toggleRow}
                rowActions={rowActions}
                onRowClick={onRowClick}
                getRowTone={getRowTone}
                previewOnNavigableClick={previewOnNavigableClick}
                activeRowId={activeRowId}
                loading={loading}
                emptyState={emptyState}
                emptyMessage={emptyMessage}
                className={className}
                density={density}
                allSelected={allSelected}
                someSelected={someSelected}
                toggleAll={toggleAll}
                showSelection={showSelection}
                showActions={showActions}
                editingCell={editingCell}
                editError={editError}
                onStartEdit={(rowId, columnId) => setEditingCell({ rowId, columnId })}
                onCommit={commitEdit}
                onCancel={cancelEdit}
                confirmingDelete={confirmingDelete}
                setConfirmingDelete={setConfirmingDelete}
                handleActionClick={handleActionClick}
            />
        );
    }

    const colSpan = effectiveColumns.length + (showSelection ? 1 : 0) + (showActions ? 1 : 0);
    // Any pinned columns? drives the frozen-column sticky styling below (selection col freezes too).
    const hasPinned = effectiveColumns.some((c) => c.pinned === "start");
    // Same sticky styles the real cells get, in cell order, so the loading state freezes identically.
    const skeletonPinnedStyles = hasPinned
        ? [
              ...(showSelection ? [selectionColumnSticky(hasPinned, "cell")] : []),
              ...effectiveColumns.map((_, i) => pinnedColumnSticky(effectiveColumns, i, showSelection, "cell")),
          ]
        : undefined;

    return (
        <div
            className={cn(
                // overflow-x-AUTO, not scroll: `scroll` reserves a permanently visible track even
                // when nothing overflows, which on a one-row panel is a heavy grey bar under the
                // data for no reason. `auto` still exposes the scroll when columns do not fit —
                // trailing columns must never be clipped silently — but only then.
                "microgrid-scrollbar w-full overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card shadow-sm",
                SCROLLBAR_CLASS,
                className,
            )}
        >
            <table className="w-full border-collapse min-w-max" aria-label={ariaLabel} role="table">
                <thead className="sticky top-0 z-10">
                    <tr>
                        {showSelection && (
                            <th
                                scope="col"
                                style={{ ...headCellStyle(selectionColumnSticky(hasPinned, "header")), paddingInline: cellPadX(density) }}
                                className={cn("w-10", HEAD_CELL_CLASS)}
                            >
                                {selection === "multi" && (
                                    <div className="flex items-center justify-center">
                                        <SelectionBox
                                            checked={allSelected}
                                            indeterminate={!allSelected && someSelected}
                                            onToggle={toggleAll}
                                            ariaLabel="בחר הכל"
                                        />
                                    </div>
                                )}
                            </th>
                        )}
                        {effectiveColumns.map((col, colIndex) => {
                            const widthStyle: CSSProperties | undefined = col.width
                                ? { width: typeof col.width === "number" ? `${col.width}px` : col.width }
                                : undefined;
                            const pinStyle = pinnedColumnSticky(effectiveColumns, colIndex, showSelection, "header");
                            return (
                                <th
                                    key={col.id}
                                    scope="col"
                                    style={{ ...headCellStyle({ ...widthStyle, ...pinStyle }), paddingInline: cellPadX(density) }}
                                    className={cn(HEAD_CELL_CLASS)}
                                >
                                    <div className={cn("flex items-center gap-1.5", alignClass(col.align))}>
                                        <span className="truncate">{col.header}</span>
                                        {col.headerSlot && <span className="ms-auto">{col.headerSlot}</span>}
                                    </div>
                                </th>
                            );
                        })}
                        {showActions && (
                            <th
                                scope="col"
                                style={{ ...headCellStyle(), paddingInline: cellPadX(density) }}
                                className={cn("w-24", HEAD_CELL_CLASS)}
                            />
                        )}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <SkeletonRows
                            colSpan={colSpan}
                            rowCount={Math.max(displayRows.length, 4)}
                            density={density}
                            pinnedStyles={skeletonPinnedStyles}
                        />
                    ) : groupedRows && groupedRows.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</td>
                        </tr>
                    ) : groupedRows ? (
                        groupedRows.map((group) => (
                            <Fragment key={group.key}>
                                {(() => {
                                    const isCollapsed = collapsedGroups.has(group.key);
                                    return (
                                        <TableGroupDivider
                                            label={group.label}
                                            count={group.rows.length}
                                            colSpan={colSpan}
                                            collapsed={isCollapsed}
                                            onToggle={() => onToggleGroup?.(group.key)}
                                            toggleLabel={isCollapsed ? groupToggleLabels.expandGroup : groupToggleLabels.collapseGroup}
                                        />
                                    );
                                })()}
                                {!collapsedGroups.has(group.key) && group.rows.map((row) => {
                                    const id = getRowId(row);
                                    const selected = selectedSet.has(id);
                                    const isActive = activeRowId != null && activeRowId === id;
                                    const tone = getRowTone?.(row);
                                    const confirming = confirmingDelete?.rowId === id;
                                    return (
                                        <tr
                                            key={id}
                                            data-testid="grid-row"
                                            data-row-id={id}
                                            data-row-tone={tone}
                                            aria-selected={selected || undefined}
                                            aria-current={isActive ? "true" : undefined}
                                            style={rowStyle(density, rowBackground({ active: isActive, selected, tone }), isActive)}
                                            onClick={(e) => {
                                                if (!onRowClick) return;
                                                const target = e.target as HTMLElement;
                                                if (target.closest("[data-no-row-click]")) return;
                                                if (target.closest("button, a, input, select, textarea")) return;
                                                onRowClick(row);
                                            }}
                                            className={rowClass(!!onRowClick, !isActive && !selected && !tone)}
                                        >
                                            {showSelection && (
                                                <td
                                                    style={bodyCellStyle(density, selectionColumnSticky(hasPinned, "cell"))}
                                                    className={cn(
                                                        "w-10",
                                                        hasPinned && "mg-pinned-cell",
                                                    )}
                                                >
                                                    <div className="flex items-center justify-center">
                                                        <SelectionBox
                                                            checked={selected}
                                                            onToggle={(e) => {
                                                                const shift =
                                                                    "shiftKey" in e ? (e as React.MouseEvent).shiftKey : false;
                                                                toggleRow(id, shift);
                                                            }}
                                                            ariaLabel={`בחר שורה ${id}`}
                                                        />
                                                    </div>
                                                </td>
                                            )}
                                            {effectiveColumns.map((col, colIndex) => (
                                                <DataCell
                                                    key={col.id}
                                                    column={col}
                                                    row={row}
                                                    density={density}
                                                    stickyStyle={pinnedColumnSticky(effectiveColumns, colIndex, showSelection, "cell")}
                                                    isEditing={
                                                        editingCell?.rowId === id && editingCell?.columnId === col.id
                                                    }
                                                    editError={
                                                        editError?.rowId === id && editError?.columnId === col.id
                                                            ? editError.message
                                                            : undefined
                                                    }
                                                    onStartEdit={() => col.edit && setEditingCell({ rowId: id, columnId: col.id })}
                                                    onCommit={(next) => commitEdit(id, col.id, next)}
                                                    onCancel={cancelEdit}
                                                    onRowClick={onRowClick}
                                                    previewOnNavigableClick={previewOnNavigableClick}
                                                />
                                            ))}
                                            {showActions && (
                                                <td
                                                    style={bodyCellStyle(density)}
                                                    className={cn(
                                                        "w-24 text-end",
                                                    )}
                                                    data-no-row-click
                                                >
                                                    {confirming ? (
                                                        <InlineConfirm
                                                            onCancel={() => setConfirmingDelete(null)}
                                                            onConfirm={() => {
                                                                const action = rowActions!.find(
                                                                    (a) => a.id === confirmingDelete!.actionId,
                                                                );
                                                                setConfirmingDelete(null);
                                                                action?.onClick?.(row);
                                                            }}
                                                        />
                                                    ) : (
                                                        <RowActions
                                                            actions={rowActions!}
                                                            row={row}
                                                            onClick={(a) => handleActionClick(a, row, id)}
                                                        />
                                                    )}
                                                </td>
                                            )}
                                        </tr>
                                    );
                                })}
                            </Fragment>
                        ))
                    ) : displayRows.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</td>
                        </tr>
                    ) : (
                        displayRows.map((row) => {
                            const id = getRowId(row);
                            const selected = selectedSet.has(id);
                            const isActive = activeRowId != null && activeRowId === id;
                            const tone = getRowTone?.(row);
                            const confirming = confirmingDelete?.rowId === id;
                            return (
                                <tr
                                    key={id}
                                    data-testid="grid-row"
                                    data-row-id={id}
                                    data-row-tone={tone}
                                    aria-selected={selected || undefined}
                                    aria-current={isActive ? "true" : undefined}
                                    style={rowStyle(density, rowBackground({ active: isActive, selected, tone }), isActive)}
                                    onClick={(e) => {
                                        if (!onRowClick) return;
                                        const target = e.target as HTMLElement;
                                        if (target.closest("[data-no-row-click]")) return;
                                        if (target.closest("button, a, input, select, textarea")) return;
                                        onRowClick(row);
                                    }}
                                    className={rowClass(!!onRowClick, !isActive && !selected && !tone)}
                                >
                                    {showSelection && (
                                        <td
                                            style={bodyCellStyle(density, selectionColumnSticky(hasPinned, "cell"))}
                                            className={cn(
                                                "w-10",
                                                hasPinned && "mg-pinned-cell",
                                            )}
                                        >
                                            <div className="flex items-center justify-center">
                                                <SelectionBox
                                                    checked={selected}
                                                    onToggle={(e) => {
                                                        const shift =
                                                            "shiftKey" in e ? (e as React.MouseEvent).shiftKey : false;
                                                        toggleRow(id, shift);
                                                    }}
                                                    ariaLabel={`בחר שורה ${id}`}
                                                />
                                            </div>
                                        </td>
                                    )}
                                    {effectiveColumns.map((col, colIndex) => (
                                        <DataCell
                                            key={col.id}
                                            column={col}
                                            row={row}
                                            density={density}
                                            stickyStyle={pinnedColumnSticky(effectiveColumns, colIndex, showSelection, "cell")}
                                            isEditing={
                                                editingCell?.rowId === id && editingCell?.columnId === col.id
                                            }
                                            editError={
                                                editError?.rowId === id && editError?.columnId === col.id
                                                    ? editError.message
                                                    : undefined
                                            }
                                            onStartEdit={() => col.edit && setEditingCell({ rowId: id, columnId: col.id })}
                                            onCommit={(next) => commitEdit(id, col.id, next)}
                                            onCancel={cancelEdit}
                                            onRowClick={onRowClick}
                                            previewOnNavigableClick={previewOnNavigableClick}
                                        />
                                    ))}
                                    {showActions && (
                                        <td
                                            style={bodyCellStyle(density)}
                                            className={cn(
                                                "w-24 text-end",
                                            )}
                                            data-no-row-click
                                        >
                                            {confirming ? (
                                                <InlineConfirm
                                                    onCancel={() => setConfirmingDelete(null)}
                                                    onConfirm={() => {
                                                        const action = rowActions!.find(
                                                            (a) => a.id === confirmingDelete!.actionId,
                                                        );
                                                        setConfirmingDelete(null);
                                                        action?.onClick?.(row);
                                                    }}
                                                />
                                            ) : (
                                                <RowActions
                                                    actions={rowActions!}
                                                    row={row}
                                                    onClick={(a) => handleActionClick(a, row, id)}
                                                />
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })
                    )}
                </tbody>
            </table>
        </div>
    );
}

// ─── Subcomponents ────────────────────────────────────────────────────────

/**
 * Click handler for a navigable cell's <Link>. By default it just stops the
 * click from bubbling to the row's onClick (the link navigates as usual).
 *
 * When `previewOnNavigableClick` is on and a row handler exists (split-preview
 * layouts), a plain left-click is intercepted: navigation is suppressed and the
 * record opens in the side panel instead. Modifier / middle clicks are left
 * untouched so the browser still follows the link — giving both the in-panel
 * preview and the full-screen / new-tab paths.
 */
function navigableLinkClick<T>(
    row: T,
    onRowClick: ((row: T) => void) | undefined,
    previewOnNavigableClick: boolean | undefined,
) {
    return (e: React.MouseEvent) => {
        if (
            previewOnNavigableClick &&
            onRowClick &&
            e.button === 0 &&
            !e.metaKey &&
            !e.ctrlKey &&
            !e.shiftKey &&
            !e.altKey
        ) {
            e.preventDefault();
            e.stopPropagation();
            onRowClick(row);
            return;
        }
        e.stopPropagation();
    };
}

function DataCell<T>({
    column,
    row,
    density,
    isEditing,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
    onRowClick,
    previewOnNavigableClick,
    stickyStyle,
    defaultVerticalAlign = "middle",
}: {
    column: MicroColumn<T>;
    row: T;
    density: MicroGridDensity;
    isEditing: boolean;
    editError: string | undefined;
    onStartEdit: () => void;
    onCommit: (next: unknown) => void;
    onCancel: () => void;
    onRowClick?: (row: T) => void;
    previewOnNavigableClick?: boolean;
    /** Sticky frozen-column style (set by the table for pinned columns). See pinnedColumnSticky. */
    stickyStyle?: CSSProperties;
    /**
     * Alignment used when the column does not state one. 'middle' for the fixed-height desktop
     * rows (§3); the medium/stacked layout passes 'top' so a one-line cell lines up with the first
     * line of the multi-line cell beside it rather than floating against its middle.
     */
    defaultVerticalAlign?: "top" | "middle";
}) {
    const { Link, labels } = useMicroGridConfig();
    const value = resolveValue(row, column.accessor);
    const rendered = column.cell ? column.cell(row, value) : ((value as ReactNode) ?? null);
    const href = column.navigateTo?.(row);
    const isNavigable = !!href;
    const display = isNavigable ? navigableDisplayValue(value) : rendered;

    // Default: middle-aligned. Rows are a fixed height and their content is one line (§3); a column
    // that wraps to several lines opts out with verticalAlign: "top".
    const vAlign = column.verticalAlign ?? defaultVerticalAlign;
    const vAlignCellClass = vAlign === "top" ? "align-top" : "align-middle";
    const vAlignFlex = vAlign === "top" ? "items-start" : "items-center";

    if (isEditing && column.edit) {
        // Compare draft to initial before firing onCommit — closing the editor
        // by tab/blur with no change should NOT trigger a save round-trip.
        const commitIfChanged = (next: unknown) => {
            const normEq = (a: unknown, b: unknown) =>
                a === b || (a == null && b == null) || String(a ?? "") === String(b ?? "");
            if (normEq(next, value)) {
                onCancel();
                return;
            }
            onCommit(next);
        };
        return (
            <td
                style={bodyCellStyle(density, stickyStyle)}
                className={cn(
                    "bg-background ring-2 ring-inset ring-primary",
                    vAlignCellClass,
                )}
                data-no-row-click
            >
                <CellEditor
                    config={column.edit}
                    row={row}
                    initialValue={value}
                    onCommit={commitIfChanged}
                    onCancel={onCancel}
                />
            </td>
        );
    }

    const isEmpty = isEmptyContent(href ? display : rendered) && !column.noEmptyDash;

    // §3.1 — the engine's own answer for this cell. Absent ⇒ idle, which is the whole of the previous
    // behaviour, so a column that does not declare `cellState` renders exactly as before.
    const meta: MicroCellMeta | undefined = column.cellState?.(row, value);
    const treatment = meta ? cellStateTreatment(meta.state) : undefined;
    const editable = column.edit && (!meta || !NON_EDITABLE.has(meta.state));

    return (
        <td
            {...(meta ? cellStateAria(meta) : {})}
            data-cell-state={meta?.state}
            style={bodyCellStyle(density, { fontSize: BODY_FS, ...treatment?.style, ...stickyStyle })}
            className={cn(
                "text-foreground",
                vAlignCellClass,
                // No ✎ affordance where typing is impossible: a promise that breaks on click is
                // worse than no promise (§1, readonly / derived / locked).
                !isNavigable && editable &&
                    "cursor-pointer hover:bg-primary/5 hover:ring-1 hover:ring-inset hover:ring-primary/30",
                isNavigable && "relative",
                stickyStyle && "mg-pinned-cell",
            )}
            title={isNavigable ? titleFromValue(value) : editable ? labels.editCell : undefined}
            onClick={
                !isNavigable && editable
                    ? (e) => {
                          e.stopPropagation();
                          onStartEdit();
                      }
                    : undefined
            }
        >
            <div
                className={cn(
                    "flex min-w-0",
                    vAlignFlex,
                    alignClass(column.align),
                    isNavigable && column.edit && "relative ps-8 ltr:ps-0 ltr:pe-8",
                )}
            >
                {isEmpty ? (
                    <EmptyDash />
                ) : href ? (
                    <Link
                        href={href}
                        prefetch={false}
                        title={titleFromValue(value)}
                        onClick={navigableLinkClick(row, onRowClick, previewOnNavigableClick)}
                        className="min-w-0 truncate text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                    >
                        {display}
                    </Link>
                ) : (
                    rendered
                )}
                {treatment?.prefix && (
                    <span aria-hidden="true" className="me-1.5 flex-none opacity-80">{treatment.prefix}</span>
                )}
                {treatment?.suffix && (
                    <span
                        aria-hidden="true"
                        title={meta?.formula}
                        className="ms-auto flex-none rounded-[5px] px-1.5 text-[11px]"
                        style={
                            treatment.suffixTone === "success"
                                ? { color: "var(--success)", background: "var(--success-soft)", border: "1px solid var(--success)" }
                                : { color: "var(--muted-foreground)", background: "var(--surface-sunken)", border: "1px dashed var(--input)" }
                        }
                    >
                        {treatment.suffix}
                    </span>
                )}
                {href && editable && (
                    <EditPencilButton
                        onClick={onStartEdit}
                        className="absolute start-1 top-1/2 z-10 -translate-y-1/2 ltr:start-auto ltr:end-1"
                    />
                )}
            </div>
            {/* The reason sits UNDER the cell, never in a toast: a toast leaves the cell the user is
                looking at, and by the time they read it they have lost which row it was about. */}
            {meta?.reason && treatment?.messageTone && (
                <div
                    className="mt-1 flex items-start gap-1.5 rounded-[6px] px-1.5 py-1 text-[11px] leading-[1.45]"
                    style={{
                        color: MESSAGE_TONE[treatment.messageTone].fg,
                        background: MESSAGE_TONE[treatment.messageTone].bg,
                    }}
                    role={meta.state === "conflict" ? "alert" : undefined}
                >
                    {treatment.messageIcon && <span aria-hidden="true">{treatment.messageIcon}</span>}
                    <span>{meta.reason}</span>
                </div>
            )}
            {editError && (
                <div className="mt-1 text-xs text-destructive" role="alert">
                    {editError}
                </div>
            )}
        </td>
    );
}

function RowActions<T>({
    actions,
    row,
    onClick,
}: {
    actions: MicroRowAction<T>[];
    row: T;
    onClick: (action: MicroRowAction<T>) => void;
}) {
    return (
        <div className="flex items-center justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
            {actions
                .filter((a) => !a.show || a.show(row))
                .map((a) => (
                    <button
                        key={a.id}
                        type="button"
                        aria-label={a.label}
                        title={a.label}
                        onClick={(e) => {
                            e.stopPropagation();
                            onClick(a);
                        }}
                        className={cn(
                            "rounded-md p-1.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary",
                            a.variant === "destructive"
                                ? "text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                                : "text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                    >
                        {a.icon ?? <span className="text-xs">{a.label}</span>}
                    </button>
                ))}
        </div>
    );
}

function InlineConfirm({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
    return (
        <div className="flex items-center justify-end gap-1.5">
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onCancel();
                }}
                className="rounded-md border border-border bg-background px-2 py-1 text-xs outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-primary"
            >
                בטל
            </button>
            <button
                type="button"
                onClick={(e) => {
                    e.stopPropagation();
                    onConfirm();
                }}
                className="rounded-md bg-destructive px-2 py-1 text-xs text-destructive-foreground outline-none hover:opacity-90 focus-visible:ring-2 focus-visible:ring-primary"
            >
                מחק
            </button>
        </div>
    );
}

/**
 * Loading state (§11). Rows shaped like real rows, at the real row height, so nothing jumps when
 * the data lands — and carrying the same `--mg-row-bg` as a live row, which is what keeps the
 * frozen columns opaque while loading. Shimmer runs on the leading bar only: a full grid of
 * pulsing blocks strobes.
 */
function SkeletonRows({
    colSpan,
    rowCount,
    density,
    pinnedStyles,
}: {
    colSpan: number;
    rowCount: number;
    density: MicroGridDensity;
    /** Sticky styles per column index, so skeleton cells freeze exactly where real ones do. */
    pinnedStyles?: (CSSProperties | undefined)[];
}) {
    return (
        <>
            {Array.from({ length: rowCount }).map((_, ri) => (
                <tr
                    key={`sk-${ri}`}
                    className="border-b border-border bg-[var(--mg-row-tint,var(--mg-row-bg))]"
                    style={rowStyle(density, ROW_BG_BASE)}
                >
                    {Array.from({ length: colSpan }).map((__, ci) => (
                        <td key={ci} className="px-3" style={bodyCellStyle(density, pinnedStyles?.[ci])}>
                            <div
                                className={cn(
                                    "h-3 rounded bg-muted",
                                    ci === 0 ? "w-3/4 animate-pulse" : "w-1/2 opacity-60",
                                )}
                            />
                        </td>
                    ))}
                </tr>
            ))}
        </>
    );
}

// ─── Responsive grouped table/card layouts ────────────────────────────────

function ResponsiveTableLayout<T>({
    rows,
    groups,
    collapsedGroups,
    onToggleGroup,
    collapseGroupLabel,
    expandGroupLabel,
    responsiveColumns,
    getRowId,
    ariaLabel,
    selection,
    selectedSet,
    onToggleRow,
    rowActions,
    onRowClick,
    getRowTone,
    previewOnNavigableClick,
    activeRowId,
    loading,
    emptyState,
    emptyMessage,
    className,
    density,
    allSelected,
    someSelected,
    toggleAll,
    showSelection,
    showActions,
    editingCell,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
    confirmingDelete,
    setConfirmingDelete,
    handleActionClick,
}: {
    rows: T[];
    groups: MicroGroup<T>[] | null;
    collapsedGroups: Set<string>;
    onToggleGroup?: (key: string) => void;
    collapseGroupLabel: string;
    expandGroupLabel: string;
    responsiveColumns: ResolvedResponsiveColumns<T>;
    getRowId: (row: T) => string;
    ariaLabel: string;
    selection: NonNullable<MicroGridProps<T>["selection"]>;
    selectedSet: Set<string>;
    onToggleRow: (rowId: string, shift: boolean) => void;
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
    getRowTone?: (row: T) => MicroRowTone | undefined;
    previewOnNavigableClick?: boolean;
    activeRowId?: string | null;
    loading?: boolean;
    emptyState?: ReactNode;
    emptyMessage?: string;
    className?: string;
    density: MicroGridDensity;
    allSelected: boolean;
    someSelected: boolean;
    toggleAll: () => void;
    showSelection: boolean;
    showActions: boolean;
    editingCell: { rowId: string; columnId: string } | null;
    editError: { rowId: string; columnId: string; message: string } | null;
    onStartEdit: (rowId: string, columnId: string) => void;
    onCommit: (rowId: string, columnId: string, next: unknown) => void;
    onCancel: () => void;
    confirmingDelete: { rowId: string; actionId: string } | null;
    setConfirmingDelete: (next: { rowId: string; actionId: string } | null) => void;
    handleActionClick: (action: MicroRowAction<T>, row: T, rowId: string) => void;
}) {
    const tableColumns = [
        ...responsiveColumns.grouped.map((group) => ({ kind: "group" as const, group })),
        ...responsiveColumns.ungrouped.map((column) => ({ kind: "column" as const, column })),
    ];
    const colSpan = tableColumns.length + (showSelection ? 1 : 0) + (showActions ? 1 : 0);
    const renderRow = (row: T) => {
        const id = getRowId(row);
        const selected = selectedSet.has(id);
        const isActive = activeRowId != null && activeRowId === id;
        const tone = getRowTone?.(row);
        const confirming = confirmingDelete?.rowId === id;
        return (
            <tr
                key={id}
                data-testid="grid-row"
                data-row-id={id}
                data-row-tone={tone}
                aria-selected={selected || undefined}
                aria-current={isActive ? "true" : undefined}
                style={rowStyle(density, rowBackground({ active: isActive, selected, tone }), isActive)}
                onClick={(e) => {
                    if (!onRowClick) return;
                    const target = e.target as HTMLElement;
                    if (target.closest("[data-no-row-click]")) return;
                    if (target.closest("button, a, input, select, textarea")) return;
                    onRowClick(row);
                }}
                className={rowClass(!!onRowClick, !isActive && !selected && !tone)}
            >
                {showSelection && (
                    <td
                        style={bodyCellStyle(density)}
                        className={cn(
                            "w-10",
                        )}
                    >
                        <div className="flex items-center justify-center">
                            <SelectionBox
                                checked={selected}
                                onToggle={(e) => {
                                    const shift =
                                        "shiftKey" in e ? (e as React.MouseEvent).shiftKey : false;
                                    onToggleRow(id, shift);
                                }}
                                ariaLabel={`בחר שורה ${id}`}
                            />
                        </div>
                    </td>
                )}
                {tableColumns.map((entry) =>
                    entry.kind === "group" ? (
                        <ResponsiveGroupCell
                            key={entry.group.id}
                            row={row}
                            rowId={id}
                            group={entry.group}
                            density={density}
                            editingCell={editingCell}
                            editError={editError}
                            onStartEdit={onStartEdit}
                            onCommit={onCommit}
                            onCancel={onCancel}
                            onRowClick={onRowClick}
                            previewOnNavigableClick={previewOnNavigableClick}
                        />
                    ) : (
                        <DataCell
                            key={entry.column.id}
                            column={entry.column}
                            row={row}
                            density={density}
                            defaultVerticalAlign="top"
                            isEditing={
                                editingCell?.rowId === id &&
                                editingCell?.columnId === entry.column.id
                            }
                            editError={
                                editError?.rowId === id && editError?.columnId === entry.column.id
                                    ? editError.message
                                    : undefined
                            }
                            onStartEdit={() =>
                                entry.column.edit && onStartEdit(id, entry.column.id)
                            }
                            onCommit={(next) => onCommit(id, entry.column.id, next)}
                            onCancel={onCancel}
                            onRowClick={onRowClick}
                            previewOnNavigableClick={previewOnNavigableClick}
                        />
                    ),
                )}
                {showActions && (
                    <td
                        style={bodyCellStyle(density)}
                        className={cn(
                            "w-24 text-end",
                        )}
                        data-no-row-click
                    >
                        {confirming ? (
                            <InlineConfirm
                                onCancel={() => setConfirmingDelete(null)}
                                onConfirm={() => {
                                    const action = rowActions!.find(
                                        (a) => a.id === confirmingDelete!.actionId,
                                    );
                                    setConfirmingDelete(null);
                                    action?.onClick?.(row);
                                }}
                            />
                        ) : (
                            <RowActions
                                actions={rowActions!}
                                row={row}
                                onClick={(a) => handleActionClick(a, row, id)}
                            />
                        )}
                    </td>
                )}
            </tr>
        );
    };

    return (
        <div
            className={cn(
                "microgrid-scrollbar w-full overflow-x-auto overflow-y-hidden rounded-xl border border-border bg-card shadow-sm",
                SCROLLBAR_CLASS,
                className,
            )}
        >
            <table className="w-full border-collapse min-w-max" aria-label={ariaLabel} role="table">
                <thead className="sticky top-0 z-10">
                    <tr>
                        {showSelection && (
                            <th
                                scope="col"
                                style={{ ...headCellStyle(), paddingInline: cellPadX(density) }}
                                className={cn("w-10", HEAD_CELL_CLASS)}
                            >
                                {selection === "multi" && (
                                    <div className="flex items-center justify-center">
                                        <SelectionBox
                                            checked={allSelected}
                                            indeterminate={!allSelected && someSelected}
                                            onToggle={toggleAll}
                                            ariaLabel="בחר הכל"
                                        />
                                    </div>
                                )}
                            </th>
                        )}
                        {tableColumns.map((entry) => (
                            <ResponsiveHeaderCell
                                key={entry.kind === "group" ? entry.group.id : entry.column.id}
                                entry={entry}
                                density={density}
                            />
                        ))}
                        {showActions && (
                            <th
                                scope="col"
                                style={{ ...headCellStyle(), paddingInline: cellPadX(density) }}
                                className={cn("w-24", HEAD_CELL_CLASS)}
                            />
                        )}
                    </tr>
                </thead>
                <tbody>
                    {loading ? (
                        <SkeletonRows colSpan={colSpan} rowCount={Math.max(rows.length, 4)} density={density} />
                    ) : groups && groups.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</td>
                        </tr>
                    ) : groups ? (
                        groups.map((group) => (
                            <Fragment key={group.key}>
                                {(() => {
                                    const isCollapsed = collapsedGroups.has(group.key);
                                    return (
                                        <TableGroupDivider
                                            label={group.label}
                                            count={group.rows.length}
                                            colSpan={colSpan}
                                            collapsed={isCollapsed}
                                            onToggle={() => onToggleGroup?.(group.key)}
                                            toggleLabel={isCollapsed ? expandGroupLabel : collapseGroupLabel}
                                        />
                                    );
                                })()}
                                {!collapsedGroups.has(group.key) && group.rows.map(renderRow)}
                            </Fragment>
                        ))
                    ) : rows.length === 0 ? (
                        <tr>
                            <td colSpan={colSpan}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</td>
                        </tr>
                    ) : (
                        rows.map(renderRow)
                    )}
                </tbody>
            </table>
        </div>
    );
}

function ResponsiveHeaderCell<T>({
    entry,
    density,
}: {
    entry:
        | { kind: "group"; group: ResolvedResponsiveColumn<T> }
        | { kind: "column"; column: MicroColumn<T> };
    density: MicroGridDensity;
}) {
    const column = entry.kind === "group" ? entry.group.primaryColumn : entry.column;
    const header = entry.kind === "group" ? entry.group.header : entry.column.header;

    return (
        <th
            scope="col"
            style={{ ...headCellStyle(
                entry.kind === "column" && entry.column.width
                    ? {
                          width:
                              typeof entry.column.width === "number"
                                  ? `${entry.column.width}px`
                                  : entry.column.width,
                      }
                    : undefined,
            ), paddingInline: cellPadX(density) }}
            className={cn(HEAD_CELL_CLASS)}
        >
            <div className={cn("flex items-center gap-1.5", alignClass(column.align))}>
                <span className="truncate">{header}</span>
                {entry.kind === "column" && entry.column.headerSlot && (
                    <span className="ms-auto">{entry.column.headerSlot}</span>
                )}
            </div>
        </th>
    );
}

function ResponsiveGroupCell<T>({
    row,
    rowId,
    group,
    density,
    editingCell,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
    onRowClick,
    previewOnNavigableClick,
}: {
    row: T;
    rowId: string;
    group: ResolvedResponsiveColumn<T>;
    density: MicroGridDensity;
    editingCell: { rowId: string; columnId: string } | null;
    editError: { rowId: string; columnId: string; message: string } | null;
    onStartEdit: (rowId: string, columnId: string) => void;
    onCommit: (rowId: string, columnId: string, next: unknown) => void;
    onCancel: () => void;
    onRowClick?: (row: T) => void;
    previewOnNavigableClick?: boolean;
}) {
    const isInline = group.layout === "inline";
    return (
        <td
            style={bodyCellStyle(density)}
            className={cn(
                "align-top text-sm text-foreground",
            )}
        >
            <div className={cn(isInline ? "flex min-w-0 items-start gap-2" : "flex min-w-0 flex-col gap-1")}>
                {group.stackedFields.map((field, index) => (
                    <div
                        key={field.column.id}
                        className={cn(
                            "min-w-0",
                            MEDIUM_RESPONSIVE_FIELD_WIDTH_CLASS,
                            isInline && index > 0 && "border-s border-border/60 ps-2",
                        )}
                    >
                        <ResponsiveField
                            row={row}
                            rowId={rowId}
                            field={field}
                            editingCell={editingCell}
                            editError={editError}
                            onStartEdit={onStartEdit}
                            onCommit={onCommit}
                            onCancel={onCancel}
                            onRowClick={onRowClick}
                            previewOnNavigableClick={previewOnNavigableClick}
                            constrainForMedium
                        />
                    </div>
                ))}
            </div>
        </td>
    );
}

function ResponsiveField<T>({
    row,
    rowId,
    field,
    editingCell,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
    onRowClick,
    previewOnNavigableClick,
    showLabel = true,
    constrainForMedium = false,
}: {
    row: T;
    rowId: string;
    field: ResolvedResponsiveField<T>;
    editingCell: { rowId: string; columnId: string } | null;
    editError: { rowId: string; columnId: string; message: string } | null;
    onStartEdit: (rowId: string, columnId: string) => void;
    onCommit: (rowId: string, columnId: string, next: unknown) => void;
    onCancel: () => void;
    onRowClick?: (row: T) => void;
    previewOnNavigableClick?: boolean;
    showLabel?: boolean;
    constrainForMedium?: boolean;
}) {
    const { Link } = useMicroGridConfig();
    const value = resolveValue(row, field.column.accessor);
    const rendered = field.column.cell ? field.column.cell(row, value) : ((value as ReactNode) ?? null);
    const href = field.column.navigateTo?.(row);
    const isNavigable = !!href;
    const display = isNavigable ? navigableDisplayValue(value) : rendered;
    const isEditing = editingCell?.rowId === rowId && editingCell?.columnId === field.column.id;
    const message =
        editError?.rowId === rowId && editError?.columnId === field.column.id ? editError.message : undefined;
    const label = field.label ?? field.column.header;
    const shouldShowLabel = showLabel && !field.hideLabel;
    const valueTitle = constrainForMedium ? titleFromValue(value) : undefined;

    if (isEditing && field.column.edit) {
        const commitIfChanged = (next: unknown) => {
            const normEq = (a: unknown, b: unknown) =>
                a === b || (a == null && b == null) || String(a ?? "") === String(b ?? "");
            if (normEq(next, value)) {
                onCancel();
                return;
            }
            onCommit(rowId, field.column.id, next);
        };
        return (
            <div className="rounded-sm bg-background ring-2 ring-inset ring-primary" data-no-row-click>
                {shouldShowLabel && <div className="mb-1 text-[11px] text-muted-foreground">{label}</div>}
                <CellEditor
                    config={field.column.edit}
                    row={row}
                    initialValue={value}
                    onCommit={commitIfChanged}
                    onCancel={onCancel}
                />
            </div>
        );
    }

    return (
        <div
            className={cn(
                "min-w-0 rounded-sm",
                constrainForMedium && [
                    MEDIUM_RESPONSIVE_FIELD_WIDTH_CLASS,
                    "overflow-hidden",
                    "[&_[data-action=edit]]:opacity-0 [&_[data-action=edit]]:transition-opacity",
                    "group-hover:[&_[data-action=edit]]:opacity-100 group-focus-within:[&_[data-action=edit]]:opacity-100",
                    "[&_.cell-action-panel]:opacity-0 [&_.cell-action-panel]:transition-opacity",
                    "group-hover:[&_.cell-action-panel]:!opacity-100 group-focus-within:[&_.cell-action-panel]:!opacity-100",
                    "group-hover:[&_.cell-action-panel]:!pointer-events-auto group-focus-within:[&_.cell-action-panel]:!pointer-events-auto",
                ],
                !isNavigable && field.column.edit &&
                    "cursor-pointer hover:bg-primary/5 hover:ring-1 hover:ring-inset hover:ring-primary/30",
            )}
            title={isNavigable ? titleFromValue(value) : valueTitle ?? (field.column.edit ? "לחץ לעריכה" : undefined)}
            onClick={
                !isNavigable && field.column.edit
                    ? (e) => {
                          e.stopPropagation();
                          onStartEdit(rowId, field.column.id);
                      }
                    : undefined
            }
            data-no-row-click={field.column.edit ? true : undefined}
            data-medium-responsive-field={constrainForMedium ? true : undefined}
        >
            {shouldShowLabel && <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>}
            <div
                className={cn(
                    "min-w-0 truncate",
                    constrainForMedium && MEDIUM_RESPONSIVE_FIELD_WIDTH_CLASS,
                    isNavigable && field.column.edit && "relative flex items-center gap-1 ps-7 ltr:ps-0 ltr:pe-7",
                )}
            >
                {href ? (
                    <Link
                        href={href}
                        prefetch={false}
                        title={titleFromValue(value)}
                        onClick={navigableLinkClick(row, onRowClick, previewOnNavigableClick)}
                        className="min-w-0 truncate text-foreground outline-none hover:underline focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
                    >
                        {display}
                    </Link>
                ) : (
                    rendered
                )}
                {href && field.column.edit && (
                    <EditPencilButton
                        onClick={() => onStartEdit(rowId, field.column.id)}
                        className="absolute start-0 top-1/2 z-10 -translate-y-1/2 ltr:start-auto ltr:end-0"
                    />
                )}
            </div>
            {message && (
                <div className="mt-1 text-xs text-destructive" role="alert">
                    {message}
                </div>
            )}
        </div>
    );
}

function ResponsiveMobileLayout<T>({
    rows,
    groups,
    collapsedGroups,
    onToggleGroup,
    collapseGroupLabel,
    expandGroupLabel,
    responsiveColumns,
    getRowId,
    ariaLabel,
    selection,
    selectedSet,
    onToggleRow,
    rowActions,
    onRowClick,
    loading,
    emptyState,
    emptyMessage,
    className,
    editingCell,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
}: {
    rows: T[];
    groups: MicroGroup<T>[] | null;
    collapsedGroups: Set<string>;
    onToggleGroup?: (key: string) => void;
    collapseGroupLabel: string;
    expandGroupLabel: string;
    responsiveColumns: ResolvedResponsiveColumns<T>;
    getRowId: (row: T) => string;
    ariaLabel: string;
    selection: NonNullable<MicroGridProps<T>["selection"]>;
    selectedSet: Set<string>;
    onToggleRow: (rowId: string, shift: boolean) => void;
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
    loading?: boolean;
    emptyState?: ReactNode;
    emptyMessage?: string;
    className?: string;
    editingCell: { rowId: string; columnId: string } | null;
    editError: { rowId: string; columnId: string; message: string } | null;
    onStartEdit: (rowId: string, columnId: string) => void;
    onCommit: (rowId: string, columnId: string, next: unknown) => void;
    onCancel: () => void;
}) {
    if (loading) {
        return (
            <ul className={cn("space-y-2", className)} aria-label={ariaLabel} aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                    </li>
                ))}
            </ul>
        );
    }

    if (groups && groups.length === 0) {
        return <div className={className}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</div>;
    }

    const renderCard = (row: T) => {
        const rowId = getRowId(row);
        return (
            <ResponsiveMobileCard
                key={rowId}
                row={row}
                rowId={rowId}
                responsiveColumns={responsiveColumns}
                selection={selection}
                selected={selectedSet.has(rowId)}
                onToggleRow={onToggleRow}
                rowActions={rowActions}
                onRowClick={onRowClick}
                editingCell={editingCell}
                editError={editError}
                onStartEdit={onStartEdit}
                onCommit={onCommit}
                onCancel={onCancel}
            />
        );
    };

    if (groups) {
        return (
            <div className={cn("space-y-3", className)} aria-label={ariaLabel}>
                {groups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.key);
                    return (
                        <section key={group.key} className="space-y-2">
                            <MobileGroupDivider
                                label={group.label}
                                count={group.rows.length}
                                collapsed={isCollapsed}
                                onToggle={() => onToggleGroup?.(group.key)}
                                toggleLabel={isCollapsed ? expandGroupLabel : collapseGroupLabel}
                            />
                            {!isCollapsed && group.rows.length > 0 && (
                                <ul role="list" className="space-y-2" aria-label={`${ariaLabel}: ${group.label}`}>
                                    {group.rows.map(renderCard)}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        );
    }

    if (rows.length === 0) {
        return <div className={className}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</div>;
    }

    return (
        <ul role="list" className={cn("space-y-2", className)} aria-label={ariaLabel}>
            {rows.map(renderCard)}
        </ul>
    );
}

function ResponsiveMobileCard<T>({
    row,
    rowId,
    responsiveColumns,
    selection,
    selected,
    onToggleRow,
    rowActions,
    onRowClick,
    editingCell,
    editError,
    onStartEdit,
    onCommit,
    onCancel,
}: {
    row: T;
    rowId: string;
    responsiveColumns: ResolvedResponsiveColumns<T>;
    selection: NonNullable<MicroGridProps<T>["selection"]>;
    selected: boolean;
    onToggleRow: (rowId: string, shift: boolean) => void;
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
    editingCell: { rowId: string; columnId: string } | null;
    editError: { rowId: string; columnId: string; message: string } | null;
    onStartEdit: (rowId: string, columnId: string) => void;
    onCommit: (rowId: string, columnId: string, next: unknown) => void;
    onCancel: () => void;
}) {
    const groupedFields = responsiveColumns.grouped.flatMap((group) => group.stackedFields);
    const titleField =
        groupedFields.find((field) => field.slot === "title") ??
        responsiveColumns.grouped[0]?.stackedFields[0] ??
        (responsiveColumns.ungrouped[0] ? { column: responsiveColumns.ungrouped[0] } : undefined);
    const badgeFields = groupedFields.filter((field) => field.slot === "badge" && field !== titleField);
    const ungroupedFields = responsiveColumns.ungrouped
        .filter((column) => column.id !== titleField?.column.id)
        .map((column) => ({ column }));

    return (
        <li
            data-testid="grid-row"
            data-row-id={rowId}
            role="article"
            onClick={() => onRowClick?.(row)}
            className={cn(
                "group rounded-xl border bg-card p-3 shadow-sm transition-colors",
                selected ? "border-primary bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]" : "border-border",
                onRowClick && "cursor-pointer",
            )}
        >
            <div className="flex items-start gap-2">
                {selection !== "none" && (
                    <div className="mt-0.5 shrink-0">
                        <SelectionBox
                            checked={selected}
                            onToggle={(e) => {
                                const shift = "shiftKey" in e ? (e as React.MouseEvent).shiftKey : false;
                                onToggleRow(rowId, shift);
                            }}
                            ariaLabel={`בחר ${rowId}`}
                        />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    {titleField && (
                        <div className="text-sm font-medium text-foreground">
                            <ResponsiveField
                                row={row}
                                rowId={rowId}
                                field={titleField}
                                editingCell={editingCell}
                                editError={editError}
                                onStartEdit={onStartEdit}
                                onCommit={onCommit}
                                onCancel={onCancel}
                                showLabel={false}
                            />
                        </div>
                    )}
                    {badgeFields.length > 0 && (
                        <div className="mt-1 flex flex-wrap gap-1">
                            {badgeFields.map((field) => (
                                <ResponsiveField
                                    key={field.column.id}
                                    row={row}
                                    rowId={rowId}
                                    field={field}
                                    editingCell={editingCell}
                                    editError={editError}
                                    onStartEdit={onStartEdit}
                                    onCommit={onCommit}
                                    onCancel={onCancel}
                                    showLabel={false}
                                />
                            ))}
                        </div>
                    )}
                </div>
                {rowActions && rowActions.length > 0 && (
                    <button
                        type="button"
                        aria-label="פעולות"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                )}
            </div>
            <div className="mt-3 space-y-3 border-t border-border/60 pt-2 text-xs">
                {responsiveColumns.grouped.map((group) => {
                    const fields = group.stackedFields.filter(
                        (field) => field !== titleField && !badgeFields.includes(field) && field.slot !== "action",
                    );
                    if (fields.length === 0) return null;
                    return (
                        <section key={group.id} className="space-y-1.5">
                            <div className="font-medium text-muted-foreground">{group.header}</div>
                            <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                                {fields.map((field) => (
                                    <ResponsiveField
                                        key={field.column.id}
                                        row={row}
                                        rowId={rowId}
                                        field={field}
                                        editingCell={editingCell}
                                        editError={editError}
                                        onStartEdit={onStartEdit}
                                        onCommit={onCommit}
                                        onCancel={onCancel}
                                    />
                                ))}
                            </div>
                        </section>
                    );
                })}
                {ungroupedFields.length > 0 && (
                    <section className="grid grid-cols-2 gap-x-3 gap-y-1.5">
                        {ungroupedFields.map((field) => (
                            <ResponsiveField
                                key={field.column.id}
                                row={row}
                                rowId={rowId}
                                field={field}
                                editingCell={editingCell}
                                editError={editError}
                                onStartEdit={onStartEdit}
                                onCommit={onCommit}
                                onCancel={onCancel}
                            />
                        ))}
                    </section>
                )}
            </div>
        </li>
    );
}

// ─── Mobile layout ────────────────────────────────────────────────────────

function MobileLayout<T>({
    rows,
    groups,
    collapsedGroups,
    onToggleGroup,
    collapseGroupLabel,
    expandGroupLabel,
    columns,
    getRowId,
    ariaLabel,
    selection,
    selectedSet,
    onToggleRow,
    rowActions,
    onRowClick,
    loading,
    emptyState,
    emptyMessage,
    className,
}: {
    rows: T[];
    groups: MicroGroup<T>[] | null;
    collapsedGroups: Set<string>;
    onToggleGroup?: (key: string) => void;
    collapseGroupLabel: string;
    expandGroupLabel: string;
    columns: MicroColumn<T>[];
    getRowId: (row: T) => string;
    ariaLabel: string;
    selection: NonNullable<MicroGridProps<T>["selection"]>;
    selectedSet: Set<string>;
    onToggleRow: (rowId: string, shift: boolean) => void;
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
    loading?: boolean;
    emptyState?: ReactNode;
    emptyMessage?: string;
    className?: string;
}) {
    if (loading) {
        return (
            <ul className={cn("space-y-2", className)} aria-label={ariaLabel} aria-busy="true">
                {Array.from({ length: 4 }).map((_, i) => (
                    <li key={i} className="space-y-2 rounded-xl border border-border bg-card p-3 shadow-sm">
                        <div className="h-4 w-1/2 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                    </li>
                ))}
            </ul>
        );
    }

    if (groups && groups.length === 0) {
        return <div className={className}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</div>;
    }

    const titleCol = columns.find((c) => c.isCardTitle) ?? columns[0];
    const subtitleCol = columns.find((c) => c.isCardSubtitle);
    const detailCols = columns.filter((c) => c !== titleCol && c !== subtitleCol && !c.hideOnMobile);
    const renderCard = (row: T) => {
        const rowId = getRowId(row);
        return (
            <MobileCard
                key={rowId}
                row={row}
                rowId={rowId}
                titleCol={titleCol}
                subtitleCol={subtitleCol}
                detailCols={detailCols}
                selection={selection}
                selected={selectedSet.has(rowId)}
                onToggleRow={onToggleRow}
                rowActions={rowActions}
                onRowClick={onRowClick}
            />
        );
    };

    if (groups) {
        return (
            <div className={cn("space-y-3", className)} aria-label={ariaLabel}>
                {groups.map((group) => {
                    const isCollapsed = collapsedGroups.has(group.key);
                    return (
                        <section key={group.key} className="space-y-2">
                            <MobileGroupDivider
                                label={group.label}
                                count={group.rows.length}
                                collapsed={isCollapsed}
                                onToggle={() => onToggleGroup?.(group.key)}
                                toggleLabel={isCollapsed ? expandGroupLabel : collapseGroupLabel}
                            />
                            {!isCollapsed && group.rows.length > 0 && (
                                <ul role="list" className="space-y-2" aria-label={`${ariaLabel}: ${group.label}`}>
                                    {group.rows.map(renderCard)}
                                </ul>
                            )}
                        </section>
                    );
                })}
            </div>
        );
    }

    if (rows.length === 0) {
        return <div className={className}>{emptyState ?? <DefaultEmpty message={emptyMessage} />}</div>;
    }

    return (
        <ul role="list" className={cn("space-y-2", className)} aria-label={ariaLabel}>
            {rows.map(renderCard)}
        </ul>
    );
}

function MobileCard<T>({
    row,
    rowId,
    titleCol,
    subtitleCol,
    detailCols,
    selection,
    selected,
    onToggleRow,
    rowActions,
    onRowClick,
}: {
    row: T;
    rowId: string;
    titleCol: MicroColumn<T>;
    subtitleCol: MicroColumn<T> | undefined;
    detailCols: MicroColumn<T>[];
    selection: NonNullable<MicroGridProps<T>["selection"]>;
    selected: boolean;
    onToggleRow: (rowId: string, shift: boolean) => void;
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
}) {
    return (
        <li
            data-testid="grid-row"
            data-row-id={rowId}
            role="article"
            aria-selected={selected || undefined}
            onClick={() => onRowClick?.(row)}
            className={cn(
                "rounded-xl border bg-card p-3 shadow-sm transition-colors",
                selected ? "border-primary bg-[color-mix(in_srgb,var(--primary)_10%,transparent)]" : "border-border",
                onRowClick && "cursor-pointer",
            )}
        >
            <div className="flex items-start gap-2">
                {selection !== "none" && (
                    <div className="mt-0.5 shrink-0">
                        <SelectionBox
                            checked={selected}
                            onToggle={(e) => {
                                const shift = "shiftKey" in e ? (e as React.MouseEvent).shiftKey : false;
                                onToggleRow(rowId, shift);
                            }}
                            ariaLabel={`בחר ${rowId}`}
                        />
                    </div>
                )}
                <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-foreground">
                        <MobileCellContent row={row} column={titleCol} />
                    </div>
                    {subtitleCol && (
                        <div className="mt-0.5 text-xs text-muted-foreground">
                            <MobileCellContent row={row} column={subtitleCol} />
                        </div>
                    )}
                </div>
                {rowActions && rowActions.length > 0 && (
                    <button
                        type="button"
                        aria-label="פעולות"
                        onClick={(e) => e.stopPropagation()}
                        className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
                    >
                        <MoreHorizontal className="h-4 w-4" aria-hidden />
                    </button>
                )}
            </div>
            {detailCols.length > 0 && (
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border/60 pt-2 text-xs">
                    {detailCols.map((col) => (
                        <div key={col.id} className="flex min-w-0 flex-col">
                            <dt className="text-muted-foreground">{col.header}</dt>
                            <dd className="truncate text-foreground">
                                <MobileCellContent row={row} column={col} />
                            </dd>
                        </div>
                    ))}
                </dl>
            )}
        </li>
    );
}

function MobileCellContent<T>({ row, column }: { row: T; column: MicroColumn<T> }) {
    const value = resolveValue(row, column.accessor);
    return <>{column.cell ? column.cell(row, value) : ((value as ReactNode) ?? null)}</>;
}
