import { describe, expect, it } from "vitest";
import { buildFlow, createDataSource, gridPositions, groupStarts, planTemplatePagination } from "../src/core";

const area: [number, number, number, number] = [12, 12, 285, 198];

describe("template pagination", () => {
  it("lists all grid positions aligned with the block", () => {
    // 60×40 block in the middle-left of the area, gap 6 → 2 columns × 6 rows
    const pos = gridPositions([58, 12, 98, 72], area, 6);
    expect(pos).toHaveLength(12);
    expect(pos[0]).toEqual([0, -46]);
    expect(pos[2]).toEqual([0, 0]);
  });

  it("starts at the template slot, then fills new pages", () => {
    const keys = Array.from({ length: 30 }, (_, i) => `K${i + 1}`);
    const plan = planTemplatePagination({ block: [58, 12, 98, 72], area, gap: 6, keys });
    expect(plan.pages.map((p) => p.length)).toEqual([10, 12, 8]);
    expect(plan.pages[0]![0]).toEqual({ key: "K1", dx: 0, dy: 0 });
    expect(plan.pages[1]![0]).toEqual({ key: "K11", dx: 0, dy: -46 });
  });

  it("breaks pages before group starts", () => {
    const ds = createDataSource("s", "csv", [
      { K: "1", G: "A" }, { K: "2", G: "A" }, { K: "3", G: "B" }, { K: "4", G: "C" }, { K: "5", G: "C" },
    ]);
    const starts = groupStarts(ds.records, "G");
    expect([...starts]).toEqual(["1", "3", "4"]);
    const plan = planTemplatePagination({ block: [12, 12, 52, 72], area, gap: 6, keys: ds.records.map((r) => r.id), breakBefore: starts });
    expect(plan.pages.map((p) => p.map((s) => s.key))).toEqual([["1", "2"], ["3"], ["4", "5"]]);
  });

  it("rejects templates outside the margins and runaway plans", () => {
    expect(() => planTemplatePagination({ block: [0, 0, 40, 60], area, gap: 6, keys: ["a"] })).toThrow(/inside the page margins/);
    expect(() => planTemplatePagination({ block: [12, 12, 300, 72], area, gap: 6, keys: ["a"] })).toThrow(/does not fit/);
    expect(() => planTemplatePagination({ block: [12, 12, 285, 198], area, gap: 6, keys: ["a", "b", "c"], maxPages: 2 })).toThrow(/stopped at 2 pages/);
  });
});

describe("flow pagination", () => {
  it("builds headings per group level and record paragraphs", () => {
    const ds = createDataSource("s", "csv", [
      { K: "1", Cat: "Drinks", Sub: "Coffee", Name: "Espresso", Price: 7.5 },
      { K: "2", Cat: "Drinks", Sub: "Coffee", Name: "Lungo", Price: 6 },
      { K: "3", Cat: "Drinks", Sub: "Tea", Name: "Sencha", Price: 3.5 },
      { K: "4", Cat: "Oils", Sub: "Tea", Name: "Odd", Price: 1 },
    ], { decimalSeparator: "," });
    const flow = buildFlow(ds, ds.records, { fields: ["Name", "Price"], headings: ["Cat", "Sub"] });
    expect(flow.map((f) => (f.kind === "heading" ? `H${f.level}:${f.text}` : `R:${f.fields.map((x) => x.text).join("|")}`))).toEqual([
      "H0:Drinks", "H1:Coffee", "R:Espresso|7,5", "R:Lungo|6", "H1:Tea", "R:Sencha|3,5", "H0:Oils", "H1:Tea", "R:Odd|1",
    ]);
  });
});

import { MemoryDocument } from "../src/hosts/memory-document";

describe("memory document pagination", () => {
  const link = (key: string, field: string) => ({ source: "s", key, field });
  it("copies the template over new pages and retargets the template to the first record", () => {
    const doc = new MemoryDocument();
    doc.placeText([{ link: link("X", "N"), text: "x" }]); // frame at top-left, 90 × 12
    doc.selection = { frameId: doc.frames[0]!.id };
    const info = doc.templateInfo("s");
    expect(info.sampleKey).toBe("X");
    const keys = Array.from({ length: 40 }, (_, i) => `K${i + 1}`);
    const plan = planTemplatePagination({ block: info.block, area: info.area, gap: 4, keys });
    const res = doc.paginateTemplate(plan);
    expect(doc.scan().map((i) => i.link.key)).toEqual(keys);
    expect(res.pagesAdded).toBe(plan.pages.length - 1);
    expect(doc.pageCount).toBe(plan.pages.length);
  });

  it("flows records and threads frames onto new pages", () => {
    const ds = createDataSource("s", "csv", Array.from({ length: 100 }, (_, i) => ({ K: `K${i}`, G: i < 50 ? "A" : "B", N: `Item ${i}` })), { id: "s" });
    const doc = new MemoryDocument();
    const res = doc.paginateFlow(buildFlow(ds, ds.records, { fields: ["N"], headings: ["G"] }), "paragraph");
    // 102 lines (2 headings + 100 records) at 6 mm per line: 45 lines per full page frame.
    expect(res.pagesAdded).toBe(2);
    expect(doc.scan()).toHaveLength(100);
    const conts = doc.frames.filter((f) => f.thread && f.thread.first !== f.id);
    expect(conts.map((f) => [f.page, f.thread!.from, f.thread!.to])).toEqual([["2", 45, 90], ["3", 90, 102]]);
    expect(doc.exported).toEqual([]);
    doc.exportPdf("/tmp/x.pdf", doc.pdfPresets()[0]!);
    expect(doc.exported[0]!.preset).toBe("[High Quality Print]");
  });
});
