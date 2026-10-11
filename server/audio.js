import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const ACCEPTED_AUDIO = /^(audio\/(webm|ogg|mp4|mpeg|wav|x-wav|wave|aac|x-m4a|m4a)|video\/webm)(;.*)?$/i;
export const MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
const PEAKS = 48;
// Only real audio containers, only local files: blocks crafted HLS/concat playlists that read other files.
const SAFE_INPUT = ['-protocol_whitelist', 'file', '-format_whitelist', 'matroska,webm,mov,mp4,m4a,3gp,ogg,mp3,wav,aac'];

function run(cmd, args, { timeoutMs = 20_000, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const out = [];
    let err = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (d) => out.push(d));
    child.stderr.on('data', (d) => { if (err.length < 4000) err += d; });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(out));
      else reject(new Error(`${cmd} failed (${signal || code}): ${err.trim().slice(-500)}`));
    });
    child.stdin.on('error', () => {});
    child.stdin.end(input);
  });
}

// Simple FIFO semaphore so a burst of uploads can't saturate a small server's CPUs.
function semaphore(max) {
  let active = 0;
  const queue = [];
  const next = () => {
    if (active >= max || !queue.length) return;
    active++;
    const { fn, resolve, reject } = queue.shift();
    fn().then(resolve, reject).finally(() => { active--; next(); });
  };
  return (fn) => new Promise((resolve, reject) => { queue.push({ fn, resolve, reject }); next(); });
}

export class AudioError extends Error {}

export function createAudioService(cfg) {
  const limit = semaphore(cfg.ffmpegConcurrency);

  async function processClip(buffer) {
    const tmp = path.join(os.tmpdir(), `tt-${crypto.randomUUID()}`);
    const id = crypto.randomUUID();
    const out = path.join(cfg.audioDir, `${id}.m4a`);
    await fs.writeFile(tmp, buffer);
    try {
      // Re-encode everything: validates it's real audio, strips metadata, trims, evens out loudness,
      // and yields AAC/M4A, which plays on every browser including iOS Safari.
      await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', '-y', ...SAFE_INPUT, '-i', tmp,
        '-map', '0:a:0', '-t', String(cfg.maxClipSeconds), '-vn', '-sn', '-dn', '-map_metadata', '-1',
        '-ac', '1', '-ar', '44100', '-af', 'loudnorm=I=-18:TP=-2:LRA=11',
        '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', '-f', 'mp4', out]);
      const pcm = await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-nostdin', ...SAFE_INPUT, '-i', out,
        '-ac', '1', '-ar', '8000', '-f', 's16le', 'pipe:1']);
      const samples = Math.floor(pcm.length / 2);
      const durationMs = Math.round((samples / 8000) * 1000);
      if (durationMs < 200) throw new AudioError('Clip is too short.');
      return { id, durationMs, peaks: computePeaks(pcm, samples) };
    } catch (err) {
      await fs.rm(out, { force: true });
      if (err instanceof AudioError) throw err;
      throw new AudioError('That recording couldn’t be processed. Try again.');
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }

  return {
    process: (buffer) => limit(() => processClip(buffer)),
    file: (id) => `${id}.m4a`,
    remove: (ids) => Promise.all(ids.filter(Boolean).map((id) => fs.rm(path.join(cfg.audioDir, `${id}.m4a`), { force: true }))),
  };
}

function computePeaks(pcm, samples) {
  const bucket = Math.max(1, Math.floor(samples / PEAKS));
  const peaks = [];
  let max = 1;
  for (let b = 0; b < PEAKS; b++) {
    let peak = 0;
    const end = Math.min(samples, (b + 1) * bucket);
    for (let i = b * bucket; i < end; i++) peak = Math.max(peak, Math.abs(pcm.readInt16LE(i * 2)));
    peaks.push(peak);
    max = Math.max(max, peak);
  }
  return peaks.map((p) => Math.round((p / max) * 100));
}
