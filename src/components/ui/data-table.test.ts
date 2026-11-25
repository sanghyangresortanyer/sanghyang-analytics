import { describe, expect, it } from "vitest";
import { sortRows, type Column } from "./data-table";

type Row = { name: string; value: number | null };
const cols: Column<Row>[] = [
  { key: "name", header: "Nama", sort: (r) => r.name, render: (r) => r.name },
  { key: "value", header: "Nilai", sort: (r) => r.value, render: (r) => String(r.value) },
  { key: "plain", header: "Tanpa urut", render: () => "" },
];
const rows: Row[] = [
  { name: "Bistro", value: 20 },
  { name: "Room", value: null },
  { name: "Adi", value: 50 },
];

describe("sortRows", () => {
  it("sorts numbers both ways and keeps empty values last", () => {
    expect(sortRows(rows, cols, { key: "value", dir: "desc" }).map((r) => r.name)).toEqual(["Adi", "Bistro", "Room"]);
    expect(sortRows(rows, cols, { key: "value", dir: "asc" }).map((r) => r.name)).toEqual(["Bistro", "Adi", "Room"]);
  });

  it("sorts text alphabetically", () => {
    expect(sortRows(rows, cols, { key: "name", dir: "asc" }).map((r) => r.name)).toEqual(["Adi", "Bistro", "Room"]);
  });

  it("leaves the order alone for a column without a sort value", () => {
    expect(sortRows(rows, cols, { key: "plain", dir: "asc" })).toBe(rows);
  });
});
