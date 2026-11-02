/** Host adapter for the browser preview (development only, no InDesign). */
import { Host, PickedFile, storageSettings } from "./host";

export function createBrowserHost(): Host {
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
  };
}
