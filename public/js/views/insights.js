import { BADGES, TRIGGERS, SMELL, typeInfo } from '../catalog.js';
import { el, svg, localDate, shortDate, hourLabel, segmented, toast } from '../ui.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { shareCard } from '../share.js';
import { startCheckout } from './me.js';

let range = 7;

export function dailyChart(daily) {
  const W = 340, H = 150, P = { l: 22, r: 4, t: 8, b: 20 };
  const max = Math.max(4, ...daily.map((d) => d.fart + d.burp));
  const bw = (W - P.l - P.r) / daily.length;
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / max);
  const step = Math.ceil(daily.length / 7);
  const nodes = [0, 0.5, 1].map((f) => {
    const v = Math.round(max * f);
    return [svg('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: y(v), y2: y(v) }), svg('text', { x: 0, y: y(v) + 3 }, v)];
  });
  daily.forEach((d, i) => {
    const x = P.l + i * bw + bw * 0.15;
    const w = Math.max(1, bw * 0.7);
    if (d.fart) nodes.push(svg('rect', { class: 'f', x, width: w, y: y(d.fart), height: y(0) - y(d.fart), rx: Math.min(3, w / 2) }));
    if (d.burp) nodes.push(svg('rect', { class: 'b', x, width: w, y: y(d.fart + d.burp), height: y(0) - y(d.burp), rx: Math.min(3, w / 2) }));
    if (i % step === 0 || i === daily.length - 1) {
      nodes.push(svg('text', { x: x + w / 2, y: H - 4, 'text-anchor': 'middle' }, daily.length <= 7 ? new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' }) : shortDate(d.date)));
    }
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Farts and burps per day' }, nodes);
}

export function hourChart(hours) {
  const W = 340, H = 90, max = Math.max(1, ...hours), bw = W / 24;
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Activity by hour of day' },
    hours.map((v, h) => svg('rect', { class: 'h', x: h * bw + 1, width: bw - 2, y: 6 + (H - 26) * (1 - v / max), height: Math.max(v ? 2 : 0, (H - 26) * (v / max)), rx: 2 })),
    [0, 6, 12, 18].map((h) => svg('text', { x: h * bw + bw / 2, y: H - 4, 'text-anchor': 'start' }, hourLabel(h))));
}

export async function renderInsights(root, { refresh }) {
  const today = localDate();
  const s = await api(`/stats?today=${today}&days=${range}`);
  const premium = state.me.isPremium;
  const billing = state.config.billingEnabled;
  const tracked = s.daily.filter((d) => d.fart + d.burp > 0).length || 1;
  const avg = (k) => (s.daily.reduce((n, d) => n + d[k], 0) / tracked).toFixed(1);
  const peak = s.hours.some(Boolean) ? s.hours.indexOf(Math.max(...s.hours)) : null;

  const lockOverlay = (msg) => el('div', { class: 'lock-overlay' },
    el('strong', {}, '⭐ Premium'), el('p', { class: 'small' }, msg),
    el('button', { class: 'btn primary sm', onclick: startCheckout }, `Unlock — ${state.config.premiumPrice}`));

  const rangeSeg = segmented([7, 30, 90, 365].map((d) => ({ id: d, label: d === 365 ? '1y' : `${d}d` })), range, (d) => {
    if (d > state.config.freeHistoryDays && !premium) { toast('90-day and 1-year history are Premium ⭐'); return refresh(); }
    range = d; refresh();
  }, 'Date range');

  const triggerCard = el('section', { class: 'card stack tight lock' },
    el('h2', {}, '🧪 Your triggers'),
    s.triggers?.length
      ? s.triggers.slice(0, 8).map((t) => {
        const info = TRIGGERS.find((x) => x.id === t.id);
        const top = s.triggers[0].count;
        const bar = el('div', { class: 'bar-mini' });
        bar.style.width = `${(t.count / top) * 100}%`;
        return el('div', { class: 'list-row' }, el('span', {}, info.emoji), el('div', { class: 'grow stack tight' },
          el('div', { class: 'row spread small' }, el('strong', {}, info.name), el('span', { class: 'muted' }, `${t.count}×${t.avgSmell != null ? ` · smell ${t.avgSmell}/4` : ''}${t.discomfort ? ` · ⚠️ ${t.discomfort}` : ''}`)), bar));
      })
      : el('p', { class: 'small muted' }, s.triggersLocked ? 'See which foods and habits show up most with your gas, how smelly they get, and which come with discomfort.'
        : 'Tag possible triggers when you log, and we’ll show which ones come up most — and which smell worst.'),
    s.triggersLocked && billing && lockOverlay('See which foods line up with your gas.'));

  root.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Insights'),
      el('button', { class: 'btn sm', onclick: () => shareCard(s, state.config.appName) }, '📤 Share today')),
    rangeSeg,
    el('section', { class: 'card stack tight' },
      el('div', { class: 'row spread' }, el('h2', {}, 'Per day'),
        el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'lf' }), 'Farts'), el('span', {}, el('i', { class: 'lb' }), 'Burps'))),
      dailyChart(s.daily),
      s.limited && el('p', { class: 'tiny muted' }, `Showing ${s.days} days. Longer history is Premium.`)),
    el('div', { class: 'tiles' },
      el('div', { class: 'tile' }, el('b', {}, avg('fart')), el('span', {}, 'farts / tracked day')),
      el('div', { class: 'tile' }, el('b', {}, avg('burp')), el('span', {}, 'burps / tracked day')),
      el('div', { class: 'tile' }, el('b', {}, `🔥${s.streak}`), el('span', {}, 'day streak')),
      el('div', { class: 'tile' }, el('b', {}, s.baseline ? Math.round(s.baseline.fart) : '—'), el('span', {}, 'your usual farts')),
      el('div', { class: 'tile' }, el('b', {}, peak == null ? '—' : hourLabel(peak)), el('span', {}, 'peak hour')),
      el('div', { class: 'tile' }, el('b', {}, s.smellAvg == null ? '—' : SMELL[Math.round(s.smellAvg)].split(' ')[0]), el('span', {}, 'avg smell'))),
    !s.baseline && el('p', { class: 'tiny muted center' }, 'Log for 5 days to unlock your personal baseline — the number that actually matters.'),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🕐 When it happens'), hourChart(s.hours),
      el('p', { class: 'tiny muted' }, 'Most people peak between 6 and 10 pm, after the biggest meal of the day.')),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🏆 Your top types'),
      s.topTypes.length ? s.topTypes.map((t) => {
        const info = typeInfo(t.kind, t.type);
        return el('div', { class: 'list-row' }, el('span', {}, info.emoji), el('span', { class: 'grow' }, info.name), el('strong', {}, t.count));
      }) : el('p', { class: 'small muted' }, 'Nothing logged in this range yet.')),
    triggerCard,
    el('section', { class: 'card stack tight' }, el('h2', {}, '🎖️ Badges'),
      el('div', { class: 'badges' }, BADGES.map((b) => el('div', { class: `badge-item${s.badges.includes(b.id) ? '' : ' locked'}`, title: b.desc },
        el('span', { class: 'e' }, b.emoji), b.name)))),
    el('section', { class: 'card stack tight' }, el('h2', {}, '📋 Your data'),
      el('p', { class: 'small muted' }, 'Heading to a doctor about your gut? Bring a printable 90-day summary.'),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm', href: '/api/export.csv', download: '' }, '⬇️ Export CSV'),
        premium ? el('a', { class: 'btn sm primary', href: '/report', target: '_blank', rel: 'noopener' }, '🩺 Doctor report')
          : billing && el('button', { class: 'btn sm', onclick: startCheckout }, '🩺 Doctor report ⭐')))));
}
