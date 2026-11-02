/** Resolve image field values (absolute or relative paths) to absolute file paths. */

export interface ImageContext {
  /** Folder chosen by the user for this source's images. */
  imageFolder?: string;
  /** Folder of the data file, used when no image folder is set. */
  dataFolder?: string;
}

export type ImageResolution = { ok: true; path: string } | { ok: false; error: string };

export function isAbsolutePath(p: string): boolean {
  return p.startsWith("/") || /^[A-Za-z]:[\\/]/.test(p) || p.startsWith("\\\\");
}

export function joinPath(folder: string, relative: string): string {
  const win = /^[A-Za-z]:[\\/]/.test(folder) || folder.startsWith("\\\\");
  const sep = win ? "\\" : "/";
  const base = folder.replace(/[\\/]+$/, "");
  const rel = relative.replace(/^\.?[\\/]+/, "").replace(/[\\/]/g, sep);
  return `${base}${sep}${rel}`;
}

/** Parent folder of a file path. */
export function dirname(p: string): string {
  const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\"));
  return i > 0 ? p.slice(0, i) : p;
}

export function resolveImage(value: string, ctx: ImageContext): ImageResolution {
  const v = value.trim();
  if (v === "") return { ok: false, error: "The image field is empty" };
  if (/^https?:\/\//i.test(v)) return { ok: false, error: "Images from URLs are not supported yet (planned for phase 2)" };
  if (v.startsWith("file://")) return { ok: true, path: decodeURI(v.replace(/^file:\/\//, "")) };
  if (isAbsolutePath(v)) return { ok: true, path: v };
  const folder = ctx.imageFolder ?? ctx.dataFolder;
  if (!folder) return { ok: false, error: `"${v}" is a relative path; choose an image folder for this data source` };
  return { ok: true, path: joinPath(folder, v) };
}

/** Compare file paths loosely (case-insensitive, either slash). */
export function samePath(a: string, b: string): boolean {
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  return a !== "" && b !== "" && norm(a) === norm(b);
}
