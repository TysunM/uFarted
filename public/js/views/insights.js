import { BADGES, TRIGGERS, SMELL, BLOATING, typeInfo } from '../catalog.js';
import { el, svg, localDate, shortDate, hourLabel, segmented } from '../ui.js';
import { api } from '../api.js';
import { state } from '../state.js';
import { shareCard } from '../share.js';

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
      nodes.push(svg('text', { x: x + w / 2, y: H - 4, 'text-anchor': 'middle' }, dayLabel(d, daily.length)));
    }
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Farts and burps per day' }, nodes);
}

const dayLabel = (d, n) => (n <= 7 ? new Date(`${d.date}T12:00`).toLocaleDateString([], { weekday: 'short' }) : shortDate(d.date));

// Daily bloating (purple) and belly pain (red) on a 0–3 scale; days without a check-in stay empty.
export function gutChart(daily) {
  const W = 340, H = 120, P = { l: 4, r: 4, t: 6, b: 20 };
  const bw = (W - P.l - P.r) / daily.length;
  const y = (v) => P.t + (H - P.t - P.b) * (1 - v / 3);
  const step = Math.ceil(daily.length / 7);
  const nodes = [1, 2, 3].map((v) => svg('line', { class: 'grid', x1: P.l, x2: W - P.r, y1: y(v), y2: y(v) }));
  daily.forEach((d, i) => {
    const w = Math.max(1, bw * 0.34);
    const x = P.l + i * bw + bw * 0.14;
    if (d.bloating != null) nodes.push(svg('rect', { class: 'h', x, width: w, y: y(Math.max(d.bloating, 0.12)), height: y(0) - y(Math.max(d.bloating, 0.12)), rx: Math.min(2, w / 2) }));
    if (d.pain != null) nodes.push(svg('rect', { class: 'p', x: x + w + bw * 0.04, width: w, y: y(Math.max(d.pain, 0.12)), height: y(0) - y(Math.max(d.pain, 0.12)), rx: Math.min(2, w / 2) }));
    if (i % step === 0 || i === daily.length - 1) nodes.push(svg('text', { x: P.l + i * bw + bw / 2, y: H - 4, 'text-anchor': 'middle' }, dayLabel(d, daily.length)));
  });
  return svg('svg', { class: 'chart', viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': 'Bloating and belly pain per day' }, nodes);
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
  const g = s.gut;
  const tracked = s.daily.filter((d) => d.fart + d.burp > 0).length || 1;
  const avg = (k) => (s.daily.reduce((n, d) => n + d[k], 0) / tracked).toFixed(1);
  const peak = s.hours.some(Boolean) ? s.hours.indexOf(Math.max(...s.hours)) : null;
  const tile = (value, label) => el('div', { class: 'tile' }, el('b', {}, value), el('span', {}, label));

  const rangeSeg = segmented([7, 30, 90, 365].map((d) => ({ id: d, label: d === 365 ? '1y' : `${d}d` })), range,
    (d) => { range = d; refresh(); }, 'Date range');

  const gutCard = el('section', { class: 'card stack tight gut' },
    el('div', { class: 'row spread' }, el('h2', {}, '🩺 Gut health'),
      el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'lh' }), 'Bloating'), el('span', {}, el('i', { class: 'lp' }), 'Pain'))),
    g.checkedDays ? gutChart(s.daily) : el('p', { class: 'small muted' }, 'Do the 2-tap gut check on the Today tab and your bloating and pain trends show up here.'),
    el('div', { class: 'tiles' },
      tile(g.bloatedDays, 'bloated days'),
      tile(g.painDays, 'days with pain'),
      tile(g.avgBloating == null ? '—' : BLOATING[Math.round(g.avgBloating)].split(' ')[0], 'avg bloating')),
    el('p', { class: 'tiny muted' }, `${g.checkedDays} of ${s.days} days checked in.`));

  const triggerRow = (t) => {
    const info = TRIGGERS.find((x) => x.id === t.id);
    const bar = el('div', { class: 'bar-mini' });
    bar.style.width = `${(t.count / s.triggers[0].count) * 100}%`;
    const worse = t.bloatWith != null && t.bloatWithout != null && t.bloatWith - t.bloatWithout >= 0.5;
    const detail = [`${t.count}×`, t.avgSmell != null && `smell ${t.avgSmell}/4`, t.discomfort && `⚠️ ${t.discomfort}`].filter(Boolean).join(' · ');
    return el('div', { class: 'list-row' }, el('span', {}, info.emoji), el('div', { class: 'grow stack tight' },
      el('div', { class: 'row spread small' }, el('strong', {}, info.name), el('span', { class: 'muted' }, detail)), bar,
      t.bloatWith != null && el('span', { class: `tiny ${worse ? 'warn-text' : 'muted'}` },
        `Bloating ${t.bloatWith}/3 on days with it${t.bloatWithout != null ? ` vs ${t.bloatWithout} without` : ''}${worse ? ' — worth testing' : ''}`)));
  };
  const triggerCard = el('section', { class: 'card stack tight' },
    el('h2', {}, '🧪 Your triggers'),
    s.triggers.length
      ? [s.triggers.slice(0, 8).map(triggerRow),
        el('p', { class: 'tiny muted' }, 'Patterns, not proof. To test one, cut it for 2 weeks and watch your bloating — ideally with a doctor or dietitian.')]
      : el('p', { class: 'small muted' }, 'Tag possible triggers when you log, and do the daily gut check. We’ll show which foods line up with bloating.'));

  root.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Insights'),
      el('button', { class: 'btn sm', onclick: () => shareCard(s, state.config.appName) }, '📤 Share today')),
    rangeSeg,
    gutCard,
    triggerCard,
    el('section', { class: 'card stack tight' },
      el('div', { class: 'row spread' }, el('h2', {}, '💨 Gas per day'),
        el('div', { class: 'legend' }, el('span', {}, el('i', { class: 'lf' }), 'Farts'), el('span', {}, el('i', { class: 'lb' }), 'Burps'))),
      dailyChart(s.daily)),
    el('div', { class: 'tiles' },
      tile(avg('fart'), 'farts / tracked day'),
      tile(avg('burp'), 'burps / tracked day'),
      tile(`🔥${s.streak}`, 'day streak'),
      tile(s.baseline ? Math.round(s.baseline.fart) : '—', 'your usual farts'),
      tile(peak == null ? '—' : hourLabel(peak), 'peak hour'),
      tile(s.smellAvg == null ? '—' : SMELL[Math.round(s.smellAvg)].split(' ')[0], 'avg smell')),
    !s.baseline && el('p', { class: 'tiny muted center' }, 'Log for 5 days to unlock your personal baseline — the number that actually matters.'),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🕐 When it happens'), hourChart(s.hours),
      el('p', { class: 'tiny muted' }, 'Most people peak between 6 and 10 pm, after the biggest meal of the day.')),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🏆 Your top types'),
      s.topTypes.length ? s.topTypes.map((t) => {
        const info = typeInfo(t.kind, t.type);
        return el('div', { class: 'list-row' }, el('span', {}, info.emoji), el('span', { class: 'grow' }, info.name), el('strong', {}, t.count));
      }) : el('p', { class: 'small muted' }, 'Nothing logged in this range yet.')),
    el('section', { class: 'card stack tight' }, el('h2', {}, '🎖️ Badges'),
      el('div', { class: 'badges' }, BADGES.map((b) => el('div', { class: `badge-item${s.badges.includes(b.id) ? '' : ' locked'}`, title: b.desc },
        el('span', { class: 'e' }, b.emoji), b.name)))),
    el('section', { class: 'card stack tight' }, el('h2', {}, '📋 Your data'),
      el('p', { class: 'small muted' }, 'Seeing a doctor about your gut? Bring a printable 90-day summary — free.'),
      el('div', { class: 'row wrap' },
        el('a', { class: 'btn sm primary', href: '/report', target: '_blank', rel: 'noopener' }, '🩺 Doctor report'),
        el('a', { class: 'btn sm', href: '/api/export.csv', download: '' }, '⬇️ Export CSV')))));
}
