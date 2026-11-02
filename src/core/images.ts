/** Resolve image field values (absolute or relative paths) to absolute file paths. */

export interface ImageContext {
  /** Folder chosen by the user for this source's images. */
  imageFolder?: string;
  /** Folder of the data file, used when no image folder is set. */
  dataFolder?: string;
  /** Downloaded copies of image URLs: URL → local file path. */
  downloaded?: ReadonlyMap<string, string>;
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
  if (/^https?:\/\//i.test(v)) {
    const local = ctx.downloaded?.get(v);
    return local ? { ok: true, path: local } : { ok: false, error: `Could not download ${v}` };
  }
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

/** Stable cache file name for an image URL (FNV-1a hash + original extension). */
export function cacheFileName(url: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < url.length; i++) {
    h ^= url.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  const ext = /\.(jpe?g|png|gif|tiff?|psd|ai|eps|pdf|svg|webp)(?:[?#]|$)/i.exec(url)?.[1]?.toLowerCase() ?? "jpg";
  return `${h.toString(16).padStart(8, "0")}-${url.length}.${ext}`;
}
