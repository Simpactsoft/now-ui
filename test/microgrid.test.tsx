import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { MicroGrid } from "../src/grid";
import type {
    MicroColumn,
    MicroRowAction,
} from "../src/grid";

interface Row {
    id: string;
    name: string;
    role: string;
    age: number;
}

const ROWS: Row[] = [
    { id: "a", name: "Alice", role: "Manager", age: 30 },
    { id: "b", name: "Bob", role: "Engineer", age: 25 },
    { id: "c", name: "Carol", role: "Designer", age: 28 },
];

const BASIC_COLS: MicroColumn<Row>[] = [
    { id: "name", header: "Name", accessor: "name", sortable: true, isCardTitle: true },
    { id: "role", header: "Role", accessor: "role", sortable: true },
    { id: "age", header: "Age", accessor: "age", sortable: true, align: "end" },
];

// ─── Rendering ─────────────────────────────────────────────────────────

describe("MicroGrid · rendering", () => {
    it("renders headers and rows", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.getByRole("columnheader", { name: /name/i })).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
        expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    it("applies the required aria-label to the table", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="my people grid"
            />,
        );

        expect(screen.getByRole("table", { name: "my people grid" })).toBeInTheDocument();
    });

    it("uses custom cell renderer when provided", () => {
        const cols: MicroColumn<Row>[] = [
            { id: "name", header: "Name", accessor: "name", cell: (r) => <strong>{`Mr. ${r.name}`}</strong> },
        ];
        render(<MicroGrid rows={ROWS} columns={cols} getRowId={(r) => r.id} ariaLabel="t" />);

        expect(screen.getByText("Mr. Alice")).toBeInTheDocument();
    });

    it("renders default empty state when rows are empty", () => {
        render(<MicroGrid rows={[]} columns={BASIC_COLS} getRowId={(r) => r.id} ariaLabel="t" />);

        expect(screen.getByText("אין שורות להצגה")).toBeInTheDocument();
    });

    it("renders custom emptyMessage", () => {
        render(
            <MicroGrid
                rows={[]}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                emptyMessage="nothing yet"
            />,
        );

        expect(screen.getByText("nothing yet")).toBeInTheDocument();
    });

    it("renders custom emptyState override", () => {
        render(
            <MicroGrid
                rows={[]}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                emptyState={<div>completely custom empty</div>}
            />,
        );

        expect(screen.getByText("completely custom empty")).toBeInTheDocument();
        expect(screen.queryByText("אין שורות להצגה")).not.toBeInTheDocument();
    });

    it("renders skeleton rows when loading=true", () => {
        const { container } = render(
            <MicroGrid
                rows={[]}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                loading
            />,
        );

        // Skeleton uses animate-pulse on inner divs
        const pulses = container.querySelectorAll(".animate-pulse");
        expect(pulses.length).toBeGreaterThan(0);
    });
});

// ─── Groups ────────────────────────────────────────────────────────────

describe("MicroGrid · groups", () => {
    const GROUPS = [
        { key: "team-a", label: "Team A", rows: ROWS.slice(0, 2) },
        { key: "team-b", label: "Team B", rows: ROWS.slice(2) },
    ];

    it("renders groups with divider + count", () => {
        render(
            <MicroGrid
                rows={[]}
                groups={GROUPS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.getByText("Team A")).toBeInTheDocument();
        expect(screen.getByText("(2)")).toBeInTheDocument();
        expect(screen.getByText("Alice")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
        expect(screen.getByText("Team B")).toBeInTheDocument();
        expect(screen.getByText("(1)")).toBeInTheDocument();
    });

    it("groups takes precedence over rows when both provided", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
        try {
            render(
                <MicroGrid
                    rows={ROWS}
                    groups={[{ key: "only", label: "Only", rows: [ROWS[0]] }]}
                    columns={BASIC_COLS}
                    getRowId={(r) => r.id}
                    ariaLabel="people"
                />,
            );

            expect(screen.getByText("Only")).toBeInTheDocument();
            expect(screen.getByText("Alice")).toBeInTheDocument();
            expect(screen.queryByText("Bob")).not.toBeInTheDocument();
            expect(screen.queryByText("Carol")).not.toBeInTheDocument();
            expect(warnSpy).toHaveBeenCalledTimes(1);
            expect(warnSpy).toHaveBeenCalledWith(
                "MicroGrid: `groups` and `rows` were both provided; grouped rendering wins.",
            );
        } finally {
            warnSpy.mockRestore();
        }
    });

    it("hideEmptyGroups: true skips empty groups", () => {
        render(
            <MicroGrid
                rows={[]}
                groups={[
                    { key: "empty", label: "Empty", rows: [] },
                    { key: "full", label: "Full", rows: [ROWS[1]] },
                ]}
                hideEmptyGroups
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.queryByText("Empty")).not.toBeInTheDocument();
        expect(screen.getByText("Full")).toBeInTheDocument();
        expect(screen.getByText("Bob")).toBeInTheDocument();
    });

    it("hideEmptyGroups: false renders divider with (0) for empty groups", () => {
        render(
            <MicroGrid
                rows={[]}
                groups={[{ key: "empty", label: "Empty", rows: [] }]}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.getByText("Empty")).toBeInTheDocument();
        expect(screen.getByText("(0)")).toBeInTheDocument();
        expect(screen.queryByText("אין שורות להצגה")).not.toBeInTheDocument();
    });

    it("empty groups array renders empty state", () => {
        render(
            <MicroGrid
                rows={[]}
                groups={[]}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.getByText("אין שורות להצגה")).toBeInTheDocument();
    });

    it("divider has data-group-divider attribute", () => {
        const { container } = render(
            <MicroGrid
                rows={[]}
                groups={GROUPS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(container.querySelectorAll('[data-group-divider="true"]')).toHaveLength(2);
    });

    it("does not render rows for collapsed groups but keeps the divider visible", () => {
        render(
            <MicroGrid
                rows={[]}
                groups={GROUPS}
                collapsedGroups={new Set(["team-a"])}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
            />,
        );

        expect(screen.getByText("Team A")).toBeInTheDocument();
        expect(screen.getByText("(2)")).toBeInTheDocument();
        expect(screen.queryByText("Alice")).not.toBeInTheDocument();
        expect(screen.queryByText("Bob")).not.toBeInTheDocument();
        expect(screen.getByText("Carol")).toBeInTheDocument();
    });

    it("fires onToggleGroup with the group key", async () => {
        const user = userEvent.setup();
        const onToggleGroup = vi.fn();
        render(
            <MicroGrid
                rows={[]}
                groups={GROUPS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
                onToggleGroup={onToggleGroup}
            />,
        );

        await user.click(screen.getAllByTestId("group-collapse-toggle")[0]);

        expect(onToggleGroup).toHaveBeenCalledWith("team-a");
    });

    it("mobile-card tier renders divider above section", () => {
        const { container } = render(
            <MicroGrid
                rows={[]}
                groups={GROUPS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
                forceMobile
            />,
        );

        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        const divider = container.querySelector('[data-group-divider="true"]');
        const firstCard = screen.getAllByRole("article")[0];
        expect(divider).not.toBeNull();
        expect(divider!.compareDocumentPosition(firstCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
});

// ─── Sort ──────────────────────────────────────────────────────────────

describe("MicroGrid · sort", () => {
    it("renders sortable columns as plain header labels", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );

        const nameHeader = screen.getByRole("columnheader", { name: /name/i });
        expect(nameHeader).not.toHaveAttribute("aria-sort");
        expect(within(nameHeader).queryByRole("button")).not.toBeInTheDocument();
    });

    it("clicking a header is a no-op", async () => {
        const user = userEvent.setup();
        const onSortChange = vi.fn();
        const reversed: Row[] = [
            { id: "a", name: "Charlie", role: "x", age: 1 },
            { id: "b", name: "Alice", role: "y", age: 2 },
            { id: "c", name: "Bob", role: "z", age: 3 },
        ];
        const { container } = render(
            <MicroGrid
                rows={reversed}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                sort={{ columnId: "name", direction: "asc" }}
                onSortChange={onSortChange}
            />,
        );

        const before = container.innerHTML;
        await user.click(screen.getByRole("columnheader", { name: /name/i }));

        const rows = screen.getAllByRole("row");
        const firstName = within(rows[1]).getByText(/Alice|Bob|Charlie/);
        expect(firstName.textContent).toBe("Charlie");
        expect(onSortChange).not.toHaveBeenCalled();
        expect(container.innerHTML).toBe(before);
    });
});

// ─── Selection ─────────────────────────────────────────────────────────

describe("MicroGrid · selection", () => {
    function Harness({
        initial = [] as string[],
        selection = "multi" as const,
    }: {
        initial?: string[];
        selection?: "multi" | "single";
    }) {
        const [ids, setIds] = useState<string[]>(initial);
        return (
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection={selection}
                selectedIds={ids}
                onSelectionChange={setIds}
            />
        );
    }

    it("does not render selection column when selection=none", () => {
        render(<MicroGrid rows={ROWS} columns={BASIC_COLS} getRowId={(r) => r.id} ariaLabel="t" />);

        expect(screen.queryByRole("checkbox", { name: /בחר/i })).not.toBeInTheDocument();
    });

    it("toggles a row in multi mode", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        const checkboxes = screen.getAllByRole("checkbox");
        // [0] = header "select all", [1..3] = row checkboxes
        await user.click(checkboxes[1]);

        expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
    });

    it("header checkbox selects all", async () => {
        const user = userEvent.setup();
        render(<Harness />);

        const header = screen.getByRole("checkbox", { name: /בחר הכל/ });
        await user.click(header);

        // All 3 row checkboxes should now be checked.
        const checked = screen.getAllByRole("checkbox").filter((cb) => cb.getAttribute("aria-checked") === "true");
        // Header + 3 rows = 4 checked
        expect(checked).toHaveLength(4);
    });

    it("header is indeterminate when partial selection", () => {
        render(<Harness initial={["a"]} />);

        const header = screen.getByRole("checkbox", { name: /בחר הכל/ });
        expect(header).toHaveAttribute("aria-checked", "mixed");
    });

    it("single mode replaces selection", async () => {
        const user = userEvent.setup();
        render(<Harness initial={[]} selection="single" />);

        const checkboxes = screen.getAllByRole("checkbox");
        await user.click(checkboxes[0]);
        expect(checkboxes[0]).toHaveAttribute("aria-checked", "true");

        await user.click(checkboxes[1]);
        // First should be unchecked now (single replaces).
        expect(checkboxes[0]).toHaveAttribute("aria-checked", "false");
        expect(checkboxes[1]).toHaveAttribute("aria-checked", "true");
    });

    it("shift-clicks across collapsed groups using only visible rows", async () => {
        const user = userEvent.setup();
        const groupedRows: Row[] = [
            { id: "a1", name: "A1", role: "Alpha", age: 1 },
            { id: "a2", name: "A2", role: "Alpha", age: 2 },
            { id: "hidden-1", name: "Hidden 1", role: "Hidden", age: 3 },
            { id: "hidden-2", name: "Hidden 2", role: "Hidden", age: 4 },
            { id: "c1", name: "C1", role: "Charlie", age: 5 },
            { id: "c2", name: "C2", role: "Charlie", age: 6 },
        ];

        function GroupedHarness() {
            const [ids, setIds] = useState<string[]>([]);
            return (
                <MicroGrid
                    rows={[]}
                    groups={[
                        { key: "alpha", label: "Alpha", rows: groupedRows.slice(0, 2) },
                        { key: "hidden", label: "Hidden", rows: groupedRows.slice(2, 4) },
                        { key: "charlie", label: "Charlie", rows: groupedRows.slice(4) },
                    ]}
                    collapsedGroups={new Set(["hidden"])}
                    columns={BASIC_COLS}
                    getRowId={(r) => r.id}
                    ariaLabel="grouped selection"
                    selection="multi"
                    selectedIds={ids}
                    onSelectionChange={setIds}
                />
            );
        }

        render(<GroupedHarness />);

        expect(screen.queryByText("Hidden 1")).not.toBeInTheDocument();
        await user.click(screen.getByRole("checkbox", { name: "בחר שורה a2" }));
        fireEvent.click(screen.getByRole("checkbox", { name: "בחר שורה c2" }), { shiftKey: true });

        const checkedIds = screen
            .getAllByRole("checkbox")
            .filter((checkbox) => checkbox.getAttribute("aria-checked") === "true")
            .map((checkbox) => checkbox.getAttribute("aria-label"))
            .filter((label): label is string => label !== null)
            .map((label) => label.replace("בחר שורה ", ""));

        expect(checkedIds).toEqual(["a2", "c1", "c2"]);
    });
});

// ─── Inline edit ───────────────────────────────────────────────────────

describe("MicroGrid · inline edit", () => {
    const editCols: MicroColumn<Row>[] = [
        { id: "name", header: "Name", accessor: "name" },
        { id: "role", header: "Role", accessor: "role", edit: { kind: "text" } },
    ];

    it("enters edit mode on cell click", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => true}
            />,
        );

        await user.click(screen.getByText("Manager"));
        expect(screen.getByDisplayValue("Manager")).toBeInTheDocument();
    });

    it("commits on Enter", async () => {
        const user = userEvent.setup();
        const onCellChange = vi.fn().mockReturnValue(true);
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={onCellChange}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        await user.clear(input);
        await user.type(input, "Director{Enter}");

        expect(onCellChange).toHaveBeenCalledWith("a", "role", "Director");
    });

    it("renders component editors and commits through the bridge", async () => {
        const user = userEvent.setup();
        const onCellChange = vi.fn().mockReturnValue(true);

        function RoleComponentEditor(props: {
            value: unknown;
            onValueChange: (value: unknown) => void;
            stopEditing: () => void;
            rowData: Row;
            label?: unknown;
        }) {
            return (
                <button
                    type="button"
                    data-testid="role-component-editor"
                    onClick={() => {
                        props.onValueChange("Principal");
                        props.stopEditing();
                    }}
                >
                    {String(props.label)} {String(props.value)} {props.rowData.id}
                </button>
            );
        }

        const cols: MicroColumn<Row>[] = [
            { id: "role", header: "Role", accessor: "role", edit: { kind: "component", Component: RoleComponentEditor, params: { label: "Legacy" } } },
        ];

        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={onCellChange}
            />,
        );

        await user.click(screen.getByText("Manager"));
        expect(screen.getByTestId("microgrid-component-editor")).toBeInTheDocument();
        expect(screen.getByTestId("role-component-editor")).toHaveTextContent("Legacy Manager a");

        await user.click(screen.getByTestId("role-component-editor"));

        expect(onCellChange).toHaveBeenCalledWith("a", "role", "Principal");
    });

    it("cancels on Escape (no onCellChange call)", async () => {
        const user = userEvent.setup();
        const onCellChange = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={onCellChange}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        await user.clear(input);
        await user.type(input, "Changed{Escape}");

        expect(onCellChange).not.toHaveBeenCalled();
        expect(screen.queryByDisplayValue("Changed")).not.toBeInTheDocument();
    });

    it("does not start edit on cells without edit config", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => true}
            />,
        );

        // "name" column has no edit config → click does nothing.
        await user.click(screen.getByText("Alice"));
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("shows an error message when onCellChange returns a string", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => "Too short"}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        // Change the value before submit — the no-op-skip path otherwise
        // cancels the edit without firing onCellChange.
        await user.clear(input);
        await user.type(input, "Lead{Enter}");

        const alert = await screen.findByRole("alert");
        expect(alert).toHaveTextContent("Too short");
        expect(alert.closest("td")).toHaveTextContent("Lead");
    });

    it("keeps the draft visible when onCellChange returns an explicit validation error", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => ({ error: "Use a longer title" })}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        await user.clear(input);
        await user.type(input, "Lead{Enter}");

        const alert = await screen.findByRole("alert");
        const cell = alert.closest("td");
        expect(alert).toHaveTextContent("Use a longer title");
        expect(cell).toHaveAttribute("data-cell-state", "error");
        expect(cell).toHaveTextContent("Lead");
        expect(cell).not.toHaveTextContent("Manager");
    });

    it("reverts the draft and shows the engine reason when onCellChange is refused", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => ({ refused: "The engine locked this record" })}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        await user.clear(input);
        await user.type(input, "Director{Enter}");

        const reason = await screen.findByText("The engine locked this record");
        const cell = reason.closest("td");
        expect(cell).toHaveAttribute("data-cell-state", "refused");
        expect(cell).toHaveTextContent("Manager");
        expect(cell).not.toHaveTextContent("Director");
    });

    it("surfaces a conflict result without treating it as success", async () => {
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={() => ({ conflict: "Another user changed this field" })}
            />,
        );

        await user.click(screen.getByText("Manager"));
        const input = screen.getByDisplayValue("Manager");
        await user.clear(input);
        await user.type(input, "Director{Enter}");

        const reason = await screen.findByText("Another user changed this field");
        expect(reason.closest("td")).toHaveAttribute("data-cell-state", "conflict");
    });

    it("skips onCellChange when the value didn't change (blur with no edit)", async () => {
        const user = userEvent.setup();
        const onCellChange = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={editCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={onCellChange}
            />,
        );

        await user.click(screen.getByText("Manager"));
        // Press Enter without changing the value — no save should fire.
        await user.keyboard("{Enter}");
        expect(onCellChange).not.toHaveBeenCalled();
    });

    it("renders navigateTo cells as links and reserves edit for the pencil", async () => {
        const user = userEvent.setup();
        const onCellChange = vi.fn();
        const onRowClick = vi.fn();
        const navCols: MicroColumn<Row>[] = [
            {
                id: "name",
                header: "Name",
                accessor: "name",
                edit: { kind: "text" },
                navigateTo: (row) => `/dashboard/people/${row.id}`,
            },
            { id: "role", header: "Role", accessor: "role", edit: { kind: "text" } },
        ];

        render(
            <MicroGrid
                rows={ROWS}
                columns={navCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onCellChange={onCellChange}
                onRowClick={onRowClick}
            />,
        );

        const link = screen.getByRole("link", { name: "Alice" });
        expect(link).toHaveAttribute("href", "/dashboard/people/a");
        link.addEventListener("click", (event) => event.preventDefault());

        await user.click(link);
        expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
        expect(onRowClick).not.toHaveBeenCalled();

        await user.click(screen.getAllByRole("button", { name: "עריכה" })[0]);
        expect(screen.getByDisplayValue("Alice")).toBeInTheDocument();
        expect(onRowClick).not.toHaveBeenCalled();

        await user.keyboard("{Escape}");
        await user.click(screen.getByText("Manager"));
        expect(screen.getByDisplayValue("Manager")).toBeInTheDocument();
    });
});

// ─── Row actions ───────────────────────────────────────────────────────

describe("MicroGrid · row actions", () => {
    const actions = (onEdit = vi.fn(), onDelete = vi.fn()): MicroRowAction<Row>[] => [
        { id: "edit", label: "Edit", icon: <span>✎</span>, onClick: onEdit },
        {
            id: "delete",
            label: "Delete",
            icon: <span>🗑</span>,
            variant: "destructive",
            confirm: { question: "Delete this row?", cancel: "Keep", confirm: "Confirm delete" },
            onClick: onDelete,
        },
    ];

    it("renders action buttons with aria-label", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={actions()}
            />,
        );

        // 3 rows × 2 actions = 6 buttons.
        expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(3);
        expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(3);
    });

    it("invokes non-destructive action immediately on click", async () => {
        const user = userEvent.setup();
        const onEdit = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={actions(onEdit)}
            />,
        );

        await user.click(screen.getAllByRole("button", { name: "Edit" })[0]);
        expect(onEdit).toHaveBeenCalledWith(ROWS[0]);
    });

    it("an action with confirm shows all three supplied strings before firing", async () => {
        const user = userEvent.setup();
        const onDelete = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={actions(undefined, onDelete)}
            />,
        );

        await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
        // onClick NOT called yet
        expect(onDelete).not.toHaveBeenCalled();

        expect(screen.getByText("Delete this row?")).toBeInTheDocument();
        expect(screen.getByRole("button", { name: "Keep" })).toBeInTheDocument();
        expect(screen.queryByRole("button", { name: "מחק" })).not.toBeInTheDocument();

        const confirmBtn = screen.getByRole("button", { name: "Confirm delete" });
        await user.click(confirmBtn);
        expect(onDelete).toHaveBeenCalledWith(ROWS[0]);
    });

    it("confirm cancel returns to actions without firing", async () => {
        const user = userEvent.setup();
        const onDelete = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={actions(undefined, onDelete)}
            />,
        );

        await user.click(screen.getAllByRole("button", { name: "Delete" })[0]);
        const cancelBtn = screen.getByRole("button", { name: "Keep" });
        await user.click(cancelBtn);

        expect(onDelete).not.toHaveBeenCalled();
        expect(screen.queryByText("Delete this row?")).not.toBeInTheDocument();
    });

    it("opens confirm for a non-destructive action when confirm is supplied", async () => {
        const user = userEvent.setup();
        const onDetach = vi.fn();
        const detach: MicroRowAction<Row> = {
            id: "detach",
            label: "Detach",
            confirm: { question: "לנתק?", cancel: "בטל", confirm: "נתק" },
            onClick: onDetach,
        };
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={[detach]}
            />,
        );

        await user.click(screen.getAllByRole("button", { name: "Detach" })[0]);
        expect(onDetach).not.toHaveBeenCalled();
        expect(screen.getByText("לנתק?")).toBeInTheDocument();
        await user.click(screen.getByRole("button", { name: "נתק" }));
        expect(onDetach).toHaveBeenCalledWith(ROWS[0]);
    });

    it("invokes a destructive action immediately when it has no confirm", async () => {
        const user = userEvent.setup();
        const onArchive = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={[
                    {
                        id: "archive",
                        label: "Archive",
                        variant: "destructive",
                        onClick: onArchive,
                    },
                ]}
            />,
        );

        await user.click(screen.getAllByRole("button", { name: "Archive" })[0]);
        expect(onArchive).toHaveBeenCalledWith(ROWS[0]);
    });

    it("respects `show` predicate", () => {
        const acts: MicroRowAction<Row>[] = [
            { id: "edit", label: "Edit", show: (r) => r.id === "a", onClick: vi.fn() },
        ];
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                rowActions={acts}
            />,
        );

        // Only Alice's row should have the action.
        expect(screen.getAllByRole("button", { name: "Edit" })).toHaveLength(1);
    });
});

// ─── Mobile cards ──────────────────────────────────────────────────────

describe("MicroGrid · mobile cards", () => {
    it("renders <ul> instead of <table> when forceMobile", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="people"
                forceMobile
            />,
        );

        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.getByRole("list", { name: "people" })).toBeInTheDocument();
    });

    it("uses the isCardTitle column as the card heading", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
            />,
        );

        const cards = screen.getAllByRole("article");
        expect(within(cards[0]).getByText("Alice")).toBeInTheDocument();
    });

    it("omits hideOnMobile columns from the detail grid", () => {
        const cols: MicroColumn<Row>[] = [
            { id: "name", header: "Name", accessor: "name", isCardTitle: true },
            { id: "role", header: "Role", accessor: "role" },
            { id: "age", header: "Age", accessor: "age", hideOnMobile: true },
        ];
        render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
            />,
        );

        // "Age" header should NOT appear as a dt.
        const dts = screen.queryAllByText("Age");
        expect(dts).toHaveLength(0);
    });

    it("keeps hook-using cell renderers scoped when mobile row count changes", () => {
        function HookCell(row: Row) {
            const [rendered] = useState(row.name);
            return <span>{rendered}</span>;
        }
        const cols: MicroColumn<Row>[] = [
            { id: "name", header: "Name", accessor: "name", isCardTitle: true, cell: HookCell },
            { id: "role", header: "Role", accessor: "role", cell: HookCell },
        ];
        const { rerender } = render(
            <MicroGrid
                rows={ROWS}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
            />,
        );

        rerender(
            <MicroGrid
                rows={ROWS.slice(0, 1)}
                columns={cols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
            />,
        );

        expect(screen.getByRole("article")).toHaveTextContent("Alice");
    });

    it("opens row actions and uses the shared confirm flow in the mobile card layout", async () => {
        const user = userEvent.setup();
        const onDetach = vi.fn();
        const onRowClick = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
                onRowClick={onRowClick}
                rowActions={[
                    {
                        id: "detach",
                        label: "Detach",
                        confirm: { question: "לנתק?", cancel: "בטל", confirm: "נתק" },
                        onClick: onDetach,
                    },
                ]}
            />,
        );

        const firstCard = screen.getAllByRole("article")[0];
        await user.click(within(firstCard).getByRole("button", { name: "פעולות" }));
        await user.click(within(firstCard).getByRole("menuitem", { name: "Detach" }));

        expect(onDetach).not.toHaveBeenCalled();
        expect(onRowClick).not.toHaveBeenCalled();
        expect(within(firstCard).getByText("לנתק?")).toBeInTheDocument();

        await user.click(within(firstCard).getByRole("button", { name: "נתק" }));
        expect(onDetach).toHaveBeenCalledWith(ROWS[0]);
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it("opens row actions in the responsive mobile card layout", async () => {
        const user = userEvent.setup();
        const onInspect = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                responsiveGroups={[
                    {
                        id: "person",
                        layout: "stack",
                        primaryField: "name",
                        fields: [{ field: "name", slot: "title" }],
                    },
                ]}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceMobile
                rowActions={[{ id: "inspect", label: "Inspect", onClick: onInspect }]}
            />,
        );

        const firstCard = screen.getAllByRole("article")[0];
        await user.click(within(firstCard).getByRole("button", { name: "פעולות" }));
        await user.click(within(firstCard).getByRole("menuitem", { name: "Inspect" }));

        expect(onInspect).toHaveBeenCalledWith(ROWS[0]);
    });
});

// ─── Narrow columns (dual layout) ──────────────────────────────────────

describe("MicroGrid · narrowColumns", () => {
    const wideCols: MicroColumn<Row>[] = [
        { id: "name", header: "Name", accessor: "name" },
        { id: "role", header: "Role", accessor: "role" },
        { id: "age", header: "Age", accessor: "age" },
    ];
    const narrowCols: MicroColumn<Row>[] = [
        {
            id: "person",
            header: "Person",
            accessor: (r) => `${r.name} ${r.role}`,
            cell: (r) => <span data-testid="composite">{`${r.name} · ${r.role}`}</span>,
        },
        { id: "age", header: "Age", accessor: "age" },
    ];

    it("uses wide columns by default (no forceNarrow)", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={wideCols}
                narrowColumns={narrowCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        // Wide layout exposes Role as its own header.
        expect(screen.getByRole("columnheader", { name: /role/i })).toBeInTheDocument();
        expect(screen.queryByTestId("composite")).not.toBeInTheDocument();
    });

    it("swaps to narrow columns when forceNarrow is set", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={wideCols}
                narrowColumns={narrowCols}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceNarrow
            />,
        );
        // Narrow layout: composite cell renders, Role header is gone.
        expect(screen.getAllByTestId("composite")).toHaveLength(ROWS.length);
        expect(screen.queryByRole("columnheader", { name: /role/i })).not.toBeInTheDocument();
    });

    it("falls back to wide columns when narrowColumns is empty", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={wideCols}
                narrowColumns={[]}
                getRowId={(r) => r.id}
                ariaLabel="t"
                forceNarrow
            />,
        );
        // Empty narrowColumns should NOT take over.
        expect(screen.getByRole("columnheader", { name: /role/i })).toBeInTheDocument();
    });
});

// ─── A11y ──────────────────────────────────────────────────────────────

describe("MicroGrid · a11y", () => {
    it("sets aria-selected on selected rows", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
                selectedIds={["b"]}
                onSelectionChange={vi.fn()}
            />,
        );

        const rows = screen.getAllByRole("row");
        // rows[0] = header; rows[1] = Alice (not selected); rows[2] = Bob (selected); rows[3] = Carol
        expect(rows[2]).toHaveAttribute("aria-selected", "true");
        expect(rows[1]).not.toHaveAttribute("aria-selected");
    });
});

// ─── Navigable cells + split-preview ───────────────────────────────────

describe("MicroGrid · navigable name link", () => {
    const NAV_COLS: MicroColumn<Row>[] = [
        { id: "name", header: "Name", accessor: "name", navigateTo: (r) => `/people/${r.id}` },
        { id: "role", header: "Role", accessor: "role" },
    ];

    it("renders the name as a link with the navigateTo href", () => {
        render(<MicroGrid rows={ROWS} columns={NAV_COLS} getRowId={(r) => r.id} ariaLabel="t" />);
        expect(screen.getByRole("link", { name: "Alice" })).toHaveAttribute("href", "/people/a");
    });

    it("plain click navigates (does NOT fire onRowClick) when previewOnNavigableClick is off", async () => {
        const onRowClick = vi.fn();
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={NAV_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onRowClick={onRowClick}
            />,
        );
        await user.click(screen.getByRole("link", { name: "Bob" }));
        expect(onRowClick).not.toHaveBeenCalled();
    });

    it("plain click opens the side panel (fires onRowClick) when previewOnNavigableClick is on", async () => {
        const onRowClick = vi.fn();
        const user = userEvent.setup();
        render(
            <MicroGrid
                rows={ROWS}
                columns={NAV_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onRowClick={onRowClick}
                previewOnNavigableClick
            />,
        );
        await user.click(screen.getByRole("link", { name: "Carol" }));
        expect(onRowClick).toHaveBeenCalledTimes(1);
        expect(onRowClick).toHaveBeenCalledWith(ROWS[2]);
    });

    it("marks the active row (split-preview) with aria-current, distinct from selection", () => {
        render(
            <MicroGrid
                rows={ROWS}
                columns={BASIC_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
                selectedIds={["a"]}
                onSelectionChange={vi.fn()}
                activeRowId="b"
            />,
        );
        const rows = screen.getAllByRole("row");
        // rows[1]=Alice (selected, not active), rows[2]=Bob (active), rows[3]=Carol
        expect(rows[2]).toHaveAttribute("aria-current", "true");
        expect(rows[1]).not.toHaveAttribute("aria-current");
        expect(rows[3]).not.toHaveAttribute("aria-current");
        // active and selection are independent signals
        expect(rows[1]).toHaveAttribute("aria-selected", "true");
        expect(rows[2]).not.toHaveAttribute("aria-selected");
    });

    it("marks no row active when activeRowId is null", () => {
        render(
            <MicroGrid rows={ROWS} columns={BASIC_COLS} getRowId={(r) => r.id} ariaLabel="t" activeRowId={null} />,
        );
        for (const row of screen.getAllByTestId("grid-row")) {
            expect(row).not.toHaveAttribute("aria-current");
        }
    });

    it("modifier (cmd/ctrl) click still navigates even when previewOnNavigableClick is on", () => {
        const onRowClick = vi.fn();
        render(
            <MicroGrid
                rows={ROWS}
                columns={NAV_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onRowClick={onRowClick}
                previewOnNavigableClick
            />,
        );
        // Modifier click → let the browser follow the link (full-page / new tab).
        fireEvent.click(screen.getByRole("link", { name: "Alice" }), { metaKey: true });
        expect(onRowClick).not.toHaveBeenCalled();
    });
});

// ─── The design handoff: GRID_AND_FILTERS §3, §4, §10 ──────────────────
// These lock the parts of the grid look that were bugs before they were rules — every one of them
// is listed in the handoff's "do not reintroduce" section.

interface SparseRow {
    id: string;
    name: string;
    city: string | null;
    junk?: boolean;
}

const SPARSE_ROWS: SparseRow[] = [
    { id: "a", name: "Alice", city: "חיפה" },
    { id: "b", name: "noreply@mailer.example", city: null, junk: true },
];

const PINNED_COLS: MicroColumn<SparseRow>[] = [
    { id: "name", header: "שם", accessor: "name", width: 248, pinned: "start" },
    { id: "city", header: "עיר", accessor: "city", width: 112 },
];

const cellsOf = (row: HTMLElement) => within(row).getAllByRole("cell");

describe("MicroGrid · handoff design", () => {
    it("§3 renders an em-dash for an empty value instead of an empty cell", () => {
        render(
            <MicroGrid rows={SPARSE_ROWS} columns={PINNED_COLS} getRowId={(r) => r.id} ariaLabel="t" />,
        );
        const [, junkRow] = screen.getAllByTestId("grid-row");
        expect(within(junkRow).getByText("—")).toBeInTheDocument();
    });

    it("§3 honours noEmptyDash for columns whose blank state is meaningful", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={[PINNED_COLS[0], { ...PINNED_COLS[1], noEmptyDash: true }]}
                getRowId={(r) => r.id}
                ariaLabel="t"
            />,
        );
        expect(screen.queryByText("—")).not.toBeInTheDocument();
    });

    it("§3 paints a toned row from --mg-row-bg so the frozen cells follow it", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                getRowTone={(r) => (r.junk ? "muted" : undefined)}
            />,
        );
        const [plain, junk] = screen.getAllByTestId("grid-row");
        expect(junk).toHaveAttribute("data-row-tone", "muted");
        expect(plain).not.toHaveAttribute("data-row-tone");
        expect(junk.style.getPropertyValue("--mg-row-bg")).toContain("--surface-2");
        expect(plain.style.getPropertyValue("--mg-row-bg")).toBe("var(--card)");
    });

    it("§4b selection and the active marker outrank the tone, and both stay opaque", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
                selectedIds={["b"]}
                activeRowId="a"
                getRowTone={() => "muted"}
            />,
        );
        const [active, selected] = screen.getAllByTestId("grid-row");
        // Mixed against --card, never against transparent: a translucent row lets horizontally
        // scrolled content show through the frozen columns.
        expect(active.style.getPropertyValue("--mg-row-bg")).toContain("var(--card)");
        expect(selected.style.getPropertyValue("--mg-row-bg")).toContain("var(--card)");
        expect(active.style.getPropertyValue("--mg-row-bg")).toContain("16%");
        expect(selected.style.getPropertyValue("--mg-row-bg")).toContain("10%");
    });

    it("§4b frozen body cells paint from the row's --mg-row-bg, not their own colour", () => {
        render(
            <MicroGrid rows={SPARSE_ROWS} columns={PINNED_COLS} getRowId={(r) => r.id} ariaLabel="t" />,
        );
        const pinned = cellsOf(screen.getAllByTestId("grid-row")[0])[0];
        expect(pinned.style.position).toBe("sticky");
        expect(pinned.style.background).toContain("--mg-row-bg");
        // …with the hover tint taking precedence over it, in the same declaration.
        expect(pinned.style.background).toContain("--mg-row-tint");
    });

    it("§4b hover writes a property the inline row style does not, or it could never win", () => {
        // An inline declaration outranks any non-!important stylesheet rule. If hover and the row's
        // base background were the same custom property, the `:hover` rule would be dead on arrival
        // and row hover would silently stop working. Keep them separate.
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                onRowClick={() => {}}
            />,
        );
        const row = screen.getAllByTestId("grid-row")[0];
        expect(row.className).toContain("hover:[--mg-row-tint:");
        expect(row.style.getPropertyValue("--mg-row-tint")).toBe("");
        expect(row.style.getPropertyValue("--mg-row-bg")).not.toBe("");
    });

    it("§4a the selection column freezes together with the pinned group", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
            />,
        );
        const [checkbox, name] = cellsOf(screen.getAllByTestId("grid-row")[0]);
        expect(checkbox.style.position).toBe("sticky");
        expect(checkbox.style.insetInlineStart).toBe("0");
        expect(name.style.position).toBe("sticky");
        expect(name.style.insetInlineStart).toBe("40px");
    });

    it("§4a an unpinned grid leaves the selection column static", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS.map(({ pinned: _pinned, ...c }) => c)}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
            />,
        );
        expect(cellsOf(screen.getAllByTestId("grid-row")[0])[0].style.position).toBe("");
    });

    it("§4c the frozen header corner sits above the frozen body cells", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
            />,
        );
        const headerPin = screen.getAllByRole("columnheader")[1];
        const bodyPin = cellsOf(screen.getAllByTestId("grid-row")[0])[1];
        expect(Number(headerPin.style.zIndex)).toBeGreaterThan(Number(bodyPin.style.zIndex));
    });

    it("§4b the active-row ring is inherited by every cell, frozen ones included", () => {
        // A box-shadow on the <tr> is painted under the frozen cells and gets sliced off at the
        // frozen boundary — the marked row looks broken exactly when the user scrolls sideways.
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
                activeRowId="a"
            />,
        );
        const [active, plain] = screen.getAllByTestId("grid-row");
        expect(active.style.getPropertyValue("--mg-row-ring")).toContain("var(--primary)");
        expect(plain.style.getPropertyValue("--mg-row-ring")).toBe("");
        for (const cell of cellsOf(active)) {
            expect(cell.style.boxShadow).toContain("--mg-row-ring");
        }
    });

    it("§1 the header is a sunken band at 700, with no case transform", () => {
        render(
            <MicroGrid rows={SPARSE_ROWS} columns={PINNED_COLS} getRowId={(r) => r.id} ariaLabel="t" />,
        );
        const header = screen.getAllByRole("columnheader")[0];
        expect(header.style.background).toContain("--surface-sunken");
        expect(header.style.fontSize).toContain("--fs-sm");
        expect(header.className).toContain("font-bold");
        expect(header.className).toContain("normal-case");
        expect(header.className).not.toContain("uppercase");
    });

    it("§3 row height follows the host's --rowh token", () => {
        render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                density="compact"
            />,
        );
        expect(screen.getAllByTestId("grid-row")[0].style.height).toBe("var(--rowh, 32px)");
    });

    it("§11 skeleton rows keep the frozen columns sticky so the layout does not jump", () => {
        const { container } = render(
            <MicroGrid
                rows={SPARSE_ROWS}
                columns={PINNED_COLS}
                getRowId={(r) => r.id}
                ariaLabel="t"
                selection="multi"
                loading
            />,
        );
        const firstSkeletonCell = container.querySelector("tbody tr td") as HTMLElement;
        expect(firstSkeletonCell.style.position).toBe("sticky");
    });
});
