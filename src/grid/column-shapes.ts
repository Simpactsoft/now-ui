/**
 * Local synthetic types for MicroGrid's legacy column-shape compatibility
 * layer. Kept here so that existing column factories (sharedColumns,
 * orgColumns, peopleColumns, UserManagement gridColumns) continue to
 * type-check without depending on a third-party grid runtime.
 *
 * MicroGrid + columnAdapter call these renderers with synthetic params
 * matching this shape — see lib/microgrid/columnAdapter.tsx.
 */

import type { ReactNode } from "react";

export interface GridCellRendererParams<TData = any, TValue = any> {
    data: TData;
    value: TValue;
    context?: any;
    colDef?: any;
    node?: any;
    column?: any;
    api?: any;
    valueFormatted?: string | null;
}

export interface GridValueGetterParams<TData = any> {
    data: TData | undefined;
    node?: any;
    api?: any;
    context?: any;
    colDef?: any;
}

export interface GridValueSetterParams<TData = any> {
    data: TData;
    oldValue: any;
    newValue: any;
    node?: any;
    api?: unknown;
    context?: any;
    colDef?: any;
}

export interface CellValueChangedEvent<TData = any> {
    data: TData;
    oldValue: any;
    newValue: any;
    colDef: any;
    context?: any;
    node?: any;
}

/** Loose legacy-compatible ColDef shape. */
export interface ColDef<TData = any> {
    field?: string;
    headerName?: string | ReactNode;
    width?: number;
    minWidth?: number;
    flex?: number;
    hide?: boolean;
    sortable?: boolean;
    editable?: boolean;
    pinned?: "left" | "right" | boolean | null;
    cellRenderer?: (params: GridCellRendererParams<TData>) => ReactNode;
    cellEditor?: unknown;
    cellEditorParams?: Record<string, unknown>;
    valueGetter?: ((data: TData) => any) | ((params: GridValueGetterParams<TData>) => any);
    valueSetter?: (params: GridValueSetterParams<TData>) => boolean;
    valueFormatter?: (params: any) => string;
    cellClass?: string | ((params: any) => string);
    cellStyle?: any;
    cellClassRules?: any;
    headerComponent?: any;
    filter?: string | boolean;
    filterParams?: any;
    suppressMovable?: boolean;
}
