'use client';

import React, { useState, useEffect, useLayoutEffect, useRef, createContext, useContext, useCallback, useMemo } from 'react';
import * as Popover from '@radix-ui/react-popover';
import {
    DndContext,
    DragOverlay,
    closestCenter,
    KeyboardSensor,
    PointerSensor,
    useSensor,
    useSensors,
    type DragStartEvent,
    type DragEndEvent,
} from '@dnd-kit/core';
import {
    arrayMove,
    SortableContext,
    sortableKeyboardCoordinates,
    useSortable,
    rectSortingStrategy,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
    GripVertical,
    ChevronUp,
    ChevronDown,
    ChevronsUpDown,
    Maximize2,
    Minimize2,
    LayoutTemplate,
    CloudUpload,
    X,
    Plus,
    Eye,
    EyeOff,
    Pencil,
    Check,
    RotateCcw,
    Tags,
    LayoutList,
    LayoutGrid,
} from 'lucide-react';
import {
    DropdownMenu,
    DropdownMenuTrigger,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubTrigger,
    DropdownMenuSubContent,
} from './ui/dropdown-menu';
// `PanelStorage` is declared locally further down this file — it predates the
// persistence contract and is structurally identical to the one in
// ./persistence.ts. Left as-is so this file stays a faithful copy of NOW's.
import { usePanelsConfig } from './config';

// ============================================================================
// PANEL COUNT CONTEXT
// Children call usePanelCount()?.setCount(n) to push their record count into
// the panel header badge.  Returns null when rendered outside a panel.
// ============================================================================

interface PanelCountContextValue {
    setCount: (n: number) => void;
}

export const PanelCountContext = createContext<PanelCountContextValue | null>(null);

export function usePanelCount(): PanelCountContextValue | null {
    return useContext(PanelCountContext);
}

// ============================================================================
// PANEL HEIGHT CONTEXT
// Children call usePanelHeight() to get the current panel maxHeight (px).
// Returns null when rendered outside a panel or when no vertical limit is set.
// Used by entity views to compute a dynamic pageSize that fills the panel.
// ============================================================================

export const PanelHeightContext = createContext<number | null>(null);

export function usePanelHeight(): number | null {
    return useContext(PanelHeightContext);
}

// ============================================================================
// PANEL WIDTH CONTEXT
// Children (e.g. headerAction components) call usePanelWidth() to get the
// current panel pixel width as measured by the ResizeObserver.
// Returns 0 before the first measurement (safe default — treat as "wide").
// ============================================================================

export const PanelWidthContext = createContext<number>(0);

export function usePanelWidth(): number {
    return useContext(PanelWidthContext);
}

// ============================================================================
// PANEL TEMPLATE STATE CONTEXT
// Allows children to store view-mode or other per-panel state that gets
// saved/restored as part of layout templates.
// ============================================================================

type PanelTemplateStateDispatch = (key: string, value: unknown) => void;

// Exported for tests: the per-panel provider path (inside DraggablePanels) and the
// standalone PanelTemplateStateProvider must BOTH supply these two contexts together —
// the state Record and the dispatch fn. Supplying only one (or the wrong shape) makes
// usePanelTemplateState read fallbacks / write to dead local state (regression fixed
// after the two-context split). Tests assert the per-panel wiring round-trips.
export const PanelTemplateStateContext = createContext<Record<string, unknown> | null>(null);
export const PanelTemplateStateDispatchContext = createContext<PanelTemplateStateDispatch | null>(null);

/** Standalone provider — use when rendering PeopleWidgetHeaderAction outside a DraggablePanels panel */
export function PanelTemplateStateProvider({ children, initialState }: { children: React.ReactNode; initialState?: Record<string, unknown> }) {
    const [state, setState_] = useState<Record<string, unknown>>(initialState ?? {});
    const setState = useCallback<PanelTemplateStateDispatch>((key, value) => {
        setState_(prev => Object.is(prev[key], value) ? prev : { ...prev, [key]: value });
    }, []);
    return (
        <PanelTemplateStateDispatchContext.Provider value={setState}>
            <PanelTemplateStateContext.Provider value={state}>
                {children}
            </PanelTemplateStateContext.Provider>
        </PanelTemplateStateDispatchContext.Provider>
    );
}

export function usePanelTemplateState<T>(key: string, fallback: T): [T, (next: T) => void] {
    const state = useContext(PanelTemplateStateContext);
    const setPanelState = useContext(PanelTemplateStateDispatchContext);
    const [localValue, setLocalValue] = useState<T>(fallback);

    const value = state
        ? ((state[key] as T | undefined) ?? fallback)
        : localValue;

    const setValue = useCallback((next: T) => {
        if (setPanelState) {
            setPanelState(key, next);
            return;
        }
        setLocalValue(next);
    }, [key, setPanelState]);

    return [value, setValue];
}

// ============================================================================
// TYPES
// ============================================================================

export interface PanelDef {
    id: string;
    title: string;
    content: React.ReactNode;
    /** Optional button / action shown in the panel header (hidden when collapsed) */
    headerAction?: React.ReactNode;
    /** Always-visible badge rendered in the title row, after the count badge */
    titleBadge?: React.ReactNode;
    /** Extra items rendered at the bottom of the kebab ⋮ menu (use DropdownMenuItem nodes) */
    menuItems?: React.ReactNode;
    /** Default column span when no stored value exists. Defaults to 3 (= 1/4 of 12-col grid). */
    defaultColSpan?: ColSpan;
    /** If true, show tags/grid/cards view-mode switcher in the kebab when the panel is narrow (<380px) */
    hasViewModes?: boolean;
}

interface TabGroup {
    panelIds: string[];
    activeTab: string;
}

interface PanelStorage {
    order: string[];
    collapsed: Record<string, boolean>;
    colSpan: Record<string, ColSpan>;
    /** Schema version — 2 = 12-column grid (migrated from old 3-col) */
    gridVersion?: number;
    panelState: Record<string, Record<string, unknown>>;
    /** Tab groups keyed by "grp-<uuid>". Empty by default → backwards compatible. */
    groups: Record<string, TabGroup>;
    /** Hidden panels — not rendered in normal mode; visible (dimmed) in edit mode. */
    hidden: Record<string, boolean>;
    /** Optional max-height per panel (px). Content scrolls when it exceeds this; shrinks when below. */
    panelMaxHeight?: Record<string, number>;
    /** User-defined panel title overrides (keyed by panel id). */
    customTitles?: Record<string, string>;
}

// ============================================================================
// MERGE TARGET — union of standalone panels and existing tab groups
// ============================================================================

/** A destination into which a standalone panel can be merged */
type MergeTarget =
    | { type: 'panel'; id: string; label: string }
    | { type: 'group'; groupId: string; label: string; representativeId: string };

// ============================================================================
// SORTABLE PANEL
// ============================================================================

interface SortablePanelProps {
    panel: PanelDef;
    count: number | undefined;
    isCollapsed: boolean;
    onToggleCollapse: () => void;
    onSetCount: (n: number) => void;
    templateState: Record<string, unknown>;
    /** Volatile panel state (in-memory only) — merged with templateState in context */
    volatileTemplateState?: Record<string, unknown>;
    onSetTemplateState: (key: string, value: unknown) => void;
    colSpan: ColSpan;
    maxColSpan?: ColSpan;
    onExpandColSpan: () => void;
    onShrinkColSpan: () => void;
    onSetColSpan: (span: ColSpan) => void;
    /** Standalone panels AND existing tab groups this panel can be merged into */
    mergeTargets: MergeTarget[];
    onMerge: (targetId: string) => void;
    isHidden: boolean;
    onToggleHidden: () => void;
    isEditMode: boolean;
    /** True when panel is hidden but shown in preview mode (showHidden toggle) */
    isPreviewHidden?: boolean;
    maxHeight: number | null;
    onSetMaxHeight: (h: number | null) => void;
    /** The title to display (may be overridden by user rename). */
    displayTitle: string;
    onRename: (newTitle: string) => void;
    /** Number of columns in the masonry grid — used for col-span drag calculation */
    gridCols?: number;
}


// ============================================================================
// MASONRY ROW SPAN
// Measures each panel's rendered height with a ResizeObserver and converts it
// to a CSS Grid row span.  With grid-auto-rows: MASONRY_ROW_PX the browser
// packs panels like Pinterest — no vertical gaps between cards.
// ============================================================================

const MASONRY_ROW_PX = 4;   // grid-auto-rows unit (4 px = Tailwind base unit → near-exact gaps)
const MASONRY_GAP_PX = 16;  // desired gap between panels
const MIN_PANEL_WIDTH_PX = 280; // must match the min-w-[280px] on every panel wrapper
const HEIGHT_STEP = 50;     // vertical resize snaps to multiples of 50px — no upper limit

// Keys that must NEVER be read from persisted storage (localStorage / DB).
// They are runtime-only signals whose stale values from a previous session
// would cause incorrect UI (e.g. lastRefreshedMs showing "93 hours ago").
const VOLATILE_PANEL_STATE_KEYS = new Set([
    'lastRefreshedMs',
    'refetchSignal',
    'activeFilterCount',
    'activeSavedViewName',
    'savedViewsList',
    'isViewModified',
    'clearFiltersSignal',
    'saveViewSignal',
    'selectViewSignal',
    'deleteViewSignal',
    'createNewViewSignal',
    'filterBarOpen',
    'addFieldSignal',
    'fieldPickerSignal',
    'createPanelOpen',
    'inlineCreateSignal',
    'autoSaveLayoutSignal',
    'kanbanGroupBy',
    'kanbanGroupableFields',
]);

const toSortableTranslate = (transform: Parameters<typeof CSS.Translate.toString>[0]) =>
    CSS.Translate.toString(transform);

// Panel-header action buttons (shrink/expand/collapse/kebab) are hidden until
// the user hovers the panel or focuses a button, and stay visible while a
// dropdown they trigger is open. group/panel sits on the panel root.
const HEADER_ACTION_BTN_CLS = "opacity-0 group-hover/panel:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100 transition-opacity";

// 12-column masonry grid — 7 jump sizes: 1/12, 2/12, 3/12, 4/12, 6/12, 8/12, 12/12
export const COL_SPAN_STEPS = [1, 2, 3, 4, 6, 8, 12] as const;
export type ColSpan = typeof COL_SPAN_STEPS[number]; // 1|2|3|4|6|8|12
const GRID_COLS = 12;
// Minimum panel width — span 3/12 ≈ 320px (smartphone minimum)
const MIN_COL_SPAN: ColSpan = 3;

/** Snapshot layout-relevant fields for dirty-state comparison.
 *  Filter selections (storedFilterViewId) are intentionally excluded — they auto-save
 *  via storage and do not require an explicit "שמור פריסה" confirmation.
 *  viewModes (volatile) are included so that switching a panel's view mode shows
 *  "שמור פריסה" when no saved-view config covers it. */
function snapshotLayout(
    s: PanelStorage,
    volatileViewModes: Record<string, unknown>,
): string {
    return JSON.stringify({
        order: s.order,
        colSpan: s.colSpan ?? {},
        panelMaxHeight: s.panelMaxHeight ?? {},
        groups: s.groups ?? {},
        hidden: s.hidden ?? {},
        viewModes: volatileViewModes,
    });
}

/** Migrate stored layouts from the old 3-column grid (colSpan 1|2|3) to the new 12-column grid */
function migrateStorage<T extends { colSpan?: Record<string, number>; gridVersion?: number }>(s: T): T {
    if (s.gridVersion === 2) return s;
    const legacyMap: Record<number, ColSpan> = { 1: 4, 2: 8, 3: 12 };
    const migratedColSpan = Object.fromEntries(
        Object.entries(s.colSpan ?? {}).map(([id, span]) => [id, legacyMap[span] ?? (span as ColSpan)])
    );
    return { ...s, colSpan: migratedColSpan, gridVersion: 2 };
}

/**
 * Reconcile a saved layout against the panels the current card actually renders.
 * Replaces the old "exact panel-set match or discard" rule: a per-user layout is
 * shared across every card of an entity type, but individual cards differ in their
 * panel set (e.g. interview / membership blocks). Reconciling keeps the shared
 * panels' saved arrangement, drops ids this card doesn't have, and APPENDS panels
 * present on this card but absent from the layout — so every current panel always
 * renders (the renderer maps over `order`, so a missing id would otherwise vanish).
 * Returns null only when nothing from the layout overlaps this card (caller defaults).
 */
function reconcileStorage(raw: PanelStorage, currentIds: Set<string>): PanelStorage | null {
    const s = migrateStorage(raw);
    const groups: Record<string, TabGroup> = {};
    for (const [gid, g] of Object.entries(s.groups ?? {})) {
        const kept = (g.panelIds ?? []).filter(id => currentIds.has(id));
        if (kept.length === 0) continue; // group emptied by this card → drop it
        groups[gid] = { panelIds: kept, activeTab: kept.includes(g.activeTab) ? g.activeTab : kept[0] };
    }
    const inGroups = new Set(Object.values(groups).flatMap(g => g.panelIds));

    // Keep order entries that still resolve: surviving groups, or known standalone panels.
    const order = (s.order ?? []).filter(id =>
        id.startsWith('grp-') ? !!groups[id] : (currentIds.has(id) && !inGroups.has(id)),
    );

    // Nothing from the saved layout applies to this card → let the caller default.
    if (order.length === 0 && inGroups.size === 0) return null;

    // Append current-card panels not represented anywhere, so they always render.
    const present = new Set<string>([...order.filter(id => !id.startsWith('grp-')), ...inGroups]);
    for (const id of currentIds) if (!present.has(id)) order.push(id);

    return { ...s, groups, order };
}

function SortablePanel({
    panel,
    count,
    isCollapsed,
    onToggleCollapse,
    onSetCount,
    templateState,
    volatileTemplateState,
    onSetTemplateState,
    colSpan,
    maxColSpan = 12,
    onExpandColSpan,
    onShrinkColSpan,
    onSetColSpan,
    mergeTargets,
    onMerge,
    isHidden,
    onToggleHidden,
    isEditMode,
    isPreviewHidden = false,
    maxHeight,
    onSetMaxHeight,
    displayTitle,
    onRename,
    gridCols: gridColsProp = GRID_COLS,
}: SortablePanelProps) {
    const [isRenaming, setIsRenaming] = useState(false);
    const [renameValue, setRenameValue] = useState('');
    const renameInputRef = useRef<HTMLInputElement>(null);

    const startRename = () => {
        setRenameValue(displayTitle);
        setIsRenaming(true);
    };

    const commitRename = () => {
        const trimmed = renameValue.trim();
        if (trimmed && trimmed !== displayTitle) onRename(trimmed);
        setIsRenaming(false);
    };

    useEffect(() => {
        if (isRenaming) renameInputRef.current?.focus();
    }, [isRenaming]);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: panel.id });

    const { labels } = usePanelsConfig();

    const [rowSpan, setRowSpan] = useState(30);
    const [panelWidth, setPanelWidth] = useState(0);
    const innerRef = useRef<HTMLDivElement | null>(null);
    useLayoutEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        const update = () => {
            setRowSpan(Math.ceil((el.offsetHeight + MASONRY_GAP_PX) / MASONRY_ROW_PX));
            setPanelWidth(el.offsetWidth);
        };
        const ro = new ResizeObserver(update);
        ro.observe(el);
        update();
        return () => ro.disconnect();
    }, []);
    const isNarrow = panelWidth > 0 && panelWidth < 380;

    const handleVertResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = innerRef.current;
        if (!el) return;
        const startY = e.clientY;
        const startH = maxHeight ?? el.getBoundingClientRect().height;
        const onMove = (ev: MouseEvent) => {
            const newH = startH + (ev.clientY - startY);
            if (newH < HEIGHT_STEP) { onSetMaxHeight(null); return; }
            // snap to nearest HEIGHT_STEP — no upper limit
            const snapped = Math.round(newH / HEIGHT_STEP) * HEIGHT_STEP;
            onSetMaxHeight(Math.max(HEIGHT_STEP, snapped));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [maxHeight, onSetMaxHeight]);

    const handleHorizResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = innerRef.current;
        if (!el) return;
        const grid = el.closest('[data-panel-grid]');
        if (!grid) return;
        const startX = e.clientX;
        const startW = el.getBoundingClientRect().width;
        const isRtl = document.documentElement.dir === 'rtl';
        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newW = startW + (isRtl ? -delta : delta);
            const gridW = grid.getBoundingClientRect().width;
            const colUnit = (gridW - MASONRY_GAP_PX * (gridColsProp - 1)) / gridColsProp;
            const options = COL_SPAN_STEPS.filter(s => s >= MIN_COL_SPAN && s <= gridColsProp).map(span => ({
                span,
                w: span * colUnit + (span - 1) * MASONRY_GAP_PX,
            }));
            const best = options.reduce((a, b) =>
                Math.abs(b.w - newW) < Math.abs(a.w - newW) ? b : a
            );
            onSetColSpan(best.span);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [onSetColSpan, gridColsProp]);

    const style: React.CSSProperties = {
        transform: toSortableTranslate(transform),
        transition,
        gridColumn: colSpan > 1 ? `span ${colSpan} / span ${colSpan}` : undefined,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
    };

    const contextValue = React.useMemo(
        () => ({ setCount: onSetCount }),
        [onSetCount]
    );
    // Merge persistent templateState (from storage) with volatile state (in-memory only).
    // Strip volatile keys from persisted templateState first — stale values from a previous
    // session in localStorage (e.g. lastRefreshedMs) must not surface after a page reload.
    const mergedTemplateState = React.useMemo(() => {
        const stable = Object.fromEntries(
            Object.entries(templateState).filter(([k]) => !VOLATILE_PANEL_STATE_KEYS.has(k))
        );
        return volatileTemplateState ? { ...stable, ...volatileTemplateState } : stable;
    }, [templateState, volatileTemplateState]);
    // Per-panel template state is provided via the two-context API below
    // (state Record + stable dispatch), matching usePanelTemplateState.

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={[
                'group/panel h-max min-w-[280px] min-h-0 relative',
                isDragging ? 'opacity-40 z-50' : '',
            ].join(' ')}
        >
            {/* Horizontal resize handle — drag inline-end edge to change column span */}
            <div
                className="absolute inset-y-0 end-0 w-3 z-10 cursor-col-resize opacity-0 group-hover/panel:opacity-100 flex items-center justify-center"
                onMouseDown={handleHorizResizeStart}
                title="גרור לשינוי רוחב עמודות"
            >
                <div className="w-1 h-12 rounded-full bg-border hover:bg-primary/60 transition-colors" />
            </div>
            <PanelCountContext.Provider value={contextValue}>
                <PanelTemplateStateDispatchContext.Provider value={onSetTemplateState}>
                <PanelTemplateStateContext.Provider value={mergedTemplateState}>
                    <PanelWidthContext.Provider value={panelWidth}>
                    <div
                        ref={innerRef}
                className={[
                    'rounded-2xl border transition-all flex flex-col overflow-hidden @container',
                    isDragging ? 'ring-2 ring-brand-primary/40 shadow-sm' : 'group-hover/panel:shadow-sm',
                    (isEditMode && isHidden)
                        ? 'border-dashed border-border/60 opacity-50 bg-card'
                        : isEditMode
                            ? 'border-border bg-card shadow-sm'
                            : 'border-border bg-card',
                ].join(' ')}
            >
                {/* ── Panel Header ── */}
                <div className={[
                    'px-4 py-2.5 border-b flex items-center gap-2 min-h-[44px] transition-colors rounded-t-2xl',
                    (isEditMode && isHidden)
                        ? 'bg-muted/10 border-border'
                        : isEditMode
                            ? 'bg-muted/30 border-border'
                            : 'bg-transparent border-transparent group-hover/panel:bg-muted/30 group-hover/panel:border-border',
                ].join(' ')}>
                    {/* Drag handle — always visible on hover */}
                    <button
                        {...attributes}
                        {...listeners}
                        className="hidden group-hover/panel:inline-flex focus-visible:inline-flex items-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none rounded p-0.5 flex-shrink-0"
                        aria-label="גרור לשינוי סדר"
                        title="גרור לשינוי סדר"
                    >
                        <GripVertical size={15} />
                    </button>

                    {/* Title & Count Wrapper */}
                    <div className="flex-1 flex items-center gap-1.5 overflow-hidden min-w-0">
                        {/* Title / rename input */}
                        {isRenaming ? (
                            <>
                                <input
                                    ref={renameInputRef}
                                    value={renameValue}
                                    onChange={e => setRenameValue(e.target.value)}
                                    onBlur={commitRename}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') commitRename();
                                        if (e.key === 'Escape') setIsRenaming(false);
                                    }}
                                    className="text-sm leading-none flex-1 min-w-0 bg-transparent border-b border-primary outline-none text-foreground font-medium"
                                />
                                {/* Confirm */}
                                <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={commitRename}
                                    className="flex-shrink-0 p-0.5 rounded text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-colors"
                                    aria-label="אשר שינוי שם"
                                    title="אשר"
                                >
                                    <Check size={13} />
                                </button>
                                {/* Cancel */}
                                <button
                                    onMouseDown={e => e.preventDefault()}
                                    onClick={() => setIsRenaming(false)}
                                    className="flex-shrink-0 p-0.5 rounded text-destructive hover:bg-destructive/10 transition-colors"
                                    aria-label="בטל שינוי שם"
                                    title="בטל"
                                >
                                    <X size={13} />
                                </button>
                            </>
                        ) : (
                            <h3 className={[
                                'text-sm truncate leading-none flex-shrink-0 transition-colors font-normal group-hover/panel:font-medium',
                                isEditMode && isHidden ? 'text-muted-foreground line-through' : 'text-foreground',
                            ].join(' ')}>
                                {displayTitle}
                            </h3>
                        )}

                        {/* Record count badge — persists even when collapsed */}
                        {!isRenaming && count !== undefined && (
                            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full text-[11px] font-semibold bg-secondary text-muted-foreground tabular-nums flex-shrink-0">
                                {count}
                            </span>
                        )}

                        {/* Title badge — always visible, entity-specific (e.g. filter dropdown) */}
                        {!isRenaming && !isEditMode && panel.titleBadge && (
                            <div className="flex items-center gap-1 flex-shrink-0">{panel.titleBadge}</div>
                        )}
                    </div>

                    {/* Header action (e.g. view switcher + add button) — always visible */}
                    {!isCollapsed && !isEditMode && !isRenaming && panel.headerAction && (
                        <div className="flex items-center gap-1 flex-shrink-0">{panel.headerAction}</div>
                    )}

                    {/* Edit-mode: height selector */}
                    {isEditMode && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                            <ChevronsUpDown size={12} className="text-muted-foreground shrink-0" />
                            <select
                                value={maxHeight ?? ''}
                                onChange={e => onSetMaxHeight(e.target.value ? Number(e.target.value) : null)}
                                className="text-xs h-6 px-1 rounded border border-border bg-background text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                title="גובה מקסימלי"
                            >
                                <option value="">שריר</option>
                                <option value="200">200px</option>
                                <option value="300">300px</option>
                                <option value="400">400px</option>
                                <option value="500">500px</option>
                                <option value="600">600px</option>
                                <option value="800">800px</option>
                            </select>
                        </div>
                    )}

                    {/* Edit-mode: hide/show toggle */}
                    {isEditMode && (
                        <button
                            onClick={onToggleHidden}
                            className={[
                                'flex-shrink-0 rounded p-0.5',
                                isHidden
                                    ? 'text-muted-foreground/50 hover:text-foreground'
                                    : 'text-foreground hover:text-muted-foreground',
                            ].join(' ')}
                            aria-label={isHidden ? 'הצג פאנל' : 'הסתר פאנל'}
                            title={isHidden ? 'הצג פאנל' : 'הסתר פאנל'}
                        >
                            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    )}

                    {/* Column-span shrink — hidden when narrow (available in kebab) */}
                    {!isNarrow && colSpan > MIN_COL_SPAN && (
                        <button
                            onClick={onShrinkColSpan}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label="כווץ טור"
                            title="כווץ טור"
                        >
                            <Minimize2 size={14} />
                        </button>
                    )}

                    {/* Column-span expand — hidden when narrow (available in kebab) */}
                    {!isNarrow && colSpan < maxColSpan && (
                        <button
                            onClick={onExpandColSpan}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label="הרחב טור"
                            title="הרחב טור"
                        >
                            <Maximize2 size={14} />
                        </button>
                    )}

                    {/* Collapse / expand toggle — hidden when narrow (available in kebab) */}
                    {!isNarrow && !isRenaming && (
                        <button
                            onClick={onToggleCollapse}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label={isCollapsed ? labels.expandPanel : labels.collapsePanel}
                            title={isCollapsed ? labels.expandPanel : labels.collapsePanel}
                        >
                            {isCollapsed
                                ? <ChevronDown size={15} />
                                : <ChevronUp size={15} />
                            }
                        </button>
                    )}

                    {/* Kebab ⋮ — last in DOM = far left in RTL (standard UX position) */}
                    {!isEditMode && !isRenaming && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className={[
                                        'flex-shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground rounded p-0.5',
                                        HEADER_ACTION_BTN_CLS,
                                    ].join(' ')}
                                    aria-label="עוד פעולות"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                                    </svg>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onSelect={startRename}>
                                    <span className="flex items-center gap-2">
                                        <Pencil size={13} className="opacity-60" />
                                        שנה שם
                                    </span>
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem onSelect={onToggleCollapse}>
                                    <span className="flex items-center gap-2">
                                        {isCollapsed
                                            ? <ChevronDown size={13} className="opacity-60" />
                                            : <ChevronUp size={13} className="opacity-60" />
                                        }
                                        {isCollapsed ? labels.expandPanel : labels.collapsePanel}
                                    </span>
                                </DropdownMenuItem>
                                {colSpan > MIN_COL_SPAN && (
                                    <DropdownMenuItem onSelect={onShrinkColSpan}>
                                        <span className="flex items-center gap-2">
                                            <Minimize2 size={13} className="opacity-60" />
                                            כווץ טור
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                {colSpan < maxColSpan && (
                                    <DropdownMenuItem onSelect={onExpandColSpan}>
                                        <span className="flex items-center gap-2">
                                            <Maximize2 size={13} className="opacity-60" />
                                            הרחב טור
                                        </span>
                                    </DropdownMenuItem>
                                )}
                                {isNarrow && panel.hasViewModes && (() => {
                                    const vm = (templateState['viewMode'] as string | undefined) ?? 'tags';
                                    return (
                                        <>
                                            <DropdownMenuSeparator />
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'tags')}>
                                                <span className="flex items-center gap-2">
                                                    <Tags size={13} className={vm === 'tags' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'tags' ? 'font-medium text-primary' : ''}>תגיות</span>
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'grid')}>
                                                <span className="flex items-center gap-2">
                                                    <LayoutList size={13} className={vm === 'grid' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'grid' ? 'font-medium text-primary' : ''}>רשת</span>
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'cards')}>
                                                <span className="flex items-center gap-2">
                                                    <LayoutGrid size={13} className={vm === 'cards' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'cards' ? 'font-medium text-primary' : ''}>כרטיסיות</span>
                                                </span>
                                            </DropdownMenuItem>
                                        </>
                                    );
                                })()}
                                {panel.menuItems && (
                                    <>
                                        <DropdownMenuSeparator />
                                        {panel.menuItems}
                                    </>
                                )}
                                {mergeTargets.length > 0 && (
                                    <>
                                        <DropdownMenuSeparator />
                                        <DropdownMenuSub>
                                            <DropdownMenuSubTrigger>
                                                <span className="flex items-center gap-2">
                                                    <Plus size={13} className="opacity-60" />
                                                    {labels.mergeWith}
                                                </span>
                                            </DropdownMenuSubTrigger>
                                            <DropdownMenuSubContent>
                                                {mergeTargets.map(target =>
                                                    target.type === 'panel' ? (
                                                        <DropdownMenuItem
                                                            key={target.id}
                                                            onSelect={() => onMerge(target.id)}
                                                        >
                                                            {target.label}
                                                        </DropdownMenuItem>
                                                    ) : (
                                                        <DropdownMenuItem
                                                            key={target.groupId}
                                                            onSelect={() => onMerge(target.representativeId)}
                                                        >
                                                            <span className="flex items-center gap-1.5">
                                                                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="opacity-50 flex-shrink-0">
                                                                    <rect x="2" y="3" width="9" height="18" rx="2"/>
                                                                    <rect x="13" y="3" width="9" height="18" rx="2"/>
                                                                </svg>
                                                                {target.label}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    )
                                                )}
                                            </DropdownMenuSubContent>
                                        </DropdownMenuSub>
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {/* ── Panel Content — hidden when: collapsed, or (hidden panel and not in edit mode) ── */}
                {/* pb-0: sticky pagination bar in EntityViewLayout sits flush at the bottom;
                    bottom padding is owned by the content itself (EntityViewLayout adds pb-4 when needed). */}
                {!isCollapsed && (!isHidden || isEditMode) && (
                    <PanelHeightContext.Provider value={maxHeight}>
                        <div
                            className={['pt-4 px-4 pb-0 overflow-x-auto', isEditMode && isHidden ? 'pointer-events-none select-none' : ''].join(' ')}
                            style={{ maxHeight: maxHeight ? `${maxHeight}px` : '80vh', overflowY: 'auto' }}
                        >
                            {panel.content}
                        </div>
                    </PanelHeightContext.Provider>
                )}
                {/* Vertical resize handle — drag to snap height to predefined steps */}
                {!isCollapsed && (
                    <div
                        className="h-2 cursor-ns-resize flex-shrink-0 opacity-0 group-hover/panel:opacity-100 hover:opacity-100 transition-all rounded-b-2xl flex items-center justify-center"
                        onMouseDown={handleVertResizeStart}
                        title="גרור לשינוי גובה"
                    >
                        <div className="w-8 h-0.5 rounded-full bg-border/60 group-hover/panel:bg-border transition-colors" />
                    </div>
                )}
                    </div>
                    </PanelWidthContext.Provider>
                </PanelTemplateStateContext.Provider>
                </PanelTemplateStateDispatchContext.Provider>
            </PanelCountContext.Provider>
        </div>
    );
}

// ============================================================================
// TAB STRIP  — overflow-aware tab bar
// Tabs that don't fit are hidden and collected in an overflow dropdown.
// Works correctly in both LTR and RTL (overflow always clips the last DOM items).
// ============================================================================

interface TabStripProps {
    panelIds: string[];
    activeTab: string;
    panelMap: Map<string, PanelDef>;
    counts: Record<string, number>;
    onTabClick: (tabId: string) => void;
    onSplitTab: (tabId: string) => void;
    splitLabel: string;
}

function TabStrip({
    panelIds,
    activeTab,
    panelMap,
    counts,
    onTabClick,
    onSplitTab,
    splitLabel,
}: TabStripProps) {
    const containerRef = useRef<HTMLDivElement>(null);
    // overflowFrom: index at which tabs are moved to the dropdown (default: show all)
    const [overflowFrom, setOverflowFrom] = useState(panelIds.length);

    const measure = useCallback(() => {
        const container = containerRef.current;
        if (!container) return;

        // Query tab buttons rendered in the DOM (includes ALL panelIds)
        const tabEls = Array.from(
            container.querySelectorAll<HTMLElement>('[data-tab-id]')
        );
        if (!tabEls.length) return;

        const containerWidth = container.clientWidth;

        // Phase 1: check if everything fits without an overflow button
        let total = 0;
        for (const el of tabEls) total += el.offsetWidth + 4; // 4px gap
        if (total <= containerWidth) {
            setOverflowFrom(panelIds.length); // all fit, no overflow menu
            return;
        }

        // Phase 2: find the cutoff — reserve 48px for the overflow button
        const limit = containerWidth - 48;
        let cum = 0;
        let cutoff = 1; // always show at least 1
        for (let i = 0; i < tabEls.length; i++) {
            cum += tabEls[i].offsetWidth + 4;
            if (cum > limit) break;
            cutoff = i + 1;
        }

        // If the active tab is in the overflow range, swap it to the last visible slot
        // so the user always sees which tab is active
        const activeIdx = panelIds.indexOf(activeTab);
        if (activeIdx >= cutoff) {
            // We'll show activeIdx in slot (cutoff - 1) — handled in render via reordering
            setOverflowFrom(cutoff - 1 < 0 ? 0 : cutoff);
        } else {
            setOverflowFrom(cutoff);
        }
    }, [panelIds, activeTab]);

    // Measure on mount and whenever panelIds change
    useLayoutEffect(() => {
        measure();
    }, [measure]);

    // Re-measure on container resize (e.g. colSpan change, window resize)
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const ro = new ResizeObserver(measure);
        ro.observe(container);
        return () => ro.disconnect();
    }, [measure]);

    // Build visible / overflow lists, ensuring the active tab is always visible
    const activeIdx = panelIds.indexOf(activeTab);
    let visibleIds: string[];
    let overflowIds: string[];

    if (overflowFrom >= panelIds.length) {
        visibleIds = panelIds;
        overflowIds = [];
    } else {
        // If active tab would be hidden, rotate it into the visible range
        if (activeIdx >= overflowFrom) {
            const reordered = [...panelIds];
            // Swap active tab into last visible slot
            const tmp = reordered[overflowFrom - 1];
            reordered[overflowFrom - 1] = reordered[activeIdx];
            reordered[activeIdx] = tmp;
            visibleIds = reordered.slice(0, overflowFrom);
            overflowIds = reordered.slice(overflowFrom);
        } else {
            visibleIds = panelIds.slice(0, overflowFrom);
            overflowIds = panelIds.slice(overflowFrom);
        }
    }

    const renderTab = (pid: string, inOverflow = false) => {
        const p = panelMap.get(pid);
        if (!p) return null;
        const isActive = pid === activeTab;

        if (inOverflow) {
            return (
                <DropdownMenuItem
                    key={pid}
                    onSelect={() => onTabClick(pid)}
                    className={isActive ? 'font-semibold text-foreground' : ''}
                >
                    <span className="flex-1">{p.title}</span>
                    {counts[pid] !== undefined && (
                        <span className="ms-2 text-[10px] font-semibold opacity-50 tabular-nums">
                            {counts[pid]}
                        </span>
                    )}
                    <span
                        role="button"
                        tabIndex={0}
                        onClick={(e) => { e.stopPropagation(); onSplitTab(pid); }}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSplitTab(pid); }}}
                        className="ms-2 p-0.5 rounded hover:bg-destructive/15 hover:text-destructive transition-colors"
                        aria-label={splitLabel}
                    >
                        <X size={10} />
                    </span>
                </DropdownMenuItem>
            );
        }

        return (
            <button
                key={pid}
                data-tab-id={pid}
                onClick={() => onTabClick(pid)}
                className={[
                    'group/tab flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs whitespace-nowrap transition-all flex-shrink-0',
                    isActive
                        ? 'text-foreground font-normal group-hover/panel:font-medium bg-transparent border border-transparent group-hover/panel:bg-background group-hover/panel:shadow-sm group-hover/panel:border-border'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/60 font-normal',
                ].join(' ')}
            >
                {p.title}
                {counts[pid] !== undefined && (
                    <span className="text-[10px] font-semibold opacity-60 tabular-nums">
                        {counts[pid]}
                    </span>
                )}
                <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => { e.stopPropagation(); onSplitTab(pid); }}
                    onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.stopPropagation(); onSplitTab(pid); }}}
                    className="opacity-0 group-hover/tab:opacity-100 hover:bg-destructive/15 hover:text-destructive rounded p-0.5 transition-all leading-none"
                    aria-label={splitLabel}
                >
                    <X size={10} />
                </span>
            </button>
        );
    };

    return (
        // overflow-hidden so clipped tabs don't visually spill before measurement settles
        <div ref={containerRef} className="flex items-center gap-1 flex-1 overflow-hidden min-w-0 py-2">
            {visibleIds.map(pid => renderTab(pid, false))}

            {overflowIds.length > 0 && (
                <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                        <button
                            className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-all whitespace-nowrap"
                            aria-label={`עוד ${overflowIds.length}`}
                        >
                            <span className="tabular-nums">+{overflowIds.length}</span>
                            <ChevronDown size={11} />
                        </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                        {overflowIds.map(pid => renderTab(pid, true))}
                    </DropdownMenuContent>
                </DropdownMenu>
            )}
        </div>
    );
}

// ============================================================================
// SORTABLE TAB GROUP
// ============================================================================

interface SortableTabGroupProps {
    groupId: string;
    group: TabGroup;
    panelMap: Map<string, PanelDef>;
    counts: Record<string, number>;
    isCollapsed: boolean;
    colSpan: ColSpan;
    maxColSpan?: ColSpan;
    onToggleCollapse: () => void;
    onExpandColSpan: () => void;
    onShrinkColSpan: () => void;
    onSetColSpan: (span: ColSpan) => void;
    onSetActiveTab: (tabId: string) => void;
    onSplitTab: (panelId: string) => void;
    onSplitAll: () => void;
    onSetCount: (panelId: string, n: number) => void;
    /** Standalone panels that can be added into this group */
    availablePanels: PanelDef[];
    onAddToGroup: (panelId: string) => void;
    templateState: Record<string, unknown>;
    /** Volatile panel state (in-memory only) — merged with templateState in context */
    volatileTemplateState?: Record<string, unknown>;
    onSetTemplateState: (key: string, value: unknown) => void;
    isHidden: boolean;
    onToggleHidden: () => void;
    isEditMode: boolean;
    maxHeight: number | null;
    onSetMaxHeight: (h: number | null) => void;
    /** Number of columns in the masonry grid — used for col-span drag calculation */
    gridCols?: number;
}

function SortableTabGroup({
    groupId,
    group,
    panelMap,
    counts,
    isCollapsed,
    colSpan,
    maxColSpan = 3,
    onToggleCollapse,
    onExpandColSpan,
    onShrinkColSpan,
    onSetColSpan,
    onSetActiveTab,
    onSplitTab,
    onSplitAll,
    onSetCount,
    availablePanels,
    onAddToGroup,
    templateState,
    volatileTemplateState,
    onSetTemplateState,
    isHidden,
    onToggleHidden,
    isEditMode,
    maxHeight,
    onSetMaxHeight,
    gridCols: gridColsProp = GRID_COLS,
}: SortableTabGroupProps) {
    const innerRef = useRef<HTMLDivElement | null>(null);

    const handleVertResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = innerRef.current;
        if (!el) return;
        const startY = e.clientY;
        const startH = maxHeight ?? el.getBoundingClientRect().height;
        const onMove = (ev: MouseEvent) => {
            const newH = startH + (ev.clientY - startY);
            if (newH < HEIGHT_STEP) { onSetMaxHeight(null); return; }
            // snap to nearest HEIGHT_STEP — no upper limit
            const snapped = Math.round(newH / HEIGHT_STEP) * HEIGHT_STEP;
            onSetMaxHeight(Math.max(HEIGHT_STEP, snapped));
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'ns-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [maxHeight, onSetMaxHeight]);

    const handleHorizResizeStart = useCallback((e: React.MouseEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const el = innerRef.current;
        if (!el) return;
        const grid = el.closest('[data-panel-grid]');
        if (!grid) return;
        const startX = e.clientX;
        const startW = el.getBoundingClientRect().width;
        const isRtl = document.documentElement.dir === 'rtl';
        const onMove = (ev: MouseEvent) => {
            const delta = ev.clientX - startX;
            const newW = startW + (isRtl ? -delta : delta);
            const gridW = grid.getBoundingClientRect().width;
            const colUnit = (gridW - MASONRY_GAP_PX * (gridColsProp - 1)) / gridColsProp;
            const options = COL_SPAN_STEPS.filter(s => s >= MIN_COL_SPAN && s <= gridColsProp).map(span => ({
                span,
                w: span * colUnit + (span - 1) * MASONRY_GAP_PX,
            }));
            const best = options.reduce((a, b) =>
                Math.abs(b.w - newW) < Math.abs(a.w - newW) ? b : a
            );
            onSetColSpan(best.span);
        };
        const onUp = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
    }, [onSetColSpan, gridColsProp]);

    const {
        attributes,
        listeners,
        setNodeRef,
        transform,
        transition,
        isDragging,
    } = useSortable({ id: groupId });

    const { labels } = usePanelsConfig();

    const [rowSpan, setRowSpan] = useState(30);
    const [panelWidth, setPanelWidth] = useState(0);
    useLayoutEffect(() => {
        const el = innerRef.current;
        if (!el) return;
        const update = () => {
            setRowSpan(Math.ceil((el.offsetHeight + MASONRY_GAP_PX) / MASONRY_ROW_PX));
            setPanelWidth(el.offsetWidth);
        };
        const ro = new ResizeObserver(update);
        ro.observe(el);
        update();
        return () => ro.disconnect();
    }, []);
    const isNarrow = panelWidth > 0 && panelWidth < 280;

    const style: React.CSSProperties = {
        transform: toSortableTranslate(transform),
        transition,
        gridColumn: colSpan > 1 ? `span ${colSpan} / span ${colSpan}` : undefined,
        gridRow: `span ${rowSpan} / span ${rowSpan}`,
    };

    const activePanel = panelMap.get(group.activeTab);

    const contextValue = React.useMemo(
        () => ({ setCount: (n: number) => onSetCount(group.activeTab, n) }),
        [group.activeTab, onSetCount]
    );
    const mergedTemplateState = React.useMemo(() => {
        const stable = Object.fromEntries(
            Object.entries(templateState).filter(([k]) => !VOLATILE_PANEL_STATE_KEYS.has(k))
        );
        return volatileTemplateState ? { ...stable, ...volatileTemplateState } : stable;
    }, [templateState, volatileTemplateState]);
    // Per-panel template state is provided via the two-context API below
    // (state Record + stable dispatch), matching usePanelTemplateState.

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={[
                'group/panel h-max min-w-[280px] min-h-0 relative',
                isDragging ? 'opacity-40 z-50' : '',
            ].join(' ')}
        >
            {/* Horizontal resize handle — drag inline-end edge to change column span */}
            <div
                className="absolute inset-y-0 end-0 w-3 z-10 cursor-col-resize opacity-0 group-hover/panel:opacity-100 flex items-center justify-center"
                onMouseDown={handleHorizResizeStart}
                title="גרור לשינוי רוחב עמודות"
            >
                <div className="w-1 h-12 rounded-full bg-border hover:bg-primary/60 transition-colors" />
            </div>
            <PanelCountContext.Provider value={contextValue}>
                <PanelTemplateStateDispatchContext.Provider value={onSetTemplateState}>
                <PanelTemplateStateContext.Provider value={mergedTemplateState}>
                    <PanelWidthContext.Provider value={panelWidth}>
                    <div
                        ref={innerRef}
                        className={[
                            'rounded-2xl border transition-all flex flex-col overflow-hidden @container',
                            isDragging ? 'ring-2 ring-brand-primary/40 shadow-sm' : 'group-hover/panel:shadow-sm',
                            (isEditMode && isHidden)
                                ? 'border-dashed border-border/60 opacity-50 bg-card'
                                : isEditMode
                                    ? 'border-border bg-card shadow-sm'
                                    : 'border-border bg-card',
                        ].join(' ')}
                    >
                {/* ── Tab Group Header ── */}
                <div className={[
                    'px-2 border-b flex items-center gap-1 min-h-[44px] transition-colors rounded-t-2xl',
                    (isEditMode && isHidden)
                        ? 'bg-muted/10 border-border'
                        : isEditMode
                            ? 'bg-muted/30 border-border'
                            : 'bg-transparent border-transparent group-hover/panel:bg-muted/30 group-hover/panel:border-border',
                ].join(' ')}>
                    {/* Drag handle — always visible on hover */}
                    <button
                        {...attributes}
                        {...listeners}
                        className="hidden group-hover/panel:inline-flex focus-visible:inline-flex items-center cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground touch-none rounded p-0.5 flex-shrink-0 ms-1"
                        aria-label="גרור לשינוי סדר"
                        title="גרור לשינוי סדר"
                    >
                        <GripVertical size={15} />
                    </button>

                    {/* Tab strip with overflow menu — inherits document dir automatically */}
                    <TabStrip
                        panelIds={group.panelIds}
                        activeTab={group.activeTab}
                        panelMap={panelMap}
                        counts={counts}
                        onTabClick={onSetActiveTab}
                        onSplitTab={onSplitTab}
                        splitLabel={labels.splitPanel}
                    />

                    {!isCollapsed && !isEditMode && activePanel?.titleBadge && (
                        <div className="flex items-center gap-1 flex-shrink-0">{activePanel.titleBadge}</div>
                    )}

                    {!isCollapsed && !isEditMode && activePanel?.headerAction && (
                        <div className="flex items-center gap-1 flex-shrink-0">{activePanel.headerAction}</div>
                    )}

                    {/* Add standalone panel to this group — hidden in edit mode */}
                    {!isEditMode && availablePanels.length > 0 && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className="flex-shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground rounded p-0.5"
                                    title={labels.addPanel}
                                    aria-label={labels.addPanel}
                                >
                                    <Plus size={13} />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                {availablePanels.map(p => (
                                    <DropdownMenuItem key={p.id} onSelect={() => onAddToGroup(p.id)}>
                                        {p.title}
                                    </DropdownMenuItem>
                                ))}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}

                    {/* Separator */}
                    <div className="w-px h-5 bg-border flex-shrink-0 mx-0.5" />

                    {/* Edit-mode: height selector */}
                    {isEditMode && (
                        <div className="flex items-center gap-0.5 flex-shrink-0">
                            <ChevronsUpDown size={12} className="text-muted-foreground shrink-0" />
                            <select
                                value={maxHeight ?? ''}
                                onChange={e => onSetMaxHeight(e.target.value ? Number(e.target.value) : null)}
                                className="text-xs h-6 px-1 rounded border border-border bg-background text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary cursor-pointer"
                                title="גובה מקסימלי"
                            >
                                <option value="">שריר</option>
                                <option value="200">200px</option>
                                <option value="300">300px</option>
                                <option value="400">400px</option>
                                <option value="500">500px</option>
                                <option value="600">600px</option>
                                <option value="800">800px</option>
                            </select>
                        </div>
                    )}

                    {/* Edit-mode: hide/show toggle */}
                    {isEditMode && (
                        <button
                            onClick={onToggleHidden}
                            className={[
                                'flex-shrink-0 rounded p-0.5',
                                isHidden
                                    ? 'text-muted-foreground/50 hover:text-foreground'
                                    : 'text-foreground hover:text-muted-foreground',
                            ].join(' ')}
                            aria-label={isHidden ? 'הצג פאנל' : 'הסתר פאנל'}
                            title={isHidden ? 'הצג פאנל' : 'הסתר פאנל'}
                        >
                            {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                        </button>
                    )}

                    {/* Column-span shrink — hidden when narrow (available in kebab) */}
                    {!isNarrow && colSpan > MIN_COL_SPAN && (
                        <button
                            onClick={onShrinkColSpan}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label="כווץ טור"
                            title="כווץ טור"
                        >
                            <Minimize2 size={14} />
                        </button>
                    )}

                    {/* Column-span expand — hidden when narrow (available in kebab) */}
                    {!isNarrow && colSpan < maxColSpan && (
                        <button
                            onClick={onExpandColSpan}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            aria-label="הרחב טור"
                            title="הרחב טור"
                        >
                            <Maximize2 size={14} />
                        </button>
                    )}

                    {/* Collapse / expand toggle — hidden when narrow (available in kebab) */}
                    {!isNarrow && (
                        <button
                            onClick={onToggleCollapse}
                            className={[
                                'flex-shrink-0 text-muted-foreground hover:text-foreground rounded p-0.5',
                                HEADER_ACTION_BTN_CLS,
                                isEditMode ? 'opacity-100' : '',
                            ].join(' ')}
                            title={isCollapsed ? labels.expandPanel : labels.collapsePanel}
                            aria-label={isCollapsed ? labels.expandPanel : labels.collapsePanel}
                        >
                            {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                        </button>
                    )}

                    {!isEditMode && activePanel && (activePanel.menuItems || (isNarrow && activePanel.hasViewModes)) && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className={[
                                        'flex-shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground rounded p-0.5',
                                        HEADER_ACTION_BTN_CLS,
                                    ].join(' ')}
                                    aria-label="עוד פעולות"
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/>
                                    </svg>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                {isNarrow && activePanel.hasViewModes && (() => {
                                    const vm = (mergedTemplateState['viewMode'] as string | undefined) ?? 'tags';
                                    return (
                                        <>
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'tags')}>
                                                <span className="flex items-center gap-2">
                                                    <Tags size={13} className={vm === 'tags' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'tags' ? 'font-medium text-primary' : ''}>תגיות</span>
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'grid')}>
                                                <span className="flex items-center gap-2">
                                                    <LayoutList size={13} className={vm === 'grid' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'grid' ? 'font-medium text-primary' : ''}>רשת</span>
                                                </span>
                                            </DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => onSetTemplateState('viewMode', 'cards')}>
                                                <span className="flex items-center gap-2">
                                                    <LayoutGrid size={13} className={vm === 'cards' ? 'text-primary' : 'opacity-60'} />
                                                    <span className={vm === 'cards' ? 'font-medium text-primary' : ''}>כרטיסיות</span>
                                                </span>
                                            </DropdownMenuItem>
                                        </>
                                    );
                                })()}
                                {activePanel.menuItems && (
                                    <>
                                        {isNarrow && activePanel.hasViewModes && <DropdownMenuSeparator />}
                                        {activePanel.menuItems}
                                    </>
                                )}
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}

                    {/* Split-all — hidden in edit mode */}
                    {!isEditMode && (
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button
                                    className={[
                                        'flex-shrink-0 text-muted-foreground hover:text-foreground data-[state=open]:text-foreground rounded p-0.5 me-1',
                                        HEADER_ACTION_BTN_CLS,
                                    ].join(' ')}
                                    title={labels.splitAll}
                                    aria-label={labels.splitAll}
                                >
                                    {/* Two-panel split icon */}
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <rect x="2" y="3" width="9" height="18" rx="2"/>
                                        <rect x="13" y="3" width="9" height="18" rx="2"/>
                                    </svg>
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem
                                    onSelect={onSplitAll}
                                    className="text-destructive focus:text-destructive"
                                >
                                    <X size={13} className="opacity-60" />
                                    {labels.splitAll}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    )}
                </div>

                {/* ── Active Tab Content ── */}
                {!isCollapsed && (!isHidden || isEditMode) && activePanel && (
                    <PanelHeightContext.Provider value={maxHeight}>
                        <div
                            className={['pt-4 px-4 pb-0 overflow-x-auto', isEditMode && isHidden ? 'pointer-events-none select-none' : ''].join(' ')}
                            style={maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' } : undefined}
                        >
                            {activePanel.content}
                        </div>
                    </PanelHeightContext.Provider>
                )}
                {/* Vertical resize handle — drag to snap height to predefined steps */}
                {!isCollapsed && (
                    <div
                        className="h-2 cursor-ns-resize flex-shrink-0 opacity-0 group-hover/panel:opacity-100 hover:opacity-100 transition-all rounded-b-2xl flex items-center justify-center"
                        onMouseDown={handleVertResizeStart}
                        title="גרור לשינוי גובה"
                    >
                        <div className="w-8 h-0.5 rounded-full bg-border/60 group-hover/panel:bg-border transition-colors" />
                    </div>
                )}
                    </div>
                    </PanelWidthContext.Provider>
                </PanelTemplateStateContext.Provider>
                </PanelTemplateStateDispatchContext.Provider>
            </PanelCountContext.Provider>
        </div>
    );
}

// ============================================================================
// DRAGGABLE PANELS  (CSS Grid 3-col + drag-to-reorder + collapse + col-span
//                   + tab group merge / split + named layout templates)
// ============================================================================

type TemplateMap = Record<string, PanelStorage>;

interface DraggablePanelsProps {
    panels: PanelDef[];
    /** Per-entity localStorage key — include the entity ID so each record has its own layout */
    storageKey: string;
    /** Shared localStorage key for named templates (same for all entities of this type) */
    templatesKey?: string;
    /** Tenant ID — when provided, syncs layout to Supabase for cross-device persistence */
    tenantId?: string;
    /** Server-loaded layout — when provided, used as initial state to prevent flash of default layout */
    initialLayout?: PanelStorage | null;
    /** Override the default 12-column grid with a custom column count (3 | 4 | 6 | 12) */
    gridCols?: number;
    /**
     * Reactive colSpan overrides — applied whenever the object reference changes.
     * Used by ScreenRenderer to apply the correct col_span_* for the current device type.
     * Does NOT override the colSpan keys already handled by user manual resizes —
     * it merges on top of existing colSpans so other panel state is preserved.
     */
    colSpanOverrides?: Record<string, ColSpan>;
    /** Optional content rendered directly under the panel toolbar. */
    toolbarSlot?: React.ReactNode;
}

export function DraggablePanels({ panels: initialPanels, storageKey, templatesKey, tenantId, initialLayout, gridCols: gridColsProp, colSpanOverrides, toolbarSlot }: DraggablePanelsProps) {
    // Layout persistence comes from the host (see ./config.tsx). It is called
    // like any other hook below; the provider contract requires a stable
    // identity, so the call order can never change between renders.
    const { usePanelLayout } = usePanelsConfig();

    const effectiveGridCols = gridColsProp ?? GRID_COLS;

    // On mobile (<640px) collapse to single column — no drag resize needed.
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.matchMedia('(max-width: 639px)').matches : false
    );
    useEffect(() => {
        const mq = window.matchMedia('(max-width: 639px)');
        const handler = (e: MediaQueryListEvent) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);

    // ── Container-responsive spans ─────────────────────────────────────────────
    // The viewport media query above can't see NARROW CONTAINERS in a wide
    // viewport (e.g. the card rendered inside the split-view side panel). There,
    // a saved span like 3/12 resolves to ~150px while every panel carries
    // min-w-[280px] — the items overflow their grid tracks and visually overlap.
    // Measure the grid itself and clamp each rendered span up to the next
    // COL_SPAN_STEPS step whose track width fits the 280px minimum; when even a
    // half-row can't fit it, degrade to a full row (stacked single column).
    // Stored layout values are untouched — wide screens render exactly as saved.
    const gridElRef = useRef<HTMLDivElement | null>(null);
    const [gridWidth, setGridWidth] = useState(0);
    useEffect(() => {
        const el = gridElRef.current;
        if (!el) return;
        // ResizeObserver fires once on observe(), so no synchronous seed needed.
        const ro = new ResizeObserver((entries) => {
            const w = entries[0]?.contentRect.width ?? 0;
            setGridWidth((prev) => (Math.abs(prev - w) < 1 ? prev : w));
        });
        ro.observe(el);
        return () => ro.disconnect();
    }, []);

    const clampColSpan = useCallback((span: ColSpan): ColSpan => {
        if (!gridWidth) return span;
        const colUnit = (gridWidth - (effectiveGridCols - 1) * MASONRY_GAP_PX) / effectiveGridCols;
        const widthOf = (s: number) => s * colUnit + (s - 1) * MASONRY_GAP_PX;
        if (widthOf(span) >= MIN_PANEL_WIDTH_PX) return span;
        for (const step of COL_SPAN_STEPS) {
            // Cap at half the grid: a forced 8/12 leaves an unfillable gutter.
            if (step > span && step <= effectiveGridCols / 2 && widthOf(step) >= MIN_PANEL_WIDTH_PX) {
                return step;
            }
        }
        return effectiveGridCols as ColSpan;
    }, [gridWidth, effectiveGridCols]);

    const [isEditMode, setIsEditMode] = useState(false);
    const [showHidden, setShowHidden] = useState(false);
    const [storageSnapshot, setStorageSnapshot] = useState<PanelStorage | null>(null);
    const [activeTemplateSnapshot, setActiveTemplateSnapshot] = useState<string | null>(null);

    const [storage, setStorage] = useState<PanelStorage>(() => {
        const defaultStorage: PanelStorage = {
            order: initialPanels.map(p => p.id),
            collapsed: {},
            colSpan: {},
            panelState: {},
            groups: {},
            hidden: {},
        };

        let base: PanelStorage;
        if (!initialLayout) {
            base = defaultStorage;
        } else {
            // Reconcile the server-provided layout against the current panel set: shared
            // panels keep their arrangement, stale ids drop, missing panels append. (Was an
            // exact-set match that fell back to defaults whenever the panel set differed.)
            const currentIds = new Set(initialPanels.map(p => p.id));
            base = reconcileStorage(initialLayout, currentIds) ?? defaultStorage;
        }

        // Apply colSpanOverrides eagerly so the initial storage already reflects the merged
        // colSpan. This keeps the baseline snapshot (computed right after this) in sync with
        // the result of the colSpanOverrides useEffect, preventing a false dirty state on load.
        if (colSpanOverrides && Object.keys(colSpanOverrides).length > 0) {
            return { ...base, colSpan: { ...colSpanOverrides, ...base.colSpan } };
        }
        return base;
    });

    // Synchronously hydrate from localStorage BEFORE the browser paints.
    // Without this, the user sees the panel flash from narrow defaults to the
    // user's saved layout when the async DB load completes ~500ms-1s later.
    // useLayoutEffect runs after the first commit but before paint, so on the
    // first frame the DOM is mutated to the saved layout and only that final
    // state is painted — no visible flash. localStorage is written debounced
    // on every layout change (see persist effect below), so it's effectively
    // in sync with what the user last saw. The DB load still runs and, if it
    // disagrees, will correct state.
    // reason: validation logic depends on stable refs; intentionally one-shot on mount.
    useLayoutEffect(() => {
        if (initialLayout) return; // already hydrated from server
        if (typeof window === 'undefined' || !storageKey) return;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (!raw) return;
            const parsed = JSON.parse(raw) as PanelStorage;
            const currentIds = new Set(initialPanels.map(p => p.id));
            const migrated = reconcileStorage(parsed, currentIds);
            if (!migrated) return;
            setStorage(prev => {
                // Preserve colSpanOverrides precedence on the local-hydrate path.
                if (colSpanOverrides && Object.keys(colSpanOverrides).length > 0) {
                    return { ...migrated, colSpan: { ...colSpanOverrides, ...migrated.colSpan, ...prev.colSpan } };
                }
                return migrated;
            });
        } catch {
            /* malformed JSON — leave default state alone */
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Record counts per panel (survives collapse/expand/tab-switch cycles)
    const [counts, setCounts] = useState<Record<string, number>>({});

    // Named layout templates (shared across all entities of this type)
    const [templates, setTemplates] = useState<TemplateMap>({});
    const [savingTemplate, setSavingTemplate] = useState(false);
    const [newTemplateName, setNewTemplateName] = useState('');
    const [activeTemplateName, setActiveTemplateName] = useState<string | null>(null);
    const [openTemplateMenu, setOpenTemplateMenu] = useState<string | null>(null);
    const [confirmDeleteTemplate, setConfirmDeleteTemplate] = useState<string | null>(null);
    const [activeId, setActiveId] = useState<string | null>(null);

    // ── Volatile viewMode state ────────────────────────────────────────────────
    // viewMode is NOT written to storage (no auto-save). It lives here so that
    // changing view (grid/chart/cards/tags) shows "שמור פריסה" without auto-saving.
    // On explicit save, it gets merged into storage and persisted.
    const [volatileViewModes, setVolatileViewModes] = useState<Record<string, unknown>>(() => {
        const vms: Record<string, unknown> = {};
        for (const [id, state] of Object.entries(storage.panelState ?? {})) {
            const vm = (state as Record<string, unknown>).viewMode;
            if (vm !== undefined) vms[id] = vm;
        }
        return vms;
    });

    // ── Volatile panel state (runtime-only, never persisted) ──────────────────
    // VOLATILE_PANEL_STATE_KEYS is defined at module scope so SortablePanel and
    // SortableTabGroup can also use it to strip stale values from templateState.
    const [volatilePanelState, setVolatilePanelState] = useState<Record<string, Record<string, unknown>>>({});

    // ── Layout dirty tracking ─────────────────────────────────────────────────
    // Detects when the user has manually changed panel order/size relative to
    // the last "saved" baseline.  Shows a "שמור פריסה" button when dirty.
    const baselineLayoutRef = useRef<string>(snapshotLayout(storage, volatileViewModes));
    // True immediately when server provided the initial layout; otherwise waits
    // for the DB load to complete before we start tracking dirty state.
    const isHydratedRef = useRef<boolean>(!!initialLayout);
    const [isDirtyLayout, setIsDirtyLayout] = useState(false);

    // ── DB persistence hook ───────────────────────────────────────────────────
    // Enabled when tenantId is provided. Falls back to localStorage when disabled.
    const {
        dbLayout,
        isLoading: dbLoading,
        presets: dbPresets,
        saveLayout: saveLayoutToDB,
        saveLayoutImmediate,
        savePreset: savePresetToDB,
        applyPreset: applyPresetFromDB,
        deletePreset: deletePresetFromDB,
    } = usePanelLayout({
        tenantId: tenantId ?? '',
        storageKey,
        templatesKey,
        initialPanelIds: initialPanels.map(p => p.id),
        // DB load is skipped when initialLayout was server-provided (hydration effect guards it),
        // but DB save must always be enabled so layout changes persist across tabs/sessions.
        enabled: !!tenantId,
    });

    // Hydrate from DB (or localStorage fallback via hook) on mount.
    // Skipped entirely when initialLayout was provided by the server.
    useEffect(() => {
        if (initialLayout) return; // already hydrated from server
        if (dbLoading) return; // wait for DB load to complete
        if (dbLayout) {
            // Reconcile against this card's panels (the per-user layout is shared across
            // every card of the entity type; panel sets differ per card). Falls back to
            // the current default order when the saved layout shares nothing with this card.
            const currentIds = new Set(initialPanels.map(p => p.id));
            const migrated = reconcileStorage(dbLayout, currentIds) ?? {
                order: initialPanels.map(p => p.id),
                collapsed: {}, colSpan: {}, panelState: {}, groups: {}, hidden: {},
            };
            setStorage(migrated);
            // Extract saved viewModes and set as volatile baseline
            const loadedViewModes: Record<string, unknown> = {};
            for (const [id, state] of Object.entries(migrated.panelState ?? {})) {
                const vm = (state as Record<string, unknown>).viewMode;
                if (vm !== undefined) loadedViewModes[id] = vm;
            }
            setVolatileViewModes(loadedViewModes);
            // DB layout is now the authoritative baseline
            baselineLayoutRef.current = snapshotLayout(migrated, loadedViewModes);
            isHydratedRef.current = true;
            return;
        }
        // dbLayout is null (no DB layout, or DB not enabled).
        // The hook already tried localStorage; if nothing, leave default state.
        // Mark as hydrated so dirty tracking can start.
        isHydratedRef.current = true;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [dbLayout, dbLoading, initialLayout]);

    // Apply reactive colSpan overrides (e.g. ScreenRenderer switching col_span_tablet on rotation).
    // Fires whenever the colSpanOverrides reference changes (memoized by caller).
    useEffect(() => {
        if (!colSpanOverrides || Object.keys(colSpanOverrides).length === 0) return;
        // colSpanOverrides are screen-editor defaults — user's saved colSpan takes precedence.
        setStorage(prev => ({ ...prev, colSpan: { ...colSpanOverrides, ...prev.colSpan } }));
    // colSpanOverrides reference only changes when screen type or panel config changes (memoized upstream).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [colSpanOverrides]);

    // Persist whenever storage changes:
    //   - localStorage (120ms debounce) as offline cache
    //   - DB (via saveLayoutToDB, which has its own 500ms debounce)
    useEffect(() => {
        const timer = window.setTimeout(() => {
            try {
                localStorage.setItem(storageKey, JSON.stringify(storage));
            } catch {
                // ignore
            }
            saveLayoutToDB(storage);
        }, 120);
        return () => window.clearTimeout(timer);
    }, [storage, storageKey, saveLayoutToDB]);

    // Track dirty state: show "שמור פריסה" when layout diverges from last saved baseline.
    // Only runs after initial hydration is complete so DB/localStorage load doesn't trigger dirty.
    useEffect(() => {
        if (!isHydratedRef.current) return;
        setIsDirtyLayout(snapshotLayout(storage, volatileViewModes) !== baselineLayoutRef.current);
    }, [storage, volatileViewModes]);

    // Load templates: merge DB presets + legacy localStorage templates.
    // Depends on both templatesKey and storageKey so that navigating between
    // records of the same type (e.g. org A → org B) re-reads the shared keys.
    useEffect(() => {
        if (!templatesKey) return;

        // Legacy localStorage templates (migration bridge)
        let lsTemplates: TemplateMap = {};
        try {
            const saved = localStorage.getItem(templatesKey);
            if (saved) lsTemplates = JSON.parse(saved) as TemplateMap;
        } catch {
            // ignore
        }

        // DB presets: convert to TemplateMap for backwards-compatible UI
        const dbTemplateMap: TemplateMap = {};
        for (const preset of dbPresets) {
            dbTemplateMap[preset.name] = preset.layout as PanelStorage;
        }

        // DB presets take precedence; localStorage fills gaps during migration
        setTemplates({ ...lsTemplates, ...dbTemplateMap });

        // Active template preference stays in localStorage (pure UI state)
        try {
            const savedActive = localStorage.getItem(`${templatesKey}:active`);
            setActiveTemplateName(savedActive ?? null);
        } catch {
            // ignore
        }
    }, [templatesKey, storageKey, dbPresets]);

    // After both storage and templates are loaded, detect which template (if any) matches
    // the current layout and mark it as active — so the chip is highlighted on page load.
    useEffect(() => {
        if (!templatesKey || Object.keys(templates).length === 0) return;
        // Only auto-detect if no saved active template preference exists
        const savedActive = (() => {
            try { return localStorage.getItem(`${templatesKey}:active`); } catch { return null; }
        })();
        if (savedActive && templates[savedActive]) {
            // Already have a valid saved preference — trust it
            return;
        }
        // Find the first template whose layout matches the current storage
        const match = Object.entries(templates).find(([, tpl]) => {
            const orderMatch = JSON.stringify(tpl.order) === JSON.stringify(storage.order);
            const hiddenMatch = JSON.stringify(tpl.hidden ?? {}) === JSON.stringify(storage.hidden ?? {});
            const colSpanMatch = JSON.stringify(tpl.colSpan ?? {}) === JSON.stringify(storage.colSpan ?? {});
            return orderMatch && hiddenMatch && colSpanMatch;
        });
        const detected = match ? match[0] : null;
        setActiveTemplateName(detected);
        if (detected) {
            try { localStorage.setItem(`${templatesKey}:active`, detected); } catch { /* ignore */ }
        }
    // Run whenever storage or templates change (covers initial load + manual edits)
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [storage, templates, templatesKey]);

    const sensors = useSensors(
        useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
        useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
    );

    const handleDragStart = ({ active }: DragStartEvent) => {
        setActiveId(String(active.id));
    };

    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        setActiveId(null);
        if (over && active.id !== over.id) {
            setStorage(prev => {
                const oldIndex = prev.order.indexOf(String(active.id));
                const newIndex = prev.order.indexOf(String(over.id));
                return { ...prev, order: arrayMove(prev.order, oldIndex, newIndex) };
            });
        }
    };

    // ── Collapse / ColSpan — work on panel IDs and group IDs alike ──

    const toggleCollapse = (id: string) => {
        setStorage(prev => ({
            ...prev,
            collapsed: { ...prev.collapsed, [id]: !prev.collapsed[id] },
        }));
    };

    const expandColSpan = (id: string) => {
        setStorage(prev => {
            const current = (prev.colSpan[id] ?? 3) as ColSpan;
            const idx = COL_SPAN_STEPS.indexOf(current);
            const next = idx < COL_SPAN_STEPS.length - 1 ? COL_SPAN_STEPS[idx + 1] : current;
            return { ...prev, colSpan: { ...prev.colSpan, [id]: next } };
        });
    };

    const shrinkColSpan = (id: string) => {
        setStorage(prev => {
            const current = (prev.colSpan[id] ?? 3) as ColSpan;
            const idx = COL_SPAN_STEPS.indexOf(current);
            const next = idx > 0 ? COL_SPAN_STEPS[idx - 1] : current;
            const clamped = (next < MIN_COL_SPAN ? MIN_COL_SPAN : next) as ColSpan;
            return { ...prev, colSpan: { ...prev.colSpan, [id]: clamped } };
        });
    };

    const setColSpan = (id: string, span: ColSpan) => {
        setStorage(prev => ({ ...prev, colSpan: { ...prev.colSpan, [id]: span } }));
    };

    const toggleHidden = (id: string) => {
        setStorage(prev => ({
            ...prev,
            hidden: { ...prev.hidden, [id]: !prev.hidden[id] },
        }));
    };

    const setMaxHeight = (id: string, h: number | null) => {
        setStorage(prev => {
            const next = { ...(prev.panelMaxHeight ?? {}) };
            if (h === null) { delete next[id]; } else { next[id] = h; }
            return { ...prev, panelMaxHeight: next };
        });
    };

    const renamePanel = (id: string, newTitle: string) => {
        setStorage(prev => ({
            ...prev,
            customTitles: { ...(prev.customTitles ?? {}), [id]: newTitle },
        }));
    };

    // ── Merge: source panel joins target (standalone or existing group) ──

    const mergeIntoGroup = (sourceId: string, targetId: string) => {
        setStorage(prev => {
            // If targetId already lives inside a group, add source to that group
            const existingEntry = Object.entries(prev.groups).find(([, g]) =>
                g.panelIds.includes(targetId)
            );

            if (existingEntry) {
                const [groupId, group] = existingEntry;
                if (group.panelIds.includes(sourceId)) return prev;
                return {
                    ...prev,
                    order: prev.order.filter(id => id !== sourceId),
                    groups: {
                        ...prev.groups,
                        [groupId]: { ...group, panelIds: [...group.panelIds, sourceId] },
                    },
                };
            }

            // Create a new group — replace target slot, remove source
            const groupId = 'grp-' + (
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : Date.now().toString()
            );

            const newOrder = prev.order
                .map(id => id === targetId ? groupId : id)
                .filter(id => id !== sourceId);

            return {
                ...prev,
                order: newOrder,
                groups: {
                    ...prev.groups,
                    [groupId]: { panelIds: [targetId, sourceId], activeTab: targetId },
                },
            };
        });
    };

    // ── Add existing standalone panel to an existing group ──

    const addToGroup = (groupId: string, panelId: string) => {
        setStorage(prev => {
            const group = prev.groups[groupId];
            if (!group || group.panelIds.includes(panelId)) return prev;
            return {
                ...prev,
                order: prev.order.filter(id => id !== panelId),
                groups: {
                    ...prev.groups,
                    [groupId]: { ...group, panelIds: [...group.panelIds, panelId] },
                },
            };
        });
    };

    // ── Split one tab out of its group ──

    const splitFromGroup = (groupId: string, panelId: string) => {
        setStorage(prev => {
            const group = prev.groups[groupId];
            if (!group) return prev;

            const remaining = group.panelIds.filter(id => id !== panelId);

            if (remaining.length === 1) {
                // Only one tab would remain → dissolve the group entirely
                const lastId = remaining[0];
                const newGroups = { ...prev.groups };
                delete newGroups[groupId];
                // Replace group slot with last remaining panel, then append split panel
                const newOrder = [...prev.order];
                const idx = newOrder.indexOf(groupId);
                newOrder.splice(idx, 1, lastId, panelId);
                return { ...prev, order: newOrder, groups: newGroups };
            }

            // Insert split panel right after the group
            const newOrder = [...prev.order];
            const groupIdx = newOrder.indexOf(groupId);
            newOrder.splice(groupIdx + 1, 0, panelId);

            const newActiveTab = group.activeTab === panelId ? remaining[0] : group.activeTab;

            return {
                ...prev,
                order: newOrder,
                groups: {
                    ...prev.groups,
                    [groupId]: { panelIds: remaining, activeTab: newActiveTab },
                },
            };
        });
    };

    // ── Dissolve entire group — all tabs become standalone panels ──

    const splitAllFromGroup = (groupId: string) => {
        setStorage(prev => {
            const group = prev.groups[groupId];
            if (!group) return prev;

            const groupIdx = prev.order.indexOf(groupId);
            const newOrder = [...prev.order];
            newOrder.splice(groupIdx, 1, ...group.panelIds);

            const newGroups = { ...prev.groups };
            delete newGroups[groupId];

            return { ...prev, order: newOrder, groups: newGroups };
        });
    };

    // ── Switch active tab ──

    const setActiveTab = (groupId: string, tabId: string) => {
        setStorage(prev => {
            const group = prev.groups[groupId];
            if (!group) return prev;
            return {
                ...prev,
                groups: { ...prev.groups, [groupId]: { ...group, activeTab: tabId } },
            };
        });
    };

    // ── Template handlers ──────────────────────────────────────────────────

    const applyTemplate = (name: string) => {
        const tpl = templates[name];
        if (!tpl) return;
        const initialIds = new Set(initialPanels.map(p => p.id));

        // For templates with groups, validate group contents too
        const tplGroups = tpl.groups ?? {};
        const allTplPanelIds = new Set<string>([
            ...(tpl.order ?? []).filter(id => !id.startsWith('grp-')),
            ...Object.values(tplGroups).flatMap(g => g.panelIds),
        ]);

        // Check if all panels are accounted for
        const allValid = initialPanels.every(p => allTplPanelIds.has(p.id));

        if (allValid) {
            setStorage({
                order: tpl.order,
                collapsed: tpl.collapsed ?? {},
                colSpan: tpl.colSpan ?? {},
                panelState: tpl.panelState ?? {},
                groups: tplGroups,
                hidden: tpl.hidden ?? {},
                panelMaxHeight: tpl.panelMaxHeight ?? {},
            });
        } else {
            // Fallback: only restore non-group parts
            const validOrder = (tpl.order ?? []).filter(id => initialIds.has(id));
            const missingIds = initialPanels.map(p => p.id).filter(id => !validOrder.includes(id));
            setStorage({
                order: [...validOrder, ...missingIds],
                collapsed: tpl.collapsed ?? {},
                colSpan: tpl.colSpan ?? {},
                panelState: tpl.panelState ?? {},
                groups: {},
                hidden: tpl.hidden ?? {},
                panelMaxHeight: tpl.panelMaxHeight ?? {},
            });
        }
        setActiveTemplateName(name);
        try { localStorage.setItem(`${templatesKey}:active`, name); } catch { /* ignore */ }
        // Sync to DB: apply preset as active layout for current screen type
        const preset = dbPresets.find(p => p.name === name);
        if (preset) {
            void applyPresetFromDB(preset.id, () => { /* storage already set above */ });
        }
    };

    const confirmSaveTemplate = () => {
        const name = newTemplateName.trim();
        if (!name) return;
        setTemplates(prev => {
            const next = { ...prev, [name]: storage };
            if (templatesKey) {
                try { localStorage.setItem(templatesKey, JSON.stringify(next)); } catch { /* ignore */ }
            }
            return next;
        });
        // Persist to DB
        void savePresetToDB(name, storage as import('./persistence').PanelStorage);
        setNewTemplateName('');
        setSavingTemplate(false);
        setActiveTemplateName(name);
        try { localStorage.setItem(`${templatesKey}:active`, name); } catch { /* ignore */ }
        // Exit edit mode after saving template
        setStorageSnapshot(null);
        setIsEditMode(false);
    };

    const enterEditMode = () => {
        setStorageSnapshot(storage);
        setActiveTemplateSnapshot(activeTemplateName);
        setIsEditMode(true);
    };

    const exitEditMode = () => {
        setStorageSnapshot(null);
        setIsEditMode(false);
        setShowHidden(false);
        setSavingTemplate(false);
        setNewTemplateName('');
        // Keep activeTemplateName as-is — saving custom layout changes clears it only if
        // a template wasn't explicitly applied during this edit session.
        // If the user just clicked שמור without changing anything, preserve the active template.
        // Update dirty baseline so "שמור פריסה" disappears after an edit-mode save.
        baselineLayoutRef.current = snapshotLayout(storage, volatileViewModes);
        setIsDirtyLayout(false);
    };

    const cancelEditMode = () => {
        if (storageSnapshot) setStorage(storageSnapshot);
        setStorageSnapshot(null);
        setIsEditMode(false);
        setShowHidden(false);
        setSavingTemplate(false);
        setNewTemplateName('');
        // Restore the template name that was active before editing
        setActiveTemplateName(activeTemplateSnapshot);
        if (activeTemplateSnapshot) {
            try { localStorage.setItem(`${templatesKey}:active`, activeTemplateSnapshot); } catch { /* ignore */ }
        } else {
            try { localStorage.removeItem(`${templatesKey}:active`); } catch { /* ignore */ }
        }
        setActiveTemplateSnapshot(null);
    };

    const deleteTemplate = (name: string) => {
        setTemplates(prev => {
            const next = { ...prev };
            delete next[name];
            if (templatesKey) {
                try { localStorage.setItem(templatesKey, JSON.stringify(next)); } catch { /* ignore */ }
            }
            return next;
        });
        // Delete from DB
        const preset = dbPresets.find(p => p.name === name);
        if (preset) void deletePresetFromDB(preset.id);
        if (activeTemplateName === name) {
            setActiveTemplateName(null);
            try { localStorage.removeItem(`${templatesKey}:active`); } catch { /* ignore */ }
        }
        if (openTemplateMenu === name) {
            setOpenTemplateMenu(null);
        }
    };

    // ── Stable callbacks ──

    const makeSetCount = useCallback(
        (panelId: string) => (n: number) =>
            setCounts(prev => prev[panelId] === n ? prev : { ...prev, [panelId]: n }),
        []
    );

    const handleSetCountForGroup = useCallback(
        (panelId: string, n: number) =>
            setCounts(prev => prev[panelId] === n ? prev : { ...prev, [panelId]: n }),
        []
    );

    const makeSetTemplateState = useCallback(
        (panelId: string) => (key: string, value: unknown) => {
            if (key === 'viewMode') {
                // viewMode is NOT written to storage — it lives in volatileViewModes
                // so that changing view does not auto-save; only explicit "שמור פריסה" persists it.
                setVolatileViewModes(prev =>
                    Object.is(prev[panelId], value) ? prev : { ...prev, [panelId]: value }
                );
                return;
            }
            // Volatile keys (display/signal state) stay in memory — never trigger
            // storage updates, localStorage writes, or DB saves.
            if (VOLATILE_PANEL_STATE_KEYS.has(key)) {
                setVolatilePanelState(prev => {
                    const prevState = prev[panelId] ?? {};
                    if (Object.is(prevState[key], value)) return prev;
                    return { ...prev, [panelId]: { ...prevState, [key]: value } };
                });
                return;
            }
            setStorage(prev => {
                const prevPanelState = prev.panelState[panelId] ?? {};
                if (Object.is(prevPanelState[key], value)) return prev;
                return {
                    ...prev,
                    panelState: {
                        ...prev.panelState,
                        [panelId]: {
                            ...prevPanelState,
                            [key]: value,
                        },
                    },
                };
            });
        },
        [] // eslint-disable-line react-hooks/exhaustive-deps
    );

    // ── Stable per-panel setTemplateState handlers ────────────────────────────
    // makeSetTemplateState(id) creates a new closure on every call.
    // Pre-computing one closure per panel ID and memoizing the map ensures that
    // SortablePanel receives the SAME function reference between renders, so
    // templateContextValue (which depends on onSetTemplateState) stays stable
    // and doesn't cause ALL panel context consumers to re-render on every
    // DraggablePanels state update.
    // Re-computes only when panel IDs actually change (reorder / add / remove).
    const panelIdsKey = React.useMemo(
        () => storage.order.filter(id => !id.startsWith('grp-')).join(',') + '|' +
            Object.values(storage.groups ?? {}).flatMap(g => g.panelIds).sort().join(','),
        [storage.order, storage.groups]
    );
    const stableSetTemplateStateHandlers = React.useMemo(() => {
        const map: Record<string, (key: string, value: unknown) => void> = {};
        for (const id of storage.order.filter(id2 => !id2.startsWith('grp-'))) {
            map[id] = makeSetTemplateState(id);
        }
        for (const group of Object.values(storage.groups ?? {})) {
            for (const panelId of group.panelIds) {
                if (!map[panelId]) map[panelId] = makeSetTemplateState(panelId);
            }
        }
        return map;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [panelIdsKey, makeSetTemplateState]);

    // ── Explicit layout save (called from "שמור פריסה" button) ──────────────

    const handleExplicitSave = useCallback(() => {
        // Merge volatile viewModes into panelState before saving
        const mergedPanelState = { ...storage.panelState };
        for (const [panelId, viewMode] of Object.entries(volatileViewModes)) {
            mergedPanelState[panelId] = { ...(mergedPanelState[panelId] ?? {}), viewMode };
        }
        const storageToSave = { ...storage, panelState: mergedPanelState };
        // Immediate save: writes localStorage synchronously + fires DB request immediately
        // so a hard refresh cannot cancel the pending debounce timer.
        saveLayoutImmediate(storageToSave);
        // Reset dirty baseline
        baselineLayoutRef.current = snapshotLayout(storageToSave, volatileViewModes);
        setIsDirtyLayout(false);
    }, [storage, saveLayoutImmediate, volatileViewModes]);

    // Auto-save layout when a panel's entity-view saves its config (widgetMode).
    // EntityViewLayout sets autoSaveLayoutSignal (volatile) after a successful view save,
    // so the "שמור פריסה" button disappears without the user needing to click it.
    const handleExplicitSaveRef = React.useRef(handleExplicitSave);
    React.useEffect(() => { handleExplicitSaveRef.current = handleExplicitSave; }, [handleExplicitSave]);
    const autoSaveLayoutSig = Object.values(volatilePanelState)
        .reduce((sum, s) => sum + ((s as Record<string, unknown>).autoSaveLayoutSignal as number || 0), 0);
    React.useEffect(() => {
        if (autoSaveLayoutSig === 0 || !isHydratedRef.current) return;
        handleExplicitSaveRef.current();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSaveLayoutSig]);

    // ── Dirty detection: active template exists but current storage diverges from it ──

    const isTemplateDirty = useMemo(() => {
        if (!activeTemplateName) return false;
        const tpl = templates[activeTemplateName];
        if (!tpl) return false;
        const cmp = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
        return !(
            cmp(storage.order, tpl.order) &&
            cmp(storage.hidden ?? {}, tpl.hidden ?? {}) &&
            cmp(storage.colSpan ?? {}, tpl.colSpan ?? {}) &&
            cmp(storage.groups ?? {}, tpl.groups ?? {}) &&
            cmp(storage.panelMaxHeight ?? {}, tpl.panelMaxHeight ?? {}) &&
            cmp(storage.customTitles ?? {}, tpl.customTitles ?? {})
        );
    }, [storage, templates, activeTemplateName]);

    /** Overwrite an existing template with the current storage */
    const overwriteTemplate = (name: string) => {
        setTemplates(prev => {
            const next = { ...prev, [name]: storage };
            if (templatesKey) {
                try { localStorage.setItem(templatesKey, JSON.stringify(next)); } catch { /* ignore */ }
            }
            return next;
        });
        void savePresetToDB(name, storage as import('./persistence').PanelStorage);
        // Keep activeTemplateName pointing to this template (layout now matches it)
        setActiveTemplateName(name);
        if (templatesKey) { try { localStorage.setItem(`${templatesKey}:active`, name); } catch { /* ignore */ } }
        setOpenTemplateMenu(null);
    };

    // ── Derived ──

    const panelMap = new Map(initialPanels.map(p => [p.id, p]));

    // Panel IDs that live inside any group (not standalone)
    const panelIdsInGroups = new Set(
        Object.values(storage.groups).flatMap(g => g.panelIds)
    );

    // Panels currently visible as standalone items in the grid
    const standalonePanels = initialPanels.filter(p => !panelIdsInGroups.has(p.id));

    // Title shown in the DragOverlay while a panel/group is being dragged
    const activeLabel = activeId
        ? activeId.startsWith('grp-')
            ? (storage.groups[activeId]?.panelIds ?? [])
                .map(pid => panelMap.get(pid)?.title)
                .filter(Boolean)
                .join(' + ')
            : panelMap.get(activeId)?.title ?? ''
        : null;

    return (
        <DndContext
            id={storageKey}
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
        >
            <SortableContext items={storage.order} strategy={rectSortingStrategy}>

                {/* ── Toolbar ── */}
                <div className="mb-4 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">

                        {/* Template chips — always visible for quick switching */}
                        {templatesKey && Object.keys(templates).length > 0 && (
                            <div className="flex items-center gap-1.5 flex-wrap flex-1">
                                {Object.keys(templates).map(name => (
                                    <Popover.Root
                                        key={name}
                                        open={openTemplateMenu === name}
                                        onOpenChange={(open) => setOpenTemplateMenu(open ? name : null)}
                                    >
                                        <div className={[
                                            "flex items-center rounded-lg overflow-hidden border shadow-sm",
                                            activeTemplateName === name && isTemplateDirty
                                                ? "border-amber-400 dark:border-amber-600"
                                                : "border-border",
                                        ].join(" ")}>
                                            <Popover.Trigger asChild>
                                                <button
                                                    className={[
                                                        "px-2.5 py-1 text-xs transition-colors flex items-center gap-1",
                                                        activeTemplateName === name
                                                            ? isTemplateDirty
                                                                ? "bg-amber-100/80 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300"
                                                                : "bg-primary/15 text-primary"
                                                            : "bg-secondary hover:bg-secondary/70",
                                                    ].join(" ")}
                                                    title={activeTemplateName === name
                                                        ? isTemplateDirty ? `תבנית פעילה: ${name} — יש שינויים שלא נשמרו` : `תבנית פעילה: ${name}`
                                                        : `החל תבנית: ${name}`}
                                                >
                                                    <LayoutTemplate size={11} />
                                                    {name}
                                                    {activeTemplateName === name && (
                                                        <span className="text-[10px] font-semibold">
                                                            {isTemplateDirty ? '• שונה' : '• פעילה'}
                                                        </span>
                                                    )}
                                                </button>
                                            </Popover.Trigger>
                                            {confirmDeleteTemplate === name ? (
                                                /* ── Inline delete confirmation ── */
                                                <>
                                                    <button
                                                        onClick={() => { deleteTemplate(name); setConfirmDeleteTemplate(null); }}
                                                        className="px-1.5 py-1 text-xs bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors border-r border-border"
                                                        title="אשר מחיקה"
                                                    >
                                                        <Check size={10} />
                                                    </button>
                                                    <button
                                                        onClick={() => setConfirmDeleteTemplate(null)}
                                                        className="px-1.5 py-1 text-xs bg-secondary hover:bg-secondary/70 transition-colors border-r border-border text-muted-foreground"
                                                        title="בטל"
                                                    >
                                                        <X size={10} />
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => setConfirmDeleteTemplate(name)}
                                                    className="px-1.5 py-1 text-xs bg-secondary hover:bg-destructive hover:text-destructive-foreground transition-colors border-r border-border text-muted-foreground"
                                                    title="מחק תבנית"
                                                >
                                                    <X size={10} />
                                                </button>
                                            )}
                                        </div>

                                        <Popover.Portal>
                                            <Popover.Content
                                                sideOffset={6}
                                                align="start"
                                                className="z-50 min-w-[180px] rounded-lg border border-border bg-popover text-popover-foreground p-1 shadow-md"
                                            >
                                                {!isEditMode && activeTemplateName === name && isTemplateDirty && (
                                                    <button
                                                        onClick={() => overwriteTemplate(name)}
                                                        className="w-full text-end px-2 py-1.5 text-xs rounded-md hover:bg-amber-50 dark:hover:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-medium transition-colors flex items-center gap-2"
                                                    >
                                                        <CloudUpload size={12} className="flex-shrink-0" />
                                                        שמור שינויים לתבנית
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => {
                                                        applyTemplate(name);
                                                        setOpenTemplateMenu(null);
                                                    }}
                                                    className="w-full text-end px-2 py-1.5 text-xs rounded-md hover:bg-accent transition-colors"
                                                >
                                                    החל תבנית
                                                </button>
                                                <button
                                                    onClick={() => deleteTemplate(name)}
                                                    className="w-full text-end px-2 py-1.5 text-xs rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                                                >
                                                    מחק תבנית
                                                </button>
                                            </Popover.Content>
                                        </Popover.Portal>
                                    </Popover.Root>
                                ))}
                            </div>
                        )}

                        {/* Edit mode actions — right side */}
                        <div className="flex items-center gap-1.5 ms-auto">
                        {isEditMode ? (
                            savingTemplate ? (
                                /* ── Saving template: name input ── */
                                <>
                                    <input
                                        value={newTemplateName}
                                        onChange={e => setNewTemplateName(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter' && newTemplateName.trim()) confirmSaveTemplate();
                                            if (e.key === 'Escape') { setSavingTemplate(false); setNewTemplateName(''); }
                                        }}
                                        placeholder="שם התבנית..."
                                        autoFocus
                                        className={`text-xs h-7 px-2 rounded-lg border bg-background w-36 focus:outline-none focus:ring-1 dark:border-amber-700 ${newTemplateName.trim() ? 'border-amber-300 focus:ring-amber-400' : 'border-red-300 focus:ring-red-400'}`}
                                    />
                                    <button
                                        onClick={confirmSaveTemplate}
                                        disabled={!newTemplateName.trim()}
                                        className="h-7 px-2.5 text-xs rounded-lg border border-amber-300 bg-amber-100/80 text-amber-800 hover:bg-amber-200/80 transition-colors disabled:opacity-40 flex items-center gap-1 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700"
                                    >
                                        <Check size={11} /> שמור
                                    </button>
                                    <button
                                        onClick={() => { setSavingTemplate(false); setNewTemplateName(''); }}
                                        className="h-7 px-1.5 text-xs rounded-lg border border-border bg-secondary hover:bg-secondary/70 transition-colors text-muted-foreground"
                                        title="ביטול שמירה"
                                    >
                                        <X size={11} />
                                    </button>
                                </>
                            ) : (
                                /* ── Edit mode controls ── */
                                <>
                                    {Object.values(storage.hidden).some(Boolean) && (
                                        <button
                                            onClick={() => setShowHidden(v => !v)}
                                            className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                                showHidden
                                                    ? 'border-primary/40 bg-primary/10 text-primary'
                                                    : 'border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70'
                                            }`}
                                            title={showHidden ? 'הסתר פאנלים מוסתרים' : 'הצג פאנלים מוסתרים'}
                                        >
                                            {showHidden ? <EyeOff size={11} /> : <Eye size={11} />}
                                            {showHidden ? 'הסתר מוסתרים' : 'הצג מוסתרים'}
                                        </button>
                                    )}
                                    <button
                                        onClick={cancelEditMode}
                                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border bg-secondary text-muted-foreground hover:text-foreground hover:bg-secondary/70 transition-colors"
                                        title="ביטול — שחזר מצב קודם"
                                    >
                                        <RotateCcw size={11} />
                                        ביטול
                                    </button>
                                    {/* Split save button */}
                                    {templatesKey ? (
                                        <div className="flex items-center rounded-lg overflow-hidden border border-amber-300 dark:border-amber-700 shadow-sm">
                                            {/* Main action */}
                                            <button
                                                onClick={() => {
                                                    if (activeTemplateName && templates[activeTemplateName]) {
                                                        overwriteTemplate(activeTemplateName);
                                                        exitEditMode();
                                                    } else {
                                                        exitEditMode();
                                                    }
                                                }}
                                                className="flex items-center gap-1.5 text-xs px-2.5 py-1 bg-amber-100/80 text-amber-800 hover:bg-amber-200/80 transition-colors dark:bg-amber-900/30 dark:text-amber-300"
                                                title={activeTemplateName && templates[activeTemplateName]
                                                    ? `שמור לתבנית: ${activeTemplateName}`
                                                    : 'שמור פריסה'}
                                            >
                                                <CloudUpload size={11} />
                                                {activeTemplateName && templates[activeTemplateName]
                                                    ? `שמור לתבנית: ${activeTemplateName}`
                                                    : 'שמור'}
                                            </button>
                                            {/* Dropdown arrow */}
                                            <DropdownMenu>
                                                <DropdownMenuTrigger asChild>
                                                    <button
                                                        className="flex items-center px-1.5 py-1 bg-amber-100/80 text-amber-800 hover:bg-amber-200/80 transition-colors dark:bg-amber-900/30 dark:text-amber-300 border-r border-amber-300 dark:border-amber-700"
                                                        title="אפשרויות שמירה נוספות"
                                                    >
                                                        <ChevronDown size={11} />
                                                    </button>
                                                </DropdownMenuTrigger>
                                                <DropdownMenuContent align="end" className="min-w-[200px]">
                                                    {activeTemplateName && templates[activeTemplateName] && (
                                                        <DropdownMenuItem onSelect={() => { overwriteTemplate(activeTemplateName); exitEditMode(); }}>
                                                            <span className="flex items-center gap-2">
                                                                <CloudUpload size={12} className="opacity-60" />
                                                                שמור לתבנית: {activeTemplateName}
                                                            </span>
                                                        </DropdownMenuItem>
                                                    )}
                                                    <DropdownMenuItem onSelect={() => setSavingTemplate(true)}>
                                                        <span className="flex items-center gap-2">
                                                            <Plus size={12} className="opacity-60" />
                                                            שמור כתבנית חדשה
                                                        </span>
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem onSelect={exitEditMode}>
                                                        <span className="flex items-center gap-2">
                                                            <Check size={12} className="opacity-60" />
                                                            שמור ללא תבנית
                                                        </span>
                                                    </DropdownMenuItem>
                                                </DropdownMenuContent>
                                            </DropdownMenu>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={exitEditMode}
                                            className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-border bg-secondary text-foreground hover:bg-secondary/70 transition-colors"
                                            title="שמור שינויים"
                                        >
                                            <Check size={11} />
                                            שמור
                                        </button>
                                    )}
                                </>
                            )
                        ) : (
                            /* ── Normal mode ── */
                            <>
                                {/* "שמור פריסה" — appears when user has dragged/resized panels */}
                                {isDirtyLayout && (
                                    <button
                                        onClick={handleExplicitSave}
                                        className="flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-lg border border-emerald-300 bg-emerald-100/80 text-emerald-800 hover:bg-emerald-200/80 dark:bg-emerald-900/30 dark:text-emerald-300 dark:border-emerald-700 transition-colors"
                                        title="שמור פריסת פאנלים"
                                    >
                                        <CloudUpload size={11} />
                                        שמור פריסה
                                    </button>
                                )}
                            </>
                        )}
                        </div>
                    </div>
                    {toolbarSlot && (
                        <div className="min-w-0">
                            {toolbarSlot}
                        </div>
                    )}
                </div>

                {/* Masonry grid — grid-auto-rows: 4px, each panel spans exactly its height + gap */}
                <div
                    ref={gridElRef}
                    data-panel-grid
                    className="grid items-start"
                    style={{
                        gridTemplateColumns: isMobile ? '1fr' : `repeat(${effectiveGridCols}, minmax(0, 1fr))`,
                        gridAutoRows: `${MASONRY_ROW_PX}px`,
                        columnGap: `${MASONRY_GAP_PX}px`,
                    }}
                >
                    {storage.order.map(id => {
                        const isHiddenItem = !!storage.hidden[id];

                        // Hidden panels are invisible by default in both modes.
                        // In edit mode the "הצג מוסתרים" button sets showHidden=true to reveal them (dimmed).
                        if (isHiddenItem && !showHidden) return null;

                        // ── Tab group ──
                        if (id.startsWith('grp-')) {
                            const group = storage.groups[id];
                            if (!group) return null;
                            const activeTabId = group.activeTab;
                            const available = standalonePanels.filter(
                                p => !group.panelIds.includes(p.id)
                            );
                            return (
                                <SortableTabGroup
                                    key={id}
                                    groupId={id}
                                    group={group}
                                    panelMap={panelMap}
                                    counts={counts}
                                    isCollapsed={!!storage.collapsed[id]}
                                    colSpan={clampColSpan((storage.colSpan[id] ?? 3) as ColSpan)}
                                    onToggleCollapse={() => toggleCollapse(id)}
                                    onExpandColSpan={() => expandColSpan(id)}
                                    onShrinkColSpan={() => shrinkColSpan(id)}
                                    onSetColSpan={(span: ColSpan) => setColSpan(id, span)}
                                    onSetActiveTab={(tabId) => setActiveTab(id, tabId)}
                                    onSplitTab={(panelId) => splitFromGroup(id, panelId)}
                                    onSplitAll={() => splitAllFromGroup(id)}
                                    onSetCount={handleSetCountForGroup}
                                    availablePanels={available}
                                    onAddToGroup={(panelId) => addToGroup(id, panelId)}
                                    templateState={volatileViewModes[activeTabId] !== undefined ? { ...(storage.panelState[activeTabId] ?? {}), viewMode: volatileViewModes[activeTabId] } : (storage.panelState[activeTabId] ?? {})}
                                    volatileTemplateState={volatilePanelState[activeTabId]}
                                    onSetTemplateState={stableSetTemplateStateHandlers[activeTabId] ?? makeSetTemplateState(activeTabId)}
                                    isHidden={isHiddenItem}
                                    onToggleHidden={() => toggleHidden(id)}
                                    isEditMode={isEditMode}
                                    maxHeight={storage.panelMaxHeight?.[id] ?? null}
                                    onSetMaxHeight={(h) => setMaxHeight(id, h)}
                                    gridCols={effectiveGridCols}
                                />
                            );
                        }

                        // ── Standalone panel ──
                        const panel = panelMap.get(id);
                        if (!panel) return null;

                        // Build merge targets: other standalone panels + all existing groups
                        // In edit mode, exclude hidden panels from merge targets to keep things clean
                        const panelMergeTargets: MergeTarget[] = standalonePanels
                            .filter(p => p.id !== id && (isEditMode || !storage.hidden[p.id]))
                            .map(p => ({ type: 'panel' as const, id: p.id, label: storage.customTitles?.[p.id] ?? p.title }));

                        const groupMergeTargets: MergeTarget[] = Object.entries(storage.groups)
                            .map(([groupId, group]) => ({
                                type: 'group' as const,
                                groupId,
                                label: group.panelIds
                                    .map(pid => panelMap.get(pid)?.title ?? pid)
                                    .join(' + '),
                                representativeId: group.panelIds[0] ?? '',
                            }))
                            .filter(t => t.representativeId !== '');

                        const mergeTargets: MergeTarget[] = [...panelMergeTargets, ...groupMergeTargets];

                        return (
                            <SortablePanel
                                key={id}
                                panel={panel}
                                count={counts[id]}
                                isCollapsed={!!storage.collapsed[id]}
                                onToggleCollapse={() => toggleCollapse(id)}
                                onSetCount={makeSetCount(id)}
                                templateState={volatileViewModes[id] !== undefined ? { ...(storage.panelState[id] ?? {}), viewMode: volatileViewModes[id] } : (storage.panelState[id] ?? {})}
                                volatileTemplateState={volatilePanelState[id]}
                                onSetTemplateState={stableSetTemplateStateHandlers[id] ?? makeSetTemplateState(id)}
                                colSpan={clampColSpan((storage.colSpan[id] ?? panel.defaultColSpan ?? 3) as ColSpan)}
                                onExpandColSpan={() => expandColSpan(id)}
                                onShrinkColSpan={() => shrinkColSpan(id)}
                                onSetColSpan={(span: ColSpan) => setColSpan(id, span)}
                                mergeTargets={mergeTargets}
                                onMerge={(targetId) => mergeIntoGroup(id, targetId)}
                                isHidden={isHiddenItem}
                                onToggleHidden={() => toggleHidden(id)}
                                isEditMode={isEditMode}
                                isPreviewHidden={false}
                                maxHeight={storage.panelMaxHeight?.[id] ?? null}
                                onSetMaxHeight={(h) => setMaxHeight(id, h)}
                                displayTitle={storage.customTitles?.[id] ?? panel.title}
                                onRename={(newTitle) => renamePanel(id, newTitle)}
                                gridCols={effectiveGridCols}
                            />
                        );
                    })}
                </div>
            </SortableContext>

            {/* Floating drag preview — follows the cursor while dragging */}
            <DragOverlay>
                {activeLabel != null && (
                    <div className="rounded-2xl border-2 border-primary/40 bg-card/90 shadow-2xl px-4 py-2.5 flex items-center gap-2 cursor-grabbing select-none">
                        <GripVertical size={15} className="text-muted-foreground flex-shrink-0" />
                        <span className="text-sm font-semibold text-foreground">{activeLabel}</span>
                    </div>
                )}
            </DragOverlay>
        </DndContext>
    );
}
