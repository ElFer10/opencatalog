import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { detectDelimiter, loadFromBytes, openXlsx, parseCsv, parseJson } from "../src/providers";
import { coerceNumber, decodeText } from "../src/providers/table";
import { columnIndex, serialToIso } from "../src/providers/xlsx";

const fixture = (name: string) => new Uint8Array(readFileSync(new URL(`./fixtures/${name}`, import.meta.url)));
const enc = (s: string) => new TextEncoder().encode(s);

describe("text decoding", () => {
  it("strips the UTF-8 BOM", () => {
    expect(decodeText(fixture("bom.csv")).startsWith("SKU")).toBe(true);
  });
  it("falls back to Windows-1252", () => {
    expect(decodeText(fixture("latin1.csv"))).toContain("Jalapeño");
  });
  it("decodes multi-byte UTF-8", () => {
    expect(decodeText(enc("Kärnsmör 😀"))).toBe("Kärnsmör 😀");
  });
});

describe("csv", () => {
  it("detects delimiters", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
  });

  it("handles quotes, newlines in quotes, decimal commas and leading zeros", () => {
    const t = parseCsv(decodeText(fixture("productos-eu.csv")));
    expect(t.columns).toEqual(["SKU", "Nombre", "Precio", "EAN"]);
    expect(t.rows[0]).toEqual({ SKU: "00123", Nombre: "Café; molido", Precio: 4.95, EAN: "0012345678905" });
    expect(t.rows[1]).toEqual({ SKU: "A-77", Nombre: 'Té "verde"\nmenta', Precio: 3.5, EAN: null });
  });

  it("names empty and duplicate headers", () => {
    const t = parseCsv("a,,a\n1,2,3");
    expect(t.columns).toEqual(["a", "Column 2", "a (2)"]);
  });

  it("only coerces unambiguous numbers", () => {
    expect(coerceNumber("12.5", false)).toBe(12.5);
    expect(coerceNumber("12,5", false)).toBe("12,5");
    expect(coerceNumber("12,5", true)).toBe(12.5);
    expect(coerceNumber("0012", false)).toBe("0012");
    expect(coerceNumber("0.5", false)).toBe(0.5);
    expect(coerceNumber("12345678901234567890", false)).toBe("12345678901234567890");
  });
});

describe("json", () => {
  it("finds the record array and flattens nested objects", () => {
    const t = parseJson(JSON.stringify({ meta: { n: 1 }, data: { products: [
      { sku: "A", price: { amount: 2, currency: "SEK" }, tags: ["x", "y"], variants: [{ s: 1 }] },
      { sku: "B", extra: true },
    ] } }));
    expect(t.columns).toEqual(["sku", "price.amount", "price.currency", "tags", "variants", "extra"]);
    expect(t.rows[0]).toMatchObject({ sku: "A", "price.amount": 2, tags: "x, y", variants: '[{"s":1}]' });
  });
  it("accepts a top-level array and an explicit path", () => {
    expect(parseJson('[{"a":1}]').rows).toEqual([{ a: 1 }]);
    expect(parseJson('{"x":{"y":[{"a":2}]}}', { path: "x.y" }).rows).toEqual([{ a: 2 }]);
    expect(() => parseJson('{"x":1}', { path: "x" })).toThrow(/not an array/);
  });
});

describe("xlsx", () => {
  it("lists sheets and reads typed cells", () => {
    const wb = openXlsx(fixture("productos.xlsx"));
    expect(wb.sheetNames).toEqual(["Productos", "Precios"]);
    const t = wb.readSheet();
    expect(t.columns).toEqual(["SKU", "Nombre", "Categoría", "Precio", "Fecha alta", "Activo", "Imagen"]);
    expect(t.rows).toHaveLength(4);
    expect(t.rows[0]).toEqual({
      SKU: "00123", Nombre: "Café molido 500 g", "Categoría": "Bebidas", Precio: 4.95,
      "Fecha alta": "2026-03-01", Activo: true, Imagen: "cafe.jpg",
    });
    expect(t.rows[1]!["Nombre"]).toBe("Té verde & menta");
    expect(t.rows[2]!["Nombre"]).toBe('Aceite "virgen extra"');
    expect(t.rows[2]!["Fecha alta"]).toBe("2026-05-02T14:30:00");
    expect(t.rows[3]).toMatchObject({ SKU: "C-10", Nombre: "Sal <marina>", Precio: null });
    expect(wb.readSheet("Precios").rows).toEqual([{ SKU: "A-77", Precio: 3.75 }]);
  });

  it("rejects non-xlsx data", () => {
    expect(() => openXlsx(enc("hello"))).toThrow(/not a valid/i);
  });

  it("converts helpers correctly", () => {
    expect(columnIndex("A1")).toBe(0);
    expect(columnIndex("AA10")).toBe(26);
    expect(serialToIso(46082, false)).toBe("2026-03-01");
    expect(serialToIso(0.5 + 46082, false)).toBe("2026-03-01T12:00:00");
  });
});

describe("loadFromBytes", () => {
  it("builds a data source from an xlsx with a detected key", () => {
    const { source, sheets } = loadFromBytes("/x/productos.xlsx", fixture("productos.xlsx"));
    expect(sheets).toEqual(["Productos", "Precios"]);
    expect(source.name).toBe("productos.xlsx [Productos]");
    expect(source.keyField).toBe("SKU");
    expect(source.fields.find((f) => f.name === "Imagen")!.type).toBe("image");
    expect(source.fields.find((f) => f.name === "Precio")!.type).toBe("number");
  });
  it("rejects unsupported extensions", () => {
    expect(() => loadFromBytes("a.xls", enc(""))).toThrow(/Unsupported/);
  });
});
