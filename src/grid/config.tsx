"use client";

// MicroGrid host configuration
// ----------------------------
// MicroGrid ships framework-agnostic. Everything it needs from the host app —
// the router's Link, the two group-toggle labels, and the name of the event the
// app dispatches when global density changes — arrives through this context.
//
// Defaults are chosen so that `<MicroGrid />` works with no provider at all:
// a plain <a>, Hebrew labels, and the conventional density event name. A host
// that wants Next.js client-side navigation wraps its tree once:
//
//   <MicroGridConfigProvider value={{ Link: NextLink }}>
//
// This is deliberately NOT a module-level singleton: under the App Router the
// same module can be evaluated in more than one bundle, and a singleton set in
// one would be invisible to the other.

import { createContext, useContext, useMemo, type ComponentType, type MouseEvent, type ReactNode } from "react";

/** Props MicroGrid passes to a navigable cell's link. */
export interface MicroGridLinkProps {
    href: string;
    /** Next.js honours this; a plain <a> ignores it. */
    prefetch?: boolean;
    title?: string;
    onClick?: (event: MouseEvent<HTMLAnchorElement>) => void;
    className?: string;
    children: ReactNode;
}

export type MicroGridLinkComponent = ComponentType<MicroGridLinkProps>;

export interface MicroGridLabels {
    collapseGroup: string;
    expandGroup: string;
    /** Shown by the built-in empty state when the host passes no message. */
    empty: string;
}

export interface MicroGridConfig {
    Link: MicroGridLinkComponent;
    labels: MicroGridLabels;
    /**
     * Window event the host dispatches when the global density preference
     * changes. MicroGrid subscribes to it and re-reads
     * `document.documentElement.dataset.density`.
     */
    densityEventName: string;
}

/** Plain anchor — the zero-dependency default. */
function DefaultLink({ href, prefetch: _prefetch, ...rest }: MicroGridLinkProps) {
    return <a href={href} {...rest} />;
}

const HE_LABELS: MicroGridLabels = {
    collapseGroup: "כווץ קבוצה",
    expandGroup: "הרחב קבוצה",
    empty: "אין שורות להצגה",
};

const EN_LABELS: MicroGridLabels = {
    collapseGroup: "Collapse group",
    expandGroup: "Expand group",
    empty: "No rows to display",
};

/** Built-in label sets, so a host with no i18n layer still gets both languages. */
export const microGridLabels = { he: HE_LABELS, en: EN_LABELS } as const;

export const DEFAULT_MICROGRID_CONFIG: MicroGridConfig = {
    Link: DefaultLink,
    labels: HE_LABELS,
    densityEventName: "appearance:density-change",
};

const MicroGridConfigContext = createContext<MicroGridConfig>(DEFAULT_MICROGRID_CONFIG);

export function MicroGridConfigProvider({
    value,
    children,
}: {
    /** Partial — anything omitted falls back to the default. */
    value: Partial<MicroGridConfig>;
    children: ReactNode;
}) {
    const merged = useMemo<MicroGridConfig>(
        () => ({
            Link: value.Link ?? DEFAULT_MICROGRID_CONFIG.Link,
            labels: { ...DEFAULT_MICROGRID_CONFIG.labels, ...value.labels },
            densityEventName: value.densityEventName ?? DEFAULT_MICROGRID_CONFIG.densityEventName,
        }),
        [value.Link, value.labels, value.densityEventName],
    );
    return <MicroGridConfigContext.Provider value={merged}>{children}</MicroGridConfigContext.Provider>;
}

export function useMicroGridConfig(): MicroGridConfig {
    return useContext(MicroGridConfigContext);
}
