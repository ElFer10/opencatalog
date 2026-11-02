/**
 * Remote data sources: a URL returning JSON or CSV (REST APIs, PIM/DAM exports), a Notion database,
 * and SQL databases through the local OpenCatalog helper. Network access goes through an injected
 * `Fetcher`, so this module is pure and testable.
 */
import { DataSource, RawRow, Value, collectColumns, createDataSource } from "../core/model";
import { parseCsv } from "./csv";
import { parseJson } from "./json";
import type { ParsedTable } from "./table";

export interface FetchRequest {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
}

export interface FetchResponse {
  status: number;
  text: string;
}

export type Fetcher = (url: string, req?: FetchRequest) => Promise<FetchResponse>;

export interface UrlSourceSpec {
  type: "url";
  name: string;
  url: string;
  format: "json" | "csv";
  /** Extra request headers, e.g. "Authorization: Bearer …" (values may reference the secret as {token}). */
  headers?: Record<string, string>;
  /** Dotted path to the record array in the JSON response (detected when empty). */
  recordsPath?: string;
  /** Dotted path to the next page URL in the JSON response (e.g. "next" or "links.next"). */
  nextPath?: string;
}

export interface NotionSourceSpec {
  type: "notion";
  name: string;
  databaseId: string;
}

export interface SqlSourceSpec {
  type: "sql";
  name: string;
  /** Helper base URL, e.g. http://127.0.0.1:8765 */
  helperUrl: string;
  /** "sqlite:/path/to/file.db" or an ODBC connection string prefixed with "odbc:". */
  connection: string;
  query: string;
}

export type RemoteSourceSpec = UrlSourceSpec | NotionSourceSpec | SqlSourceSpec;

const MAX_PAGES = 200;

function getPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const part of path.split(".").filter(Boolean)) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function check(res: FetchResponse, what: string): void {
  if (res.status < 200 || res.status >= 300) {
    let detail = res.text.slice(0, 200);
    try {
      const j = JSON.parse(res.text) as Record<string, unknown>;
      detail = String(j["message"] ?? j["error"] ?? detail);
    } catch {
      /* not JSON */
    }
    throw new Error(`${what} failed (HTTP ${res.status}): ${detail}`);
  }
}

const withSecret = (headers: Record<string, string> | undefined, secret: string | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers ?? {})) out[k] = secret ? v.split("{token}").join(secret) : v;
  return out;
};

function resolveUrl(next: string, base: string): string {
  try {
    return new URL(next, base).toString();
  } catch {
    return next;
  }
}

export async function loadUrlTable(fetch: Fetcher, spec: UrlSourceSpec, secret?: string): Promise<ParsedTable> {
  const headers = withSecret(spec.headers, secret);
  if (spec.format === "csv") {
    const res = await fetch(spec.url, { headers });
    check(res, `Loading ${spec.url}`);
    return parseCsv(res.text);
  }
  const rows: RawRow[] = [];
  let url: string | undefined = spec.url;
  const seen = new Set<string>();
  for (let page = 0; url && page < MAX_PAGES; page++) {
    if (seen.has(url)) break; // a server that keeps returning the same "next" link
    seen.add(url);
    const res = await fetch(url, { headers });
    check(res, `Loading ${url}`);
    rows.push(...parseJson(res.text, spec.recordsPath ? { path: spec.recordsPath } : {}).rows);
    if (!spec.nextPath) break;
    const next = getPath(JSON.parse(res.text), spec.nextPath);
    url = typeof next === "string" && next ? resolveUrl(next, url) : undefined;
  }
  return { columns: collectColumns(rows), rows };
}

// ---------- Notion ----------

const NOTION_VERSION = "2022-06-28";

/** Notion database id from an id or a notion.so URL. */
export function notionDatabaseId(input: string): string {
  const m = /([0-9a-f]{32})/i.exec(input.replace(/-/g, ""));
  if (!m) throw new Error("Paste the Notion database link or its 32-character id");
  const h = m[1]!.toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

const plain = (arr: unknown): string =>
  Array.isArray(arr) ? arr.map((t) => String((t as Record<string, unknown>)["plain_text"] ?? "")).join("") : "";

/** Convert one Notion property value to a cell value. */
export function notionValue(prop: Record<string, unknown>): Value {
  const type = String(prop["type"]);
  const v = prop[type] as unknown;
  switch (type) {
    case "title":
    case "rich_text":
      return plain(v);
    case "number":
      return typeof v === "number" ? v : null;
    case "checkbox":
      return v === true;
    case "select":
    case "status":
      return v && typeof v === "object" ? String((v as Record<string, unknown>)["name"] ?? "") : null;
    case "multi_select":
      return Array.isArray(v) ? v.map((o) => String((o as Record<string, unknown>)["name"])).join(", ") : null;
    case "date": {
      if (!v || typeof v !== "object") return null;
      const d = v as Record<string, unknown>;
      return d["end"] ? `${d["start"]} – ${d["end"]}` : String(d["start"] ?? "");
    }
    case "url":
    case "email":
    case "phone_number":
      return typeof v === "string" ? v : null;
    case "files":
      return Array.isArray(v)
        ? v.map((f) => {
            const o = f as Record<string, Record<string, unknown> | string>;
            const inner = (o["file"] ?? o["external"]) as Record<string, unknown> | undefined;
            return String(inner?.["url"] ?? "");
          }).filter(Boolean).join(", ")
        : null;
    case "formula": {
      const f = v as Record<string, unknown> | null;
      if (!f) return null;
      const ft = String(f["type"]);
      const fv = f[ft];
      if (ft === "date") return fv && typeof fv === "object" ? String((fv as Record<string, unknown>)["start"] ?? "") : null;
      return typeof fv === "string" || typeof fv === "number" || typeof fv === "boolean" ? fv : null;
    }
    case "rollup": {
      const r = v as Record<string, unknown> | null;
      if (!r) return null;
      if (r["type"] === "number") return (r["number"] as number | null) ?? null;
      if (r["type"] === "array" && Array.isArray(r["array"]))
        return r["array"].map((x) => notionValue(x as Record<string, unknown>)).filter((x) => x !== null && x !== "").join(", ");
      return null;
    }
    case "relation":
      return Array.isArray(v) ? v.map((r) => String((r as Record<string, unknown>)["id"])).join(", ") : null;
    case "people":
      return Array.isArray(v) ? v.map((p) => String((p as Record<string, unknown>)["name"] ?? "")).join(", ") : null;
    case "created_time":
    case "last_edited_time":
      return typeof v === "string" ? v.slice(0, 10) : null;
    case "unique_id": {
      const u = v as Record<string, unknown> | null;
      return u ? `${u["prefix"] ? `${u["prefix"]}-` : ""}${u["number"]}` : null;
    }
    default:
      return null;
  }
}

/** Rows from Notion page objects; the title property comes first. */
export function notionTable(pages: readonly Record<string, unknown>[]): ParsedTable {
  const rows: RawRow[] = [];
  let titleName: string | null = null;
  for (const p of pages) {
    const props = (p["properties"] ?? {}) as Record<string, Record<string, unknown>>;
    const row: RawRow = {};
    for (const [name, prop] of Object.entries(props)) {
      if (prop["type"] === "title") titleName = name;
      row[name] = notionValue(prop);
    }
    rows.push(row);
  }
  const cols = collectColumns(rows);
  const columns = titleName ? [titleName, ...cols.filter((c) => c !== titleName)] : cols;
  return { columns, rows };
}

export async function loadNotionTable(fetch: Fetcher, spec: NotionSourceSpec, token: string): Promise<ParsedTable> {
  if (!token) throw new Error("A Notion integration token is required");
  const id = notionDatabaseId(spec.databaseId);
  const pages: Record<string, unknown>[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < MAX_PAGES; i++) {
    const res = await fetch(`https://api.notion.com/v1/databases/${id}/query`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Notion-Version": NOTION_VERSION, "Content-Type": "application/json" },
      body: JSON.stringify(cursor ? { page_size: 100, start_cursor: cursor } : { page_size: 100 }),
    });
    check(res, "Notion query");
    const j = JSON.parse(res.text) as { results?: Record<string, unknown>[]; has_more?: boolean; next_cursor?: string | null };
    pages.push(...(j.results ?? []));
    if (!j.has_more || !j.next_cursor) break;
    cursor = j.next_cursor;
  }
  return notionTable(pages);
}

// ---------- SQL through the local helper ----------

export async function loadSqlTable(fetch: Fetcher, spec: SqlSourceSpec, token: string): Promise<ParsedTable> {
  const base = spec.helperUrl.replace(/\/+$/, "");
  const res = await fetch(`${base}/query`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-OpenCatalog-Token": token },
    body: JSON.stringify({ connection: spec.connection, sql: spec.query }),
  });
  if (res.status === 0) throw new Error(`Cannot reach the helper at ${base}. Is opencatalog-helper running?`);
  check(res, "Database query");
  const j = JSON.parse(res.text) as { columns: string[]; rows: Value[][] };
  const rows: RawRow[] = j.rows.map((r) => Object.fromEntries(j.columns.map((c, i) => [c, r[i] ?? null])));
  return { columns: j.columns, rows };
}

export async function loadRemote(fetch: Fetcher, spec: RemoteSourceSpec, secret: string | undefined): Promise<DataSource> {
  const table =
    spec.type === "url" ? await loadUrlTable(fetch, spec, secret)
    : spec.type === "notion" ? await loadNotionTable(fetch, spec, secret ?? "")
    : await loadSqlTable(fetch, spec, secret ?? "");
  const kind = spec.type === "url" ? "rest" : spec.type;
  return createDataSource(spec.name, kind, table.rows, { columns: table.columns, id: `${kind}:${spec.name}`, decimalSeparator: table.decimalSeparator });
}
