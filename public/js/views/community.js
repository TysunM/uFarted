import { KINDS, REACTIONS, REPORT_REASONS, typeInfo } from '../catalog.js';
import { el, sheet, toast, confirmSheet, segmented, avatar, timeAgo } from '../ui.js';
import { api } from '../api.js';
import { player } from '../player.js';
import { state } from '../state.js';

let sort = 'new';

async function sharePost(post) {
  const url = `${location.origin}/p/${post.id}`;
  const t = typeInfo(post.kind, post.type);
  try {
    if (navigator.share) return await navigator.share({ title: `${t.emoji} ${t.name} by @${post.username}`, url });
    await navigator.clipboard.writeText(url);
    toast('Link copied 🔗');
  } catch (err) {
    if (err?.name !== 'AbortError') toast(url);
  }
}

function postCard(post, { refresh, featured = false }) {
  const t = typeInfo(post.kind, post.type);
  const mine = state.me && post.username === state.me.username;
  const reactRow = el('div', { class: 'reactions', role: 'group', 'aria-label': 'Reactions' });
  const paintReactions = (p) => reactRow.replaceChildren(...REACTIONS.map((r) => el('button', {
    class: 'react', 'aria-pressed': String(p.mine === r.id), 'aria-label': `React ${r.emoji}`,
    onclick: async () => {
      if (!state.me) return toast('Start tracking to react 💨');
      if (state.me.isGuest) return toast('Claim a username on the Me tab to react 🙋');
      try {
        const res = await api(`/posts/${p.id}/reaction`, { method: 'PUT', body: { emoji: p.mine === r.id ? null : r.id } });
        Object.assign(p, res.post);
        paintReactions(p);
      } catch (err) { toast(err.message, { error: true }); }
    },
  }, r.emoji, el('span', {}, p.reactions[r.id] || ''))));
  paintReactions(post);

  const more = async () => {
    const choice = await sheet('Options', (close) => el('div', { class: 'menu' },
      el('button', { class: 'btn block', onclick: () => close('share') }, '🔗 Share link'),
      mine && el('button', { class: 'btn block danger', onclick: () => close('delete') }, '🗑️ Delete post'),
      !mine && state.me && !state.me.isGuest && el('button', { class: 'btn block', onclick: () => close('report') }, '🚩 Report'),
      !mine && state.me && el('button', { class: 'btn block', onclick: () => close('block') }, `🚫 Block @${post.username}`),
      state.me?.isAdmin && !mine && el('button', { class: 'btn block danger', onclick: () => close('delete') }, '🛡️ Remove (admin)')));
    try {
      if (choice === 'share') await sharePost(post);
      if (choice === 'delete' && await confirmSheet('Delete this post?', 'The clip stays in your private log.', { yes: 'Delete', danger: true })) {
        await api(`/posts/${post.id}`, { method: 'DELETE' }); toast('Post removed'); refresh();
      }
      if (choice === 'report') {
        const reason = await sheet('Report post', (close) => el('div', { class: 'menu' },
          el('p', { class: 'small muted' }, 'Reports are anonymous. Posts with several reports are hidden automatically while we review.'),
          REPORT_REASONS.map((r) => el('button', { class: 'btn block', onclick: () => close(r.id) }, r.name))));
        if (reason) { await api(`/posts/${post.id}/report`, { method: 'POST', body: { reason } }); toast('Thanks — we’ll take a look 🛡️'); }
      }
      if (choice === 'block' && await confirmSheet(`Block @${post.username}?`, 'You won’t see their posts anymore. You can unblock them from the Me tab.', { yes: 'Block', danger: true })) {
        await api('/blocks', { method: 'POST', body: { username: post.username } }); toast(`Blocked @${post.username}`); refresh();
      }
    } catch (err) { toast(err.message, { error: true }); }
  };

  return el('article', { class: `card post${featured ? ' featured' : ''}` },
    featured && el('p', { class: 'featured-label' }, `🏆 ${KINDS[post.kind].name} of the day`),
    el('div', { class: 'post-head' }, avatar(post.username),
      el('div', { class: 'grow' },
        el('div', { class: 'row' }, el('span', { class: 'who' }, `@${post.username}`), post.supporter && el('span', { class: 'pill star', title: 'Premium supporter' }, '⭐')),
        el('div', { class: 'what' }, `${t.emoji} ${t.name} · ${timeAgo(post.createdAt)}`)),
      el('button', { class: 'btn icon ghost', 'aria-label': 'More options', onclick: more }, '⋯')),
    player({ src: `/api/audio/${post.audioId}`, peaks: post.peaks, durationMs: post.durationMs }),
    reactRow);
}

export async function renderCommunity(root, { refresh, focusId }) {
  const list = el('div', { class: 'stack' });
  const moreBtn = el('button', { class: 'btn block hidden' }, 'Load more');
  let cursor = null;
  let since = null;
  const shown = new Set(focusId ? [focusId] : []);

  const load = async () => {
    moreBtn.disabled = true;
    const qs = sort === 'top' ? `sort=top${cursor ? `&cursor=${cursor}&since=${since}` : ''}` : `sort=${sort}${cursor ? `&before=${cursor}` : ''}`;
    const res = await api(`/posts?${qs}`);
    const { posts } = res;
    list.append(...posts.filter((p) => !shown.has(p.id)).map((p) => { shown.add(p.id); return postCard(p, { refresh }); }));
    cursor = (sort === 'top' ? res.cursor : posts.at(-1)?.id) ?? cursor;
    since = res.since ?? since;
    moreBtn.classList.toggle('hidden', posts.length < 20);
    moreBtn.disabled = false;
    if (!list.children.length && !focusId) {
      list.append(el('div', { class: 'card empty' }, el('span', { class: 'big' }, '🎙️'),
        el('p', {}, sort === 'mine' ? 'You haven’t shared any clips yet.' : 'No clips here yet. Be the legend who goes first.'),
        el('a', { class: 'btn primary sm', href: '#/today' }, 'Record one')));
    }
  };
  moreBtn.addEventListener('click', () => load().catch((err) => toast(err.message, { error: true })));

  const [focused, featured] = await Promise.all([
    focusId ? api(`/posts/${focusId}`).then((r) => r.post).catch(() => null) : null,
    api('/posts/featured').then((r) => r.post),
  ]);

  root.replaceChildren(el('div', { class: 'page' },
    el('div', { class: 'page-head' }, el('h1', {}, 'Community')),
    !state.me && el('div', { class: 'card brand stack tight' },
      el('h2', {}, 'Track yours too 💨'), el('p', { class: 'small muted' }, 'Log farts & burps, record the legendary ones, and see what’s normal for you.'),
      el('a', { class: 'btn white', href: '/' }, 'Start free')),
    focused && postCard(focused, { refresh }),
    segmented([{ id: 'new', label: '🆕 New' }, { id: 'top', label: '🔥 Top week' }, state.me && { id: 'mine', label: '🙋 Mine' }].filter(Boolean),
      sort, (s) => { sort = s; refresh(); }, 'Sort posts'),
    featured && sort === 'new' && featured.id !== focused?.id && postCard(featured, { refresh, featured: true }),
    list, moreBtn,
    el('p', { class: 'tiny muted center' }, 'Keep it to farts & burps. Speech, slurs and spam get removed and can get you banned.')));
  await load();
}
