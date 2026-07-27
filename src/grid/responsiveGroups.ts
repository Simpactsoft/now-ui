import type { ReactNode } from "react";
import type { MicroColumn } from "./types";

export type MicroGridResponsiveTier = "medium" | "narrow";

export interface MicroGridResponsiveFieldConfig {
    field: string;
    label?: ReactNode;
    slot?: "title" | "badge" | "line" | "meta" | "action";
    order?: number;
    hideLabel?: boolean;
}

export interface MicroGridResponsiveGroup {
    id: string;
    label?: ReactNode;
    tiers?: MicroGridResponsiveTier[];
    layout: "stack" | "inline" | "grid";
    primaryField: string;
    fields: MicroGridResponsiveFieldConfig[];
}

export interface ResolvedResponsiveField<T> {
    column: MicroColumn<T>;
    slot?: MicroGridResponsiveFieldConfig["slot"];
    label?: ReactNode;
    hideLabel?: boolean;
}

export interface ResolvedResponsiveColumn<T> {
    id: string;
    header: ReactNode;
    layout: MicroGridResponsiveGroup["layout"];
    primaryColumn: MicroColumn<T>;
    stackedFields: ResolvedResponsiveField<T>[];
}

export interface ResolvedResponsiveColumns<T> {
    grouped: ResolvedResponsiveColumn<T>[];
    ungrouped: MicroColumn<T>[];
}

const DEFAULT_TIERS: MicroGridResponsiveTier[] = ["medium", "narrow"];

export function resolveResponsiveColumns<T>(
    activeColumns: MicroColumn<T>[],
    groups: MicroGridResponsiveGroup[],
    tier: MicroGridResponsiveTier,
): ResolvedResponsiveColumns<T> {
    const columnsById = new Map(activeColumns.map((column) => [column.id, column]));
    const claimedIds = new Set<string>();
    const grouped: ResolvedResponsiveColumn<T>[] = [];

    for (const group of groups) {
        const tiers = group.tiers ?? DEFAULT_TIERS;
        if (!tiers.includes(tier)) continue;

        const fields = group.fields
            .map((field, index) => ({ field, index }))
            .sort((a, b) => (a.field.order ?? 0) - (b.field.order ?? 0) || a.index - b.index)
            .flatMap(({ field }) => {
                const column = columnsById.get(field.field);
                if (!column) return [];
                claimedIds.add(column.id);
                return [{
                    column,
                    slot: field.slot,
                    label: field.label,
                    hideLabel: field.hideLabel,
                }];
            });

        if (fields.length === 0) continue;

        const primaryColumn =
            columnsById.get(group.primaryField) ??
            fields.find(({ column }) => column.sortable)?.column ??
            fields[0].column;

        grouped.push({
            id: group.id,
            header: group.label ?? primaryColumn.header,
            layout: group.layout,
            primaryColumn,
            stackedFields: fields,
        });
    }

    return {
        grouped,
        ungrouped: activeColumns.filter((column) => !claimedIds.has(column.id)),
    };
}
