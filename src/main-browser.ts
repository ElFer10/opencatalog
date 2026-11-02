/**
 * Browser preview: the same panel next to a simulated InDesign document (MemoryDocument),
 * so placing and updating can be tried without InDesign.
 */
import { decodeLink } from "./core/links";
import { createBrowserHost } from "./hosts/browser";
import { MemFrame, MemoryDocument, PAGE } from "./hosts/memory-document";
import { h, clear } from "./ui/dom";
import { Panel } from "./ui/panel";

const doc = new MemoryDocument("Preview document");
const root = document.getElementById("app")!;
const panel = new Panel(root, createBrowserHost(doc));
const docRoot = document.getElementById("doc")!;

const SCALE = 2.4; // px per mm

function isSelected(id: number): boolean {
  const s = doc.selection;
  return !!s && (s.frameId === id || (s.more ?? []).includes(id));
}

function renderTable(f: MemFrame): HTMLElement {
  const t = f.table;
  if (!t) return h("div", { class: "pv-muted" }, "(empty table)");
  return h("table", { class: "pv-table" },
    t.header ? h("tr", {}, ...t.header.map((c) => h("th", {}, c))) : null,
    ...t.rows.map((row) => h("tr", {}, ...row.map((c) => {
      const link = decodeLink(c.link);
      return h("td", { class: link ? "pv-field" : "", title: link ? `${link.key} · ${link.field}` : "" }, c.text.replace(/\r/g, "\n"));
    }))),
  );
}

function renderFrame(f: MemFrame): HTMLElement {
  const selected = isSelected(f.id);
  const frameLink = decodeLink(f.label);
  const threadText = (): HTMLElement => {
    const t = f.thread!;
    const story = MemoryDocument.storyText(doc.frame(t.first)).replace(/\r$/, "").split("\r");
    return h("div", { class: "pv-text pv-flow" }, story.slice(t.from, t.to).join("\n").replace(/\t/g, "  ·  "));
  };
  const body =
    f.thread
      ? threadText()
      : f.kind === "table"
      ? renderTable(f)
      : f.kind === "graphic"
      ? h("div", { class: "pv-img" }, f.image ? `🖼 ${f.image}` : "(empty graphic frame)")
      : h("div", { class: "pv-text" },
          ...f.runs.map((r, i) => {
            const link = decodeLink(r.link);
            const text = r.text.replace(/\r/g, "\n");
            if (!link) return h("span", {}, text);
            return h("span", {
              class: "pv-field",
              title: `${link.key} · ${link.field}\nDouble-click to edit`,
              on: { dblclick: (e) => {
                e.stopPropagation();
                const v = window.prompt(`Edit ${link.key} · ${link.field}`, r.text);
                if (v !== null) doc.editText({ frameId: f.id, run: i }, v);
              } },
            }, text);
          }),
          f.runs.length === 0 ? h("span", { class: "pv-muted" }, "(empty text frame)") : null,
        );
  const [top, left, bottom, right] = f.bounds;
  return h("div", {
    class: `pv-frame${selected ? " pv-sel" : ""}${frameLink ? " pv-linked" : ""}`,
    "data-frame": String(f.id),
    style: `top:${top * SCALE}px;left:${left * SCALE}px;width:${(right - left) * SCALE}px;min-height:${(bottom - top) * SCALE}px`,
    title: "Click to select, Shift+click to add to the selection",
    on: { click: (e) => {
      const s = doc.selection;
      if ((e as MouseEvent).shiftKey && s && s.frameId !== f.id) {
        const more = new Set(s.more ?? []);
        if (more.has(f.id)) more.delete(f.id);
        else more.add(f.id);
        doc.selection = { frameId: s.frameId, more: [...more] };
      } else doc.selection = { frameId: f.id };
      renderDoc();
    } },
  },
    h("div", { class: "pv-frame-head" },
      `${f.kind === "graphic" ? "Graphic" : f.kind === "table" ? "Table" : "Text"} ${f.id}${f.thread ? ` · flow lines ${f.thread.from + 1}–${f.thread.to}` : ""}`,
      frameLink ? h("span", { class: "pv-badge" }, `linked: ${frameLink.key} · ${frameLink.field}`) : null,
      f.kind === "text" && !frameLink
        ? h("button", { class: "pv-mini", title: "Put the text cursor at the end of this frame", on: { click: (e) => {
            e.stopPropagation();
            doc.selection = { frameId: f.id, offset: MemoryDocument.storyText(f).length };
            renderDoc();
          } } }, selected && doc.selection?.offset !== undefined ? "cursor ▮" : "set cursor")
        : null,
    ),
    body,
  );
}

function renderDoc(): void {
  clear(docRoot);
  const sel = doc.selection;
  docRoot.append(
    h("div", { class: "pv-toolbar" },
      h("strong", {}, "Simulated InDesign document"),
      h("button", { on: { click: () => { const f = doc.addFrame("text", "Price: "); doc.selection = { frameId: f.id, offset: 7 }; renderDoc(); } } }, "+ Text frame"),
      h("button", { on: { click: () => { const f = doc.addFrame("graphic"); doc.selection = { frameId: f.id }; renderDoc(); } } }, "+ Graphic frame"),
      h("button", { on: { click: () => { doc.selection = null; renderDoc(); } } }, "Deselect"),
      h("span", { class: "pv-muted" }, sel ? (sel.offset !== undefined ? `Cursor in frame ${sel.frameId}` : `${1 + (sel.more?.length ?? 0)} selected`) : "Nothing selected"),
    ),
    ...Array.from({ length: doc.pageCount }, (_, i) => String(i + 1)).map((page) =>
      h("div", { class: "pv-pagewrap" },
        h("div", { class: "pv-pagenum" }, `Page ${page}`),
        h("div", { class: "pv-page", "data-page": page, style: `width:${PAGE[3] * SCALE}px;height:${PAGE[2] * SCALE}px` },
          h("div", { class: "pv-margins", style: `top:${12 * SCALE}px;left:${12 * SCALE}px;right:${12 * SCALE}px;bottom:${12 * SCALE}px` }),
          ...doc.frames.filter((f) => f.page === page).map(renderFrame),
          doc.frames.length === 0 ? h("p", { class: "pv-muted", style: "position:absolute;top:40px;left:40px" }, "Empty page. Place a field from the panel, or add a frame.") : null),
      ),
    ),
  );
}

doc.onChange = renderDoc;
renderDoc();

// Demo data so the preview can be tried without a file.
const demo = [
  "SKU;Product;Category;Subcategory;Price;Unit;Image",
  "A-001;Ground coffee;Drinks;Coffee;4,95;500 g;https://images.example.com/coffee.jpg",
  "A-002;Espresso beans;Drinks;Coffee;7,50;1 kg;espresso.jpg",
  "A-010;Green tea;Drinks;Tea;3,50;100 g;green-tea.jpg",
  "A-011;Rooibos;Drinks;Tea;3,20;100 g;rooibos.jpg",
  "B-001;Extra virgin olive oil;Oils;Olive;12,00;750 ml;olive-oil.jpg",
  "B-002;Rapeseed oil;Oils;Seed;4,10;1 l;rapeseed.jpg",
  "C-001;Sea salt;Spices;Salt;1,90;500 g;salt.jpg",
  "C-002;Smoked paprika;Spices;;2,80;75 g;paprika.jpg",
].join("\n");

const loadDemo = (text: string) =>
  panel.openPicked({ name: "demo-products.csv", bytes: new TextEncoder().encode(text), token: "demo", path: "/Users/me/catalog/demo-products.csv" });

document.getElementById("demo")?.addEventListener("click", () => loadDemo(demo));
// "Change prices" simulates editing the data file and reloading it.
document.getElementById("demo2")?.addEventListener("click", () => loadDemo(demo.replace("4,95", "5,25").replace("Green tea", "Sencha green tea")));

// A larger generated catalogue for trying pagination.
const big = (() => {
  const cats: [string, string[]][] = [["Drinks", ["Coffee", "Tea", "Juice"]], ["Oils", ["Olive", "Seed"]], ["Spices", ["Salt", "Pepper", "Herbs"]]];
  const lines = ["SKU;Product;Category;Subcategory;Price;Unit;Image"];
  let n = 0;
  for (const [cat, subs] of cats)
    for (const sub of subs)
      for (let i = 1; i <= 7; i++) {
        n++;
        lines.push(`P-${String(n).padStart(3, "0")};${sub} no. ${i};${cat};${sub};${(2 + ((n * 37) % 90) / 10).toFixed(2).replace(".", ",")};${100 * i} g;${sub.toLowerCase()}-${i}.jpg`);
      }
  return lines.join("\n");
})();
document.getElementById("demo3")?.addEventListener("click", () => panel.openPicked({ name: "big-catalogue.csv", bytes: new TextEncoder().encode(big), token: "big", path: "/Users/me/catalog/big-catalogue.csv" }));

(window as unknown as Record<string, unknown>).opencatalog = { panel, doc };
