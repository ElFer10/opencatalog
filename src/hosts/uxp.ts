/**
 * Host adapter for Adobe UXP (InDesign). `require("uxp")` is provided by the UXP runtime;
 * the bundler leaves it as an external.
 */
import { cacheFileName } from "../core/images";
import { DownloadResult, Host, PickedFile, storageSettings } from "./host";
import { activeInDesignDocument } from "./indesign";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;

export function createUxpHost(): Host {
  const uxp = require("uxp");
  const fs = uxp.storage.localFileSystem;
  const formats = uxp.storage.formats;

  const readEntry = async (file: any, token?: string): Promise<PickedFile> => {
    const data: ArrayBuffer = await file.read({ format: formats.binary });
    return { name: file.name, bytes: new Uint8Array(data), token, path: file.nativePath };
  };

  return {
    kind: "uxp",
    async pickFile(extensions) {
      const file = await fs.getFileForOpening({ types: [...extensions], allowMultiple: false });
      if (!file) return null;
      let token: string | undefined;
      try {
        token = await fs.createPersistentToken(file);
      } catch {
        token = undefined;
      }
      return readEntry(file, token);
    },
    async reread(token) {
      try {
        const file = await fs.getEntryForPersistentToken(token);
        return file ? await readEntry(file, token) : null;
      } catch {
        return null;
      }
    },
    loadSettings: storageSettings.load,
    saveSettings: storageSettings.save,
    getDocument: activeInDesignDocument,
    async pickFolder() {
      const folder = await fs.getFolder();
      return folder ? String(folder.nativePath) : null;
    },
    async downloadImages(urls): Promise<DownloadResult> {
      const result: DownloadResult = { downloaded: new Map(), failed: new Map() };
      if (urls.length === 0) return result;
      const data = await fs.getDataFolder();
      let cache: any;
      try {
        cache = await data.getEntry("image-cache");
      } catch {
        cache = await data.createFolder("image-cache");
      }
      for (const url of urls) {
        const name = cacheFileName(url);
        try {
          let file: any = null;
          try {
            file = await cache.getEntry(name);
          } catch {
            file = null;
          }
          if (!file) {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const bytes = await res.arrayBuffer();
            file = await cache.createFile(name, { overwrite: true });
            await file.write(bytes, { format: formats.binary });
          }
          result.downloaded.set(url, String(file.nativePath));
        } catch (e) {
          result.failed.set(url, e instanceof Error ? e.message : String(e));
        }
      }
      return result;
    },
    async pickSavePath(suggestedName) {
      const file = await fs.getFileForSaving(suggestedName, { types: [suggestedName.split(".").pop() ?? "pdf"] });
      return file ? String(file.nativePath) : null;
    },
    async saveTextFile(suggestedName, text) {
      const file = await fs.getFileForSaving(suggestedName, { types: [suggestedName.split(".").pop() ?? "csv"] });
      if (!file) return false;
      await file.write(text, { format: formats.utf8 });
      return true;
    },
  };
}
