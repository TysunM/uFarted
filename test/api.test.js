import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { makeApp, client, guest, member, testClip, today } from './helpers.js';
import { runMaintenance } from '../server/maintenance.js';

const audioHeaders = { 'content-type': 'audio/webm;codecs=opus' };

describe('auth', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(() => app.close());

  test('neutral age screen: 13+ only, checked server-side, nothing stored', async () => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth() + 1;
    const c = client(app);
    assert.equal((await c.post('/api/auth/guest', {})).status, 400);
    assert.equal((await c.post('/api/auth/guest', { ageOk: true })).status, 400, 'old checkbox payload is rejected');
    assert.equal((await c.post('/api/auth/guest', { birthYear: y - 10 })).status, 403);
    assert.equal((await c.post('/api/auth/guest', { birthYear: y - 13 })).status, 400, 'borderline year needs the month');
    assert.equal((await c.post('/api/auth/guest', { birthYear: y - 13, birthMonth: m })).status, 403, 'birthday month counts as not yet');
    if (m < 12) assert.equal((await c.post('/api/auth/guest', { birthYear: y - 13, birthMonth: 12 })).status, 403);
    if (m > 1) assert.equal((await client(app).post('/api/auth/guest', { birthYear: y - 13, birthMonth: 1 })).status, 200);
    assert.equal((await c.get('/api/me')).json.user, null, 'no session for under-13s');
    const r = await c.post('/api/auth/guest', { birthYear: y - 14 });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.isGuest, true);
    const cols = app.db.prepare('PRAGMA table_info(users)').all().map((col) => col.name);
    assert.ok(!cols.some((n) => /birth|age/.test(n)), 'birth date is not stored');
  });

  test('claim validates usernames and passwords', async () => {
    const c = await guest(app);
    for (const username of ['ab', 'has space', 'admin', 'fuckface', 'x'.repeat(21)]) {
      assert.equal((await c.post('/api/auth/claim', { username, password: 'password123' })).status, 400, username);
    }
    assert.equal((await c.post('/api/auth/claim', { username: 'okname', password: 'short' })).status, 400);
    const r = await c.post('/api/auth/claim', { username: 'Toot_Master', password: 'password123' });
    assert.equal(r.status, 200);
    assert.match(r.json.recoveryCode, /^[A-Z0-9]{5}(-[A-Z0-9]{5}){3}$/);
    const other = await guest(app);
    assert.equal((await other.post('/api/auth/claim', { username: 'toot_master', password: 'password123' })).status, 409, 'case-insensitive uniqueness');
  });

  test('login, logout, wrong password', async () => {
    await member(app, 'loginuser', 'correct-horse');
    const c = client(app);
    assert.equal((await c.post('/api/auth/login', { username: 'loginuser', password: 'nope-nope' })).status, 401);
    assert.equal((await c.post('/api/auth/login', { username: 'ghost', password: 'nope-nope' })).status, 401);
    assert.equal((await c.post('/api/auth/login', { username: 'LoginUser', password: 'correct-horse' })).status, 200);
    assert.equal((await c.get('/api/me')).json.user.username, 'loginuser');
    await c.post('/api/auth/logout');
    assert.equal((await c.get('/api/me')).json.user, null);
  });

  test('guest logs merge into account on login', async () => {
    await member(app, 'merger', 'password123');
    const c = await guest(app);
    await c.post('/api/logs', { kind: 'fart', type: 'toot', tzOffset: 0 });
    assert.equal((await c.post('/api/auth/login', { username: 'merger', password: 'password123' })).status, 200);
    const logs = (await c.get(`/api/logs?date=${today()}`)).json.logs;
    assert.equal(logs.length, 1);
    assert.equal(logs[0].type, 'toot');
  });

  test('recovery code resets password and rotates', async () => {
    const m = await member(app, 'forgetful', 'password123');
    const c = client(app);
    assert.equal((await c.post('/api/auth/recover', { username: 'forgetful', recoveryCode: 'AAAAA-BBBBB-CCCCC-DDDDD', password: 'newpassword1' })).status, 401);
    const r = await c.post('/api/auth/recover', { username: 'forgetful', recoveryCode: m.recoveryCode.toLowerCase().replace(/-/g, ' '), password: 'newpassword1' });
    assert.equal(r.status, 200);
    assert.notEqual(r.json.recoveryCode, m.recoveryCode);
    assert.equal((await m.get('/api/me')).json.user, null, 'old sessions revoked');
    assert.equal((await client(app).post('/api/auth/login', { username: 'forgetful', password: 'newpassword1' })).status, 200);
    assert.equal((await c.post('/api/auth/recover', { username: 'forgetful', recoveryCode: m.recoveryCode, password: 'another-one' })).status, 401, 'old code invalid');
  });

  test('change password requires the current one', async () => {
    const m = await member(app, 'changer', 'password123');
    assert.equal((await m.post('/api/auth/password', { currentPassword: 'wrong-pass', password: 'newpassword1' })).status, 401);
    assert.equal((await m.post('/api/auth/password', { currentPassword: 'password123', password: 'newpassword1' })).status, 200);
    assert.equal((await client(app).post('/api/auth/login', { username: 'changer', password: 'newpassword1' })).status, 200);
  });

  test('cross-site writes are rejected', async () => {
    const c = await guest(app);
    const r = await c.post('/api/logs', { kind: 'fart' }, { origin: 'https://evil.example' });
    assert.equal(r.status, 403);
    const r2 = await c.post('/api/logs', { kind: 'fart' }, { 'sec-fetch-site': 'cross-site' });
    assert.equal(r2.status, 403);
  });

  test('login is rate limited', async () => {
    const c = client(app);
    let last;
    for (let i = 0; i < 11; i++) last = await c.post('/api/auth/login', { username: 'nobody', password: 'whatever1' }, { 'x-forwarded-for': '9.9.9.9' });
    assert.equal(last.status, 429);
  });
});

describe('logs & stats', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(() => app.close());

  test('requires a session', async () => {
    assert.equal((await client(app).post('/api/logs', { kind: 'fart' })).status, 401);
  });

  test('create, validate, edit, delete', async () => {
    const c = await guest(app);
    assert.equal((await c.post('/api/logs', { kind: 'poop' })).status, 400);
    assert.equal((await c.post('/api/logs', { kind: 'fart', type: 'soda' })).status, 400, 'burp-only type on a fart');
    assert.equal((await c.post('/api/logs', { kind: 'fart', occurredAt: Date.now() + 86_400_000 })).status, 400, 'future');
    assert.equal((await c.post('/api/logs', { kind: 'fart', note: 'x'.repeat(281) })).status, 400);
    const r = await c.post('/api/logs', { kind: 'burp', type: 'sulfur', smell: 4, discomfort: 1, triggers: ['fizzy', 'bogus', 'fizzy'], note: '  eggs  ', tzOffset: 0 });
    assert.equal(r.status, 201);
    assert.deepEqual(r.json.triggers, ['fizzy']);
    assert.equal(r.json.note, 'eggs');
    const e = await c.patch(`/api/logs/${r.json.id}`, { kind: 'fart', type: 'sbd', smell: null });
    assert.equal(e.status, 200);
    assert.equal(e.json.type, 'sbd');
    assert.equal(e.json.smell, null);
    assert.equal(e.json.note, 'eggs', 'untouched fields kept');
    const other = await guest(app);
    assert.equal((await other.patch(`/api/logs/${r.json.id}`, { smell: 1 })).status, 404, 'cannot edit others');
    assert.equal((await other.del(`/api/logs/${r.json.id}`)).status, 404, 'cannot delete others');
    assert.equal((await c.del(`/api/logs/${r.json.id}`)).status, 200);
    assert.equal((await c.get(`/api/logs?date=${today()}`)).json.logs.length, 0);
  });

  test('local date follows the client timezone', async () => {
    const c = await guest(app);
    const at = Date.UTC(2026, 0, 2, 3, 30); // 03:30 UTC = 21:30 on Jan 1 in UTC-6
    const now = Date.now();
    const occurredAt = Math.min(now - 60_000, at + Math.floor((now - at) / 86_400_000) * 86_400_000);
    const r = await c.post('/api/logs', { kind: 'fart', occurredAt, tzOffset: 360 });
    const local = new Date(occurredAt - 360 * 60_000);
    assert.equal(r.json.localDate, local.toISOString().slice(0, 10));
  });

  test('stats: counts, streak, baseline, flags, badges', async () => {
    const c = await guest(app);
    const DAY = 86_400_000;
    const noon = Date.UTC(...today().split('-').map((n, i) => (i === 1 ? n - 1 : +n)), 12) ;
    const at = (daysAgo, h = 12) => Math.min(Date.now() - 1000, noon - daysAgo * DAY + (h - 12) * 3_600_000);
    for (let d = 1; d <= 6; d++) for (let i = 0; i < 4; i++) await c.post('/api/logs', { kind: 'fart', occurredAt: at(d), tzOffset: 0 });
    for (let d = 0; d < 3; d++) await c.post('/api/logs', { kind: 'fart', type: 'wet', discomfort: 2, triggers: ['beans'], smell: 3, occurredAt: at(d, 1), tzOffset: 0 });
    await c.post('/api/logs', { kind: 'burp', occurredAt: at(0, 1), tzOffset: 0 });
    const s = (await c.get(`/api/stats?today=${today()}&days=7`)).json;
    assert.equal(s.today.fart, 1);
    assert.equal(s.today.burp, 1);
    assert.equal(s.streak, 7);
    assert.equal(s.daily.length, 7);
    assert.ok(s.baseline && s.baseline.fart >= 4, JSON.stringify(s.baseline));
    assert.deepEqual(s.flags.sort(), ['discomfort', 'wet']);
    assert.equal(s.triggers[0].id, 'beans');
    assert.equal(s.triggers[0].avgSmell, 3);
    assert.ok(s.badges.includes('first') && s.badges.includes('streak7') && s.badges.includes('bilingual') && s.badges.includes('night_owl'));
    assert.equal(s.hours[1], 4);
    assert.equal((await c.get('/api/stats?today=1999-01-01&days=7')).status, 400, 'today must be near server date');
  });

  test('CSV export escapes formulas and only includes own logs', async () => {
    const c = await guest(app);
    await c.post('/api/logs', { kind: 'fart', note: '=HYPERLINK("http://x","y")', tzOffset: 0 });
    const other = await guest(app);
    await other.post('/api/logs', { kind: 'burp', note: 'secret', tzOffset: 0 });
    const r = await c.get('/api/export.csv');
    assert.equal(r.status, 200);
    assert.match(r.res.headers['content-type'], /text\/csv/);
    assert.match(r.res.body, /"'=HYPERLINK\(""http:\/\/x"",""y""\)"/);
    assert.doesNotMatch(r.res.body, /secret/);
  });
});

describe('audio & community', () => {
  let app;
  before(async () => { app = await makeApp({ reportHideThreshold: 2 }); });
  after(() => app.close());

  async function postedClip(c) {
    const log = (await c.post('/api/logs', { kind: 'fart', type: 'thunder', tzOffset: 0 })).json;
    const up = await c.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
    assert.equal(up.status, 200, JSON.stringify(up.json));
    const p = await c.post('/api/posts', { logId: log.id });
    return { log: up.json, postId: p.json.id };
  }

  test('upload transcodes to AAC with peaks; rejects junk', async () => {
    const c = await guest(app);
    const log = (await c.post('/api/logs', { kind: 'fart', tzOffset: 0 })).json;
    const bad = await c.put(`/api/logs/${log.id}/audio`, Buffer.alloc(5000, 7), audioHeaders);
    assert.equal(bad.status, 422);
    assert.equal((await c.put(`/api/logs/${log.id}/audio`, Buffer.from('x'.repeat(500)), { 'content-type': 'text/plain' })).status, 415);
    const ok = await c.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
    assert.equal(ok.status, 200);
    assert.equal(ok.json.peaks.length, 48);
    assert.ok(ok.json.durationMs > 1500 && ok.json.durationMs < 2600, String(ok.json.durationMs));
    const file = path.join(app.cfg.audioDir, `${ok.json.audioId}.m4a`);
    assert.ok(fs.existsSync(file));
    const play = await c.get(`/api/audio/${ok.json.audioId}`, { range: 'bytes=0-9' });
    assert.equal(play.status, 206);
    assert.equal(play.res.headers['content-type'], 'audio/mp4');
    assert.match(play.res.headers['cache-control'], /private/);
    // Replacing deletes the old file.
    const again = await c.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
    assert.ok(!fs.existsSync(file));
    // Private clip isn't playable by others or anonymous users.
    assert.equal((await (await guest(app)).get(`/api/audio/${again.json.audioId}`)).status, 404);
    assert.equal((await client(app).get(`/api/audio/${again.json.audioId}`)).status, 404);
    await c.del(`/api/logs/${log.id}`);
    assert.ok(!fs.existsSync(path.join(app.cfg.audioDir, `${again.json.audioId}.m4a`)), 'deleting log deletes clip');
  });

  test('posting requires a claimed account and a clip', async () => {
    const g = await guest(app);
    const log = (await g.post('/api/logs', { kind: 'fart', tzOffset: 0 })).json;
    assert.equal((await g.post('/api/posts', { logId: log.id })).status, 403);
    const m = await member(app, 'poster');
    const log2 = (await m.post('/api/logs', { kind: 'fart', tzOffset: 0 })).json;
    assert.equal((await m.post('/api/posts', { logId: log2.id })).status, 400);
    assert.equal((await m.post('/api/posts', { logId: log.id })).status, 404, "can't post someone else's log");
  });

  test('public feed, reactions, featured, share page', async () => {
    const a = await member(app, 'alice');
    const b = await member(app, 'bob');
    const { log, postId } = await postedClip(a);
    const anon = client(app);
    const feed = (await anon.get('/api/posts')).json.posts;
    assert.equal(feed[0].id, postId);
    assert.equal(feed[0].username, 'alice');
    assert.equal((await anon.get(`/api/audio/${log.audioId}`)).status, 200, 'posted clips are public');
    assert.equal((await anon.put(`/api/posts/${postId}/reaction`, { emoji: 'laugh' })).status, 401);
    assert.equal((await b.put(`/api/posts/${postId}/reaction`, { emoji: 'nope' })).status, 400);
    let r = await b.put(`/api/posts/${postId}/reaction`, { emoji: 'laugh' });
    assert.deepEqual(r.json.post.reactions, { laugh: 1 });
    r = await b.put(`/api/posts/${postId}/reaction`, { emoji: 'fire' });
    assert.deepEqual(r.json.post.reactions, { fire: 1 }, 'one reaction per user');
    assert.equal(r.json.post.mine, 'fire');
    assert.equal((await anon.get('/api/posts/featured')).json.post.id, postId);
    assert.equal((await anon.get('/api/posts?sort=top')).json.posts[0].score, 1);
    const page = await anon.get(`/p/${postId}`);
    assert.match(page.res.body, /og:title" content="⛈️ Thunderclap by @alice"/);
    r = await b.put(`/api/posts/${postId}/reaction`, { emoji: null });
    assert.deepEqual(r.json.post.reactions, {});
  });

  test('reports auto-hide at threshold; blocks hide authors', async () => {
    const author = await member(app, 'spammer');
    const { postId, log } = await postedClip(author);
    const r1 = await member(app, 'rep1');
    const r2 = await member(app, 'rep2');
    app.db.prepare("UPDATE users SET created_at = 0 WHERE username IN ('rep1', 'rep2')").run(); // trusted (aged) accounts
    assert.equal((await author.post(`/api/posts/${postId}/report`, { reason: 'spam' })).status, 400, 'no self-report');
    assert.equal((await r1.post(`/api/posts/${postId}/report`, { reason: 'bad' })).status, 400);
    await r1.post(`/api/posts/${postId}/report`, { reason: 'spam' });
    await r1.post(`/api/posts/${postId}/report`, { reason: 'spam' }); // duplicate doesn't count twice
    assert.ok((await client(app).get('/api/posts')).json.posts.some((p) => p.id === postId));
    await r2.post(`/api/posts/${postId}/report`, { reason: 'offensive' });
    assert.ok(!(await client(app).get('/api/posts')).json.posts.some((p) => p.id === postId), 'hidden after 2 reports');
    assert.equal((await client(app).get(`/api/audio/${log.audioId}`)).status, 404, 'hidden clip not public');
    assert.equal((await author.get(`/api/audio/${log.audioId}`)).status, 200, 'owner still hears it');

    const loud = await member(app, 'loudmouth');
    const { postId: p2 } = await postedClip(loud);
    const viewer = await member(app, 'viewer');
    assert.equal((await viewer.post('/api/blocks', { username: 'loudmouth' })).status, 200);
    assert.ok(!(await viewer.get('/api/posts')).json.posts.some((p) => p.id === p2));
    assert.deepEqual((await viewer.get('/api/blocks')).json.blocks, ['loudmouth']);
    await viewer.del('/api/blocks/loudmouth');
    assert.ok((await viewer.get('/api/posts')).json.posts.some((p) => p.id === p2));
  });

  test('banned users cannot post or react, and vanish from the feed', async () => {
    const m = await member(app, 'troll');
    const { postId } = await postedClip(m);
    app.db.prepare("UPDATE users SET banned = 1 WHERE username = 'troll'").run();
    assert.ok(!(await client(app).get('/api/posts')).json.posts.some((p) => p.id === postId));
    const log = (await m.post('/api/logs', { kind: 'fart', tzOffset: 0 })).json;
    await m.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
    assert.equal((await m.post('/api/posts', { logId: log.id })).status, 403);
    assert.equal((await m.get('/api/me')).json.user.banned, true);
  });

  test('only owner or admin can delete a post', async () => {
    const owner = await member(app, 'owner1');
    const { postId } = await postedClip(owner);
    const rando = await member(app, 'rando');
    assert.equal((await rando.del(`/api/posts/${postId}`)).status, 404);
    assert.equal((await owner.del(`/api/posts/${postId}`)).status, 200);
  });

  test('account deletion removes everything including files', async () => {
    const m = await member(app, 'leaver');
    const { log } = await postedClip(m);
    const file = path.join(app.cfg.audioDir, `${log.audioId}.m4a`);
    assert.ok(fs.existsSync(file));
    assert.equal((await m.del('/api/me', { confirm: 'wrong' })).status, 400);
    assert.equal((await m.del('/api/me', { confirm: 'LEAVER' })).status, 200);
    assert.ok(!fs.existsSync(file));
    assert.equal(app.db.prepare("SELECT COUNT(*) n FROM users WHERE username = 'leaver'").get().n, 0);
    assert.equal(app.db.prepare('SELECT COUNT(*) n FROM logs WHERE audio_id = ?').get(log.audioId).n, 0);
    assert.equal((await client(app).post('/api/auth/login', { username: 'leaver', password: 'password123' })).status, 401);
  });
});

describe('pages, headers & maintenance', () => {
  let app;
  before(async () => { app = await makeApp({ appName: 'GasPass' }); });
  after(() => app.close());

  test('templated pages and security headers', async () => {
    const c = client(app);
    const home = await c.get('/');
    assert.equal(home.status, 200);
    assert.match(home.res.body, /<title>GasPass/);
    assert.match(home.res.headers['content-security-policy'], /script-src 'self'/);
    assert.equal(home.res.headers['x-content-type-options'], 'nosniff');
    assert.match((await c.get('/privacy')).res.body, /GasPass/);
    assert.match((await c.get('/manifest.webmanifest')).res.body, /"short_name": "GasPass"/);
    assert.equal((await c.get('/js/catalog.js')).status, 200);
    assert.equal((await c.get('/index.html')).status, 404, 'raw templates are not exposed');
    assert.equal((await c.get('/../server/config.js')).status, 404);
    assert.equal((await c.get('/healthz')).json.ok, true);
  });

  test('maintenance backs up and purges abandoned guests', async () => {
    const g = await guest(app);
    await g.post('/api/logs', { kind: 'fart', tzOffset: 0 });
    await g.post('/api/auth/logout');
    app.db.prepare('UPDATE users SET last_seen_at = 0 WHERE username IS NULL').run();
    const keep = await member(app, 'keeper');
    app.db.prepare("UPDATE users SET last_seen_at = 0 WHERE username = 'keeper'").run();
    const res = await runMaintenance(app);
    assert.ok(fs.existsSync(res.file));
    assert.ok(res.guests >= 1);
    assert.equal((await keep.get('/api/me')).json.user.username, 'keeper', 'claimed accounts are never purged');
  });
});

describe('review hardening', () => {
  let app;
  before(async () => { app = await makeApp({ reportHideThreshold: 2 }); });
  after(() => app.close());

  test('login limit is per IP, not per (free) guest session', async () => {
    await member(app, 'target', 'password123');
    const headers = { 'x-forwarded-for': '7.7.7.7' };
    let statuses = [];
    for (let s = 0; s < 3; s++) {
      const c = client(app);
      await c.post('/api/auth/guest', { birthYear: 1990 }, headers);
      for (let i = 0; i < 4; i++) statuses.push((await c.post('/api/auth/login', { username: 'target', password: 'wrong-guess' }, headers)).status);
    }
    assert.equal(statuses.filter((s) => s === 401).length, 10);
    assert.equal(statuses.at(-1), 429);
  });

  test('per-account throttle stops distributed guessing', async () => {
    await member(app, 'victim', 'password123');
    let last;
    for (let i = 0; i < 21; i++) last = await client(app).post('/api/auth/login', { username: 'victim', password: 'wrong-guess' });
    assert.equal(last.status, 429);
  });

  test('sliding session re-sends the cookie', async () => {
    const c = await guest(app);
    app.db.prepare('UPDATE sessions SET expires_at = ?').run(Date.now() + 86_400_000);
    const r = await c.get('/api/me');
    const set = r.res.cookies.find((k) => k.name === 'ufarted_sid');
    assert.ok(set, 'Set-Cookie present');
    assert.ok(set.maxAge > 170 * 86400);
    assert.equal((await c.get('/api/me')).res.cookies.length, 0, 'not re-sent on every request');
  });

  test('admin comes from the database flag, not the username', async () => {
    const m = await member(app, 'mod_tyler');
    assert.equal((await m.get('/api/me')).json.user.isAdmin, false);
    app.db.prepare("UPDATE users SET is_admin = 1 WHERE username = 'mod_tyler'").run();
    assert.equal((await m.get('/api/me')).json.user.isAdmin, true);
  });

  test('guests cannot react or report; fresh accounts do not auto-hide', async () => {
    const author = await member(app, 'author2');
    const log = (await author.post('/api/logs', { kind: 'burp', tzOffset: 0 })).json;
    await author.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
    const postId = (await author.post('/api/posts', { logId: log.id })).json.id;
    const g = await guest(app);
    assert.equal((await g.put(`/api/posts/${postId}/reaction`, { emoji: 'laugh' })).status, 403);
    assert.equal((await g.post(`/api/posts/${postId}/report`, { reason: 'spam' })).status, 403);
    for (const name of ['sock1', 'sock2', 'sock3']) await (await member(app, name)).post(`/api/posts/${postId}/report`, { reason: 'spam' });
    assert.ok((await client(app).get('/api/posts')).json.posts.some((p) => p.id === postId), 'new accounts cannot hide posts');
  });

  test('password recovery from a guest session keeps the guest logs', async () => {
    const m = await member(app, 'recoverer', 'password123');
    const g = await guest(app);
    await g.post('/api/logs', { kind: 'fart', tzOffset: 0 });
    await g.post('/api/logs', { kind: 'burp', tzOffset: 0 });
    assert.equal((await g.post('/api/auth/recover', { username: 'recoverer', recoveryCode: m.recoveryCode, password: 'newpassword1' })).status, 200);
    assert.equal((await g.get(`/api/logs?date=${today()}`)).json.logs.length, 2);
  });

  test('top feed pages with a stable keyset cursor', async () => {
    const posters = [await member(app, 'prolific1'), await member(app, 'prolific2')]; // 20 posts/hour/user limit
    const fans = await Promise.all(['fan1', 'fan2'].map((n) => member(app, n)));
    const ids = [];
    for (let i = 0; i < 24; i++) {
      const poster = posters[i % 2];
      const log = (await poster.post('/api/logs', { kind: 'fart', tzOffset: 0 })).json;
      await poster.put(`/api/logs/${log.id}/audio`, testClip(), audioHeaders);
      ids.push((await poster.post('/api/posts', { logId: log.id })).json.id);
    }
    for (const f of fans) await f.put(`/api/posts/${ids[5]}/reaction`, { emoji: 'fire' });
    const anon = client(app);
    const p1 = (await anon.get('/api/posts?sort=top')).json;
    assert.equal(p1.posts[0].id, ids[5]);
    await fans[0].put(`/api/posts/${ids[5]}/reaction`, { emoji: null }); // score changes between pages
    const p2 = (await anon.get(`/api/posts?sort=top&cursor=${p1.cursor}&since=${p1.since}`)).json;
    const all = [...p1.posts, ...p2.posts].map((p) => p.id);
    assert.equal(new Set(all).size, all.length, 'no duplicates');
    assert.ok(ids.every((id) => all.includes(id)), 'nothing skipped');
  });
});

describe('gut checks', () => {
  let app;
  before(async () => { app = await makeApp(); });
  after(() => app.close());

  test('upsert, validate, clear, and feed stats / triggers / flags', async () => {
    const c = await guest(app);
    const DAY = 86_400_000;
    const d = (n) => new Date(Date.now() - n * DAY).toISOString().slice(0, 10);
    assert.equal((await c.put('/api/gutcheck', { date: d(0), bloating: 4 })).status, 400);
    assert.equal((await c.put('/api/gutcheck', { date: d(40), bloating: 1 })).status, 400, 'too old');
    assert.equal((await c.put('/api/gutcheck', { date: 'yesterday', bloating: 1 })).status, 400);
    assert.equal((await client(app).put('/api/gutcheck', { date: d(0), bloating: 1 })).status, 401);
    // Bloated on bean days (0, 2, 4), flat on the others.
    for (let i = 0; i < 6; i++) {
      const beans = i % 2 === 0;
      assert.equal((await c.put('/api/gutcheck', { date: d(i), bloating: beans ? 3 : 0, pain: beans ? 2 : 0 })).status, 200);
      await c.post('/api/logs', { kind: 'fart', triggers: beans ? ['beans'] : ['coffee'], occurredAt: Date.now() - i * DAY - 60_000, tzOffset: 0 });
    }
    const r = await c.put('/api/gutcheck', { date: d(1), bloating: 1, pain: null }); // re-save updates in place
    assert.deepEqual(r.json, { date: d(1), bloating: 1, pain: null });
    const s = (await c.get(`/api/stats?today=${d(0)}&days=7`)).json;
    assert.deepEqual(s.gut.today, { bloating: 3, pain: 2 });
    assert.equal(s.gut.checkedDays, 6);
    assert.equal(s.gut.bloatedDays, 3);
    assert.equal(s.gut.painDays, 3);
    assert.equal(s.daily.at(-2).bloating, 1);
    assert.equal(s.daily.at(-2).pain, null);
    const beans = s.triggers.find((t) => t.id === 'beans');
    assert.equal(beans.bloatWith, 3);
    assert.equal(beans.bloatWithout, 0.3); // days 1, 3, 5 → (1 + 0 + 0) / 3
    assert.ok(s.flags.includes('bloating') && s.flags.includes('pain'));
    assert.ok(s.streak >= 6);
    const csv = (await c.get('/api/export.csv')).res.body;
    assert.match(csv, new RegExp(`,gut_check,,,${d(0)},.*,3,2\\r\\n`));
  });

  test('guest gut checks move into the account on login (account wins same-day conflicts)', async () => {
    const m = await member(app, 'checker', 'password123');
    const today = new Date().toISOString().slice(0, 10);
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    await m.put('/api/gutcheck', { date: today, bloating: 2 });
    const g = await guest(app);
    await g.put('/api/gutcheck', { date: today, bloating: 0 });
    await g.put('/api/gutcheck', { date: yesterday, bloating: 1 });
    assert.equal((await g.post('/api/auth/login', { username: 'checker', password: 'password123' })).status, 200);
    const s = (await g.get(`/api/stats?today=${today}&days=7`)).json;
    assert.equal(s.gut.today.bloating, 2);
    assert.equal(s.daily.at(-2).bloating, 1);
  });

  test('all history and trigger insights are free', async () => {
    const c = await guest(app);
    await c.post('/api/logs', { kind: 'fart', triggers: ['dairy'], tzOffset: 0 });
    const s = (await c.get(`/api/stats?today=${today()}&days=365`)).json;
    assert.equal(s.days, 365);
    assert.equal(s.triggers[0].id, 'dairy');
    assert.equal((await c.get('/api/me')).json.user.isPremium, undefined);
  });
});
