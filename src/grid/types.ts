import type { ElementType, ReactNode } from "react";
import type { MicroGridResponsiveGroup } from "./responsiveGroups";

// ─── Inline-edit configuration ────────────────────────────────────────────

export interface MicroEditOption {
    value: string;
    label: string;
}

export type MicroComponentEditProps<T> = {
    value: unknown;
    initialValue?: unknown;
    onValueChange: (value: unknown) => void;
    stopEditing: (suppressNavigate?: boolean) => void;
    rowData: T;
    data: T;
    colDef?: unknown;
    api: { stopEditing: (suppressNavigate?: boolean) => void };
};

export type MicroEditConfig<T> =
    | { kind: "text" }
    | { kind: "number"; min?: number; max?: number; step?: number }
    | { kind: "select"; options: MicroEditOption[] }
    | { kind: "checkbox" }
    | { kind: "date" }
    | {
          kind: "component";
          Component: ElementType;
          params?: Record<string, unknown>;
          colDef?: unknown;
      }
    | {
          kind: "custom";
          render: (props: {
              value: unknown;
              row: T;
              commit: (next: unknown) => void;
              cancel: () => void;
          }) => ReactNode;
      };

export type MicroGridDensity = "compact" | "cozy" | "comfortable";

export type MicroSortDirection = "asc" | "desc";

export interface MicroSortState {
    columnId: string;
    direction: MicroSortDirection;
}

export type MicroSelectionMode = "none" | "single" | "multi";

export interface MicroColumn<T> {
    id: string;
    header: ReactNode;
    /** Optional slot next to the header label (e.g. filter popover). */
    headerSlot?: ReactNode;
    accessor: keyof T | ((row: T) => unknown);
    width?: number | string;
    align?: "start" | "center" | "end";
    /** Vertical alignment within the row. Default: 'top' (matches design decision 2026-05-24). */
    verticalAlign?: "top" | "middle";
    /**
     * Hint for responsive grouping: marks a column as a candidate to drive the
     * composite group label. Does not affect header interactivity; sorting is
     * owned by host toolbar controls.
     */
    sortable?: boolean;
    cell?: (row: T, value: unknown) => ReactNode;
    /** Optional client-side destination for cells that should navigate instead of opening edit on click. */
    navigateTo?: (row: T) => string | undefined;
    /** Opt this column into inline editing. */
    edit?: MicroEditConfig<T>;
    /** Hidden when MicroGrid switches to mobile-card layout. */
    hideOnMobile?: boolean;
    /** Promoted to card title in mobile layout. */
    isCardTitle?: boolean;
    /** Promoted to card subtitle in mobile layout. */
    isCardSubtitle?: boolean;
}

export interface MicroRowAction<T> {
    id: string;
    label: string;
    icon?: ReactNode;
    onClick?: (row: T) => void;
    show?: (row: T) => boolean;
    variant?: "default" | "destructive";
}

export interface MicroGroup<T> {
    /** Stable group identifier — used for React keys + future collapse state. */
    key: string;
    /** Display label shown in the divider header. */
    label: string;
    /** Rows in this group. May be empty (see hideEmptyGroups prop). */
    rows: T[];
    /**
     * Reserved for a future slice. MicroGrid does NOT read this in this PR.
     * Documented now so the shape is stable.
     */
    collapsed?: boolean;
}

export interface MicroGridProps<T> {
    rows: T[];
    /**
     * Optional grouped rendering. When provided, takes precedence over `rows`.
     * MicroGrid renders a divider (label + row count) before each group's rows.
     * Mutually exclusive with `rows` — if both are provided, `groups` wins and
     * a console.warn is emitted in dev.
     */
    groups?: MicroGroup<T>[];
    /**
     * When true, groups with `rows.length === 0` are not rendered (no divider
     * either). Default: false — render the divider with "(0)" so the user
     * still sees the structure.
     */
    hideEmptyGroups?: boolean;
    /** Controlled group-collapse state keyed by MicroGroup.key. */
    collapsedGroups?: Set<string>;
    /** Called when a group divider collapse toggle is clicked. */
    onToggleGroup?: (key: string) => void;
    /**
     * Column definitions used at wide viewport widths (≥ narrowBreakpoint).
     * On narrower viewports `narrowColumns` is used if provided.
     */
    columns: MicroColumn<T>[];
    /**
     * Optional column definitions used when viewport width < narrowBreakpoint.
     * Typically these are fewer columns with composite (multi-field) cells.
     * Also used by the mobile cards layout (isCardTitle/isCardSubtitle flags
     * are read from this set when provided, otherwise from `columns`).
     */
    narrowColumns?: MicroColumn<T>[];
    /**
     * Declarative responsive grouping rules for future narrow/medium adapters.
     * Phase 2 accepts this silently; rendering still uses `narrowColumns`.
     */
    responsiveGroups?: MicroGridResponsiveGroup[];
    getRowId: (row: T) => string;
    /** Required for a11y — describes the table to assistive tech. */
    ariaLabel: string;

    // ── Sort state from host controls ─────────────────────────────────────
    /**
     * Host-owned sort state. MicroGrid renders rows in the order it receives
     * them and does not expose header sorting.
     */
    sort?: MicroSortState | null;
    /**
     * Deprecated compatibility prop for existing callers. MicroGrid no longer
     * fires this; sorting should be driven by host toolbar controls.
     */
    onSortChange?: (next: MicroSortState | null) => void;

    // ── Selection (controlled) ────────────────────────────────────────────
    selection?: MicroSelectionMode;
    selectedIds?: string[];
    onSelectionChange?: (ids: string[]) => void;

    // ── Inline edit ───────────────────────────────────────────────────────
    /** Called when a cell edit commits. Return a string to display as an error. */
    onCellChange?: (
        rowId: string,
        columnId: string,
        next: unknown,
    ) => void | true | string | Promise<void | true | string>;

    // ── Row actions & interactions ────────────────────────────────────────
    rowActions?: MicroRowAction<T>[];
    onRowClick?: (row: T) => void;
    /**
     * When true, a plain left-click on a navigable cell (one with `navigateTo`)
     * fires `onRowClick(row)` instead of following the link. Used by split-preview
     * layouts so clicking a name opens the record in the side panel rather than
     * replacing the screen. Modifier / middle clicks still follow the link
     * (full-page navigation / open-in-new-tab), preserving "both" behaviors.
     */
    previewOnNavigableClick?: boolean;
    /**
     * Id of the row currently shown in the split-preview side panel. That row
     * gets a distinct "active" marker (separate from hover and checkbox
     * selection) so the user can see which record the panel is displaying.
     */
    activeRowId?: string | null;

    // ── Layout ────────────────────────────────────────────────────────────
    density?: MicroGridDensity;
    loading?: boolean;
    emptyState?: ReactNode;
    emptyMessage?: string;
    className?: string;
    /** Below this width MicroGrid switches to mobile-card layout. Default: 640. */
    mobileBreakpoint?: number;
    /** Below this width MicroGrid can use responsive group columns when provided. */
    mediumBreakpoint?: number;
    /**
     * Below this width MicroGrid swaps to `narrowColumns` (if provided).
     * Default: 720. Has no effect if `narrowColumns` is not set.
     * Picked to reserve narrow layout for tablet/phone — half-screen desktop
     * windows stay on the wide table (with horizontal scroll if needed).
     */
    narrowBreakpoint?: number;
    /** Force mobile-card layout regardless of viewport. Used for testing + sandbox. */
    forceMobile?: boolean;
    /** Force narrow-column layout regardless of viewport. Used for testing + sandbox. */
    forceNarrow?: boolean;
}
