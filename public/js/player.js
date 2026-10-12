import { el, fmtDur } from './ui.js';

// One shared <audio> so only one clip plays at a time across the whole app.
const audio = new Audio();
audio.preload = 'none';
let active = null;
let activeSrc = '';

audio.addEventListener('timeupdate', () => active?.progress(audio.currentTime / (audio.duration || 1)));
audio.addEventListener('ended', () => { active?.reset(); active = null; });
audio.addEventListener('pause', () => active?.setPlaying(false));
audio.addEventListener('play', () => active?.setPlaying(true));

/** Waveform player. `src` is a URL (server clip) or blob URL (local preview). */
export function player({ src, peaks, durationMs }) {
  const bars = (peaks?.length ? peaks : Array(48).fill(30)).map((p) => {
    const bar = el('i');
    bar.style.height = `${Math.max(8, p)}%`;
    return bar;
  });
  const btn = el('button', { type: 'button', class: 'play', 'aria-label': 'Play clip' }, '▶');
  const node = el('div', { class: 'player' }, btn, el('div', { class: 'wave', 'aria-hidden': 'true' }, bars),
    el('span', { class: 'dur' }, durationMs ? fmtDur(durationMs) : 'New'));
  const self = {
    progress(frac) { const n = Math.round(frac * bars.length); bars.forEach((b, i) => b.classList.toggle('on', i < n)); },
    setPlaying(on) { btn.textContent = on ? '❚❚' : '▶'; btn.setAttribute('aria-label', on ? 'Pause clip' : 'Play clip'); },
    reset() { self.setPlaying(false); self.progress(0); },
  };
  btn.addEventListener('click', () => toggle(self, src));
  return node;
}

async function toggle(self, src) {
  if (active === self && activeSrc === src && !audio.paused) return audio.pause();
  if (active !== self || activeSrc !== src) {
    active?.reset();
    active = self;
    activeSrc = src;
    audio.src = src;
  }
  try {
    await audio.play();
  } catch {
    self.reset();
  }
}

/** Compact round play button for short clips. `src` may be a function so it can follow a changing selection. */
export function playButton(src, { label = 'Play', icon = '▶', className = '' } = {}) {
  const btn = el('button', { type: 'button', class: `play sm ${className}`, 'aria-label': label, title: label }, icon);
  const self = {
    progress() {},
    setPlaying(on) { btn.textContent = on ? '❚❚' : icon; btn.classList.toggle('playing', on); },
    reset() { self.setPlaying(false); },
  };
  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(self, typeof src === 'function' ? src() : src); });
  return btn;
}

export const stopPlayback = () => { audio.pause(); active?.reset(); active = null; activeSrc = ''; };
