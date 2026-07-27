/**
 * Legacy column-shape → MicroColumn adapter.
 *
 * Bridges the existing sharedColumns factory system (1017 lines of legacy
 * ColumnDef factories powering Organizations, People, etc.) to MicroGrid
 * without rewriting each factory. cellRenderers receive synthetic legacy
 * params object containing { data, value, context, colDef } — enough to
 * cover ~all of sharedColumns. Renderers that reach for params.api / .node
 * fall back to undefined.
 *
 * What is NOT carried over (intentionally — MicroGrid is renderer-only):
 *   pinned, flex, filter, cellClass functions, grouping
 *
 * Edit support: legacy `editable + cellEditor` columns become MicroColumn `edit`
 * configs where shape is recognized (text / number / component editors, etc.).
 * Unknown string-named editors fall back to text so editable legacy columns stay
 * editable without silently downgrading component references.
 */

import type { ElementType, ReactNode } from "react";
import type { MicroColumn, MicroEditConfig } from "./types";
import type {
    ColDef,
    CellValueChangedEvent,
    GridCellRendererParams,
    GridValueGetterParams,
    GridValueSetterParams,
} from "./column-shapes";

type LegacyValueGetter<T> = (input: T | GridValueGetterParams<T>) => unknown;
type SyntheticNode<T> = {
    data: T;
    setDataValue: (colId: string, next: unknown) => boolean;
};
type SyntheticApi<T> = {
    dispatchEvent: (evt: Partial<CellValueChangedEvent<T>> & { type?: string; value?: unknown; source?: string }) => void;
};
type SyntheticColumn<T> = {
    getColId: () => string;
    getColDef: () => LegacyColumnLike<T>;
};
type LegacyCellRendererArgs<T> = GridCellRendererParams<T> & {
    context: Record<string, unknown>;
    colDef: LegacyColumnLike<T>;
    node: SyntheticNode<T>;
    api: SyntheticApi<T>;
    column: SyntheticColumn<T>;
};

interface LegacyColumnLike<T = Record<string, unknown>> extends Omit<
    ColDef<T>,
    "cellRenderer" | "cellEditor" | "valueGetter" | "valueSetter" | "valueFormatter" | "headerComponent"
> {
    field?: string;
    headerName?: string | ReactNode;
    navigateTo?: (row: unknown) => string | undefined;
    valueGetter?: LegacyValueGetter<T>;
    /** Legacy `valueFormatter` — used by date / currency / select columns instead
     *  of (or in addition to) a cellRenderer. We honor it when present and
     *  no cellRenderer is set. */
    valueFormatter?: (params: { value: unknown; data?: T }) => string;
    cellRenderer?: (params: LegacyCellRendererArgs<T> & Record<string, unknown>) => ReactNode;
    /** Legacy `cellRendererParams` — merged into the synthetic params so existing
     *  renderers that read `params.tenantId`, `params.code`, etc. still work. */
    cellRendererParams?: Record<string, unknown>;
    cellEditor?: unknown;
    cellEditorParams?: Record<string, unknown>;
    valueSetter?: (params: GridValueSetterParams<T>) => boolean;
    headerComponent?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isComponentEditor(value: unknown): value is ElementType {
    if (typeof value === "function") return true;
    return isRecord(value) && "$$typeof" in value;
}

function readField(row: unknown, field?: string): unknown {
    if (!field || row == null) return undefined;
    if (!field.includes(".")) return isRecord(row) ? row[field] : undefined;
    let current: unknown = row;
    for (const key of field.split(".")) {
        if (!isRecord(current)) return undefined;
        current = current[key];
    }
    return current;
}

function cloneRowForEdit<T>(row: T): T {
    if (!isRecord(row)) return row;
    if (typeof structuredClone === "function") return structuredClone(row) as T;
    return { ...row } as T;
}

function patchRowField<T>(row: T, field: string, next: unknown): T {
    const cloned = cloneRowForEdit(row);
    if (!isRecord(cloned)) return cloned;
    return { ...cloned, [field]: next } as T;
}

function callValueGetter<T>(getter: LegacyValueGetter<T>, row: T): unknown {
    // The legacy valueGetter signature is (params) where params.data is the row.
    // Every valueGetter in sharedColumns / peopleColumns / orgColumns / UserManagement
    // follows this shape (verified). We try the params shape first and fall back to the
    // bare-row shape only if it throws — supports (row) => row.x style outliers.
    try {
        return getter({ data: row });
    } catch {
        try {
            return getter(row);
        } catch {
            return undefined;
        }
    }
}

function inferEdit<T>(col: LegacyColumnLike<T>): MicroEditConfig<T> | undefined {
    if (!col.editable) return undefined;
    const editor = col.cellEditor;
    // Genuine text/default legacy editors intentionally map to MicroGrid text editing.
    if (!editor || editor === "agTextCellEditor") return { kind: "text" };
    if (editor === "agNumberCellEditor") return { kind: "number" };
    if (editor === "agSelectCellEditor") {
        const rawValues = col.cellEditorParams?.values;
        const values = Array.isArray(rawValues) ? rawValues : [];
        return {
            kind: "select",
            options: values.map((v) => ({ value: String(v), label: String(v) })),
        };
    }
    if (editor === "agDateCellEditor" || editor === "agDateStringCellEditor") return { kind: "date" };
    if (editor === "agCheckboxCellEditor") return { kind: "checkbox" };
    if (isComponentEditor(editor)) {
        return {
            kind: "component",
            Component: editor,
            params: col.cellEditorParams,
            colDef: col,
        };
    }
    if (typeof editor === "string") {
        // Intentional fallback for unknown string-named editors only: keep the
        // legacy column editable while component references take the branch above.
        return { kind: "text" };
    }
    return undefined;
}

export interface LegacyColumnAdapterOptions {
    /** Context object passed to every cellRenderer as params.context. */
    context?: Record<string, unknown>;
    /** Drop columns marked `hide: true`. Default: true. */
    dropHidden?: boolean;
    /** Drop columns whose field is in this list (used to skip legacy-only oddities). */
    excludeFields?: string[];
    /** Optional handler invoked when a legacy renderer calls
     *  params.node.setDataValue(colId, value) or
     *  params.api.dispatchEvent({type: 'cellValueChanged', ...}).
     *  This is how StatusCellRenderer-style in-cell popovers notify the grid
     *  of a value change. Without this, in-cell edits made by such renderers
     *  are silently lost. */
    onLegacyCellEdit?: (event: {
        data: unknown;
        colDef: { field?: string };
        oldValue: unknown;
        newValue: unknown;
    }) => void;
}

/**
 * Convert an array of legacy ColumnDef-shaped objects to MicroColumns.
 * Synthetic params: { data: row, value: accessor(row), context, colDef }.
 */
export function legacyColumnsToMicroColumns<T>(
    legacyCols: LegacyColumnLike<T>[],
    opts: LegacyColumnAdapterOptions = {},
): MicroColumn<T>[] {
    const ctx = opts.context ?? {};
    const dropHidden = opts.dropHidden ?? true;
    const exclude = new Set(opts.excludeFields ?? []);
    const onLegacyEdit = opts.onLegacyCellEdit;

    const out: MicroColumn<T>[] = [];

    for (const col of legacyCols) {
        if (dropHidden && col.hide) continue;
        if (col.field && exclude.has(col.field)) continue;
        if (!col.field && !col.headerName) continue;

        const id = col.field || (typeof col.headerName === "string" ? col.headerName : `col_${out.length}`);
        const accessor: MicroColumn<T>["accessor"] = (row: T): unknown => {
            if (col.valueGetter) return callValueGetter(col.valueGetter, row);
            return readField(row, col.field);
        };

        // valueFormatter-only columns (date / currency / etc.) — wrap as a
        // synthetic cellRenderer so MicroGrid renders the formatted string.
        // If a real cellRenderer exists, it takes precedence.
        const formatterAsCell = !col.cellRenderer && col.valueFormatter
            ? (row: T, value: unknown) => {
                  try {
                      return col.valueFormatter!({ value, data: row });
                  } catch {
                      return null;
                  }
              }
            : undefined;

        const cell = col.cellRenderer
            ? (row: T, value: unknown) => {
                  // Synthetic legacy-shaped node/api so renderers that
                  // self-initiate edits (StatusCellRenderer etc.) keep working.
                  const api: SyntheticApi<T> = {
                      dispatchEvent: (evt) => {
                          if (!onLegacyEdit || evt?.type !== "cellValueChanged") return;
                          onLegacyEdit({
                              data: evt.data ?? row,
                              colDef: evt.colDef ?? { field: id },
                              oldValue: evt.oldValue,
                              newValue: evt.newValue,
                          });
                      },
                  };
                  const node: SyntheticNode<T> = {
                      data: row,
                      setDataValue: (colId: string, next: unknown) => {
                          if (!onLegacyEdit) return false;
                          const old = colId === id ? value : readField(row, colId);
                          if (old === next) return false;

                          if (col.valueSetter) {
                              const nextData = cloneRowForEdit(row);
                              const didSet = col.valueSetter({
                                  data: nextData,
                                  oldValue: old,
                                  newValue: next,
                                  colDef: col,
                                  node,
                                  api,
                                  context: ctx,
                              });
                              if (!didSet) return false;
                              onLegacyEdit({ data: nextData, colDef: { field: colId }, oldValue: old, newValue: next });
                              return true;
                          }

                          const nextData = patchRowField(row, colId, next);
                          onLegacyEdit({ data: nextData, colDef: { field: colId }, oldValue: old, newValue: next });
                          return true;
                      },
                  };
                  return col.cellRenderer!({
                      data: row,
                      value,
                      context: ctx,
                      colDef: col,
                      node,
                      api,
                      column: { getColId: () => id, getColDef: () => col },
                      // Spread cellRendererParams so legacy renderers reading
                      // params.tenantId, params.code, etc. still resolve.
                      ...(col.cellRendererParams ?? {}),
                  });
              }
            : undefined;

        const microCol: MicroColumn<T> = {
            id,
            header: col.headerName ?? id,
            accessor,
            sortable: col.sortable !== false,
            cell: cell ?? formatterAsCell,
        };

        if (col.navigateTo) microCol.navigateTo = (row) => col.navigateTo?.(row);

        if (typeof col.width === "number") microCol.width = col.width;
        else if (typeof col.minWidth === "number") microCol.width = col.minWidth;

        const edit = inferEdit(col);
        if (edit) microCol.edit = edit;

        out.push(microCol);
    }

    return out;
}

/** Field names that are utility columns (action menus, expand toggles,
 *  add-column sentinel, etc.) — never useful in a narrow stacked layout. */
const NARROW_FIELD_BLOCKLIST = new Set([
    "actions",
    "action",
    "expand",
    "add",
    "selection",
    "checkbox",
]);

/** Best-effort: does the cell render anything meaningful for this row? */
function hasMeaningfulValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim() !== "" && value !== "-" && value !== "—";
    if (typeof value === "number") return !Number.isNaN(value);
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === "object") return Object.keys(value as object).length > 0;
    return true;
}

export interface NarrowColumnOptions extends LegacyColumnAdapterOptions {
    /** Maximum number of fields to stack per row. Default: 5. */
    maxFields?: number;
    /** Extra field names to exclude from the stack. */
    excludeFromNarrow?: string[];
}

/**
 * Build a single composite "stacked" narrow MicroColumn from legacy columns.
 *
 * For mobile/narrow viewports — each row renders the top-N meaningful cells
 * vertically stacked inside one column. Skips:
 *   - utility columns (actions, expand, etc.)
 *   - columns marked hide: true
 *   - cells whose accessor returns null/empty/placeholder ("—", "-")
 * Cap defaults to 5 to keep rows scannable.
 *
 * Cells are rendered with the same synthetic params as the wide adapter,
 * so cellRendererParams + node/api still work.
 */
/** Build a single composite cell that renders multiple wide cells stacked. */
function composeCell<T>(cols: MicroColumn<T>[], asPlainText: boolean): MicroColumn<T>["cell"] {
    return (row: T) => {
        const items: ReactNode[] = [];
        for (const c of cols) {
            const value = typeof c.accessor === "function"
                ? (c.accessor as (r: T) => unknown)(row)
                : readField(row, String(c.accessor));
            if (!hasMeaningfulValue(value)) continue;
            const node = asPlainText
                ? String(value)
                : (c.cell ? c.cell(row, value) : String(value));
            if (node === null || node === undefined || node === false) continue;
            items.push(
                <div key={c.id} className="leading-snug truncate">
                    {node}
                </div>,
            );
        }
        if (items.length === 0) return null;
        return <div className="flex flex-col gap-0.5">{items}</div>;
    };
}

/**
 * Build narrow MicroColumns from a wide legacy ColumnDef set by COMPOSING
 * multiple fields into fewer columns. Default grouping:
 *   1. Title (name) + Status — stacked
 *   2. Contact — email + phone stacked
 *   3. Owner + Meta (date / score / etc.) — stacked
 *
 * Each composite column reuses the wide cellRenderers (so badges/icons
 * keep their look) and keeps the title column's responsive grouping hint.
 *
 * Returns an ARRAY (used as `narrowColumns={...}`) — typically 2–3 columns,
 * never one mega-stack. Falls back to a single stacked column only when
 * the heuristic finds nothing meaningful to group.
 */
export function legacyColumnsToNarrowColumns<T>(
    legacyCols: LegacyColumnLike<T>[],
    opts: NarrowColumnOptions = {},
): MicroColumn<T>[] {
    const extraExclude = new Set(opts.excludeFromNarrow ?? []);
    const microCols = legacyColumnsToMicroColumns<T>(legacyCols, opts);

    const eligible = microCols.filter((c) => {
        const id = String(c.id).toLowerCase();
        if (NARROW_FIELD_BLOCKLIST.has(id)) return false;
        if (extraExclude.has(c.id)) return false;
        return true;
    });

    const matches = (col: MicroColumn<T>, re: RegExp) => re.test(String(col.id));
    const titleRe = /^(first_name|last_name|name|ret_name|display_name|full_name|title|subject|tenant_name|target_name|source_name)$/i;
    const statusRe = /^(status|ret_status|state|lifecycle_stage|lead_status)$/i;
    const emailRe = /^(email|ret_email)$/i;
    const phoneRe = /^(phone|ret_phone|mobile|whatsapp)$/i;
    const ownerRe = /^(owner|owner_id|owner_name|assigned_to|assigned_user|agent_id|responsible)$/i;

    const titleCol = eligible.find((c) => matches(c, titleRe)) ?? eligible[0];
    const statusCol = eligible.find((c) => matches(c, statusRe));
    const emailCol = eligible.find((c) => matches(c, emailRe));
    const phoneCol = eligible.find((c) => matches(c, phoneRe));
    const ownerCol = eligible.find((c) => matches(c, ownerRe));

    const claimed = new Set<string>(
        [titleCol, statusCol, emailCol, phoneCol, ownerCol].filter(Boolean).map((c) => String(c!.id)),
    );
    const restCols = eligible.filter((c) => !claimed.has(String(c.id)));

    const out: MicroColumn<T>[] = [];

    // Column 1 — title + status stacked. Plain-text title to dodge h-full
    // collapsing inside flex-col (legacy name renderers).
    const titleColumns: MicroColumn<T>[] = [];
    if (titleCol) titleColumns.push(titleCol);
    if (statusCol) titleColumns.push(statusCol);
    if (titleColumns.length > 0) {
        out.push({
            id: "narrow_title",
            header: titleCol?.header ?? "",
            accessor: titleCol?.accessor ?? (() => ""),
            sortable: titleCol?.sortable ?? false,
            isCardTitle: true,
            width: 180,
            cell: (row: T) => {
                const titleValue = titleCol
                    ? (typeof titleCol.accessor === "function"
                        ? (titleCol.accessor as (r: T) => unknown)(row)
                        : readField(row, String(titleCol.accessor)))
                    : null;
                const titleTextValue = hasMeaningfulValue(titleValue)
                    ? String(titleValue)
                    : (
                        readField(row, "email")
                        ?? readField(row, "ret_email")
                        ?? readField(row, "display_name")
                        ?? readField(row, "ret_name")
                        ?? readField(row, "phone")
                        ?? readField(row, "ret_phone")
                        ?? null
                    );
                const titleText = hasMeaningfulValue(titleTextValue) ? String(titleTextValue) : null;
                const statusNode = statusCol
                    ? (() => {
                        const v = typeof statusCol.accessor === "function"
                            ? (statusCol.accessor as (r: T) => unknown)(row)
                            : readField(row, String(statusCol.accessor));
                        if (!hasMeaningfulValue(v)) return null;
                        return statusCol.cell ? statusCol.cell(row, v) : String(v);
                    })()
                    : null;
                return (
                    <div className="flex flex-col gap-0.5">
                        {titleText && (
                            <div className="font-semibold text-sm text-foreground truncate">{titleText}</div>
                        )}
                        {statusNode && <div className="text-xs">{statusNode}</div>}
                    </div>
                );
            },
        });
    }

    // Column 2 — contact (email + phone stacked).
    const contactColumns: MicroColumn<T>[] = [];
    if (emailCol) contactColumns.push(emailCol);
    if (phoneCol) contactColumns.push(phoneCol);
    if (contactColumns.length > 0) {
        out.push({
            id: "narrow_contact",
            header: emailCol?.header ?? phoneCol?.header ?? "",
            accessor: (emailCol ?? phoneCol)!.accessor,
            sortable: false,
            width: 220,
            cell: composeCell<T>(contactColumns, false),
        });
    }

    // Column 3 — owner + the rest, stacked (capped to 3 lines).
    const metaColumns: MicroColumn<T>[] = [];
    if (ownerCol) metaColumns.push(ownerCol);
    metaColumns.push(...restCols.slice(0, 3 - metaColumns.length));
    if (metaColumns.length > 0) {
        out.push({
            id: "narrow_meta",
            header: ownerCol?.header ?? restCols[0]?.header ?? "",
            accessor: metaColumns[0].accessor,
            sortable: false,
            width: 160,
            cell: composeCell<T>(metaColumns, false),
        });
    }

    // Safety net — if heuristics matched nothing, fall back to a single
    // stacked everything column so the user still sees content.
    if (out.length === 0 && eligible.length > 0) {
        out.push({
            id: "narrow_all",
            header: eligible[0].header,
            accessor: eligible[0].accessor,
            sortable: false,
            isCardTitle: true,
            cell: composeCell<T>(eligible.slice(0, 5), false),
        });
    }

    return out;
}

/**
 * Backwards-compatible wrapper that returns a SINGLE MicroColumn (legacy
 * call sites). Prefer `legacyColumnsToNarrowColumns` (plural) for new code.
 */
export function legacyColumnsToNarrowColumn<T>(
    legacyCols: LegacyColumnLike<T>[],
    opts: NarrowColumnOptions = {},
): MicroColumn<T> {
    const cols = legacyColumnsToNarrowColumns<T>(legacyCols, opts);
    if (cols.length === 1) return cols[0];
    // Re-compose all narrow columns' content into one cell for legacy single-col consumers.
    return {
        id: "stacked",
        header: "",
        accessor: () => "",
        isCardTitle: true,
        sortable: false,
        cell: (row: T) => (
            <div className="flex flex-col gap-1 py-1">
                {cols.map((c) => {
                    const node = c.cell ? c.cell(row, undefined) : null;
                    if (node === null || node === undefined || node === false) return null;
                    return <div key={c.id}>{node}</div>;
                })}
            </div>
        ),
    };
}
