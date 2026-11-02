import { describe, expect, it } from "vitest";
import {
  allGroupKeys,
  applyView,
  createDataSource,
  cycleSort,
  detectKeyField,
  emptyView,
  flattenView,
  inferType,
  withKeyField,
} from "../src/core";

const rows = [
  { SKU: "A-2", Name: "Tea", Category: "Drinks", Price: 3.5, Stock: 10 },
  { SKU: "A-10", Name: "Coffee", Category: "Drinks", Price: 4.95, Stock: 0 },
  { SKU: "B-1", Name: "Olive oil", Category: "Oils", Price: 12, Stock: null },
  { SKU: "C-1", Name: "Salt", Category: "", Price: 1, Stock: 5 },
];
const ds = () => createDataSource("demo.csv", "csv", rows, { now: new Date("2026-11-02T00:00:00Z") });

describe("model", () => {
  it("infers field types", () => {
    expect(inferType([1, 2, null])).toBe("number");
    expect(inferType(["2026-01-01", ""])).toBe("date");
    expect(inferType(["a.jpg", "b.PNG"])).toBe("image");
    expect(inferType([true, false])).toBe("boolean");
    expect(inferType(["1", 2])).toBe("text");
    expect(inferType([null, ""])).toBe("text");
  });

  it("detects a key field, preferring key-like names", () => {
    expect(detectKeyField(["Name", "SKU"], rows)).toBe("SKU");
    expect(detectKeyField(["Category"], rows)).toBeNull();
    expect(ds().records.map((r) => r.id)).toEqual(["A-2", "A-10", "B-1", "C-1"]);
  });

  it("falls back to row ids without a key", () => {
    const s = createDataSource("x", "csv", [{ a: 1 }, { a: 1 }]);
    expect(s.keyField).toBeNull();
    expect(s.records.map((r) => r.id)).toEqual(["#1", "#2"]);
  });

  it("validates a new key field", () => {
    expect(() => withKeyField(ds(), "Category")).toThrow(/duplicate/);
    expect(() => withKeyField(ds(), "Stock")).toThrow(/empty values/);
    expect(withKeyField(ds(), "Name").records[0]!.id).toBe("Tea");
    expect(withKeyField(ds(), null).records[0]!.id).toBe("#1");
  });
});

describe("query", () => {
  it("searches across all fields, all terms required", () => {
    const r = applyView(ds(), { ...emptyView(), search: "drinks cof" });
    expect(r.records.map((x) => x.id)).toEqual(["A-10"]);
  });

  it("filters with all/any modes and numeric comparison", () => {
    const base = { ...emptyView(), filters: [
      { field: "Price", op: "gte" as const, value: "4" },
      { field: "Category", op: "eq" as const, value: "drinks" },
    ] };
    expect(applyView(ds(), base).records.map((x) => x.id)).toEqual(["A-10"]);
    expect(applyView(ds(), { ...base, filterMode: "any" }).records.map((x) => x.id)).toEqual(["A-2", "A-10", "B-1"]);
    expect(applyView(ds(), { ...emptyView(), filters: [{ field: "Stock", op: "empty" }] }).records.map((x) => x.id)).toEqual(["B-1"]);
  });

  it("sorts naturally, keeps empties last and is stable", () => {
    const asc = applyView(ds(), { ...emptyView(), sort: [{ field: "SKU", dir: "asc" }] });
    expect(asc.records.map((x) => x.id)).toEqual(["A-2", "A-10", "B-1", "C-1"]);
    const stock = applyView(ds(), { ...emptyView(), sort: [{ field: "Stock", dir: "desc" }] });
    expect(stock.records.map((x) => x.id)).toEqual(["A-2", "C-1", "A-10", "B-1"]);
  });

  it("groups hierarchically and flattens with collapsed groups", () => {
    const r = applyView(ds(), { ...emptyView(), groupBy: ["Category"], sort: [{ field: "Price", dir: "desc" }] });
    expect(r.groups!.map((g) => [g.value, g.count])).toEqual([["Drinks", 2], ["Oils", 1], [null, 1]]);
    expect(r.groups![0]!.records.map((x) => x.id)).toEqual(["A-10", "A-2"]);
    const rowsOpen = flattenView(r, new Set());
    expect(rowsOpen).toHaveLength(7);
    const collapsed = flattenView(r, new Set([r.groups![0]!.key]));
    expect(collapsed).toHaveLength(5);
    expect(allGroupKeys(r.groups)).toHaveLength(3);
  });

  it("supports nested groups", () => {
    const r = applyView(ds(), { ...emptyView(), groupBy: ["Category", "Stock"] });
    const drinks = r.groups![0]!;
    expect(drinks.children.map((c) => c.value)).toEqual([0, 10]);
    expect(drinks.records).toEqual([]);
  });

  it("cycles sort keys", () => {
    expect(cycleSort([], "a", false)).toEqual([{ field: "a", dir: "asc" }]);
    expect(cycleSort([{ field: "a", dir: "asc" }], "a", false)).toEqual([{ field: "a", dir: "desc" }]);
    expect(cycleSort([{ field: "a", dir: "desc" }], "a", false)).toEqual([]);
    expect(cycleSort([{ field: "a", dir: "asc" }], "b", true)).toEqual([{ field: "a", dir: "asc" }, { field: "b", dir: "asc" }]);
  });
});
