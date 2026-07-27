"use client";

// DraggablePanels host configuration
// ---------------------------------
// Same shape as the grid's config (see ../grid/config.tsx): React context, every
// field defaulted, no module-level singleton.
//
// The persistence seam is the interesting one. Rather than inventing a narrow
// load/save pair and losing presets, the host hands over the entire hook. NOW
// passes its existing `usePanelLayoutDB` verbatim; the contract in
// `persistence.ts` was lifted from that hook's signature precisely so adoption
// costs nothing.

import { createContext, useContext, useMemo, type ReactNode } from "react";
import { ephemeralPanelLayout, type UsePanelLayout } from "./persistence";

export interface PanelLabels {
    addPanel: string;
    collapsePanel: string;
    expandPanel: string;
    splitPanel: string;
    splitAll: string;
    mergeWith: string;
}

export interface PanelsConfig {
    /**
     * Layout persistence. Must obey the rules of hooks — it is called
     * unconditionally from the panel grid's body, so the host must not swap it
     * out between renders.
     */
    usePanelLayout: UsePanelLayout;
    labels: PanelLabels;
}

const HE_LABELS: PanelLabels = {
    addPanel: "הוסף פאנל",
    collapsePanel: "כווץ פאנל",
    expandPanel: "הרחב פאנל",
    splitPanel: "פצל פאנל",
    splitAll: "פצל הכל",
    mergeWith: "אחד עם…",
};

const EN_LABELS: PanelLabels = {
    addPanel: "Add panel",
    collapsePanel: "Collapse panel",
    expandPanel: "Expand panel",
    splitPanel: "Split panel",
    splitAll: "Split all",
    mergeWith: "Merge with…",
};

export const panelLabels = { he: HE_LABELS, en: EN_LABELS } as const;

export const DEFAULT_PANELS_CONFIG: PanelsConfig = {
    usePanelLayout: ephemeralPanelLayout,
    labels: HE_LABELS,
};

const PanelsConfigContext = createContext<PanelsConfig>(DEFAULT_PANELS_CONFIG);

export function PanelsConfigProvider({
    value,
    children,
}: {
    /** Partial — anything omitted falls back to the default. */
    value: Partial<PanelsConfig>;
    children: ReactNode;
}) {
    const merged = useMemo<PanelsConfig>(
        () => ({
            usePanelLayout: value.usePanelLayout ?? DEFAULT_PANELS_CONFIG.usePanelLayout,
            labels: { ...DEFAULT_PANELS_CONFIG.labels, ...value.labels },
        }),
        [value.usePanelLayout, value.labels],
    );
    return <PanelsConfigContext.Provider value={merged}>{children}</PanelsConfigContext.Provider>;
}

export function usePanelsConfig(): PanelsConfig {
    return useContext(PanelsConfigContext);
}
