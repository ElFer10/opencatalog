/** Entry point inside InDesign (UXP). */
import { createUxpHost } from "./hosts/uxp";
import { Panel } from "./ui/panel";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;

let panel: Panel | null = null;

function mount(root: HTMLElement): void {
  if (panel) return;
  panel = new Panel(root, createUxpHost());
  void panel.restore();
}

require("uxp").entrypoints.setup({
  panels: {
    opencatalogPanel: {
      show() {
        const root = document.getElementById("app");
        if (root) mount(root);
      },
    },
  },
});

const root = document.getElementById("app");
if (root) mount(root);
