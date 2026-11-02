/** The "Connect…" box: URL (JSON/CSV), Notion database, or SQL database through the local helper. */
import type { RemoteSourceSpec } from "../providers";
import { add, h, select } from "./dom";

export const secretKey = (spec: RemoteSourceSpec): string => `${spec.type}:${spec.name}`;

export interface ConnectProps {
  saved: RemoteSourceSpec[];
  current: RemoteSourceSpec | null;
  onConnect(spec: RemoteSourceSpec, secret: string | null): void;
  onDelete(name: string): void;
}

type Draft = {
  type: RemoteSourceSpec["type"];
  name: string;
  url: string;
  format: "json" | "csv";
  recordsPath: string;
  nextPath: string;
  headerName: string;
  headerValue: string;
  databaseId: string;
  helperUrl: string;
  connection: string;
  query: string;
  secret: string;
};

function draftFrom(spec: RemoteSourceSpec | null): Draft {
  const d: Draft = {
    type: "url", name: "", url: "", format: "json", recordsPath: "", nextPath: "", headerName: "Authorization",
    headerValue: "Bearer {token}", databaseId: "", helperUrl: "http://127.0.0.1:8765", connection: "sqlite:", query: "SELECT * FROM products", secret: "",
  };
  if (!spec) return d;
  d.type = spec.type;
  d.name = spec.name;
  if (spec.type === "url") {
    d.url = spec.url;
    d.format = spec.format;
    d.recordsPath = spec.recordsPath ?? "";
    d.nextPath = spec.nextPath ?? "";
    const [hn, hv] = Object.entries(spec.headers ?? {})[0] ?? ["Authorization", ""];
    d.headerName = hn;
    d.headerValue = hv;
  } else if (spec.type === "notion") d.databaseId = spec.databaseId;
  else {
    d.helperUrl = spec.helperUrl;
    d.connection = spec.connection;
    d.query = spec.query;
  }
  return d;
}

function specFrom(d: Draft): RemoteSourceSpec {
  const name = d.name.trim();
  if (!name) throw new Error("Give the connection a name");
  if (d.type === "url") {
    if (!/^https?:\/\//i.test(d.url.trim())) throw new Error("The URL must start with http:// or https://");
    return {
      type: "url", name, url: d.url.trim(), format: d.format,
      recordsPath: d.recordsPath.trim() || undefined, nextPath: d.nextPath.trim() || undefined,
      headers: d.headerName.trim() && d.headerValue.trim() ? { [d.headerName.trim()]: d.headerValue.trim() } : undefined,
    };
  }
  if (d.type === "notion") return { type: "notion", name, databaseId: d.databaseId.trim() };
  return { type: "sql", name, helperUrl: d.helperUrl.trim(), connection: d.connection.trim(), query: d.query.trim() };
}

/** The form keeps its draft across panel re-renders until another connection is loaded. */
let kept: { for: string | null; draft: Draft } | null = null;

export function renderConnectBox(p: ConnectProps, onError: (e: unknown) => void): HTMLElement {
  const box = h("div", { class: "oc-connect" });
  const forName = p.current?.name ?? null;
  if (!kept || kept.for !== forName) kept = { for: forName, draft: draftFrom(p.current) };
  const d: Draft = kept.draft;
  const input = (key: keyof Draft, placeholder: string, width = 220, type = "text") => {
    const el = h("input", { class: "oc-input", type, value: d[key], placeholder, style: `width:${width}px` });
    el.addEventListener("input", () => ((d as Record<string, string>)[key] = el.value));
    return el;
  };
  const build = () => {
    while (box.firstChild) box.removeChild(box.firstChild);
    add(box,
      p.saved.length
        ? h("div", { class: "oc-row" },
            h("span", { class: "oc-label" }, "Saved"),
            select([{ value: "", label: "choose…" }, ...p.saved.map((s) => ({ value: s.name, label: `${s.name} (${s.type})` }))], "", (v) => {
              const spec = p.saved.find((s) => s.name === v);
              if (spec) p.onConnect(spec, null);
            }),
            p.current ? h("button", { class: "oc-btn oc-small", title: "Delete the current saved connection", on: { click: () => p.onDelete(p.current!.name) } }, `Delete “${p.current.name}”`) : null,
          )
        : null,
      h("div", { class: "oc-row" },
        h("span", { class: "oc-label" }, "Type"),
        select([
          { value: "url", label: "URL (JSON / CSV, REST API)" },
          { value: "notion", label: "Notion database" },
          { value: "sql", label: "SQL database (local helper)" },
        ], d.type, (v) => { d.type = v as Draft["type"]; build(); }),
        h("span", { class: "oc-label" }, "Name"), input("name", "e.g. Products", 140),
      ),
    );
    if (d.type === "url") {
      add(box,
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "URL"), input("url", "https://…/api/products", 300),
          select([{ value: "json", label: "JSON" }, { value: "csv", label: "CSV" }], d.format, (v) => { d.format = v as "json" | "csv"; build(); })),
        d.format === "json"
          ? h("div", { class: "oc-row" },
              h("span", { class: "oc-label", title: "Dotted path to the list of records, e.g. data.items (detected when empty)" }, "Records at"), input("recordsPath", "auto", 110),
              h("span", { class: "oc-label", title: "Dotted path to the next page link, e.g. links.next" }, "Next page at"), input("nextPath", "none", 110))
          : null,
        h("div", { class: "oc-row" },
          h("span", { class: "oc-label" }, "Header"), input("headerName", "Authorization", 110), input("headerValue", "Bearer {token}", 140),
          h("span", { class: "oc-label", title: "Replaces {token} in the header; kept in secure storage" }, "Token"), input("secret", "(unchanged)", 120, "password")),
      );
    } else if (d.type === "notion") {
      add(box,
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "Database"), input("databaseId", "link or id of the Notion database", 300)),
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "Integration token"), input("secret", "secret_… / ntn_… (unchanged)", 220, "password")),
        h("div", { class: "oc-row oc-muted oc-help" }, "Create an internal integration at notion.so/my-integrations, then share the database with it (••• › Connections)."),
      );
    } else {
      const q = h("textarea", { class: "oc-input oc-sql", rows: "3" }, d.query);
      q.addEventListener("input", () => (d.query = q.value));
      add(box,
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "Helper"), input("helperUrl", "http://127.0.0.1:8765", 170),
          h("span", { class: "oc-label" }, "Token"), input("secret", "printed by the helper (unchanged)", 170, "password")),
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "Connection"), input("connection", "sqlite:/path/to/catalog.db   or   odbc:DSN=…", 300)),
        h("div", { class: "oc-row" }, h("span", { class: "oc-label" }, "Query"), q),
        h("div", { class: "oc-row oc-muted oc-help" }, "Run tools/opencatalog-helper.py on this computer; it prints the token. SQLite works out of the box, ODBC needs pyodbc."),
      );
    }
    add(box,
      h("div", { class: "oc-row" },
        h("button", { class: "oc-btn oc-primary", on: { click: () => {
          try {
            p.onConnect(specFrom(d), d.secret ? d.secret : null);
          } catch (e) {
            onError(e);
          }
        } } }, "Connect and save"),
      ),
    );
  };
  build();
  return box;
}
