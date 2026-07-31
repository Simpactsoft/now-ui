import { describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { forwardRef } from "react";
import { MicroGrid, MicroGridConfigProvider, microGridLabels, type MicroColumn, type MicroGridLinkProps } from "../src/grid";

type Row = { id: string; name: string };

const rows: Row[] = [{ id: "r1", name: "צחי" }];

const navigableColumns: MicroColumn<Row>[] = [
    { id: "name", header: "שם", accessor: (r) => r.name, navigateTo: (r) => `/people/${r.id}` },
];

describe("MicroGridConfigProvider · Link injection", () => {
    it("renders a plain <a> when no provider wraps the grid", () => {
        render(<MicroGrid rows={rows} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r) => r.id} />);
        const link = screen.getByRole("link", { name: "צחי" });
        expect(link.tagName).toBe("A");
        expect(link).toHaveAttribute("href", "/people/r1");
    });

    it("uses the host-supplied Link component and forwards href/onClick", () => {
        const HostLink = vi.fn(({ href, children, prefetch: _prefetch, ...rest }: MicroGridLinkProps) => (
            <a data-testid="host-link" href={href} {...rest}>
                {children}
            </a>
        ));

        render(
            <MicroGridConfigProvider value={{ Link: HostLink }}>
                <MicroGrid rows={rows} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r) => r.id} />
            </MicroGridConfigProvider>,
        );

        expect(screen.getByTestId("host-link")).toHaveAttribute("href", "/people/r1");
        expect(HostLink).toHaveBeenCalled();
        // `prefetch` is part of the contract even though a plain <a> drops it.
        expect(HostLink.mock.calls[0][0]).toMatchObject({ href: "/people/r1", prefetch: false });
        expect(typeof HostLink.mock.calls[0][0].onClick).toBe("function");
    });

    it("does not choke on a Link that forwards refs", () => {
        const RefLink = forwardRef<HTMLAnchorElement, MicroGridLinkProps>(function RefLink(
            { href, prefetch: _prefetch, ...rest },
            ref,
        ) {
            return <a ref={ref} href={href} {...rest} />;
        });

        render(
            <MicroGridConfigProvider value={{ Link: RefLink }}>
                <MicroGrid rows={rows} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r) => r.id} />
            </MicroGridConfigProvider>,
        );
        expect(screen.getByRole("link", { name: "צחי" })).toHaveAttribute("href", "/people/r1");
    });
});

describe("MicroGridConfigProvider · labels", () => {
    it("falls back to the Hebrew empty-state label", () => {
        render(<MicroGrid rows={[]} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r: Row) => r.id} />);
        expect(screen.getByText(microGridLabels.he.empty)).toBeInTheDocument();
    });

    it("honours a partial label override without losing the other defaults", () => {
        render(
            <MicroGridConfigProvider value={{ labels: { empty: "אין נתונים" } }}>
                <MicroGrid rows={[]} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r: Row) => r.id} />
            </MicroGridConfigProvider>,
        );
        expect(screen.getByText("אין נתונים")).toBeInTheDocument();
    });

    it("exposes an English label set for LTR hosts", () => {
        render(
            <MicroGridConfigProvider value={{ labels: microGridLabels.en }}>
                <MicroGrid rows={[]} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r: Row) => r.id} />
            </MicroGridConfigProvider>,
        );
        expect(screen.getByText(microGridLabels.en.empty)).toBeInTheDocument();
        expect(microGridLabels.en.rowActions).toBe("Actions");
        expect(microGridLabels.en.cellChangeError).toBe("Error");
    });
});

describe("MicroGridConfigProvider · density event", () => {
    // Density lands on the --cellpad-backed inline style, not on a utility class.
    const cellPadding = () => screen.getAllByRole("cell")[0].style.paddingInline;

    it("re-reads density when the host-named event fires", () => {
        document.documentElement.dataset.density = "cozy";

        render(
            <MicroGridConfigProvider value={{ densityEventName: "skyz:density" }}>
                <MicroGrid rows={rows} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r) => r.id} />
            </MicroGridConfigProvider>,
        );

        expect(cellPadding()).toBe("var(--cellpad, 12px)");

        act(() => {
            document.documentElement.dataset.density = "compact";
            window.dispatchEvent(new Event("skyz:density"));
        });
        expect(cellPadding()).toBe("var(--cellpad, 8px)");

        // The default event name must NOT be listened to once the host renamed it.
        act(() => {
            document.documentElement.dataset.density = "comfortable";
            window.dispatchEvent(new Event("appearance:density-change"));
        });
        expect(cellPadding()).toBe("var(--cellpad, 8px)");

        delete document.documentElement.dataset.density;
    });

    it("listens to the default event name when the host does not rename it", () => {
        document.documentElement.dataset.density = "cozy";
        render(<MicroGrid rows={rows} ariaLabel="אנשים" columns={navigableColumns} getRowId={(r) => r.id} />);

        expect(cellPadding()).toBe("var(--cellpad, 12px)");

        act(() => {
            document.documentElement.dataset.density = "compact";
            window.dispatchEvent(new Event("appearance:density-change"));
        });
        expect(cellPadding()).toBe("var(--cellpad, 8px)");

        delete document.documentElement.dataset.density;
    });
});
