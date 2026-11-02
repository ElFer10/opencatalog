import { describe, expect, it } from "vitest";
import { Fetcher, loadRemote, loadUrlTable, notionDatabaseId, notionTable, notionValue } from "../src/providers";

const fake = (routes: Record<string, (body?: string, headers?: Record<string, string>) => { status: number; body: unknown }>): { fetch: Fetcher; calls: { url: string; body?: string; headers?: Record<string, string> }[] } => {
  const calls: { url: string; body?: string; headers?: Record<string, string> }[] = [];
  return {
    calls,
    fetch: async (url, req) => {
      calls.push({ url, body: req?.body, headers: req?.headers });
      const r = routes[url];
      if (!r) return { status: 404, text: '{"message":"not found"}' };
      const out = r(req?.body, req?.headers);
      return { status: out.status, text: typeof out.body === "string" ? out.body : JSON.stringify(out.body) };
    },
  };
};

describe("URL sources", () => {
  it("follows next links, injects the secret and finds records", async () => {
    const { fetch, calls } = fake({
      "https://pim.example.com/api/products": () => ({ status: 200, body: { data: [{ sku: "A", name: "Tea" }], links: { next: "/api/products?page=2" } } }),
      "https://pim.example.com/api/products?page=2": () => ({ status: 200, body: { data: [{ sku: "B", name: "Coffee", price: { amount: 5 } }], links: { next: null } } }),
    });
    const t = await loadUrlTable(fetch, { type: "url", name: "pim", url: "https://pim.example.com/api/products", format: "json", recordsPath: "data", nextPath: "links.next", headers: { Authorization: "Bearer {token}" } }, "s3cret");
    expect(t.rows).toEqual([{ sku: "A", name: "Tea" }, { sku: "B", name: "Coffee", "price.amount": 5 }]);
    expect(calls[0]!.headers).toEqual({ Authorization: "Bearer s3cret" });
    expect(calls).toHaveLength(2);
  });
  it("loads CSV and reports HTTP errors", async () => {
    const { fetch } = fake({ "https://x/p.csv": () => ({ status: 200, body: "SKU;Price\nA;4,95\n" }), "https://x/denied": () => ({ status: 401, body: { message: "bad key" } }) });
    const ds = await loadRemote(fetch, { type: "url", name: "Prices", url: "https://x/p.csv", format: "csv" }, undefined);
    expect(ds.id).toBe("rest:Prices");
    expect(ds.records[0]!.values["Price"]).toBe(4.95);
    expect(ds.decimalSeparator).toBe(",");
    await expect(loadUrlTable(fetch, { type: "url", name: "d", url: "https://x/denied", format: "json" })).rejects.toThrow(/HTTP 401\): bad key/);
  });
  it("stops on a repeating next link", async () => {
    const { fetch, calls } = fake({ "https://x/a": () => ({ status: 200, body: { items: [{ k: 1 }], next: "https://x/a" } }) });
    await loadUrlTable(fetch, { type: "url", name: "a", url: "https://x/a", format: "json", nextPath: "next" });
    expect(calls).toHaveLength(1);
  });
});

describe("Notion", () => {
  it("parses database ids from links", () => {
    expect(notionDatabaseId("https://www.notion.so/fer/Recept-1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6?v=123")).toBe("1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6");
    expect(() => notionDatabaseId("nope")).toThrow(/32-character/);
  });

  it("maps property types", () => {
    const rt = (t: string) => [{ plain_text: t }];
    expect(notionValue({ type: "title", title: rt("Blåbärsmousse") })).toBe("Blåbärsmousse");
    expect(notionValue({ type: "number", number: 10 })).toBe(10);
    expect(notionValue({ type: "select", select: { name: "Dessert" } })).toBe("Dessert");
    expect(notionValue({ type: "multi_select", multi_select: [{ name: "Gluten" }, { name: "Mjölk" }] })).toBe("Gluten, Mjölk");
    expect(notionValue({ type: "checkbox", checkbox: true })).toBe(true);
    expect(notionValue({ type: "date", date: { start: "2026-11-02", end: null } })).toBe("2026-11-02");
    expect(notionValue({ type: "files", files: [{ type: "external", external: { url: "https://img/x.jpg" } }] })).toBe("https://img/x.jpg");
    expect(notionValue({ type: "formula", formula: { type: "number", number: 42 } })).toBe(42);
    expect(notionValue({ type: "rollup", rollup: { type: "array", array: [{ type: "title", title: rt("Grädde") }, { type: "title", title: rt("Socker") }] } })).toBe("Grädde, Socker");
    expect(notionValue({ type: "unique_id", unique_id: { prefix: "REC", number: 7 } })).toBe("REC-7");
    expect(notionValue({ type: "status", status: null })).toBeNull();
  });

  it("queries all pages with the cursor and puts the title first", async () => {
    const page = (name: string, portions: number) => ({ properties: { Portioner: { type: "number", number: portions }, Namn: { type: "title", title: [{ plain_text: name }] } } });
    const url = "https://api.notion.com/v1/databases/1a2b3c4d-5e6f-47a8-b9c0-d1e2f3a4b5c6/query";
    const { fetch, calls } = fake({
      [url]: (body) => (JSON.parse(body!).start_cursor
        ? { status: 200, body: { results: [page("Bröd", 20)], has_more: false, next_cursor: null } }
        : { status: 200, body: { results: [page("Mousse", 10)], has_more: true, next_cursor: "c2" } }),
    });
    const ds = await loadRemote(fetch, { type: "notion", name: "Recept", databaseId: "1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6" }, "secret_x");
    expect(ds.fields.map((f) => f.name)).toEqual(["Namn", "Portioner"]);
    expect(ds.records.map((r) => r.values["Namn"])).toEqual(["Mousse", "Bröd"]);
    expect(ds.keyField).toBe("Namn");
    expect(calls[0]!.headers!["Notion-Version"]).toBe("2022-06-28");
    expect(calls[1]!.body).toContain('"start_cursor":"c2"');
    expect(notionTable([]).rows).toEqual([]);
    await expect(loadRemote(fetch, { type: "notion", name: "R", databaseId: "1a2b3c4d5e6f47a8b9c0d1e2f3a4b5c6" }, "")).rejects.toThrow(/token is required/);
  });
});

describe("SQL helper source", () => {
  it("posts the query with the token and builds rows", async () => {
    const { fetch, calls } = fake({
      "http://127.0.0.1:8765/query": (_b, h) => (h?.["X-OpenCatalog-Token"] === "tok"
        ? { status: 200, body: { columns: ["id", "name"], rows: [[1, "Tea"], [2, "Coffee"]] } }
        : { status: 403, body: { error: "invalid token" } }),
    });
    const ds = await loadRemote(fetch, { type: "sql", name: "Products", helperUrl: "http://127.0.0.1:8765/", connection: "sqlite:/x.db", query: "SELECT id, name FROM p" }, "tok");
    expect(ds.records.map((r) => r.values["name"])).toEqual(["Tea", "Coffee"]);
    expect(JSON.parse(calls[0]!.body!)).toEqual({ connection: "sqlite:/x.db", sql: "SELECT id, name FROM p" });
    await expect(loadRemote(fetch, { type: "sql", name: "P", helperUrl: "http://127.0.0.1:8765", connection: "c", query: "q" }, "bad")).rejects.toThrow(/invalid token/);
  });
});
