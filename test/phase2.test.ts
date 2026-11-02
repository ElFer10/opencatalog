import { describe, expect, it } from "vitest";
import {
  applyFieldSettings,
  cacheFileName,
  createDataSource,
  diffSources,
  evaluate,
  formatDate,
  formatFieldValue,
  formatNumber,
  gridOffsets,
  imageUrlsFor,
  parse,
  parseFieldText,
  planUpdateDocument,
  planUpdatePanel,
  resolveImage,
  retargetEncoded,
  encodeLink,
  validateExpression,
} from "../src/core";
import { MemoryDocument } from "../src/hosts/memory-document";

const ev = (src: string, values: Record<string, string | number | boolean | null> = {}) =>
  evaluate(parse(src), (n) => (n in values ? values[n]! : undefined));

describe("number and date formats", () => {
  it("formats numbers", () => {
    expect(formatNumber(1234567.891, ",", 2, " ")).toBe("1 234 567,89");
    expect(formatNumber(4.5, ".", 2)).toBe("4.50");
    expect(formatNumber(-1234, ",", undefined, ".")).toBe("-1.234");
    expect(formatNumber(0.1 + 0.2, ".", 2)).toBe("0.30");
  });
  it("formats dates", () => {
    expect(formatDate("2026-03-01", "DD.MM.YYYY")).toBe("01.03.2026");
    expect(formatDate("2026-03-01T14:30:00", "D/M/YY HH:mm")).toBe("1/3/26 14:30");
    expect(formatDate("2026-03-01", "D MMMM YYYY", "en-US")).toBe("1 March 2026");
    expect(formatDate("not a date", "YYYY")).toBe("not a date");
  });
  it("applies a field format and reverses it", () => {
    const ds = { decimalSeparator: "," as const };
    const price = { name: "Price", type: "number" as const, format: { decimals: 2, thousands: " ", suffix: " kr" } };
    expect(formatFieldValue(1299.5, price, ds)).toBe("1 299,50 kr");
    expect(parseFieldText("1 349,00 kr", price, ds)).toBe(1349);
    const name = { name: "Name", type: "text" as const, format: { case: "upper" as const, prefix: "» " } };
    expect(formatFieldValue("café", name, ds)).toBe("» CAFÉ");
    expect(formatFieldValue(null, { ...name, format: { empty: "—" } }, ds)).toBe("—");
    const title = { name: "N", type: "text" as const, format: { case: "title" as const } };
    expect(formatFieldValue("olive oil extra-virgin", title, ds)).toBe("Olive Oil Extra-Virgin");
  });
});

describe("expressions", () => {
  it("computes arithmetic, text and logic", () => {
    expect(ev("{Price} * 1.25", { Price: 4 })).toBe(5);
    expect(ev("1 + 2 * 3 - 4 / 2")).toBe(5);
    expect(ev("(1 + 2) * 3")).toBe(9);
    expect(ev('{Name} & " – " & {Unit}', { Name: "Tea", Unit: "100 g" })).toBe("Tea – 100 g");
    expect(ev('if({Stock} > 0, "In stock", "Sold out")', { Stock: 0 })).toBe("Sold out");
    expect(ev("Stock >= 5 and not isempty(Name)", { Stock: 5, Name: "x" })).toBe(true);
    expect(ev("round({Price} * 0.8, 2)", { Price: 4.95 })).toBe(3.96);
    expect(ev('join(", ", {A}, {B}, {C})', { A: "red", B: "", C: "XL" })).toBe("red, XL");
    expect(ev('upper(left("sencha", 3)) & right("abc", 1) & mid("abcdef", 2, 3)')).toBe("SENcbcd");
    expect(ev('replace("a-b-c", "-", "/")')).toBe("a/b/c");
    expect(ev('coalesce({X}, "fallback")', { X: null })).toBe("fallback");
    expect(ev("price.amount + 1", { "price.amount": 2 })).toBe(3);
    expect(ev('"10" = 10')).toBe(true);
    expect(ev("-{a} + 1", { a: 3 })).toBe(-2);
    expect(ev('text(3.14159, 2)')).toBe("3.14");
  });
  it("reports errors", () => {
    expect(() => parse("1 +")).toThrow(/end of expression/);
    expect(() => parse('"open')).toThrow(/Unclosed text/);
    expect(() => ev("{Missing}")).toThrow(/Unknown field/);
    expect(() => ev("nope(1)")).toThrow(/Unknown function/);
    expect(() => ev("1 / 0")).toThrow(/Division by zero/);
    expect(() => ev('"abc" * 2')).toThrow(/not a number/);
    expect(validateExpression("{Price} * 2", ["Price"])).toBeNull();
    expect(validateExpression("{Prize} * 2", ["Price"])).toMatch(/Unknown field "Prize"/);
  });
});

describe("computed fields and settings", () => {
  const base = () => createDataSource("p.csv", "csv", [
    { SKU: "A", Price: 10, Name: "tea" },
    { SKU: "B", Price: "n/a", Name: "coffee" },
  ]);
  it("adds computed fields in order and reports failures", () => {
    const { source, errors } = applyFieldSettings(base(), {
      computed: [
        { name: "VAT", expression: "{Price} * 0.25" },
        { name: "Label", expression: 'upper({Name}) & " " & text({VAT}, 2)' },
        { name: "Broken", expression: "1 +" },
      ],
      formats: { Price: { suffix: " kr" } },
    });
    expect(source.fields.map((f) => f.name)).toEqual(["SKU", "Price", "Name", "VAT", "Label", "Broken"]);
    expect(source.records[0]!.values["Label"]).toBe("TEA 2.50");
    expect(source.records[1]!.values["VAT"]).toBeNull();
    expect(source.fields.find((f) => f.name === "Price")!.format).toEqual({ suffix: " kr" });
    // Label for B uses an empty VAT, which is not an error: text() of an empty value is "".
    expect(errors.map((e) => [e.field, e.count])).toEqual([["VAT", 1], ["Broken", 2]]);
    expect(source.records[1]!.values["Label"]).toBe("COFFEE ");
  });
  it("refuses computed names that clash with data fields; reapplying replaces old computed fields", () => {
    const first = applyFieldSettings(base(), { computed: [{ name: "Price", expression: "1" }, { name: "X", expression: "1" }] });
    expect(first.errors[0]!.message).toMatch(/already a data field/);
    const again = applyFieldSettings(first.source, { computed: [{ name: "Y", expression: "2" }] });
    expect(again.source.fields.map((f) => f.name)).toEqual(["SKU", "Price", "Name", "Y"]);
  });
  it("protects computed fields from Update Panel and uses formats in Update Document", () => {
    const { source } = applyFieldSettings(base(), { computed: [{ name: "VAT", expression: "{Price} * 0.25" }], formats: { Price: { suffix: " kr" } } });
    const doc = new MemoryDocument();
    doc.placeText([{ link: { source: source.id, key: "A", field: "VAT" }, text: "9" }, { link: { source: source.id, key: "A", field: "Price" }, text: "10" }]);
    const ctx = new Map([[source.id, { source, images: {} }]]);
    expect(planUpdateDocument(doc.scan(), ctx).changes.map((c) => c.value)).toEqual(["2.5", "10 kr"]);
    const panel = planUpdatePanel(doc.scan(), source);
    expect(panel.conflicts[0]!.message).toMatch(/computed field/);
  });
});

describe("synchronize diff", () => {
  it("finds new, changed and removed records and fields", () => {
    const a = createDataSource("p.csv", "csv", [{ SKU: "A", P: 1, Old: 1 }, { SKU: "B", P: 2, Old: 1 }, { SKU: "C", P: 3, Old: 1 }]);
    const b = createDataSource("p.csv", "csv", [{ SKU: "A", P: 1, New: 1 }, { SKU: "C", P: 4, New: 1 }, { SKU: "D", P: 5, New: 1 }]);
    const d = diffSources(a, b);
    expect(d.added).toEqual(["D"]);
    expect(d.removed).toEqual(["B"]);
    expect([...d.changed]).toEqual([["C", ["P"]]]);
    expect(d.addedFields).toEqual(["New"]);
    expect(d.removedFields).toEqual(["Old"]);
  });
});

describe("image URLs", () => {
  it("uses downloaded copies and names cache files stably", () => {
    const url = "https://cdn.example.com/img/tea.PNG?w=800";
    expect(resolveImage(url, {}).ok).toBe(false);
    expect(resolveImage(url, { downloaded: new Map([[url, "/cache/x.png"]]) })).toEqual({ ok: true, path: "/cache/x.png" });
    expect(cacheFileName(url)).toBe(cacheFileName(url));
    expect(cacheFileName(url)).toMatch(/^[0-9a-f]{8}-\d+\.png$/);
    expect(cacheFileName("https://x/a")).toMatch(/\.jpg$/);
  });
  it("lists URLs needed by image links", () => {
    const ds = createDataSource("p.csv", "csv", [{ SKU: "A", Img: "https://x/a.jpg" }, { SKU: "B", Img: "b.jpg" }]);
    const doc = new MemoryDocument();
    doc.placeImage({ source: ds.id, key: "A", field: "Img" }, "/old.jpg");
    doc.selection = null;
    doc.placeImage({ source: ds.id, key: "B", field: "Img" }, "/old.jpg");
    expect(imageUrlsFor(doc.scan(), new Map([[ds.id, { source: ds, images: {} }]]))).toEqual(["https://x/a.jpg"]);
  });
});

describe("tables and repeated layouts", () => {
  const link = (key: string, field: string) => ({ source: "s", key, field });
  it("places a linked table and updates cells", () => {
    const ds = createDataSource("s", "csv", [{ K: "1", N: "Tea" }, { K: "2", N: "Coffee" }], { id: "s" });
    const doc = new MemoryDocument();
    doc.placeTable(["K", "N"], [[{ link: link("1", "K"), text: "1" }, { link: link("1", "N"), text: "old" }], [{ link: link("2", "K"), text: "2" }, { link: link("2", "N"), text: "Coffee" }]]);
    const items = doc.scan();
    expect(items.map((i) => i.kind)).toEqual(["cell", "cell", "cell", "cell"]);
    const plan = planUpdateDocument(items, new Map([["s", { source: ds, images: {} }]]));
    expect(plan.changes.map((c) => c.value)).toEqual(["Tea"]);
  });

  it("computes grid offsets inside the margins", () => {
    // 60×40 block at the top-left of a 186×273 area, gap 6: 2 per row (a third would end at 204 > 198), 6 rows.
    const offs = gridOffsets([12, 12, 52, 72], [12, 12, 285, 198], 20, 6);
    expect(offs.slice(0, 3)).toEqual([[66, 0], [0, 46], [66, 46]]);
    expect(offs).toHaveLength(11); // 2 × 6 slots minus the sample's own
    expect(gridOffsets([12, 12, 52, 72], [12, 12, 285, 198], 2, 6)).toHaveLength(2);
  });

  it("repeats a selected block per record with retargeted links", () => {
    const doc = new MemoryDocument();
    doc.placeText([{ link: link("1", "N"), text: "Tea" }]);
    const text = doc.frames[0]!;
    doc.selection = null;
    doc.placeImage(link("1", "Img"), "/a.jpg");
    const img = doc.frames[1]!;
    doc.selection = { frameId: text.id, more: [img.id] };
    const res = doc.repeatSelection("s", ["1", "2", "3"], 4);
    expect(res).toEqual({ sampleKey: "1", placed: ["2", "3"], notPlaced: [] });
    expect(doc.frames).toHaveLength(6);
    expect(doc.scan().map((i) => `${i.link.key}:${i.link.field}`)).toEqual(["1:N", "1:Img", "2:N", "2:Img", "3:N", "3:Img"]);
    expect(retargetEncoded("plain", "x")).toBe("plain");
    expect(retargetEncoded(encodeLink(link("1", "N")), "9")).toBe(encodeLink(link("9", "N")));
  });

  it("refuses a selection that mixes records", () => {
    const doc = new MemoryDocument();
    doc.placeText([{ link: link("1", "N"), text: "a" }, { link: link("2", "N"), text: "b" }]);
    doc.selection = { frameId: doc.frames[0]!.id };
    expect(() => doc.repeatSelection("s", ["3"], 4)).toThrow(/mixes fields of 2 records/);
  });
});
