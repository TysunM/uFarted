// Renders every fart/burp type with scripts/synth.js in headless Chromium, then encodes
// public/sounds/<kind>-<type>.mp3.
// Usage: npm run sounds
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { chromium } from 'playwright-core';
import { KINDS } from '../public/js/catalog.js';

const root = new URL('..', import.meta.url).pathname;
const outDir = path.join(root, 'public/sounds');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ufarted-sounds-'));
const keys = Object.values(KINDS).flatMap((k) => k.groups.flatMap((g) => g.types.map((t) => `${k.id}:${t.id}`)));
const SR = 44100;

const synth = fs.readFileSync(path.join(root, 'scripts/synth.js'), 'utf8');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium' });
const page = await browser.newPage();
await page.setContent('<!doctype html><title>synth</title>');
await page.addScriptTag({ type: 'module', content: `${synth}\nwindow.__synth = { renderType, RECIPES };` });
await page.waitForFunction(() => window.__synth);

const recipeKeys = await page.evaluate(() => Object.keys(window.__synth.RECIPES));
const missing = keys.filter((k) => !recipeKeys.includes(k));
const extra = recipeKeys.filter((k) => !keys.includes(k));
if (missing.length || extra.length) throw new Error(`Recipe mismatch. Missing: ${missing} Extra: ${extra}`);

// Render every type to raw PCM first so loudness can be normalised across the whole set.
const rendered = {};
for (const key of keys) {
  const b64 = await page.evaluate(async ([k, sr]) => {
    const buf = await window.__synth.renderType(k, sr);
    const data = buf.getChannelData(0);
    const bytes = new Uint8Array(data.buffer.slice(0));
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, [key, SR]);
  const buf = Buffer.from(b64, 'base64');
  rendered[key] = new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
}
await browser.close();

// Level each kind separately (burps synthesize hotter than farts), keeping relative levels within a kind
// so quiet types like SBD and Whisper stay quiet. Each kind's loudest sound peaks at about -1 dBFS.
const peakOf = (pcm) => pcm.reduce((m, v) => Math.max(m, Math.abs(v)), 0);
const kindGain = Object.fromEntries(Object.keys(KINDS).map((kind) =>
  [kind, 0.89 / Math.max(...keys.filter((k) => k.startsWith(`${kind}:`)).map((k) => peakOf(rendered[k])))]));
fs.mkdirSync(outDir, { recursive: true });
for (const key of keys) {
  const pcm = rendered[key];
  const gain = kindGain[key.split(':')[0]];
  if (pcm.some((v) => !Number.isFinite(v))) throw new Error(`${key} rendered NaN/Infinity`);
  const raw = path.join(tmp, `${key.replace(':', '-')}.f32`);
  fs.writeFileSync(raw, Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength));
  const file = `${key.replace(':', '-')}.mp3`;
  execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'f32le', '-ar', String(SR), '-ac', '1', '-i', raw,
    '-af', `volume=${gain.toFixed(4)}`, '-c:a', 'libmp3lame', '-b:a', '96k', '-map_metadata', '-1', path.join(outDir, file)]);
}
fs.rmSync(tmp, { recursive: true, force: true });
const total = fs.readdirSync(outDir).reduce((n, f) => n + fs.statSync(path.join(outDir, f)).size, 0);
console.log(`Rendered ${keys.length} sounds → public/sounds (${Math.round(total / 1024)} KB)`);
