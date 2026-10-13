// Procedural burp synthesizer (Web Audio). Runs in a browser OfflineAudioContext at build time
// (scripts/render-sounds.js). Deterministic: a type always sounds the same.

const VOWELS = { a: [730, 1090], e: [530, 1840], i: [300, 2200], o: [570, 840], u: [440, 1020], uh: [600, 1100], ur: [490, 1350] };

function seeded(str) {
  let h = 2166136261;
  for (const ch of str) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return (h >>> 0) / 4294967296;
  };
}

function noiseSource(c, t, dur, rand) {
  const buf = c.createBuffer(1, Math.ceil(c.sampleRate * (dur + 0.05)), c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = rand() * 2 - 1;
  const s = c.createBufferSource();
  s.buffer = buf;
  s.start(t);
  s.stop(t + dur + 0.04);
  return s;
}

function envelope(param, t, dur, peak, attack = 0.012, release = 0.07) {
  param.setValueAtTime(0, t);
  param.linearRampToValueAtTime(peak, t + attack);
  param.setValueAtTime(peak, t + Math.max(attack, dur - release));
  param.linearRampToValueAtTime(0, t + dur);
}

// Organic pitch: an exponential glide with small random steps every ~25 ms.
function wobblyPitch(param, t, dur, f0, f1, jitter, rand) {
  const steps = Math.max(2, Math.floor(dur / 0.025));
  for (let i = 0; i <= steps; i++) {
    const p = i / steps;
    param.setValueAtTime(f0 * (f1 / f0) ** p * (1 + (rand() - 0.5) * jitter), t + p * dur);
  }
}

function lfoInto(c, param, t, dur, rate, amount, type = 'sine') {
  const lfo = c.createOscillator();
  lfo.type = type;
  lfo.frequency.value = rate;
  const g = c.createGain();
  g.gain.value = amount;
  lfo.connect(g).connect(param);
  lfo.start(t);
  lfo.stop(t + dur + 0.02);
}

// Sphincter-style buzz: low sawtooth + optional air noise, a lowpass "body", and square-wave flutter.
function fart(c, out, t, o, rand) {
  const { dur, f0 } = o;
  const osc = c.createOscillator();
  osc.type = o.wave ?? 'sawtooth';
  wobblyPitch(osc.frequency, t, dur, f0, o.f1 ?? f0 * 0.8, o.jitter ?? 0.12, rand);
  if (o.vibrato) lfoInto(c, osc.frequency, t, dur, o.vibrato, o.vibDepth ?? f0 * 0.08);
  const body = c.createBiquadFilter();
  body.type = 'lowpass';
  body.frequency.value = o.cutoff ?? 900;
  body.Q.value = o.q ?? 1;
  osc.connect(body);
  if (o.noise) {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = f0 * 3;
    bp.Q.value = 0.8;
    const ng = c.createGain();
    ng.gain.value = o.noise;
    noiseSource(c, t, dur, rand).connect(bp).connect(ng).connect(body);
  }
  const flutter = c.createGain();
  if (o.flutter) {
    const depth = o.depth ?? 0.6;
    flutter.gain.value = 1 - depth / 2;
    lfoInto(c, flutter.gain, t, dur, o.flutter, depth / 2, 'square');
  }
  const sputter = c.createGain();
  if (o.sputter) {
    for (let s = t; s < t + dur; s += 0.025 + rand() * 0.05) sputter.gain.setValueAtTime(0.15 + rand() * 0.85, s);
  }
  const amp = c.createGain();
  amp.gain.value = 0;
  envelope(amp.gain, t, dur, o.gain ?? 0.7, o.attack, o.release);
  body.connect(flutter).connect(sputter).connect(amp).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.02);
}

// Burp: rough glottal sawtooth + breath noise through two moving vowel formants.
function burp(c, out, t, o, rand) {
  const { dur } = o;
  const f0 = o.f0 ?? 105;
  const src = c.createOscillator();
  src.type = 'sawtooth';
  wobblyPitch(src.frequency, t, dur, f0, o.f1 ?? f0 * 0.8, o.jitter ?? 0.18, rand);
  const mix = c.createGain();
  src.connect(mix);
  const breath = c.createGain();
  breath.gain.value = o.breath ?? 0.25;
  noiseSource(c, t, dur, rand).connect(breath).connect(mix);
  const vowels = o.vowels ?? ['ur', 'uh'];
  const scale = o.formantScale ?? 1;
  const formants = c.createGain();
  [[0, 6, 1.6], [1, 9, 1]].forEach(([idx, q, level]) => {
    const bp = c.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = q;
    vowels.forEach((v, k) => {
      const at = t + (vowels.length > 1 ? (dur * k) / (vowels.length - 1) : 0);
      bp.frequency[k ? 'linearRampToValueAtTime' : 'setValueAtTime'](VOWELS[v][idx] * scale, at);
    });
    const g = c.createGain();
    g.gain.value = level * 4;
    mix.connect(bp).connect(g).connect(formants);
  });
  const lp = c.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = o.cutoff ?? 2600;
  const roll = c.createGain();
  if (o.roll) {
    roll.gain.value = 1 - (o.rollDepth ?? 0.5) / 2;
    lfoInto(c, roll.gain, t, dur, o.roll, (o.rollDepth ?? 0.5) / 2);
  }
  const amp = c.createGain();
  amp.gain.value = 0;
  envelope(amp.gain, t, dur, o.gain ?? 0.8, o.attack ?? 0.03, o.release ?? 0.15);
  formants.connect(lp).connect(roll).connect(amp).connect(out);
  src.start(t);
  src.stop(t + dur + 0.02);
}

// Air: filtered noise (hiss, fizz, sneeze), optionally swept and crackling.
function air(c, out, t, o, rand) {
  const { dur } = o;
  const f = c.createBiquadFilter();
  f.type = o.filter ?? 'lowpass';
  f.frequency.setValueAtTime(o.freq ?? 1000, t);
  if (o.sweepTo) f.frequency.exponentialRampToValueAtTime(o.sweepTo, t + dur);
  f.Q.value = o.q ?? 0.7;
  const amp = c.createGain();
  amp.gain.value = 0;
  envelope(amp.gain, t, dur, o.gain ?? 0.1, o.attack ?? 0.05, o.release ?? 0.2);
  const crackle = c.createGain();
  if (o.crackle) for (let s = t; s < t + dur; s += 0.008 + rand() * 0.03) crackle.gain.setValueAtTime(rand() < 0.35 ? 1 : 0.1, s);
  noiseSource(c, t, dur, rand).connect(f).connect(crackle).connect(amp).connect(out);
}

// Bubbles: short rising sine blips at random intervals.
function bubbles(c, out, t, o, rand) {
  for (let s = t; s < t + o.dur;) {
    const d = 0.03 + rand() * 0.05;
    const f = (o.freq ?? 250) * (0.7 + rand() * 0.8);
    const osc = c.createOscillator();
    osc.frequency.setValueAtTime(f, s);
    osc.frequency.exponentialRampToValueAtTime(f * 2.2, s + d);
    const g = c.createGain();
    g.gain.value = 0;
    envelope(g.gain, s, d, (o.gain ?? 0.3) * (0.5 + rand() * 0.5), 0.004, d * 0.6);
    osc.connect(g).connect(out);
    osc.start(s);
    osc.stop(s + d + 0.01);
    s += d + rand() * (o.gap ?? 0.09);
  }
}

const VOICES = { fart, burp, air, bubbles };
// Burp recipes. Farts are built from real recordings (scripts/render-sounds.js), burps are synthesized
// until there are real burp recordings to build from.
// Each recipe: parts = [voice, startTime, options]; fx.muffle = lowpass cutoff (Hz).
export const RECIPES = {
  'burp:classic': () => ({ parts: [['burp', 0, { dur: 0.75, f0: 115, f1: 85, vowels: ['ur', 'uh', 'o'], gain: 0.9 }]] }),
  'burp:baby': () => ({ parts: [['burp', 0, { dur: 0.22, f0: 230, f1: 200, vowels: ['e', 'uh'], formantScale: 1.25, gain: 0.5, release: 0.06 }]] }),
  'burp:post_meal': () => ({ parts: [['burp', 0, { dur: 0.55, f0: 105, f1: 90, vowels: ['uh', 'a'], gain: 0.8 }],
    ['air', 0.55, { dur: 0.35, filter: 'bandpass', freq: 1100, gain: 0.08 }]] }),
  'burp:silent': () => ({ parts: [['burp', 0, { dur: 0.3, f0: 100, gain: 0.5 }]], fx: { muffle: 520 } }),
  'burp:nose': () => ({ parts: [['burp', 0, { dur: 0.45, f0: 150, f1: 130, vowels: ['i', 'i'], formantScale: 0.8, breath: 0.5, cutoff: 1300, gain: 0.5 }]] }),
  'burp:belch': () => ({ parts: [['burp', 0, { dur: 1.4, f0: 85, f1: 62, vowels: ['ur', 'o', 'uh'], jitter: 0.3, gain: 1, breath: 0.3 }]] }),
  'burp:soda': () => ({ parts: [['air', 0, { dur: 1.0, filter: 'highpass', freq: 3500, gain: 0.12, crackle: true }],
    ['burp', 0.25, { dur: 0.6, f0: 120, f1: 95 }]] }),
  'burp:rolling': () => ({ parts: [['burp', 0, { dur: 2.0, f0: 100, f1: 72, vowels: ['ur', 'o', 'uh', 'o'], roll: 7, rollDepth: 0.55, gain: 0.95 }]] }),
  'burp:talker': () => ({ parts: [['burp', 0, { dur: 2.2, f0: 115, f1: 95, vowels: ['a', 'e', 'i', 'o', 'u'], gain: 0.9, jitter: 0.12 }]] }),
  'burp:hiccup': () => ({ parts: [['burp', 0, { dur: 0.09, f0: 320, f1: 280, vowels: ['i'], gain: 0.7, attack: 0.003, release: 0.03 }],
    ['burp', 0.16, { dur: 0.5, f0: 110, f1: 88 }]] }),
  'burp:double_ender': () => ({ parts: [['burp', 0, { dur: 0.8, f0: 110, f1: 85 }],
    ['fart', 0.05, { dur: 0.8, f0: 95, f1: 70, flutter: 26, gain: 0.55 }]] }),
  'burp:wet': () => ({ parts: [['burp', 0, { dur: 0.6, f0: 105, f1: 85, breath: 0.4 }], ['bubbles', 0.1, { dur: 0.5, freq: 140, gain: 0.2, gap: 0.04 }]] }),
  'burp:sulfur': () => ({ parts: [['burp', 0, { dur: 1.0, f0: 92, f1: 72, vowels: ['o', 'ur', 'u'], formantScale: 0.85, gain: 0.95, jitter: 0.25 }]] }),
};

const partEnd = ([, t, o]) => t + o.dur;

/** Renders one type to a mono AudioBuffer. */
export async function renderType(key, sampleRate = 44100) {
  const rand = seeded(key);
  const recipe = RECIPES[key](rand);
  const length = Math.max(...recipe.parts.map(partEnd)) + 0.1;
  const c = new OfflineAudioContext(1, Math.ceil(length * sampleRate), sampleRate);
  const bus = c.createGain();
  const master = c.createDynamicsCompressor();
  master.threshold.value = -10;
  master.ratio.value = 8;
  if (recipe.fx?.muffle) {
    const lp = c.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = recipe.fx.muffle;
    bus.connect(lp).connect(master);
  } else {
    bus.connect(master);
  }
  master.connect(c.destination);
  for (const [voice, t, opts] of recipe.parts) VOICES[voice](c, bus, t + 0.02, opts, rand);
  return c.startRendering();
}
