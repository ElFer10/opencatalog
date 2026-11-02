import { describe, expect, it } from "vitest";
import {
  SourceContext,
  applyDocumentPlan,
  applyPanelPlan,
  createDataSource,
  decodeLink,
  encodeLink,
  joinPath,
  placeCounts,
  planUpdateDocument,
  planUpdatePanel,
  resolveImage,
  setRecordValue,
} from "../src/core";
import { MemoryDocument } from "../src/hosts/memory-document";
import { toCsv } from "../src/providers";

const source = () =>
  createDataSource("prices.csv", "csv", [
    { SKU: "A1", Name: "Coffee", Price: 4.95, Image: "coffee.jpg" },
    { SKU: "B2", Name: "Tea\nGreen", Price: 3.5, Image: "tea.jpg" },
  ], { decimalSeparator: "," });

const ctx = (ds = source()): Map<string, SourceContext> => new Map([[ds.id, { source: ds, images: { dataFolder: "/data" } }]]);
const link = (key: string, field: string) => ({ source: "csv:prices.csv", key, field });

describe("links", () => {
  it("round-trips and rejects junk", () => {
    expect(decodeLink(encodeLink(link("A1", "Name")))).toEqual(link("A1", "Name"));
    expect(decodeLink("nope")).toBeNull();
    expect(decodeLink('{"v":2,"s":"a","k":"b","f":"c"}')).toBeNull();
  });
});

describe("images", () => {
  it("resolves relative, absolute and unsupported paths", () => {
    expect(resolveImage("img/a.jpg", { dataFolder: "/Users/fer/data/" })).toEqual({ ok: true, path: "/Users/fer/data/img/a.jpg" });
    expect(resolveImage("a.jpg", { imageFolder: "C:\\cat", dataFolder: "/x" })).toEqual({ ok: true, path: "C:\\cat\\a.jpg" });
    expect(resolveImage("/abs/a.png", {})).toEqual({ ok: true, path: "/abs/a.png" });
    expect(resolveImage("a.jpg", {}).ok).toBe(false);
    expect(resolveImage("https://x/a.jpg", { dataFolder: "/d" }).ok).toBe(false);
    expect(joinPath("/a/", "./b/c.jpg")).toBe("/a/b/c.jpg");
  });
});

describe("placing and updating the document", () => {
  it("places fields with the source's decimal separator and paragraph breaks", () => {
    const doc = new MemoryDocument();
    const text = doc.addFrame("text", "Price: ");
    doc.selection = { frameId: text.id, offset: 7 };
    expect(doc.placeText([{ link: link("A1", "Price"), text: "4,95" }]).target).toBe("insertion-point");
    expect(MemoryDocument.storyText(text)).toBe("Price: 4,95");
    doc.selection = null;
    expect(doc.placeText([{ link: link("A1", "Name"), text: "Coffee" }, { link: link("A1", "Price"), text: "4,95" }]).target).toBe("new-frame");
    expect(doc.scan().map((i) => i.kind)).toEqual(["inline-text", "inline-text", "inline-text"]);
    doc.selection = null;
    doc.placeText([{ link: link("A1", "Name"), text: "Coffee" }]);
    expect(doc.scan().at(-1)!.kind).toBe("frame-text");
  });

  it("plans and applies Update Document", () => {
    const doc = new MemoryDocument();
    doc.placeText([{ link: link("A1", "Price"), text: "4,00" }]);
    doc.selection = null;
    doc.placeText([{ link: link("B2", "Name"), text: "Tea\rGreen" }]);
    doc.selection = null;
    doc.placeText([{ link: link("Z9", "Name"), text: "Gone" }]);
    doc.selection = null;
    doc.placeImage(link("A1", "Image"), "/old/coffee.jpg");
    doc.selection = null;
    doc.placeText([{ link: { source: "csv:other.csv", key: "1", field: "x" }, text: "x" }]);

    const plan = planUpdateDocument(doc.scan(), ctx());
    expect(plan.changes.map((c) => c.value)).toEqual(["4,95", "/data/coffee.jpg"]);
    expect(plan.unchanged).toBe(1); // "Tea\rGreen" equals "Tea\nGreen"
    expect(plan.errors.map((e) => e.message)).toEqual(['Record "Z9" no longer exists in prices.csv']);
    expect(plan.otherSources).toBe(1);

    const res = applyDocumentPlan(doc, plan);
    expect(res.updated).toBe(2);
    expect(doc.undoSteps).toEqual(["OpenCatalog: Update document"]);
    expect(planUpdateDocument(doc.scan(), ctx()).changes).toEqual([]);
  });

  it("limits updates to selected keys and reports apply failures", () => {
    const doc = new MemoryDocument();
    doc.existingFiles.add("/data/tea.jpg");
    doc.placeImage(link("A1", "Image"), "/data/tea.jpg");
    doc.selection = null;
    doc.placeImage(link("B2", "Image"), "/data/tea.jpg");
    const ds = setRecordValue(source(), "B2", "Image", "missing.jpg");
    expect(planUpdateDocument(doc.scan(), ctx(ds), { keys: new Set(["A1"]) }).changes).toHaveLength(1);
    const res = applyDocumentPlan(doc, planUpdateDocument(doc.scan(), ctx(ds)));
    expect(res.updated).toBe(0);
    expect(res.errors.map((e) => e.message)).toEqual(["A1 · Image: File not found: /data/coffee.jpg", "B2 · Image: File not found: /data/missing.jpg"]);
  });

  it("counts placements per record", () => {
    const doc = new MemoryDocument();
    doc.placeText([{ link: link("A1", "Name"), text: "Coffee" }, { link: link("A1", "Price"), text: "4,95" }]);
    expect(placeCounts(doc.scan(), "csv:prices.csv")).toEqual(new Map([["A1", 2]]));
  });
});

describe("Update Panel (document → data)", () => {
  it("collects edits, parses numbers and flags conflicts", () => {
    const doc = new MemoryDocument();
    doc.placeText([
      { link: link("A1", "Price"), text: "4,95" },
      { link: link("A1", "Name"), text: "Coffee" },
      { link: link("B2", "Price"), text: "3,5" },
    ]);
    doc.selection = null;
    doc.placeText([{ link: link("A1", "Name"), text: "Coffee" }]);
    const items = doc.scan();
    doc.editText(items[0]!.ref, "5,25");
    doc.editText(items[1]!.ref, "Dark roast");
    doc.editText(items[2]!.ref, "cheap");
    doc.editText(items[3]!.ref, "Espresso");
    const plan = planUpdatePanel(doc.scan(), source());
    expect(plan.edits.map((e) => [e.recordId, e.field, e.to])).toEqual([["A1", "Price", 5.25]]);
    expect(plan.conflicts.map((c) => c.message)).toEqual([
      '"cheap" is not a valid number for B2 · Price',
      "A1 · Name was edited differently in two places",
    ]);
    const ds = applyPanelPlan(source(), plan);
    expect(ds.records[0]!.values["Price"]).toBe(5.25);
  });
});

describe("csv export", () => {
  it("writes ; with decimal commas and quotes when needed", () => {
    expect(toCsv(source())).toBe('SKU;Name;Price;Image\r\nA1;Coffee;4,95;coffee.jpg\r\nB2;"Tea\nGreen";3,5;tea.jpg\r\n');
  });
});
