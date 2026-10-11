import { KINDS, HEALTH, TRIGGERS, SMELL, typeInfo } from '../catalog.js';
import { el, svg, toast, localDate, prettyDate, timeOf } from '../ui.js';
import { api, createLog } from '../api.js';
import { openLogSheet } from '../logsheet.js';
import { player } from '../player.js';

const FLAG_TEXT = {
  discomfort: 'You’ve logged moderate or severe discomfort on 3+ days this week.',
  wet: 'You’ve logged wet ones on 3+ days this week.',
  sulfur: 'You’ve logged rotten-egg burps on 3+ days this week.',
};

function ring(count, target) {
  const r = 50;
  const c = 2 * Math.PI * r;
  const frac = Math.min(1, target ? count / target : 0);
  return svg('svg', { viewBox: '0 0 116 116', 'aria-hidden': 'true' },
    svg('circle', { class: 'track', cx: 58, cy: 58, r, fill: 'none', 'stroke-width': 11 }),
    svg('circle', { class: 'bar', cx: 58, cy: 58, r, fill: 'none', 'stroke-width': 11, 'stroke-linecap': 'round',
      'stroke-dasharray': c, 'stroke-dashoffset': c * (1 - frac) }));
}

function statusLine(kind, count, baseline) {
  const h = HEALTH[kind];
  if (baseline != null) {
    const usual = Math.round(baseline);
    if (count > usual * 1.75 + 3) return `Gassier than your usual ~${usual}`;
    return `Your usual: ~${usual}/day`;
  }
  return kind === 'fart' ? `Most people log ${h.low}–${h.high}` : `Normal: up to ~${h.high}`;
}

export async function renderToday(root, { refresh }) {
  const today = localDate();
  const [stats, { logs }] = await Promise.all([
    api(`/stats?today=${today}&days=7`),
    api(`/logs?date=${today}`),
  ]);

  const quick = async (kind) => {
    const res = await createLog({ kind, type: 'classic', occurredAt: Date.now(), tzOffset: new Date().getTimezoneOffset() });
    toast(res.offline ? 'Saved offline 📶' : `${KINDS[kind].emoji} +1 ${KINDS[kind].name.toLowerCase()}`);
    refresh();
  };
  const log = async (kind) => { if (await openLogSheet({ kind })) refresh(); };

  const counter = (kind) => {
    const count = stats.today[kind];
    const base = stats.baseline?.[kind];
    const target = Math.max(base ?? (kind === 'fart' ? HEALTH.fart.high : 10), count, 1);
    return el('div', { class: `card counter ${kind}` },
      el('button', { class: 'btn icon sm quick', 'aria-label': `Quick add one ${kind}`, title: 'Quick +1', onclick: () => quick(kind) }, '＋'),
      el('div', { class: 'ring' }, ring(count, target),
        el('div', { class: 'num' }, el('b', {}, count), el('span', {}, `${KINDS[kind].plural} today`))),
      el('p', { class: 'status muted' }, statusLine(kind, count, base)));
  };

  const entry = (l) => {
    const t = typeInfo(l.kind, l.type);
    const extras = [
      l.smell != null && SMELL[l.smell].split(' ')[0],
      ...l.triggers.map((id) => TRIGGERS.find((x) => x.id === id)?.emoji),
      l.discomfort >= 2 && '⚠️',
      l.postId && '🌍',
    ].filter(Boolean).join(' ');
    const row = el('button', { class: 'entry', onclick: async () => { if (await openLogSheet({ log: l })) refresh(); } },
      el('div', { class: `badge ${l.kind}`, 'aria-hidden': 'true' }, t.emoji),
      el('div', { class: 'grow' }, el('div', { class: 'row' }, el('strong', {}, t.name), l.hasAudio && el('span', { 'aria-label': 'has recording' }, '🎙️')),
        el('div', { class: 'meta' }, extras || (l.note ? l.note : 'Tap to add details'))),
      el('span', { class: 'when' }, timeOf(l.occurredAt)));
    if (!l.hasAudio) return row;
    return el('div', {}, row, el('div', { class: 'player-wrap' }, player({ src: `/api/audio/${l.audioId}`, peaks: l.peaks, durationMs: l.durationMs })));
  };

  root.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' },
      el('div', {}, el('p', { class: 'muted small' }, prettyDate(today)), el('h1', {}, 'Today')),
      stats.streak > 0 && el('span', { class: 'pill fire', title: 'Logging streak' }, `🔥 ${stats.streak} day${stats.streak === 1 ? '' : 's'}`)),
    el('div', { class: 'counters' }, counter('fart'), counter('burp')),
    el('div', { class: 'log-buttons' },
      el('button', { class: 'big-log fart', onclick: () => log('fart') }, el('span', { class: 'emoji' }, '💨'), 'Log a fart'),
      el('button', { class: 'big-log burp', onclick: () => log('burp') }, el('span', { class: 'emoji' }, '🫧'), 'Log a burp')),
    stats.flags.length > 0 && el('div', { class: 'card warn stack tight', role: 'note' },
      el('h3', {}, '🩺 Worth keeping an eye on'),
      stats.flags.map((f) => el('p', { class: 'small' }, FLAG_TEXT[f])),
      el('p', { class: 'small' }, 'That can be totally normal, but if it keeps up or comes with any warning signs below, talk to a doctor.'),
      el('a', { href: '#/insights', class: 'small' }, 'See your patterns →')),
    el('section', { class: 'card stack tight' },
      el('div', { class: 'row spread' }, el('h2', {}, 'Timeline'), el('span', { class: 'muted small' }, `${logs.length} logged`)),
      logs.length ? el('div', { class: 'timeline' }, logs.map(entry))
        : el('div', { class: 'empty' }, el('span', { class: 'big' }, '🌬️'), el('p', {}, 'Nothing yet today.'), el('p', { class: 'small' }, 'Tap a button above when nature calls.'))),
    whatsNormal()));
}

export function whatsNormal() {
  return el('details', { class: 'card' },
    el('summary', {}, '🔬 What’s normal?'),
    el('div', { class: 'stack' },
      el('div', { class: 'stack tight' }, el('h3', {}, '💨 Farts'), el('p', { class: 'small' }, HEALTH.fart.detail)),
      el('div', { class: 'stack tight' }, el('h3', {}, '🫧 Burps'), el('p', { class: 'small' }, HEALTH.burp.detail)),
      el('div', { class: 'stack tight' }, el('h3', {}, '🚩 See a doctor if gas comes with'),
        el('ul', { class: 'flags small' }, HEALTH.redFlags.map((f) => el('li', {}, f)))),
      el('p', { class: 'tiny muted' }, 'For fun and general wellness only — not medical advice or a diagnosis. Sources: ',
        HEALTH.sources.map((s, i) => [i ? ' · ' : '', el('a', { href: s.url, target: '_blank', rel: 'noopener' }, s.name)]))));
}
