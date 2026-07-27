"use client";

import { useEffect, useMemo, useState } from "react";
// Panel layout persistence contract
// ---------------------------------
// The panel grid does not know how a layout is stored. NOW keeps layouts in
// Supabase (per tenant, per screen type, with presets); another app may use
// localStorage, or nothing at all. So the host supplies the whole hook and the
// grid just calls it — see `config.tsx`.
//
// The types below are pure data and belong to the contract, not to any host.

export type ScreenType = "desktop" | "tablet" | "mobile";

export type ColSpan = 1 | 2 | 3 | 4 | 6 | 8 | 12;

/** A complete saved arrangement for one screen type. */
export interface PanelStorage {
    order: string[];
    collapsed: Record<string, boolean>;
    colSpan: Record<string, ColSpan>;
    panelState: Record<string, Record<string, unknown>>;
    groups: Record<string, { panelIds: string[]; activeTab: string }>;
    hidden: Record<string, boolean>;
    panelMaxHeight?: Record<string, number>;
    customTitles?: Record<string, string>;
    gridVersion?: number;
}

/** A named arrangement a user can re-apply. */
export interface PanelLayoutPreset {
    id: string;
    name: string;
    screenKey: string;
    layout: PanelStorage;
    isSystemDefault: boolean;
    userId: string | null;
    createdAt: string;
}

export interface PanelLayoutOptions {
    tenantId: string;
    /** Entity-instance key, e.g. "people-panels-{uuid}". */
    storageKey: string;
    /** Entity-type key, e.g. "people-panels-templates". */
    templatesKey?: string;
    initialPanelIds: string[];
    /** false → the host should fall back to local-only storage. */
    enabled?: boolean;
}

/**
 * What the host's hook returns on every render.
 *
 * ⚠️ **Referential stability is part of the contract.** `dbLayout` and the
 * callbacks land in effect dependency arrays inside the panel grid, so a fresh
 * object identity on every render drives an infinite render loop — the symptom
 * is a hang, not an error. Memoise them (`useMemo` / `useCallback` / `useState`),
 * exactly as NOW's `usePanelLayoutDB` already does.
 */
export interface PanelLayoutState {
    dbLayout: PanelStorage | null;
    isLoading: boolean;
    screenType: ScreenType;
    presets: PanelLayoutPreset[];
    presetsLoading: boolean;
    saveLayout: (layout: PanelStorage) => void;
    saveLayoutImmediate: (layout: PanelStorage) => void;
    savePreset: (name: string, layout: PanelStorage, isSystemDefault?: boolean) => Promise<void>;
    applyPreset: (presetId: string, onApplied: (layout: PanelStorage) => void) => Promise<void>;
    deletePreset: (presetId: string) => Promise<void>;
    error: string | null;
}

/**
 * The hook the host provides. NOW passes its existing `usePanelLayoutDB`
 * unchanged — the signature was lifted from it deliberately, so adopting the
 * package costs the host nothing.
 */
export type UsePanelLayout = (options: PanelLayoutOptions) => PanelLayoutState;

/** Screen-type breakpoints, shared so hosts classify identically. */
export function detectScreenType(): ScreenType {
    if (typeof window === "undefined") return "desktop";
    const width = window.innerWidth;
    if (width < 768) return "mobile";
    if (width < 1280) return "tablet";
    return "desktop";
}

const NO_PRESETS: PanelLayoutPreset[] = [];
const noop = () => {};
const asyncNoop = async () => {};

/**
 * Reactive screen type. Server and first client render both return "desktop",
 * then the real value arrives in an effect — reading `window.innerWidth`
 * straight into `useState`'s initialiser would mismatch during hydration.
 */
export function useScreenType(): ScreenType {
    const [screenType, setScreenType] = useState<ScreenType>("desktop");
    useEffect(() => {
        const sync = () => setScreenType((prev) => (detectScreenType() === prev ? prev : detectScreenType()));
        sync();
        window.addEventListener("resize", sync, { passive: true });
        return () => window.removeEventListener("resize", sync);
    }, []);
    return screenType;
}

/**
 * In-memory no-op persistence — the default, so `<DraggablePanels />` renders
 * with no provider at all. Arrangements simply do not survive a reload.
 *
 * The returned object is memoised: it lands in effect dependency arrays inside
 * the grid, and a fresh identity every render would loop.
 */
export const ephemeralPanelLayout: UsePanelLayout = () => {
    const screenType = useScreenType();
    return useMemo(
        () => ({
            dbLayout: null,
            isLoading: false,
            screenType,
            presets: NO_PRESETS,
            presetsLoading: false,
            saveLayout: noop,
            saveLayoutImmediate: noop,
            savePreset: asyncNoop,
            applyPreset: asyncNoop,
            deletePreset: asyncNoop,
            error: null,
        }),
        [screenType],
    );
};
