import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { MicroGrid, legacyColumnsToMicroColumns } from "../src/grid";
import type { GridValueSetterParams } from "../src/grid";

interface Row {
    id: string;
    ret_name: string;
    ret_status?: string;
    nested?: { city?: string };
}

const ROWS: Row[] = [
    { id: "1", ret_name: "Acme Inc.", ret_status: "active", nested: { city: "TLV" } },
    { id: "2", ret_name: "Beta Co.", ret_status: "lead" },
];

describe("columnAdapter · shape", () => {
    it("maps field → id + accessor", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "ret_name", headerName: "Name" },
        ]);
        expect(cols).toHaveLength(1);
        expect(cols[0].id).toBe("ret_name");
        expect(cols[0].header).toBe("Name");
        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.getByText("Acme Inc.")).toBeInTheDocument();
        expect(screen.getByText("Beta Co.")).toBeInTheDocument();
    });

    it("reads dotted field paths", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "nested.city", headerName: "City" },
        ]);
        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.getByText("TLV")).toBeInTheDocument();
    });

    it("falls back to (row) shape when params shape throws", () => {
        // Some legacy factories (rare) call the bare row directly. We only
        // try this path after the params shape throws — keeps real-world legacy-style
        // getters from accidentally producing undefined via the wrong shape.
        const cols = legacyColumnsToMicroColumns<Row>([
            {
                field: "computed",
                headerName: "Upper",
                valueGetter: ((row: Row) => {
                    // Throw on params shape (row is {data:...}, no ret_name)
                    if (!row.ret_name) throw new Error("not the params shape");
                    return row.ret_name.toUpperCase();
                }) as any,
            },
        ]);
        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.getByText("ACME INC.")).toBeInTheDocument();
        expect(screen.getByText("BETA CO.")).toBeInTheDocument();
    });

    it("invokes valueGetter with ({data}) params shape", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            {
                field: "computed",
                headerName: "Upper",
                valueGetter: (p: any) => String(p.data.ret_name).toUpperCase(),
            },
        ]);
        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.getByText("ACME INC.")).toBeInTheDocument();
    });

    it("passes synthetic params {data, value, context, colDef} to cellRenderer", () => {
        const ctx = { tenantId: "T-1" };
        const cols = legacyColumnsToMicroColumns<Row>(
            [
                {
                    field: "ret_name",
                    headerName: "Name",
                    cellRenderer: (params: any) => (
                        <span data-testid="cell">
                            {params.data.id}|{String(params.value)}|{params.context.tenantId}|{params.colDef.field}
                        </span>
                    ),
                },
            ],
            { context: ctx },
        );
        render(
            <MicroGrid
                rows={[ROWS[0]]}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.getByTestId("cell").textContent).toBe("1|Acme Inc.|T-1|ret_name");
    });

    it("drops hidden columns by default", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "ret_name", headerName: "Name" },
            { field: "ret_status", headerName: "Status", hide: true },
        ]);
        expect(cols).toHaveLength(1);
        expect(cols[0].id).toBe("ret_name");
    });

    it("respects excludeFields", () => {
        const cols = legacyColumnsToMicroColumns<Row>(
            [
                { field: "ret_name", headerName: "Name" },
                { field: "ret_status", headerName: "Status" },
            ],
            { excludeFields: ["ret_status"] },
        );
        expect(cols).toHaveLength(1);
        expect(cols[0].id).toBe("ret_name");
    });

    it("infers edit config from agSelectCellEditor", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            {
                field: "ret_status",
                headerName: "Status",
                editable: true,
                cellEditor: "agSelectCellEditor",
                cellEditorParams: { values: ["active", "lead", "lost"] },
            },
        ]);
        expect(cols[0].edit).toEqual({
            kind: "select",
            options: [
                { value: "active", label: "active" },
                { value: "lead", label: "lead" },
                { value: "lost", label: "lost" },
            ],
        });
    });

    it("infers edit config for text/number/date/checkbox", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "a", editable: true, cellEditor: "agTextCellEditor" },
            { field: "b", editable: true, cellEditor: "agNumberCellEditor" },
            { field: "c", editable: true, cellEditor: "agDateCellEditor" },
            { field: "d", editable: true, cellEditor: "agCheckboxCellEditor" },
            { field: "e", editable: true }, // default → text
        ]);
        expect(cols[0].edit).toEqual({ kind: "text" });
        expect(cols[1].edit).toEqual({ kind: "number" });
        expect(cols[2].edit).toEqual({ kind: "date" });
        expect(cols[3].edit).toEqual({ kind: "checkbox" });
        expect(cols[4].edit).toEqual({ kind: "text" });
    });

    it("preserves component cellEditor references", () => {
        function TestEditor() {
            return <input aria-label="test editor" />;
        }

        const cols = legacyColumnsToMicroColumns<Row>([
            {
                field: "ret_name",
                editable: true,
                cellEditor: TestEditor,
                cellEditorParams: { min: 1 },
            },
        ]);
        expect(cols[0].edit).toEqual({
            kind: "component",
            Component: TestEditor,
            params: { min: 1 },
            colDef: expect.objectContaining({ field: "ret_name" }),
        });
    });

    it("falls back to text edit for unknown string-named cellEditor when editable", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "a", editable: true, cellEditor: "MyCustomEditor" },
        ]);
        expect(cols[0].edit).toEqual({ kind: "text" });
    });

    it("does not set edit when editable is false", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "a", editable: false, cellEditor: "agTextCellEditor" },
        ]);
        expect(cols[0].edit).toBeUndefined();
    });

    it("reports legacy setDataValue edits without mutating the source row", () => {
        const onLegacyCellEdit = vi.fn();
        const row: Row = { id: "1", ret_name: "Acme Inc.", ret_status: "lead" };
        const snapshot = structuredClone(row);
        const cols = legacyColumnsToMicroColumns<Row>(
            [
                {
                    field: "ret_status",
                    headerName: "Status",
                    cellRenderer: (params: any) => {
                        const changed = params.node.setDataValue("ret_status", "active");
                        return <span>{String(changed)}</span>;
                    },
                },
            ],
            { onLegacyCellEdit },
        );

        cols[0].cell?.(row, row.ret_status);

        expect(row).toEqual(snapshot);
        expect(onLegacyCellEdit).toHaveBeenCalledWith({
            data: { ...row, ret_status: "active" },
            colDef: { field: "ret_status" },
            oldValue: "lead",
            newValue: "active",
        });
    });

    it("honors valueSetter on a cloned row before reporting legacy setDataValue edits", () => {
        const onLegacyCellEdit = vi.fn();
        const valueSetter = vi.fn((params: GridValueSetterParams<Row>) => {
            params.data.ret_name = String(params.newValue);
            return true;
        });
        const row: Row = { id: "1", ret_name: "Acme Inc.", ret_status: "lead" };
        const snapshot = structuredClone(row);
        const cols = legacyColumnsToMicroColumns<Row>(
            [
                {
                    field: "ret_name",
                    headerName: "Name",
                    valueSetter,
                    cellRenderer: (params: any) => {
                        const changed = params.node.setDataValue("ret_name", "Acme Ltd.");
                        return <span>{String(changed)}</span>;
                    },
                },
            ],
            { onLegacyCellEdit },
        );

        cols[0].cell?.(row, row.ret_name);

        expect(valueSetter).toHaveBeenCalledOnce();
        expect(valueSetter.mock.calls[0]?.[0]).toEqual(expect.objectContaining({
            data: { ...row, ret_name: "Acme Ltd." },
            oldValue: "Acme Inc.",
            newValue: "Acme Ltd.",
        }));
        expect(row).toEqual(snapshot);
        expect(onLegacyCellEdit).toHaveBeenCalledWith({
            data: { ...row, ret_name: "Acme Ltd." },
            colDef: { field: "ret_name" },
            oldValue: "Acme Inc.",
            newValue: "Acme Ltd.",
        });
    });

    it("uses width or minWidth as MicroColumn width", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            { field: "a", width: 200 },
            { field: "b", minWidth: 150 },
        ]);
        expect(cols[0].width).toBe(200);
        expect(cols[1].width).toBe(150);
    });

    it("carries navigateTo through to MicroColumn", () => {
        const cols = legacyColumnsToMicroColumns<Row>([
            {
                field: "ret_name",
                headerName: "Name",
                navigateTo: (row) => {
                    const record = row as Row;
                    return `/dashboard/organizations/${record.id}`;
                },
            },
        ]);

        expect(cols[0].navigateTo?.(ROWS[0])).toBe("/dashboard/organizations/1");
    });
});
