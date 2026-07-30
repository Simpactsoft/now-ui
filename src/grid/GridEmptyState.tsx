"use client";

import type { ReactNode } from "react";

/**
 * An empty state that says WHY, per `MicroGrid States.dc.html` §3.
 *
 * The generic "no rows to show" is allowed only in a form sub-table. On a primary grid it is a dead
 * end: three very different situations look identical, and the user cannot tell which they are in.
 *
 *   noData   — nothing has ever been created here. The CTA creates the first one.
 *   filtered — rows exist; the FILTER is hiding them. The CTA clears the filter.
 *   error    — the engine did not answer. The CTA retries. Never "no results": a failed read that
 *              reads as an empty set is how a user concludes their data was deleted.
 *
 * Which one applies is the HOST's call — only it knows whether a filter is live or a query threw —
 * so this renders the shape and takes the words.
 */
export type GridEmptyKind = "noData" | "filtered" | "error";

const TONE: Record<GridEmptyKind, { icon: string; fg: string; bg: string; border: string }> = {
    noData: { icon: "◌", fg: "var(--muted-foreground)", bg: "var(--surface-sunken)", border: "var(--border)" },
    filtered: { icon: "⛃", fg: "var(--primary)", bg: "var(--entity-person-soft)", border: "var(--primary)" },
    error: { icon: "⚠", fg: "var(--warning)", bg: "var(--warning-soft)", border: "var(--warning)" },
};

export function GridEmptyState({
    kind,
    title,
    body,
    action,
}: {
    kind: GridEmptyKind;
    title: string;
    body?: ReactNode;
    action?: { label: string; onClick: () => void };
}) {
    const tone = TONE[kind];
    return (
        <div
            role={kind === "error" ? "alert" : undefined}
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 10,
                padding: "34px 18px",
                textAlign: "center",
            }}
        >
            <span
                aria-hidden="true"
                style={{
                    width: 44,
                    height: 44,
                    borderRadius: 12,
                    display: "grid",
                    placeItems: "center",
                    fontSize: 20,
                    background: tone.bg,
                    color: tone.fg,
                    border: `1px solid ${tone.border}`,
                }}
            >
                {tone.icon}
            </span>
            <span style={{ fontWeight: 700, fontSize: "var(--fs)" }}>{title}</span>
            {body && (
                <span style={{ fontSize: "var(--fs-sm)", color: "var(--muted-foreground)", lineHeight: 1.6, maxWidth: 460 }}>
                    {body}
                </span>
            )}
            {action && (
                <button
                    type="button"
                    onClick={action.onClick}
                    style={{
                        marginTop: 2,
                        cursor: "pointer",
                        borderRadius: 8,
                        padding: "7px 16px",
                        minHeight: 36,
                        fontWeight: 600,
                        fontSize: "var(--fs-sm)",
                        background: "var(--primary)",
                        color: "var(--primary-foreground)",
                        border: "1px solid var(--primary)",
                    }}
                >
                    {action.label}
                </button>
            )}
        </div>
    );
}
