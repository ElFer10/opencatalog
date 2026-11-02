/** What the panel needs from its environment (InDesign UXP or a browser preview). */
export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Opaque handle to re-read the same file later (e.g. a UXP persistent token). */
  token?: string;
}

export interface Host {
  readonly kind: "uxp" | "browser";
  /** Ask the user for a data file. Resolves null when cancelled. */
  pickFile(extensions: readonly string[]): Promise<PickedFile | null>;
  /** Re-read a file picked earlier; null when the token is unknown or the file is gone. */
  reread(token: string): Promise<PickedFile | null>;
  loadSettings(): unknown;
  saveSettings(value: unknown): void;
}

const SETTINGS_KEY = "opencatalog.settings.v1";

/** localStorage-backed settings, safe when storage is unavailable. */
export const storageSettings = {
  load(): unknown {
    try {
      const raw = globalThis.localStorage?.getItem(SETTINGS_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  },
  save(value: unknown): void {
    try {
      globalThis.localStorage?.setItem(SETTINGS_KEY, JSON.stringify(value));
    } catch {
      /* settings are a convenience; ignore */
    }
  },
};
