/** Geometry helpers for repeating a layout block in a grid. Bounds are [top, left, bottom, right]. */
import { FieldLink, decodeLink, encodeLink } from "./links";

export type Bounds = [number, number, number, number];

export function unionBounds(list: readonly Bounds[]): Bounds {
  if (list.length === 0) throw new Error("Nothing selected");
  return list.reduce<Bounds>(
    (u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])],
    [...list[0]!] as Bounds,
  );
}

/**
 * Offsets [dx, dy] for `count` copies of a block, filling free grid slots inside `area`
 * row by row, aligned with the block. The block's own slot is never returned.
 * Returns fewer offsets than requested when the area is full.
 */
export function gridOffsets(block: Bounds, area: Bounds, count: number, gap: number): [number, number][] {
  const w = block[3] - block[1];
  const h = block[2] - block[0];
  if (w <= 0 || h <= 0) return [];
  const stepX = w + gap;
  const stepY = h + gap;
  const eps = 1e-6;
  // First column/row positions aligned to the block, but not outside the area.
  const firstLeft = block[1] - Math.floor((block[1] - area[1] + eps) / stepX) * stepX;
  const out: [number, number][] = [];
  for (let top = block[0]; top + h <= area[2] + eps && out.length < count; top += stepY) {
    const startLeft = top === block[0] ? block[1] + stepX : firstLeft;
    for (let left = startLeft; left + w <= area[3] + eps && out.length < count; left += stepX) {
      out.push([left - block[1], top - block[0]]);
    }
  }
  return out;
}

/** Point an encoded link at another record; returns the input unchanged when it is not a link. */
export function retargetEncoded(raw: string, key: string): string {
  const link = decodeLink(raw);
  return link ? encodeLink({ ...link, key }) : raw;
}

/** The single record key used by a set of links; throws if they mix records or sources. */
export function sampleKeyOf(links: readonly FieldLink[], sourceId: string): string {
  const mine = links.filter((l) => l.source === sourceId);
  if (mine.length === 0) throw new Error("The selection has no fields from this data source. Place fields of one record, select them, then repeat.");
  const keys = new Set(mine.map((l) => l.key));
  if (keys.size > 1) throw new Error(`The selection mixes fields of ${keys.size} records; it must show exactly one record`);
  return mine[0]!.key;
}
