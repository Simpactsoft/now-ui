"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../utils";
import type { MicroComponentEditProps, MicroEditConfig } from "../types";

interface CellEditorProps<T> {
    config: MicroEditConfig<T>;
    row: T;
    initialValue: unknown;
    onCommit: (next: unknown) => void;
    onCancel: () => void;
}

function stringify(v: unknown): string {
    if (v == null) return "";
    if (typeof v === "string" || typeof v === "number") return String(v);
    if (v instanceof Date) return v.toISOString().slice(0, 10);
    return String(v);
}

export function CellEditor<T>({
    config,
    row,
    initialValue,
    onCommit,
    onCancel,
}: CellEditorProps<T>) {
    const ref = useRef<HTMLInputElement | HTMLSelectElement | null>(null);
    const [draft, setDraft] = useState<unknown>(initialValue);
    const draftRef = useRef<unknown>(initialValue);
    const finishedRef = useRef(false);

    function updateDraft(next: unknown) {
        draftRef.current = next;
        setDraft(next);
    }

    // Focus the editor on mount. For native <select>, immediately open the dropdown
    // so the user sees options on the FIRST click rather than needing a second click.
    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.focus();
        if (el instanceof HTMLInputElement && typeof el.select === "function") {
            el.select();
        }
        if (el instanceof HTMLSelectElement) {
            // showPicker() is the modern, reliable way to open a native dropdown.
            // Wrap in try/catch — older browsers and some restricted contexts throw.
            try {
                el.showPicker?.();
            } catch {
                /* fallback: user will need to click the select manually */
            }
        }
    }, []);

    function handleKeyDown(e: KeyboardEvent<HTMLElement>) {
        if (e.key === "Enter") {
            e.preventDefault();
            onCommit(draftRef.current);
        } else if (e.key === "Escape") {
            e.preventDefault();
            onCancel();
        }
    }

    if (config.kind === "custom") {
        return <>{config.render({ value: initialValue, row, commit: onCommit, cancel: onCancel })}</>;
    }

    // kind: "component" renders legacy component editors through bridge props.
    if (config.kind === "component") {
        const finishEditing = (suppressNavigate?: boolean) => {
            if (finishedRef.current) return;
            finishedRef.current = true;
            if (suppressNavigate) {
                onCancel();
                return;
            }
            onCommit(draftRef.current);
        };
        const Component = config.Component;
        const adaptedProps: MicroComponentEditProps<T> & Record<string, unknown> = {
            ...(config.params ?? {}),
            value: draft,
            initialValue,
            onValueChange: updateDraft,
            stopEditing: finishEditing,
            rowData: row,
            data: row,
            colDef: config.colDef,
            api: { stopEditing: finishEditing },
        };
        return (
            <div data-testid="microgrid-component-editor" className="w-full">
                <Component {...adaptedProps} />
            </div>
        );
    }

    if (config.kind === "select") {
        return (
            <select
                ref={ref as React.RefObject<HTMLSelectElement>}
                value={stringify(draft)}
                onChange={(e) => updateDraft(e.target.value)}
                onBlur={() => onCommit(draftRef.current)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent text-sm outline-none"
            >
                {config.options.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                        {opt.label}
                    </option>
                ))}
            </select>
        );
    }

    if (config.kind === "checkbox") {
        return (
            <input
                ref={ref as React.RefObject<HTMLInputElement>}
                type="checkbox"
                checked={Boolean(draft)}
                onChange={(e) => {
                    updateDraft(e.target.checked);
                    onCommit(e.target.checked);
                }}
                onKeyDown={handleKeyDown}
                className="h-4 w-4"
            />
        );
    }

    if (config.kind === "number") {
        return (
            <input
                ref={ref as React.RefObject<HTMLInputElement>}
                type="number"
                value={stringify(draft)}
                min={config.min}
                max={config.max}
                step={config.step}
                onChange={(e) => updateDraft(e.target.value === "" ? null : Number(e.target.value))}
                onBlur={() => onCommit(draftRef.current)}
                onKeyDown={handleKeyDown}
                className={cn("w-full bg-transparent text-sm outline-none")}
            />
        );
    }

    if (config.kind === "date") {
        return (
            <input
                ref={ref as React.RefObject<HTMLInputElement>}
                type="date"
                value={stringify(draft)}
                onChange={(e) => updateDraft(e.target.value)}
                onBlur={() => onCommit(draftRef.current)}
                onKeyDown={handleKeyDown}
                className="w-full bg-transparent text-sm outline-none"
            />
        );
    }

    // kind === 'text'
    return (
        <input
            ref={ref as React.RefObject<HTMLInputElement>}
        type="text"
        value={stringify(draft)}
        onChange={(e) => updateDraft(e.target.value)}
        onBlur={() => onCommit(draftRef.current)}
        onKeyDown={handleKeyDown}
        className="w-full bg-transparent text-sm outline-none"
    />
    );
}
