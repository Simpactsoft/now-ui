import { describe, expect, it } from "vitest";
import { bucketRows } from "../src/grid";

interface Row {
    id: string;
    status: string | null;
}

describe("bucketRows", () => {
    it("sorts buckets alphabetically by label", () => {
        const rows: Row[] = [
            { id: "1", status: "beta" },
            { id: "2", status: "alpha" },
            { id: "3", status: "gamma" },
        ];

        const groups = bucketRows(rows, "status");

        expect(groups.map((group) => group.label)).toEqual(["Alpha", "Beta", "Gamma"]);
        expect(groups.map((group) => group.key)).toEqual(["alpha", "beta", "gamma"]);
    });

    it("places the null bucket last", () => {
        const rows: Row[] = [
            { id: "1", status: null },
            { id: "2", status: "active" },
            { id: "3", status: "" },
            { id: "4", status: "lead" },
        ];

        const groups = bucketRows(rows, "status");

        expect(groups.map((group) => group.key)).toEqual(["active", "lead", "__null__"]);
        expect(groups.at(-1)).toMatchObject({
            key: "__null__",
            label: "ללא ערך",
            rows: [rows[0], rows[2]],
        });
    });

    it("preserves incoming row order inside each bucket", () => {
        const rows: Row[] = [
            { id: "1", status: "active" },
            { id: "2", status: "lead" },
            { id: "3", status: "active" },
            { id: "4", status: "active" },
        ];

        const groups = bucketRows(rows, "status");
        const active = groups.find((group) => group.key === "active");

        expect(active?.rows.map((row) => row.id)).toEqual(["1", "3", "4"]);
    });
});
