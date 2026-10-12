import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../server/config.js';
import { buildApp } from '../server/app.js';

export async function makeApp(overrides = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ifart-test-'));
  const cfg = loadConfig({ dataDir, ...overrides });
  const app = await buildApp(cfg, { logger: false });
  app.addHook('onClose', async () => fs.rmSync(dataDir, { recursive: true, force: true }));
  return app;
}

/** Minimal cookie-jar client over fastify.inject. */
let ipSeq = 0;
export function client(app) {
  let cookie = '';
  const ip = `10.0.${(++ipSeq >> 8) & 255}.${ipSeq & 255}`; // each simulated user gets its own address
  const call = async (method, url, body, headers = {}) => {
    const opts = { method, url, headers: { 'x-forwarded-for': ip, ...headers, ...(cookie ? { cookie } : {}) } };
    if (Buffer.isBuffer(body)) opts.payload = body;
    else if (body !== undefined) { opts.payload = body; opts.headers['content-type'] ??= 'application/json'; }
    const res = await app.inject(opts);
    const set = res.cookies.find((c) => c.name === 'ifart_sid');
    if (set) cookie = set.value ? `ifart_sid=${set.value}` : '';
    let json;
    try { json = res.json(); } catch { json = undefined; }
    return { status: res.statusCode, json, res };
  };
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b, h) => call('POST', u, b ?? {}, h),
    put: (u, b, h) => call('PUT', u, b, h),
    patch: (u, b) => call('PATCH', u, b),
    del: (u, b) => call('DELETE', u, b),
    get cookie() { return cookie; },
  };
}

export async function guest(app) {
  const c = client(app);
  await c.post('/api/auth/guest', { ageOk: true });
  return c;
}

export async function member(app, username, password = 'password123') {
  const c = await guest(app);
  const r = await c.post('/api/auth/claim', { username, password });
  if (r.status !== 200) throw new Error(`claim failed: ${JSON.stringify(r.json)}`);
  c.recoveryCode = r.json.recoveryCode;
  return c;
}

let clip;
export function testClip() {
  if (!clip) {
    const file = path.join(os.tmpdir(), 'ifart-test-clip.webm');
    execFileSync('ffmpeg', ['-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=90:duration=2', '-c:a', 'libopus', file]);
    clip = fs.readFileSync(file);
  }
  return clip;
}

export const today = () => new Date().toISOString().slice(0, 10);
