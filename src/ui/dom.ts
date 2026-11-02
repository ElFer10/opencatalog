/** Tiny DOM helper; avoids a framework so the panel stays small and UXP-friendly. */
type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string; on?: Record<string, (e: Event) => void> };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "on") {
      for (const [evt, fn] of Object.entries(v as Record<string, (e: Event) => void>)) el.addEventListener(evt, fn);
    } else if (k === "class") el.className = String(v);
    else if (k === "value") (el as unknown as HTMLInputElement).value = String(v);
    else if (k === "selected" || k === "checked" || k === "disabled") (el as unknown as Record<string, boolean>)[k] = Boolean(v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
  return el;
}

export function clear(el: Element): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function select(options: readonly { value: string; label: string }[], current: string, onChange: (v: string) => void, cls = ""): HTMLSelectElement {
  return h(
    "select",
    { class: cls, on: { change: (e) => onChange((e.target as HTMLSelectElement).value) } },
    options.map((o) => h("option", { value: o.value, selected: o.value === current }, o.label)),
  );
}

/** Append children, skipping null/undefined/false. */
export function add(el: Element, ...children: Child[]): void {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    el.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
  }
}
