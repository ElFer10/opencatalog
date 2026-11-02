/** Entry point for the browser preview: the same panel, without InDesign. */
import { createBrowserHost } from "./hosts/browser";
import { Panel } from "./ui/panel";

const root = document.getElementById("app")!;
const panel = new Panel(root, createBrowserHost());

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

document.getElementById("demo")?.addEventListener("click", () => {
  panel.openPicked({ name: "demo-products.csv", bytes: new TextEncoder().encode(demo), token: "demo" });
});

(window as unknown as { opencatalog: Panel }).opencatalog = panel;
