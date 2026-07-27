import { describe, expect, it, vi, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import {
    DraggablePanels,
    PanelsConfigProvider,
    panelLabels,
    ephemeralPanelLayout,
    type PanelDef,
    type PanelLayoutOptions,
    type UsePanelLayout,
} from "../src/panels";

// jsdom implements neither of these, and the panel grid measures itself on mount.
beforeAll(() => {
    window.matchMedia ??= ((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    globalThis.ResizeObserver ??= class {
        observe() {}
        unobserve() {}
        disconnect() {}
    } as unknown as typeof ResizeObserver;
});

const panels: PanelDef[] = [
    { id: "p1", title: "פרטי תקשורת", content: <div>תוכן א</div> },
    { id: "p2", title: "קשרים", content: <div>תוכן ב</div> },
];

describe("DraggablePanels · rendering without a provider", () => {
    it("renders every panel using the built-in ephemeral persistence", () => {
        render(<DraggablePanels panels={panels} storageKey="test-panels" />);

        expect(screen.getByText("פרטי תקשורת")).toBeInTheDocument();
        expect(screen.getByText("קשרים")).toBeInTheDocument();
        expect(screen.getByText("תוכן א")).toBeInTheDocument();
    });

    it("uses the Hebrew collapse label by default", () => {
        render(<DraggablePanels panels={panels} storageKey="test-panels-2" />);
        expect(screen.getAllByTitle(panelLabels.he.collapsePanel).length).toBeGreaterThan(0);
    });
});

describe("DraggablePanels · persistence seam", () => {
    it("calls the host-supplied hook with the panel ids and storage keys", () => {
        const seen: PanelLayoutOptions[] = [];
        const hostHook: UsePanelLayout = (options) => {
            seen.push(options);
            return ephemeralPanelLayout(options);
        };

        render(
            <PanelsConfigProvider value={{ usePanelLayout: hostHook }}>
                <DraggablePanels
                    panels={panels}
                    storageKey="people-panels-abc"
                    templatesKey="people-panels-templates"
                    tenantId="tenant-1"
                />
            </PanelsConfigProvider>,
        );

        expect(seen.length).toBeGreaterThan(0);
        expect(seen[0]).toMatchObject({
            tenantId: "tenant-1",
            storageKey: "people-panels-abc",
            templatesKey: "people-panels-templates",
            initialPanelIds: ["p1", "p2"],
            // enabled tracks tenantId — no tenant means local-only.
            enabled: true,
        });
    });

    it("marks persistence disabled when the host passes no tenant", () => {
        const seen: PanelLayoutOptions[] = [];
        const hostHook: UsePanelLayout = (options) => {
            seen.push(options);
            return ephemeralPanelLayout(options);
        };

        render(
            <PanelsConfigProvider value={{ usePanelLayout: hostHook }}>
                <DraggablePanels panels={panels} storageKey="k" />
            </PanelsConfigProvider>,
        );

        expect(seen[0]).toMatchObject({ enabled: false, tenantId: "" });
    });

    // NOTE: hoisted to module scope on purpose. Returning a fresh `dbLayout`
    // object from the hook on every render drives the grid into an infinite
    // render loop — the layout lands in effect dependencies. See the stability
    // requirement documented on PanelLayoutState.
    const SAVED_LAYOUT = {
        order: ["p2", "p1"],
        collapsed: {},
        colSpan: {},
        panelState: {},
        groups: {},
        hidden: {},
    };

    it("renders the host's saved order rather than the declared order", () => {
        const hostHook: UsePanelLayout = (options) => ({
            ...ephemeralPanelLayout(options),
            dbLayout: SAVED_LAYOUT,
        });

        render(
            <PanelsConfigProvider value={{ usePanelLayout: hostHook }}>
                <DraggablePanels panels={panels} storageKey="k" tenantId="t" />
            </PanelsConfigProvider>,
        );

        const titles = screen.getAllByText(/פרטי תקשורת|קשרים/).map((n) => n.textContent);
        expect(titles).toEqual(["קשרים", "פרטי תקשורת"]);
    });
});

describe("DraggablePanels · labels seam", () => {
    it("honours a full English label set", () => {
        render(
            <PanelsConfigProvider value={{ labels: panelLabels.en }}>
                <DraggablePanels panels={panels} storageKey="k-en" />
            </PanelsConfigProvider>,
        );
        expect(screen.getAllByTitle(panelLabels.en.collapsePanel).length).toBeGreaterThan(0);
    });

    it("merges a partial override over the defaults", () => {
        // Override a key that is NOT rendered in the default (expanded) state, so
        // the assertion below proves the untouched key survived the merge.
        render(
            <PanelsConfigProvider value={{ labels: { expandPanel: "פתח" } as never }}>
                <DraggablePanels panels={panels} storageKey="k-partial" />
            </PanelsConfigProvider>,
        );
        expect(screen.getAllByTitle(panelLabels.he.collapsePanel).length).toBeGreaterThan(0);
    });
});
