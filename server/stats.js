import { TRIGGERS } from '../public/js/catalog.js';

const DAY = 86_400_000;
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
export const addDays = (date, n) => new Date(Date.parse(`${date}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const round1 = (n) => +n.toFixed(1);
const avg = (nums) => (nums.length ? round1(nums.reduce((a, b) => a + b, 0) / nums.length) : null);

export function median(nums) {
  if (!nums.length) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * Computes everything the dashboard needs from the user's raw rows.
 * `rows` are logs and `checks` are daily gut checks from (today - lookback) to today;
 * `dayTotals` are per-date log counts for all time (cheap aggregate used for streaks and baseline).
 */
export function computeStats({ today, days, rows, checks, dayTotals, totals }) {
  const start = addDays(today, -(days - 1));
  const inRange = rows.filter((r) => r.local_date >= start && r.local_date <= today);
  const checkByDate = new Map(checks.map((c) => [c.local_date, c]));

  const byDate = new Map(dayTotals.map((d) => [d.local_date, d]));
  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    const d = byDate.get(date);
    const c = checkByDate.get(date);
    daily.push({ date, fart: d?.fart ?? 0, burp: d?.burp ?? 0, bloating: c?.bloating ?? null, pain: c?.pain ?? null });
  }

  // Personal baseline: median of the last 14 *tracked* days before today (needs 5+ days of data).
  const prior = dayTotals.filter((d) => d.local_date < today && d.local_date >= addDays(today, -60))
    .sort((a, b) => (a.local_date < b.local_date ? 1 : -1)).slice(0, 14);
  const baseline = prior.length >= 5
    ? { fart: median(prior.map((d) => d.fart)), burp: median(prior.map((d) => d.burp)), days: prior.length }
    : null;

  // Streak: consecutive days with a log or a gut check, ending today (or yesterday if today is empty so far).
  const active = new Set([...byDate.keys(), ...totals.checkDates]);
  let streak = 0;
  let cursor = active.has(today) ? today : addDays(today, -1);
  while (active.has(cursor)) { streak++; cursor = addDays(cursor, -1); }

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
      const e = trig.get(t) || { id: t, count: 0, smellSum: 0, smellN: 0, discomfort: 0, dates: new Set() };
      e.count++;
      e.dates.add(r.local_date);
      if (r.smell != null) { e.smellSum += r.smell; e.smellN++; }
      if ((r.discomfort ?? 0) >= 2) e.discomfort++;
      trig.set(t, e);
    }
  }
  const topTypes = [...typeCounts].sort((a, b) => b[1] - a[1]).slice(0, 5)
    .map(([k, count]) => ({ kind: k.split(':')[0], type: k.split(':')[1], count }));

  // Gut checks in range, and how bloated you were on days a trigger showed up vs days it didn't.
  const rangeChecks = checks.filter((c) => c.local_date >= start && c.local_date <= today);
  const bloatOn = (pred) => avg(rangeChecks.filter((c) => c.bloating != null && pred(c.local_date)).map((c) => c.bloating));
  const triggers = [...trig.values()].filter((t) => TRIGGERS.some((x) => x.id === t.id))
    .sort((a, b) => b.count - a.count)
    .map((t) => ({
      id: t.id, count: t.count, discomfort: t.discomfort,
      avgSmell: t.smellN ? round1(t.smellSum / t.smellN) : null,
      bloatWith: bloatOn((d) => t.dates.has(d)),
      bloatWithout: bloatOn((d) => !t.dates.has(d)),
    }));
  const gut = {
    today: checkByDate.get(today) ? { bloating: checkByDate.get(today).bloating, pain: checkByDate.get(today).pain } : null,
    checkedDays: rangeChecks.length,
    bloatedDays: rangeChecks.filter((c) => (c.bloating ?? 0) >= 2).length,
    painDays: rangeChecks.filter((c) => (c.pain ?? 0) >= 2).length,
    avgBloating: avg(rangeChecks.filter((c) => c.bloating != null).map((c) => c.bloating)),
    avgPain: avg(rangeChecks.filter((c) => c.pain != null).map((c) => c.pain)),
  };

  // Gentle health nudges, computed over the last 7 days only.
  const weekStart = addDays(today, -6);
  const week = rows.filter((r) => r.local_date >= weekStart && r.local_date <= today);
  const weekChecks = checks.filter((c) => c.local_date >= weekStart && c.local_date <= today);
  const daysWith = (pred) => new Set(week.filter(pred).map((r) => r.local_date)).size;
  const flags = [];
  if (weekChecks.filter((c) => (c.bloating ?? 0) >= 2).length >= 3) flags.push('bloating');
  if (weekChecks.filter((c) => (c.pain ?? 0) >= 2).length >= 3) flags.push('pain');
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
  if (totals.checkDates.length >= 7) badges.push('gut_feeling');

  return {
    today: { date: today, fart: byDate.get(today)?.fart ?? 0, burp: byDate.get(today)?.burp ?? 0 },
    days,
    daily,
    baseline,
    streak,
    hours,
    topTypes,
    triggers,
    gut,
    smellAvg: smellN ? round1(smellSum / smellN) : null,
    discomfortDays: discomfortDays.size,
    flags,
    totals: { fart: totals.fart, burp: totals.burp, firstDate: totals.firstDate },
    badges,
  };
}
