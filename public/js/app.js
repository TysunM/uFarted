import { el, toast } from './ui.js';
import { api, flushQueue, queuedCount } from './api.js';
import { state } from './state.js';
import { renderToday } from './views/today.js';
import { renderInsights } from './views/insights.js';
import { renderCommunity } from './views/community.js';
import { renderMe, loginSheet } from './views/me.js';
import { openLogSheet } from './logsheet.js';

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

function welcome() {
  const age = el('input', { type: 'checkbox', id: 'age' });
  const go = el('button', { class: 'btn primary block', disabled: true }, 'Start tracking — it’s free');
  age.addEventListener('change', () => { go.disabled = !age.checked; });
  go.addEventListener('click', async () => {
    go.disabled = true;
    try { await api('/auth/guest', { method: 'POST', body: { ageOk: true } }); await boot(); }
    catch (err) { toast(err.message, { error: true }); go.disabled = false; }
  });
  root.replaceChildren(el('div', { class: 'welcome' },
    el('div', { class: 'logo', 'aria-hidden': 'true' }, '💨'),
    el('div', { class: 'stack tight' }, el('h1', {}, state.config.appName), el('p', { class: 'muted' }, 'The fun, science-backed gas tracker.')),
    el('div', { class: 'features' },
      el('div', {}, el('span', {}, '📝'), 'Log farts & burps — 26 types, from Toot to Thunderclap'),
      el('div', {}, el('span', {}, '🎙️'), 'Record the legendary ones & share them'),
      el('div', {}, el('span', {}, '📊'), 'See your daily counts, patterns & food triggers'),
      el('div', {}, el('span', {}, '🔬'), 'Know what’s actually normal — backed by 2026 research')),
    el('label', { class: 'check', for: 'age' }, age, el('span', {}, 'I’m 13 or older and agree to the ', el('a', { href: '/terms', target: '_blank' }, 'Terms'), ' and ', el('a', { href: '/privacy', target: '_blank' }, 'Privacy Policy'), '.')),
    go,
    el('button', { class: 'btn ghost', onclick: () => loginSheet(boot) }, 'I already have an account'),
    el('a', { class: 'small', href: '#/community', onclick: (e) => { e.preventDefault(); location.hash = '#/community'; showShell(); } }, 'Just browse the community →')));
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
