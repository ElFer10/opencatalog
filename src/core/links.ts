/**
 * Links between document content and data: each placed field remembers its source, record key and field.
 */

export interface FieldLink {
  /** DataSource.id the value came from. */
  source: string;
  /** Record id (key field value, or "#n" when the source has no key). */
  key: string;
  field: string;
}

/** Label name used on page items and attribute name used on XML elements. */
export const LINK_LABEL = "opencatalog";
/** XML tag that marks a field placed inside running text. */
export const FIELD_TAG = "oc_field";
/** XML tag used to mark up a story that holds inline fields. */
export const STORY_TAG = "oc_story";

const VERSION = 1;

export function encodeLink(link: FieldLink): string {
  return JSON.stringify({ v: VERSION, s: link.source, k: link.key, f: link.field });
}

export function decodeLink(raw: string | null | undefined): FieldLink | null {
  if (!raw) return null;
  try {
    const o = JSON.parse(raw) as Record<string, unknown>;
    if (o["v"] !== VERSION || typeof o["s"] !== "string" || typeof o["k"] !== "string" || typeof o["f"] !== "string") return null;
    return { source: o["s"], key: o["k"], field: o["f"] };
  } catch {
    return null;
  }
}

/** How a link is attached in the document. */
export type LinkKind =
  /** A whole text frame (its story) shows one field. */
  | "frame-text"
  /** A field inside running text, marked with an XML element. */
  | "inline-text"
  /** A graphic frame shows an image field. */
  | "image";

/** A link found in the document, with an opaque handle the document adapter understands. */
export interface LinkedItem<Ref = unknown> {
  ref: Ref;
  link: FieldLink;
  kind: LinkKind;
  /** Current text, or the current image file path ("" when empty). */
  current: string;
  /** Page name for reports, when known. */
  page?: string;
}

/**
 * What the sync engine needs from a document. Implemented for InDesign (UXP DOM) and for an
 * in-memory document used by the browser preview and the tests.
 */
export interface DocumentAdapter<Ref = unknown> {
  /** Human-readable name of the target document. */
  readonly name: string;
  scan(): LinkedItem<Ref>[];
  /** Run several changes as one undoable step when the host supports it. */
  transaction(label: string, fn: () => void): void;
  setText(item: LinkedItem<Ref>, text: string): void;
  setImage(item: LinkedItem<Ref>, path: string): void;
  /** Place one or more fields at the current selection (insertion point, frame) or in a new frame. */
  placeText(fields: { link: FieldLink; text: string }[]): PlaceResult;
  placeImage(link: FieldLink, path: string): PlaceResult;
  /** Select and scroll to the item, e.g. from an error report. */
  reveal(item: LinkedItem<Ref>): void;
}

export interface PlaceResult {
  /** Where the content went, for the status message. */
  target: "insertion-point" | "text-frame" | "new-frame" | "graphic-frame";
}
