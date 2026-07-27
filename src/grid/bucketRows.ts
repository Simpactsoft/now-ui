import type { MicroGroup } from "./types";

export const NULL_GROUP_KEY = "__null__";
export const NULL_GROUP_LABEL = "ללא ערך";

interface Bucket<T> {
    key: string;
    label: string;
    rows: T[];
    firstIndex: number;
    isNull: boolean;
}

function isNullishGroupValue(value: unknown): boolean {
    return value == null || (typeof value === "string" && value.trim() === "");
}

function defaultGroupLabel(value: unknown): string {
    if (isNullishGroupValue(value)) return NULL_GROUP_LABEL;
    const raw = String(value).trim();
    return raw.charAt(0).toLocaleUpperCase("he-IL") + raw.slice(1);
}

export function bucketRows<T extends object>(
    rows: T[],
    field: keyof T,
    labelFn: (value: unknown) => string = defaultGroupLabel,
): MicroGroup<T>[] {
    const buckets = new Map<string, Bucket<T>>();

    rows.forEach((row, index) => {
        const value = row[field];
        const isNull = isNullishGroupValue(value);
        const key = isNull ? NULL_GROUP_KEY : String(value);
        const label = isNull ? NULL_GROUP_LABEL : labelFn(value);
        const existing = buckets.get(key);

        if (existing) {
            existing.rows.push(row);
            return;
        }

        buckets.set(key, {
            key,
            label,
            rows: [row],
            firstIndex: index,
            isNull,
        });
    });

    return [...buckets.values()]
        .sort((a, b) => {
            if (a.isNull && !b.isNull) return 1;
            if (!a.isNull && b.isNull) return -1;
            const byLabel = a.label.localeCompare(b.label, "he");
            return byLabel || a.firstIndex - b.firstIndex;
        })
        .map(({ key, label, rows }) => ({ key, label, rows }));
}
