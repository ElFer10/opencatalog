/** What the panel needs from its environment (InDesign UXP or a browser preview). */
import type { DocumentAdapter } from "../core/links";

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
  /** Full native path, when the host exposes it (used to resolve relative image paths). */
  path?: string;
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
  /** The document to place into and update; null when none is open. */
  getDocument(): DocumentAdapter | null;
  /** Ask the user for a folder; resolves its native path, or null when cancelled. */
  pickFolder(): Promise<string | null>;
  /** Ask where to save a text file and write it. Resolves false when cancelled. */
  saveTextFile(suggestedName: string, text: string): Promise<boolean>;
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
