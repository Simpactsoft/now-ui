import type { CSSProperties } from "react";

/**
 * The thirteen states a cell can be in — `MicroGrid States.dc.html` §1.
 *
 * A cell used to know only "am I being edited". The EAV engine returns far more than that, and every
 * one of these is a distinct thing the user must be able to tell apart at a glance:
 *
 *   idle · focus · editing   the ordinary lifecycle
 *   saving · saved           in flight, and just landed
 *   error                    OUR validation refused it — the typed value STAYS in the cell
 *   refused                  the ENGINE refused it, with a reason it supplied
 *   readonly · derived · locked   three different reasons you cannot type here
 *   staged                   validated, never sent (write mode off)
 *   conflict                 someone else changed it while you were editing
 *
 * The distinctions that carry the most weight:
 *
 * - `error` vs `refused`. Ours vs theirs. `refused` REQUIRES a reason, because a refusal without one
 *   is indistinguishable from a bug, and the reason is a prop — the grid must never invent wording
 *   for a rule it does not know.
 * - `staged` vs `saved`. Dry-run must not look like success. This maps onto our own write guard: when
 *   the write path is in dry-run the cell is `staged`, and a dotted primary border says the engine
 *   never saw it.
 * - `readonly` vs `derived` vs `locked`. Permission, computation, and a closed document are three
 *   different answers to "why can't I type", and collapsing them produces the support ticket.
 */
export type MicroCellState =
    | "idle"
    | "focus"
    | "editing"
    | "saving"
    | "saved"
    | "error"
    | "refused"
    | "readonly"
    | "derived"
    | "locked"
    | "staged"
    | "conflict";

export interface MicroCellMeta {
    state: MicroCellState;
    /** REQUIRED for refused | error | conflict | locked — the whole point of those states. */
    reason?: string;
    /** Shown on the ƒ marker for `derived`; revealed on hover, never sent as a field on write. */
    formula?: string;
}

/** States where typing is impossible — no ✎ on hover, because a promise that breaks on click is worse
 *  than no promise. */
export const NON_EDITABLE: ReadonlySet<MicroCellState> = new Set([
    "readonly",
    "derived",
    "locked",
    "saving",
]);

/** States that must not be silent to a screen reader. */
export function cellStateAria(meta: MicroCellMeta): Record<string, string | boolean | undefined> {
    switch (meta.state) {
        case "saving":
            return { "aria-busy": true };
        case "saved":
        case "staged":
            return { "aria-live": "polite" };
        case "error":
            return { "aria-invalid": true, title: meta.reason };
        case "refused":
        case "locked":
            return { "aria-disabled": true, title: meta.reason };
        case "readonly":
        case "derived":
            return { "aria-readonly": true, title: meta.formula ?? meta.reason };
        case "conflict":
            return { role: "alert", title: meta.reason };
        default:
            return {};
    }
}

type Treatment = {
    style: CSSProperties;
    /** A glyph before the value (🔒, ⟳) and after it (✓, ƒ). */
    prefix?: string;
    suffix?: string;
    suffixTone?: "success" | "derived";
    /** Tone of the message rendered UNDER the cell — never a toast; a toast leaves the cell. */
    messageTone?: "error" | "warning" | "primary";
    messageIcon?: string;
    mono?: boolean;
};

/**
 * The exact fill / border / ring per state, from the §1 table.
 *
 * The ring goes on the CELL, not on the input inside it: an input with its own outline inside a
 * ringed cell draws a double line. `editing` therefore strips the input's own border elsewhere.
 */
export function cellStateTreatment(state: MicroCellState): Treatment {
    switch (state) {
        case "focus":
            return { style: { background: "var(--card)", boxShadow: "0 0 0 2px var(--ring)" } };
        case "editing":
            return { style: { background: "var(--background)", boxShadow: "0 0 0 2px var(--ring)" } };
        case "saving":
            return { style: { background: "var(--surface-2)", color: "var(--muted-foreground)" } };
        case "saved":
            return { style: {}, suffix: "✓", suffixTone: "success" };
        case "error":
            return {
                style: { background: "var(--destructive-soft)", border: "1px solid var(--destructive)" },
                messageTone: "error",
                mono: true,
            };
        case "refused":
            return {
                style: { background: "var(--warning-soft)", border: "1px solid var(--warning)" },
                messageTone: "warning",
                messageIcon: "⊘",
                mono: true,
            };
        case "readonly":
            return { style: { color: "var(--muted-foreground)" } };
        case "derived":
            return { style: { background: "var(--surface-sunken)" }, suffix: "ƒ", suffixTone: "derived" };
        case "locked":
            return { style: { background: "var(--surface-2)", color: "var(--muted-foreground)" }, prefix: "🔒" };
        case "staged":
            // Dotted, not solid, and primary rather than success: "validated" must never read as "saved".
            return {
                style: { background: "var(--entity-person-soft)", border: "1.5px dashed var(--primary)" },
                messageTone: "primary",
                messageIcon: "◌",
            };
        case "conflict":
            return {
                style: { border: "1px solid var(--warning)" },
                prefix: "⟳",
                messageTone: "warning",
                messageIcon: "⟳",
            };
        case "idle":
        default:
            return { style: {} };
    }
}

export const MESSAGE_TONE: Record<NonNullable<Treatment["messageTone"]>, { fg: string; bg: string }> = {
    error: { fg: "var(--destructive)", bg: "var(--destructive-soft)" },
    warning: { fg: "var(--warning)", bg: "var(--warning-soft)" },
    primary: { fg: "var(--primary)", bg: "var(--entity-person-soft)" },
};

/** How long the ✓ stays before it fades. No toast per cell — a toast is for what the user cannot see. */
export const SAVED_MARKER_MS = 1600;
