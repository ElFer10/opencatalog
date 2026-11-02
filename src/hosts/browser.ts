/** Host adapter for the browser preview (development only, no InDesign). */
import type { DocumentAdapter } from "../core/links";
import { Host, PickedFile, storageSettings } from "./host";

/** Browser host; pass a document (e.g. a MemoryDocument) to simulate InDesign. */
export function createBrowserHost(document_: DocumentAdapter | null = null): Host {
  const cache = new Map<string, PickedFile>();
  return {
    kind: "browser",
    pickFile(extensions) {
      return new Promise((resolve) => {
        const input = document.createElement("input");
        input.type = "file";
        input.accept = extensions.map((e) => `.${e}`).join(",");
        input.addEventListener("change", async () => {
          const f = input.files?.[0];
          if (!f) return resolve(null);
          const picked: PickedFile = { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()), token: `mem:${f.name}` };
          cache.set(picked.token!, picked);
          resolve(picked);
        });
        input.click();
      });
    },
    async reread(token) {
      return cache.get(token) ?? null;
    },
    loadSettings: storageSettings.load,
    saveSettings: storageSettings.save,
    getDocument: () => document_,
    async pickFolder() {
      return window.prompt("Image folder (absolute path):", "/Users/me/catalog/images");
    },
    async saveTextFile(suggestedName, text) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
      a.download = suggestedName;
      a.click();
      return true;
    },
  };
}
