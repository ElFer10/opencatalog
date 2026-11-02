/**
 * Host adapter for Adobe UXP (InDesign). `require("uxp")` is provided by the UXP runtime;
 * the bundler leaves it as an external.
 */
import { Host, PickedFile, storageSettings } from "./host";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;

export function createUxpHost(): Host {
  const uxp = require("uxp");
  const fs = uxp.storage.localFileSystem;
  const formats = uxp.storage.formats;

  const readEntry = async (file: any, token?: string): Promise<PickedFile> => {
    const data: ArrayBuffer = await file.read({ format: formats.binary });
    return { name: file.name, bytes: new Uint8Array(data), token };
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
  };
}
