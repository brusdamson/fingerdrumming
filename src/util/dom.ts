type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> | null;

/** Мини-хелпер для DOM: h('div', {class: 'x', onclick: fn}, 'текст', child). */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs,
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === null || v === undefined || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') {
        el.addEventListener(k.slice(2), v as EventListener);
      } else if (k === 'class') {
        el.className = String(v);
      } else if (k === 'value' || k === 'checked' || k === 'disabled' || k === 'selected') {
        (el as unknown as Record<string, unknown>)[k] = v;
      } else {
        el.setAttribute(k, v === true ? '' : String(v));
      }
    }
  }
  for (const c of children.flat()) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

export function clear(el: HTMLElement): void {
  while (el.firstChild) el.removeChild(el.firstChild);
}

export function fmtMs(ms: number, digits = 0): string {
  const v = ms.toFixed(digits);
  return (ms > 0 ? '+' : ms < 0 ? '−' : '') + v.replace('-', '') + ' мс';
}

export function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export function stddev(xs: number[]): number {
  if (!xs.length) return 0;
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / xs.length);
}
