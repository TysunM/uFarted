// Builds the 39 type sounds in public/sounds/<kind>-<type>.mp3.
//  - Farts are real recordings, trimmed and shaped per type with ffmpeg. The originals go in assets/samples/
//    (gitignored: their licenses allow use inside the app but not passing the raw files on; see
//    docs/SOUND_CREDITS.md). A fart whose recording is missing keeps its committed MP3.
//  - Burps are synthesized by scripts/synth.js in headless Chromium until there are burp recordings.
// Every sound is matched to -16 LUFS, offset by its type's `level` so quiet types (SBD, Whisper, Silent burp)
// stay quiet. A lookahead limiter holds peaks at -1 dBFS, so pops don't keep a whole clip quiet.
// Usage: npm run sounds
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { KINDS } from '../public/js/catalog.js';

const SR = 44100;
const TARGET_LUFS = -16;
const CEILING_DB = -1;
const MAX_LIMIT_DB = 9; // most peak reduction allowed before a clip is left quieter instead

// part: { src, from, to, pitch (semitones, sampler-style so lower is also slower), at (start, s) }
// or { noise: color, dur }. Recipe: one part inline or `parts`, then `fx` (ffmpeg filters) and `level` (dB).
const TRIPLE = 'mixkit-cartoon-fart-triple-3055';
const FARTS = {
  classic: { src: 'apebble-fart-3-228243', from: 0.18, to: 0.85 },
  toot: { src: 'apebble-fart-7-228247', from: 0.42, to: 0.82, pitch: 2 },
  double_tap: { src: 'freesound_community-fart-noises-83359', from: 1.0, to: 1.8 },
  morning: { src: 'beanfrog-proud-fart-288263', from: 0.12, to: 1.25, pitch: -1.5 },
  squeaker: { src: 'mixkit-farting-balloon-deflate-3052', from: 0.1, to: 0.9, pitch: 5 },
  whistler: { src: 'mixkit-farting-balloon-deflate-3052', from: 0.05, to: 1.85, pitch: 2 },
  thunder: { src: 'waltermidnight-ultimate-fart-sound-310131', from: 1.25, to: 2.5, fx: 'acompressor=threshold=-18dB:ratio=4,bass=g=4' },
  foghorn: { src: 'waltermidnight-fart-sound-310129', from: 0.45, to: 3.2, pitch: -3 },
  growler: { src: 'freesound_community-fart-3-89567', from: 0, to: 2.0, pitch: -5, fx: 'lowpass=f=1800' },
  rapid_fire: { src: 'mixkit-cartoon-fart-sound-2891', from: 0, to: 1.05 },
  staircase: { parts: [{ src: TRIPLE, from: 0, to: 0.16 }, { src: TRIPLE, from: 0.32, to: 0.5, pitch: -2, at: 0.42 },
    { src: TRIPLE, from: 0.6, to: 0.82, pitch: -4, at: 0.84 }] },
  sbd: { src: 'mixkit-farting-balloon-deflate-3052', from: 1.0, to: 1.85, fadeIn: 0.3, fx: 'highpass=f=900,lowpass=f=5000', level: -10 },
  whisper: { src: 'freesound_community-fart-83471', from: 0.24, to: 0.46, fx: 'highpass=f=500', level: -8 },
  slow_leak: { src: 'freesound_community-long-fart-farting-80351', from: 0.55, to: 3.2, fx: 'highpass=f=150,lowpass=f=3000', level: -5 },
  squeeze: { src: 'freesound_community-fart-squeeze-60793', from: 15.8, to: 17.6 },
  fake_out: { src: 'mikrotop22-furtz22-198542', from: 0.08, to: 0.26, level: -4 },
  crop_duster: { src: 'mixkit-farting-doubt-male-laugh-3054', from: 0.08, to: 1.5, fx: "volume='0.3+0.7*sin(PI*t/1.42)':eval=frame" },
  dutch_oven: { src: 'apebble-fart-5-228245', from: 0.48, to: 1.4, fx: 'lowpass=f=650,aecho=0.8:0.6:25:0.3' },
  elevator: { src: 'apebble-fart-8-228248', from: 0.22, to: 1.18, fx: 'aecho=0.8:0.7:18|31:0.35|0.25' },
  cushion: { src: 'waltermidnight-ultimate-fart-sound-310131', from: 2.83, to: 4.05, fx: 'lowpass=f=450' },
  echo: { src: 'apebble-fart-4-228244', from: 0.7, to: 1.36, fx: 'apad=pad_dur=0.6,aecho=0.8:0.85:110|210|330:0.5|0.35|0.2' },
  bubbler: { src: 'dragon-studio-wet-fart-335478', from: 0.25, to: 2.0, fx: 'lowpass=f=900,chorus=0.6:0.8:40:0.6:0.25:2' },
  workout: { src: 'freesound_community-fart-91011', from: 0.02, to: 0.62, pitch: 3 },
  sneeze_combo: { src: 'mixkit-cartoon-fail-blow-fart-3053', from: 0.08, to: 1.35 },
  hot: { parts: [{ src: 'freesound_community-fart-noises-83359', from: 6.0, to: 7.42 },
    { noise: 'white', dur: 1.42, fx: 'highpass=f=5000,volume=-32dB' }] },
  wet: { src: 'freesound_community-wet-fart-6139', from: 0.16, to: 1.16 },
};
const BURP_LEVELS = { silent: -10, baby: -5 };

const root = new URL('..', import.meta.url).pathname;
const outDir = path.join(root, 'public/sounds');
const sampleDir = path.join(root, 'assets/samples');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ufarted-sounds-'));
process.on('exit', () => fs.rmSync(tmp, { recursive: true, force: true }));
const typesOf = (kind) => KINDS[kind].groups.flatMap((g) => g.types.map((t) => t.id));
const ffmpeg = (args) => execFileSync('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
const samples = fs.existsSync(sampleDir) ? fs.readdirSync(sampleDir) : [];
const findSample = (name) => samples.find((f) => path.parse(f).name === name);

function check(kind, recipes) {
  const want = typesOf(kind);
  const missing = want.filter((t) => !recipes.includes(t));
  const extra = recipes.filter((t) => !want.includes(t));
  if (missing.length || extra.length) throw new Error(`${kind} recipe mismatch. Missing: ${missing} Extra: ${extra}`);
}

// One ffmpeg run per fart: decode each part to mono 44.1 kHz, trim, pitch, de-click, place, mix, then fx.
function renderFart(recipe, out) {
  const parts = recipe.parts ?? [recipe];
  const inputs = [];
  const chains = parts.map((p, i) => {
    let chain;
    if (p.noise) {
      inputs.push('-f', 'lavfi', '-i', `anoisesrc=c=${p.noise}:r=${SR}:a=0.5:d=${p.dur}:seed=7`);
      chain = `[${i}:a]anull`;
    } else {
      inputs.push('-i', path.join(sampleDir, findSample(p.src)));
      const ratio = 2 ** ((p.pitch ?? 0) / 12);
      chain = `[${i}:a]aformat=sample_fmts=fltp:channel_layouts=mono,aresample=${SR},atrim=${p.from}:${p.to},asetpts=PTS-STARTPTS`;
      if (ratio !== 1) chain += `,asetrate=${Math.round(SR * ratio)},aresample=${SR}`;
      chain += `,afade=t=in:d=${recipe.fadeIn ?? 0.008},areverse,afade=t=in:d=0.04,areverse`;
    }
    if (p.fx) chain += `,${p.fx}`;
    if (p.at) chain += `,adelay=${Math.round(p.at * 1000)}`;
    return `${chain}[p${i}]`;
  });
  const mix = parts.length > 1 ? `${parts.map((_, i) => `[p${i}]`).join('')}amix=inputs=${parts.length}:duration=longest:normalize=0` : '[p0]anull';
  const post = [recipe.fx, 'areverse,afade=t=in:d=0.02,areverse'].filter(Boolean).join(',');
  ffmpeg([...inputs, '-filter_complex', `${chains.join(';')};${mix},${post}[out]`, '-map', '[out]', '-ar', String(SR), '-ac', '1', '-c:a', 'pcm_f32le', out]);
}

// Burps: render in Chromium's OfflineAudioContext and write raw float PCM to WAV.
async function renderBurps(types) {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
  try {
    const page = await browser.newPage();
    await page.setContent('<!doctype html><title>synth</title>');
    await page.addScriptTag({ type: 'module', content: `${fs.readFileSync(path.join(root, 'scripts/synth.js'), 'utf8')}\nwindow.__synth = { renderType, RECIPES };` });
    await page.waitForFunction(() => window.__synth);
    check('burp', (await page.evaluate(() => Object.keys(window.__synth.RECIPES))).map((k) => k.replace(/^burp:/, '')));
    const files = {};
    for (const type of types) {
      const b64 = await page.evaluate(async ([k, sr]) => {
        const bytes = new Uint8Array((await window.__synth.renderType(k, sr)).getChannelData(0).buffer.slice(0));
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      }, [`burp:${type}`, SR]);
      const raw = path.join(tmp, `burp-${type}.f32`);
      fs.writeFileSync(raw, Buffer.from(b64, 'base64'));
      files[type] = path.join(tmp, `burp-${type}.wav`);
      ffmpeg(['-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw, '-c:a', 'pcm_f32le', files[type]]);
    }
    return files;
  } finally {
    await browser.close();
  }
}

// Integrated loudness (EBU R128) and sample peak. Short clips are looped to 4 s so a 0.2 s toot still
// gets a full measurement.
function measure(wav) {
  const dur = Number(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', wav], { encoding: 'utf8' }));
  const { stderr } = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', '-stream_loop', String(Math.ceil(4 / dur)), '-i', wav,
    '-af', 'ebur128=peak=sample', '-f', 'null', '-'], { encoding: 'utf8' });
  const summary = stderr.slice(stderr.lastIndexOf('Summary:'));
  const lufs = Number(summary.match(/I:\s+(-?[\d.]+) LUFS/)?.[1]);
  const peak = Number(summary.match(/Peak:\s+(-?[\d.]+) dBFS/)?.[1]);
  if (!Number.isFinite(lufs) || !Number.isFinite(peak)) throw new Error(`Couldn't measure ${path.basename(wav)}`);
  return { dur, lufs, peak };
}

// Gain to target, limit peaks, then re-measure and correct, since limiting costs a little loudness.
function normalize(wav, target) {
  const m = measure(wav);
  const out = wav.replace(/\.wav$/, '.norm.wav');
  const maxGain = CEILING_DB + MAX_LIMIT_DB - m.peak;
  let gain = Math.min(target - m.lufs, maxGain);
  let r;
  for (let pass = 0; pass < 3; pass++) {
    const af = [`volume=${gain.toFixed(2)}dB`];
    if (m.peak + gain > CEILING_DB) af.push(`alimiter=limit=${10 ** (CEILING_DB / 20)}:attack=1:release=40:level=0:latency=1`);
    ffmpeg(['-i', wav, '-af', af.join(','), '-c:a', 'pcm_f32le', out]);
    r = measure(out);
    if (Math.abs(target - r.lufs) < 0.3 || af.length === 1 || gain >= maxGain) break;
    gain = Math.min(gain + target - r.lufs, maxGain);
  }
  return { out, ...r };
}

check('fart', Object.keys(FARTS));
const wavs = [];
const kept = [];
for (const [type, recipe] of Object.entries(FARTS)) {
  const srcs = (recipe.parts ?? [recipe]).filter((p) => p.src).map((p) => p.src);
  const lost = [...new Set(srcs.filter((s) => !findSample(s)))];
  if (lost.length) { kept.push(`fart-${type} (needs ${lost.join(', ')})`); continue; }
  const wav = path.join(tmp, `fart-${type}.wav`);
  renderFart(recipe, wav);
  wavs.push({ name: `fart-${type}`, wav, level: recipe.level ?? 0 });
}
for (const [type, wav] of Object.entries(await renderBurps(typesOf('burp')))) {
  wavs.push({ name: `burp-${type}`, wav, level: BURP_LEVELS[type] ?? 0 });
}

fs.mkdirSync(outDir, { recursive: true });
for (const { name, wav, level } of wavs) {
  const r = normalize(wav, TARGET_LUFS + level);
  ffmpeg(['-i', r.out, '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', path.join(outDir, `${name}.mp3`)]);
  console.log(`${name.padEnd(18)} ${r.dur.toFixed(2)}s  ${r.lufs.toFixed(1)} LUFS  peak ${r.peak.toFixed(1)} dBFS`);
}
if (kept.length) console.warn(`\nKept the committed MP3 for ${kept.length} fart(s) whose recording isn't in assets/samples:\n  ${kept.join('\n  ')}`);
// The app requests /sounds/x.mp3?v=<hash of every sound>, so browsers drop cached copies as soon as one changes.
const files = fs.readdirSync(outDir).filter((f) => f.endsWith('.mp3')).sort();
const hash = crypto.createHash('sha256');
for (const f of files) hash.update(f).update(fs.readFileSync(path.join(outDir, f)));
const version = hash.digest('hex').slice(0, 10);
fs.writeFileSync(path.join(root, 'public/js/sounds-version.js'),
  `// Written by scripts/render-sounds.js. Changes whenever a type sound does, so browsers fetch the new files.\nexport const SOUNDS_VERSION = '${version}';\n`);
const total = files.reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`\nRendered ${wavs.length} sounds → public/sounds (${Math.round(total / 1024)} KB total, version ${version})`);
