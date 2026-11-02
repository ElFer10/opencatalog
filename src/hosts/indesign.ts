/**
 * DocumentAdapter for Adobe InDesign through the UXP DOM (`require("indesign")`).
 *
 * How links are stored (all inside the .indd, nothing external):
 * - A whole text frame or graphic frame linked to one field carries a script label
 *   (`insertLabel("opencatalog", json)`).
 * - A field inside running text is marked up as an XML element `<oc_field>` with an
 *   `opencatalog` attribute holding the link. The story is tagged `<oc_story>` if it was untagged.
 *
 * The InDesign UXP DOM is synchronous and mirrors the ExtendScript DOM.
 */
import {
  DocumentAdapter,
  FIELD_TAG,
  FieldLink,
  LINK_LABEL,
  LinkedItem,
  PlaceResult,
  STORY_TAG,
  decodeLink,
  encodeLink,
} from "../core/links";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (id: string) => any;

type IdRef = { node: any; inline: boolean };

const TEXT_SELECTIONS = new Set(["InsertionPoint", "Character", "Word", "Line", "Paragraph", "TextStyleRange", "TextColumn", "Text"]);
const GRAPHIC_FRAMES = new Set(["Rectangle", "Oval", "Polygon"]);
const GRAPHICS = new Set(["Image", "PDF", "EPS", "PICT", "WMF", "ImportedPage", "SVG"]);

function valid(o: any): boolean {
  try {
    return o !== null && o !== undefined && (o.isValid === undefined || o.isValid);
  } catch {
    return false;
  }
}

function pageName(item: any): string | undefined {
  try {
    const p = item.parentPage;
    return valid(p) ? String(p.name) : undefined;
  } catch {
    return undefined;
  }
}

/** Returns an adapter for the active document, or null when no document is open. */
export function activeInDesignDocument(): DocumentAdapter<IdRef> | null {
  const id = require("indesign");
  const app = id.app;
  if (!app.documents || app.documents.length === 0) return null;
  const doc = app.activeDocument;

  const tag = (name: string): any => {
    const t = doc.xmlTags.itemByName(name);
    return valid(t) ? t : doc.xmlTags.add(name);
  };

  const storyElement = (story: any): any => {
    try {
      const el = story.associatedXMLElement;
      if (valid(el)) return el;
    } catch {
      /* not tagged */
    }
    const root = doc.xmlElements.item(0);
    const el = root.xmlElements.add(tag(STORY_TAG));
    story.markup(el);
    return el;
  };

  const frameText = (frame: any): string => {
    try {
      return String(frame.parentStory.contents ?? "");
    } catch {
      return "";
    }
  };

  const imagePath = (frame: any): string => {
    try {
      if (frame.graphics.length === 0) return "";
      const link = frame.graphics.item(0).itemLink;
      return valid(link) ? String(link.filePath ?? "") : "";
    } catch {
      return "";
    }
  };

  const fit = (frame: any) => {
    try {
      frame.fit(id.FitOptions.PROPORTIONALLY);
      frame.fit(id.FitOptions.CENTER_CONTENT);
    } catch {
      /* fitting is cosmetic */
    }
  };

  /** Insert fields as tagged runs at a story index; returns nothing, throws on failure. */
  const insertInline = (story: any, index: number, fields: { link: FieldLink; text: string }[]) => {
    const parent = storyElement(story);
    const fieldTag = tag(FIELD_TAG);
    let idx = index;
    fields.forEach((f, i) => {
      if (i > 0) {
        story.insertionPoints.item(idx).contents = "\r";
        idx += 1;
      }
      const len = f.text.length;
      let content: any;
      if (len > 0) {
        story.insertionPoints.item(idx).contents = f.text;
        content = story.characters.itemByRange(idx, idx + len - 1);
      } else content = story.insertionPoints.item(idx);
      const el = parent.xmlElements.add(fieldTag, content);
      el.xmlAttributes.add(LINK_LABEL, encodeLink(f.link));
      idx += len;
    });
  };

  const newFrameBounds = (heightShare: number, widthShare: number): number[] => {
    const page = app.activeWindow.activePage;
    const [y1, x1, y2, x2] = page.bounds as number[];
    const m = page.marginPreferences;
    const top = y1! + Number(m.top);
    const left = x1! + Number(m.left);
    const width = x2! - x1! - Number(m.left) - Number(m.right);
    const height = y2! - y1! - Number(m.top) - Number(m.bottom);
    return [top, left, top + height * heightShare, left + width * widthShare];
  };

  const firstSelection = (): any => {
    const sel = app.selection;
    return sel && sel.length > 0 ? sel[0] : null;
  };

  return {
    name: String(doc.name),

    scan() {
      const out: LinkedItem<IdRef>[] = [];
      for (const item of doc.allPageItems as any[]) {
        let raw = "";
        try {
          raw = item.extractLabel(LINK_LABEL);
        } catch {
          continue;
        }
        const link = decodeLink(raw);
        if (!link) continue;
        const isText = item.constructorName === "TextFrame";
        out.push({
          ref: { node: item, inline: false },
          link,
          kind: isText ? "frame-text" : "image",
          current: isText ? frameText(item) : imagePath(item),
          page: pageName(item),
        });
      }
      const walk = (el: any) => {
        const children = el.xmlElements;
        for (let i = 0; i < children.length; i++) {
          const child = children.item(i);
          let link: FieldLink | null = null;
          try {
            if (child.markupTag.name === FIELD_TAG) {
              const attr = child.xmlAttributes.itemByName(LINK_LABEL);
              link = valid(attr) ? decodeLink(String(attr.value)) : null;
            }
          } catch {
            link = null;
          }
          if (link) {
            let page: string | undefined;
            try {
              const frames = child.texts.item(0).parentTextFrames;
              page = frames && frames.length > 0 ? pageName(frames[0]) : undefined;
            } catch {
              page = undefined;
            }
            out.push({ ref: { node: child, inline: true }, link, kind: "inline-text", current: String(child.contents ?? ""), page });
          } else walk(child);
        }
      };
      walk(doc.xmlElements.item(0));
      return out;
    },

    transaction(label, fn) {
      let ran = false;
      const run = () => {
        ran = true;
        fn();
      };
      try {
        app.doScript(run, id.ScriptLanguage.UXPSCRIPT, [], id.UndoModes.ENTIRE_SCRIPT, label);
      } catch (e) {
        if (ran) throw e;
        fn(); // hosts without function support in doScript
      }
    },

    setText(item, text) {
      const node = item.ref.node;
      if (!valid(node)) throw new Error("The linked content was deleted");
      if (item.ref.inline) node.contents = text;
      else node.parentStory.contents = text;
    },

    setImage(item, path) {
      const frame = item.ref.node;
      if (!valid(frame)) throw new Error("The linked frame was deleted");
      frame.place(path);
      fit(frame);
    },

    placeText(fields): PlaceResult {
      if (fields.length === 0) throw new Error("Nothing to place");
      const s = firstSelection();
      if (s && TEXT_SELECTIONS.has(s.constructorName)) {
        const story = s.parentStory;
        const frames = story.textContainers;
        if (frames && frames.length > 0 && decodeLink(frames[0].extractLabel(LINK_LABEL))) {
          throw new Error("This frame is linked as a whole; select the frame instead of placing inside it");
        }
        const index = s.insertionPoints.item(0).index;
        if (s.constructorName !== "InsertionPoint") s.contents = "";
        insertInline(story, index, fields);
        return { target: "insertion-point" };
      }
      let frame = s && s.constructorName === "TextFrame" ? s : null;
      if (s && !frame) throw new Error("Select a text frame or a text insertion point to place text fields");
      const created = !frame;
      if (!frame) {
        frame = app.activeWindow.activePage.textFrames.add();
        frame.geometricBounds = newFrameBounds(fields.length > 1 ? 0.2 : 0.06, 0.5);
      }
      if (fields.length === 1) {
        frame.parentStory.contents = fields[0]!.text;
        frame.insertLabel(LINK_LABEL, encodeLink(fields[0]!.link));
      } else {
        frame.insertLabel(LINK_LABEL, "");
        frame.parentStory.contents = "";
        insertInline(frame.parentStory, 0, fields);
      }
      if (created) app.select(frame);
      return { target: created ? "new-frame" : "text-frame" };
    },

    placeImage(link, path): PlaceResult {
      let s = firstSelection();
      if (s && GRAPHICS.has(s.constructorName)) s = s.parent;
      if (s && !GRAPHIC_FRAMES.has(s.constructorName)) throw new Error("Select an empty or graphic frame to place an image field");
      const created = !s;
      const frame = s ?? app.activeWindow.activePage.rectangles.add();
      if (created) frame.geometricBounds = newFrameBounds(0.25, 0.4);
      frame.place(path);
      fit(frame);
      frame.insertLabel(LINK_LABEL, encodeLink(link));
      if (created) app.select(frame);
      return { target: created ? "new-frame" : "graphic-frame" };
    },

    reveal(item) {
      const node = item.ref.node;
      if (!valid(node)) return;
      try {
        if (item.ref.inline) {
          const text = node.texts.item(0);
          app.select(text);
          text.showText();
        } else {
          const page = node.parentPage;
          if (valid(page)) app.activeWindow.activePage = page;
          app.select(node);
        }
      } catch {
        /* best effort */
      }
    },
  };
}
