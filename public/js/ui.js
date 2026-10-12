// Tiny DOM helpers. Text is always inserted as text nodes, so user content can't inject HTML.
export function el(tag, props, ...children) {
  const node = document.createElement(tag);
  let value;
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'value') value = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') node[k] = Boolean(v);
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  append(node, children);
  if (value !== undefined) node.value = value;
  return node;
}

export function append(node, children) {
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

const SVGNS = 'http://www.w3.org/2000/svg';
export function svg(tag, attrs = {}, ...children) {
  const node = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, String(v));
  return append(node, children);
}

export const $ = (sel, root = document) => root.querySelector(sel);

let toastBox;
export function toast(message, { error = false, ms = 2600 } = {}) {
  toastBox ??= document.body.appendChild(el('div', { class: 'toasts', role: 'status', 'aria-live': 'polite' }));
  const t = el('div', { class: `toast${error ? ' error' : ''}` }, message);
  toastBox.replaceChildren(t); // newest message wins; stale ones would just cover the UI
  setTimeout(() => t.remove(), ms);
}

/** Bottom sheet. `build(close)` returns the content node. Resolves with whatever close() is called with. */
export function sheet(title, build, { label } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (result) => {
      backdrop.remove();
      document.removeEventListener('keydown', onKey);
      if (!document.querySelector('.backdrop')) document.body.style.overflow = '';
      prevFocus?.focus?.();
      resolve(result);
    };
    const onKey = (e) => { if (e.key === 'Escape' && [...document.querySelectorAll('.backdrop')].pop() === backdrop) close(); };
    const box = el('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': label || title, tabindex: '-1' },
      el('div', { class: 'grabber' }),
      el('div', { class: 'sheet-head' }, el('h2', {}, title), el('button', { class: 'btn icon ghost', 'aria-label': 'Close', onclick: () => close() }, '✕')),
      build(close));
    const backdrop = el('div', { class: 'backdrop', onclick: (e) => { if (e.target === backdrop) close(); } }, box);
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    document.body.append(backdrop);
    // Focus the dialog itself (not the first field) so phones don't pop up a keyboard or date picker.
    (box.querySelector('[autofocus]') || box).focus({ preventScroll: true });
  });
}

export function confirmSheet(title, message, { yes = 'Yes', danger = false } = {}) {
  return sheet(title, (close) => el('div', { class: 'stack' },
    el('p', { class: 'muted' }, message),
    el('div', { class: 'row' },
      el('button', { class: 'btn grow', onclick: () => close(false) }, 'Cancel'),
      el('button', { class: `btn grow ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, yes))));
}

export const pad = (n) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const timeOf = (ms) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
export const prettyDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
export const shortDate = (date) => new Date(`${date}T12:00:00`).toLocaleDateString([], { month: 'short', day: 'numeric' });
export const fmtDur = (ms) => `0:${pad(Math.round((ms || 0) / 1000))}`;
export function timeAgo(ms) {
  const s = Math.max(1, Math.round((Date.now() - ms) / 1000));
  if (s < 60) return 'just now';
  const units = [[31536000, 'y'], [86400, 'd'], [3600, 'h'], [60, 'm']];
  for (const [n, u] of units) if (s >= n) return `${Math.floor(s / n)}${u} ago`;
  return 'just now';
}
export const hourLabel = (h) => new Date(2000, 0, 1, h).toLocaleTimeString([], { hour: 'numeric' });

export function avatar(username) {
  let h = 0;
  for (const c of username) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const node = el('div', { class: 'avatar', 'aria-hidden': 'true' }, username[0].toUpperCase());
  node.style.background = `hsl(${h % 360} 65% 45%)`;
  return node;
}

export function segmented(options, current, onChange, label) {
  const wrap = el('div', { class: 'seg', role: 'group', 'aria-label': label });
  for (const o of options) {
    wrap.append(el('button', {
      type: 'button', 'aria-pressed': String(o.id === current),
      onclick: () => {
        wrap.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', 'false'));
        wrap.querySelector(`[data-id="${o.id}"]`).setAttribute('aria-pressed', 'true');
        onChange(o.id);
      },
      'data-id': o.id,
    }, o.label));
  }
  return wrap;
}
