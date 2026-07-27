"use client";

import { useSyncExternalStore } from "react";

// SSR-safe: returns false (above breakpoint) on the server. First client commit
// reads the real matchMedia value. No useState/useEffect — avoids the legacy
// mount pattern blocked by react-hooks/set-state-in-effect.

const mediaQueryListCache = new Map<string, MediaQueryList>();
const subscribeCache = new Map<string, (notify: () => void) => () => void>();

function getCachedMediaQuery(query: string): MediaQueryList | null {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
        return null;
    }

    const cached = mediaQueryListCache.get(query);
    if (cached) return cached;

    const mq = window.matchMedia(query);
    mediaQueryListCache.set(query, mq);
    return mq;
}

function getCachedSubscribe(query: string) {
    const cached = subscribeCache.get(query);
    if (cached) return cached;

    // Keep subscribe identity stable per query so useSyncExternalStore does not
    // resubscribe on every MicroGrid render.
    const subscribe = (notify: () => void) => {
        const mq = getCachedMediaQuery(query);
        if (!mq) return () => {};

        mq.addEventListener("change", notify);
        return () => mq.removeEventListener("change", notify);
    };
    subscribeCache.set(query, subscribe);
    return subscribe;
}

const noopSubscribe = () => () => {};

/** True when viewport width is strictly below the given pixel breakpoint. */
export function useIsBelow(breakpointPx: number): boolean {
    const query = `(max-width: ${breakpointPx - 1}px)`;

    return useSyncExternalStore(
        typeof window !== "undefined" ? getCachedSubscribe(query) : noopSubscribe,
        () => getCachedMediaQuery(query)?.matches ?? false,
        () => false,
    );
}

/** Back-compat alias — kept so existing imports keep working. */
export const useIsMobile = useIsBelow;
