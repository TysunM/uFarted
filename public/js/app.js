import { el, toast } from './ui.js';
import { api, flushQueue, queuedCount } from './api.js';
import { state } from './state.js';
import { renderToday } from './views/today.js';
import { renderInsights } from './views/insights.js';
import { renderCommunity } from './views/community.js';
import { renderMe, loginSheet } from './views/me.js';
import { openLogSheet } from './logsheet.js';
import { checkAge, MIN_AGE } from './age.js';

const root = document.getElementById('app');
const TABS = [
  { id: 'today', icon: '💨', label: 'Today', render: renderToday },
  { id: 'insights', icon: '📊', label: 'Insights', render: renderInsights },
  { id: 'community', icon: '🎙️', label: 'Community', render: renderCommunity },
  { id: 'me', icon: '🙋', label: 'Me', render: renderMe },
];
const view = el('main', { id: 'view' });
const nav = el('nav', { class: 'nav', 'aria-label': 'Main' },
  TABS.map((t) => el('a', { href: `#/${t.id}`, 'data-tab': t.id }, el('span', { class: 'ico', 'aria-hidden': 'true' }, t.icon), t.label)));

const sharedPostId = () => Number(location.pathname.match(/^\/p\/(\d+)$/)?.[1]) || null;
const currentTab = () => {
  const id = location.hash.replace(/^#\//, '').split('?')[0];
  return TABS.find((t) => t.id === id) ?? (sharedPostId() ? TABS[2] : TABS[0]);
};

let renderSeq = 0;
async function route() {
  const tab = currentTab();
  nav.querySelectorAll('a').forEach((a) => (a.dataset.tab === tab.id ? a.setAttribute('aria-current', 'page') : a.removeAttribute('aria-current')));
  const seq = ++renderSeq;
  const target = el('div');
  try {
    await tab.render(target, { refresh: route, reboot: boot, focusId: tab.id === 'community' ? sharedPostId() : null });
    if (seq !== renderSeq) return; // a newer navigation won
    view.replaceChildren(target);
    if (sharedPostId()) history.replaceState(null, '', '/#/community'); // shared link shown once; normal URLs after
  } catch (err) {
    if (seq !== renderSeq) return;
    if (err.status === 401) return boot();
    view.replaceChildren(el('div', { class: 'page' }, el('div', { class: 'card empty' }, el('span', { class: 'big' }, '😵‍💫'),
      el('p', {}, navigator.onLine ? 'Couldn’t load this screen.' : 'You’re offline.'),
      el('button', { class: 'btn primary sm', onclick: route }, 'Try again'))));
  }
  const log = new URLSearchParams(location.hash.split('?')[1]).get('log');
  if (log === 'fart' || log === 'burp') {
    history.replaceState(null, '', '#/today');
    if (await openLogSheet({ kind: log })) route();
  }
}

const UNDER_AGE_KEY = 'ufarted_under_age';
const rememberUnderAge = () => { try { localStorage.setItem(UNDER_AGE_KEY, '1'); } catch { /* storage blocked */ } };
const isUnderAge = () => { try { return localStorage.getItem(UNDER_AGE_KEY) === '1'; } catch { return false; } };
const browseCommunity = (e) => { e?.preventDefault(); location.hash = '#/community'; showShell(); };

// Shown to under-13s, and on later visits from the same device, so going back can't change the answer.
function tooYoung() {
  root.replaceChildren(el('div', { class: 'welcome' },
    el('div', { class: 'logo', 'aria-hidden': 'true' }, '🎈'),
    el('div', { class: 'stack tight' }, el('h1', {}, 'Almost!'),
      el('p', { class: 'muted' }, `${state.config.appName} accounts are for ages 13 and up. You can still listen to the funniest clips in the community — no account needed.`)),
    el('button', { class: 'btn primary block', onclick: browseCommunity }, '🎧 Listen to the community'),
    el('p', { class: 'small muted' }, 'Got a tummy question? Ask a grown-up you trust.'),
    el('button', { class: 'btn ghost sm', onclick: () => loginSheet(boot) }, 'Grown-up with an account? Log in')));
}

// Neutral age screen: asks the year without hinting at the cutoff (FTC COPPA guidance).
function welcome() {
  if (isUnderAge()) return tooYoung();
  const thisYear = new Date().getFullYear();
  const year = el('select', { class: 'input', id: 'birth-year', 'aria-label': 'Birth year' },
    el('option', { value: '', disabled: true, selected: true }, 'Select year'),
    Array.from({ length: 101 }, (_, i) => el('option', { value: thisYear - i }, thisYear - i)));
  const month = el('select', { class: 'input', id: 'birth-month', 'aria-label': 'Birth month' },
    el('option', { value: '', disabled: true, selected: true }, 'Select month'),
    Array.from({ length: 12 }, (_, i) => el('option', { value: i + 1 }, new Date(2000, i, 1).toLocaleDateString([], { month: 'long' }))));
  const monthField = el('label', { class: 'field hidden', for: 'birth-month' }, 'And the month?', month);
  const go = el('button', { class: 'btn primary block', disabled: true }, 'Start tracking — it’s free');
  const answer = () => checkAge(Number(year.value), Number(month.value) || undefined);
  const update = () => {
    const a = year.value ? answer() : null;
    monthField.classList.toggle('hidden', Number(year.value) !== thisYear - MIN_AGE); // only the borderline year needs a month
    go.disabled = !a || Boolean(a.needMonth);
  };
  year.addEventListener('change', () => { month.value = ''; update(); });
  month.addEventListener('change', update);
  go.addEventListener('click', async () => {
    const a = answer();
    if (!a.ok) { rememberUnderAge(); return tooYoung(); }
    go.disabled = true;
    try {
      await api('/auth/guest', { method: 'POST', body: { birthYear: Number(year.value), birthMonth: Number(month.value) || undefined } });
      await boot();
    } catch (err) {
      if (err.status === 403) { rememberUnderAge(); return tooYoung(); }
      toast(err.message, { error: true });
      go.disabled = false;
    }
  });
  root.replaceChildren(el('div', { class: 'welcome' },
    el('div', { class: 'logo', 'aria-hidden': 'true' }, '💨'),
    el('div', { class: 'stack tight' }, el('h1', {}, state.config.appName), el('p', { class: 'muted' }, 'The fart tracker for your gut health. Free.')),
    el('div', { class: 'features' },
      el('div', {}, el('span', {}, '🩺'), 'Check in on bloating & belly pain — 2 taps a day'),
      el('div', {}, el('span', {}, '🧪'), 'Find the foods that set you off'),
      el('div', {}, el('span', {}, '💨'), 'Log farts & burps — 39 types, from Toot to Thunderclap'),
      el('div', {}, el('span', {}, '📋'), 'Bring a printable report to your doctor'),
      el('div', {}, el('span', {}, '🎙️'), 'Record the legendary ones & share them')),
    el('div', { class: 'stack tight age' },
      el('label', { class: 'field', for: 'birth-year' }, 'What year were you born?', year),
      monthField),
    go,
    el('p', { class: 'tiny muted' }, 'By continuing you agree to the ', el('a', { href: '/terms', target: '_blank' }, 'Terms'), ' and ',
      el('a', { href: '/privacy', target: '_blank' }, 'Privacy Policy'), '. We only use your birth year to check your age — it isn’t saved.'),
    el('button', { class: 'btn ghost', onclick: () => loginSheet(boot) }, 'I already have an account'),
    el('a', { class: 'small', href: '#/community', onclick: browseCommunity }, 'Just browse the community →')));
}

function showShell() {
  if (!root.contains(view)) root.replaceChildren(view, nav);
  route();
}

export async function boot() {
  const { user, config } = await api('/me');
  state.me = user;
  state.config = config;
  document.title = config.appName;
  if (!user && !sharedPostId() && !location.hash.startsWith('#/community')) return welcome();
  root.replaceChildren(view, nav);
  await route();
  if (user && queuedCount()) {
    const sent = await flushQueue();
    if (sent) { toast(`Synced ${sent} offline log${sent > 1 ? 's' : ''} ✅`); route(); }
  }
}

window.addEventListener('hashchange', () => { if (root.contains(view)) route(); });
window.addEventListener('online', async () => { if (state.me && (await flushQueue())) route(); });
// Coming back to the app (e.g. the next morning): refresh so "today" is really today.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hiddenAt && Date.now() - hiddenAt > 5 * 60_000 && root.contains(view) && !document.querySelector('.backdrop')) route();
});

if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
boot().catch(() => {
  root.replaceChildren(el('div', { class: 'welcome' }, el('div', { class: 'logo' }, '😵‍💫'), el('p', {}, 'Can’t reach the server.'),
    el('button', { class: 'btn primary', onclick: () => location.reload() }, 'Retry')));
});
