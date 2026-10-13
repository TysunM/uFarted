import { KINDS } from './catalog.js';
import { el, sheet, segmented } from './ui.js';
import { api } from './api.js';
import { playButton, stopPlayback } from './player.js';
import { state } from './state.js';
import { SOUNDS_VERSION } from './sounds-version.js';

export const sampleSrc = (kind, type) => `/sounds/${kind}-${type}.mp3?v=${SOUNDS_VERSION}`;

// Top-rated real community clip per type, refreshed at most once a minute.
let champions = { at: 0, data: {} };
async function loadChampions() {
  if (Date.now() - champions.at > 60_000) {
    try { champions = { at: Date.now(), data: (await api('/posts/champions')).champions }; } catch { /* offline: samples still work */ }
  }
  return champions.data;
}

/**
 * Type picker with a ▶ preview on every type. Resolves with the chosen type id (or undefined).
 * In `browse` mode it's the soundboard: tapping a row plays it and nothing is selected.
 */
export function pickType({ kind = 'fart', current = null, browse = false } = {}) {
  let showKind = kind;
  let best = {};
  return sheet(browse ? '🔊 Soundboard' : 'Pick the type', (close) => {
    const list = el('div', { class: 'stack' });
    const row = (t) => {
      const sample = playButton(sampleSrc(showKind, t.id), { label: `Hear ${t.name}` });
      const champ = best[`${showKind}:${t.id}`];
      return el('div', { class: `type-row${t.id === current && showKind === kind ? ' selected' : ''}` },
        sample,
        el('button', { type: 'button', class: 'type-pick', onclick: () => (browse ? sample.click() : close(t.id)) },
          el('span', { class: 'e', 'aria-hidden': 'true' }, t.emoji),
          el('span', { class: 'grow' }, el('strong', {}, t.name), el('span', { class: 'tiny muted' }, t.desc)),
          !browse && t.id === current && showKind === kind && el('span', { class: 'tick', 'aria-label': 'selected' }, '✓')),
        champ && playButton(`/api/audio/${champ.audioId}`, { icon: '🏆', className: 'champ',
          label: `Hear the community's best ${t.name}, by @${champ.username}` }));
    };
    const paint = () => list.replaceChildren(...KINDS[showKind].groups.map((g) =>
      el('section', { class: 'stack tight' }, el('h3', { class: 'small muted' }, g.label), g.types.map(row))));
    paint();
    loadChampions().then((c) => { best = c; if (Object.keys(c).length) paint(); });
    return el('div', { class: 'stack' },
      browse && segmented([{ id: 'fart', label: '💨 Farts' }, { id: 'burp', label: '🫧 Burps' }], showKind,
        (k) => { showKind = k; stopPlayback(); paint(); }, 'Farts or burps'),
      el('p', { class: 'small muted' }, browse ? 'Tap any sound to hear it.' : 'Tap ▶ to hear it, tap the name to pick it.'),
      list,
      el('p', { class: 'tiny muted' }, `▶ plays a studio sample made by ${state.config.appName}. 🏆 plays the community's top-rated real one.`));
  }, { label: browse ? 'Soundboard' : 'Pick the type' }).then((picked) => { stopPlayback(); return picked; });
}
