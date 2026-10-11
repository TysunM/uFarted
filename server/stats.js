import { TRIGGERS } from '../public/js/catalog.js';

const DAY = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Computes everything the dashboard needs from the user's raw rows.
 * `rows` are logs from (today - lookback) to today, `dayTotals` are per-date counts for all time
 * (cheap aggregate used for streaks and baseline).
 */
export function computeStats({ today, days, rows, dayTotals, totals, premium }) {
  const start = addDays(today, -(days - 1));
  const inRange = rows.filter((r) => r.local_date >= start && r.local_date <= today);

  const byDate = new Map(dayTotals.map((d) => [d.local_date, d]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const d = byDate.get(date);
    daily.push({ date, fart: d?.fart ?? 0, burp: d?.burp ?? 0 });
  }

  // Personal baseline: median of the last 14 *tracked* days before today (needs 5+ days of data).
  const prior = dayTotals.filter((d) => d.local_date < today && d.local_date >= addDays(today, -60))
    .sort((a, b) => (a.local_date < b.local_date ? 1 : -1)).slice(0, 14);
  const baseline = prior.length >= 5
    ? { fart: median(prior.map((d) => d.fart)), burp: median(prior.map((d) => d.burp)), days: prior.length }
    : null;

  // Streak: consecutive days with at least one log, ending today (or yesterday if today is empty so far).
  let streak = 0;
  let cursor = byDate.has(today) ? today : addDays(today, -1);
  while (byDate.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

  const hours = Array(24).fill(0);
  const typeCounts = new Map();
  const trig = new Map();
  let smellSum = 0;
  let smellN = 0;
  const discomfortDays = new Set();
  for (const r of inRange) {
    if ((r.discomfort ?? 0) >= 2) discomfortDays.add(r.local_date);
    hours[r.local_hour]++;
    const key = `${r.kind}:${r.type}`;
    typeCounts.set(key, (typeCounts.get(key) || 0) + 1);
    if (r.smell != null) { smellSum += r.smell; smellN++; }
    for (const t of JSON.parse(r.triggers)) {
      const e = trig.get(t) || { id: t, count: 0, smellSum: 0, smellN: 0, discomfort: 0 };
      e.count++;
      if (r.smell != null) { e.smellSum += r.smell; e.smellN++; }
      if ((r.discomfort ?? 0) >= 2) e.discomfort++;
      trig.set(t, e);
    }
  }
  const topTypes = [...typeCounts].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, count]) => ({ kind: k.split(':')[0], type: k.split(':')[1], count }));
  const triggers = [...trig.values()].filter((t) => TRIGGERS.some((x) => x.id === t.id))
    .sort((a, b) => b.count - a.count)
    .map((t) => ({ id: t.id, count: t.count, avgSmell: t.smellN ? +(t.smellSum / t.smellN).toFixed(1) : null, discomfort: t.discomfort }));

  // Gentle health nudges, computed over the last 7 days only.
  const week = rows.filter((r) => r.local_date > addDays(today, -7) && r.local_date <= today);
  const daysWith = (pred) => new Set(week.filter(pred).map((r) => r.local_date)).size;
  const flags = [];
  if (daysWith((r) => (r.discomfort ?? 0) >= 2) >= 3) flags.push('discomfort');
  if (daysWith((r) => r.type === 'wet') >= 3) flags.push('wet');
  if (daysWith((r) => r.kind === 'burp' && r.type === 'sulfur') >= 3) flags.push('sulfur');

  const todayRows = rows.filter((r) => r.local_date === today);
  const badges = [];
  const allTime = totals.fart + totals.burp;
  if (allTime >= 1) badges.push('first');
  if (streak >= 7) badges.push('streak7');
  if (streak >= 30) badges.push('streak30');
  if (allTime >= 100) badges.push('century');
  if (new Set(todayRows.map((r) => `${r.kind}:${r.type}`)).size >= 5 || totals.symphony) badges.push('symphony');
  if (totals.recorded > 0) badges.push('recorder');
  if (totals.nightOwl > 0) badges.push('night_owl');
  if (totals.bothEnds) badges.push('bilingual');

  return {
    today: { date: today, fart: byDate.get(today)?.fart ?? 0, burp: byDate.get(today)?.burp ?? 0 },
    days,
    daily,
    baseline,
    streak,
    hours,
    topTypes,
    triggers: premium ? triggers : null,
    triggersLocked: !premium && triggers.length > 0,
    smellAvg: smellN ? +(smellSum / smellN).toFixed(1) : null,
    discomfortDays: discomfortDays.size,
    flags,
    totals: { fart: totals.fart, burp: totals.burp, firstDate: totals.firstDate },
    badges,
  };
}
