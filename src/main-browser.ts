/**
 * Browser preview: the same panel next to a simulated InDesign document (MemoryDocument),
 * so placing and updating can be tried without InDesign.
 */
import { decodeLink } from "./core/links";
import { createBrowserHost } from "./hosts/browser";
import { MemFrame, MemoryDocument } from "./hosts/memory-document";
import { h, clear } from "./ui/dom";
import { Panel } from "./ui/panel";

const doc = new MemoryDocument("Preview document");
const root = document.getElementById("app")!;
const panel = new Panel(root, createBrowserHost(doc));
const docRoot = document.getElementById("doc")!;

function renderFrame(f: MemFrame): HTMLElement {
  const selected = doc.selection?.frameId === f.id;
  const frameLink = decodeLink(f.label);
  const body =
    f.kind === "graphic"
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
  return h("div", {
    class: `pv-frame${selected ? " pv-sel" : ""}${frameLink ? " pv-linked" : ""}`,
    "data-frame": String(f.id),
    on: { click: () => { doc.selection = { frameId: f.id }; renderDoc(); } },
  },
    h("div", { class: "pv-frame-head" },
      `${f.kind === "graphic" ? "Graphic" : "Text"} frame ${f.id}`,
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
      h("span", { class: "pv-muted" }, sel ? (sel.offset !== undefined ? `Cursor in frame ${sel.frameId}` : `Frame ${sel.frameId} selected`) : "Nothing selected"),
    ),
    h("div", { class: "pv-page" }, ...doc.frames.map(renderFrame), doc.frames.length === 0 ? h("p", { class: "pv-muted" }, "Empty page. Place a field from the panel, or add a frame.") : null),
  );
}

doc.onChange = renderDoc;
renderDoc();

// Demo data so the preview can be tried without a file.
const demo = [
  "SKU;Product;Category;Subcategory;Price;Unit;Image",
  "A-001;Ground coffee;Drinks;Coffee;4,95;500 g;coffee.jpg",
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

(window as unknown as Record<string, unknown>).opencatalog = { panel, doc };
