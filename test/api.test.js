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

  test('guest requires age confirmation', async () => {
    const c = client(app);
    assert.equal((await c.post('/api/auth/guest', {})).status, 400);
    assert.equal((await c.post('/api/auth/guest', { ageOk: false })).status, 400);
    const r = await c.post('/api/auth/guest', { ageOk: true });
    assert.equal(r.status, 200);
    assert.equal(r.json.user.isGuest, true);
    assert.equal((await c.get('/api/me')).json.user.isGuest, true);
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

describe('premium gating & billing', () => {
  let app;
  before(async () => {
    app = await makeApp({ stripe: { secretKey: 'sk_test_dummy', webhookSecret: 'whsec_test', priceId: 'price_x', mode: 'payment', priceLabel: '$4.99' } });
  });
  after(() => app.close());

  test('free users get 30 days and no trigger insights', async () => {
    const c = await member(app, 'freebie');
    await c.post('/api/logs', { kind: 'fart', triggers: ['beans'], tzOffset: 0 });
    const s = (await c.get(`/api/stats?today=${today()}&days=90`)).json;
    assert.equal(s.days, 30);
    assert.equal(s.limited, true);
    assert.equal(s.triggers, null);
    assert.equal(s.triggersLocked, true);
    assert.equal((await c.get('/api/me')).json.config.billingEnabled, true);
  });

  test('signed webhook grants premium; bad signature rejected; replay ignored', async () => {
    const c = await member(app, 'payer');
    const userId = (await c.get('/api/me')).json.user.id;
    const { default: Stripe } = await import('stripe');
    const stripe = new Stripe('sk_test_dummy');
    const payload = JSON.stringify({ id: 'evt_1', type: 'checkout.session.completed', data: { object: {
      id: 'cs_1', mode: 'payment', payment_status: 'paid', client_reference_id: String(userId), customer: 'cus_1' } } });
    const bad = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': 't=1,v1=deadbeef' } });
    assert.equal(bad.statusCode, 400);
    const sig = stripe.webhooks.generateTestHeaderString({ payload, secret: 'whsec_test' });
    const ok = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
    assert.equal(ok.statusCode, 200);
    assert.equal((await c.get('/api/me')).json.user.isPremium, true);
    const s = (await c.get(`/api/stats?today=${today()}&days=90`)).json;
    assert.equal(s.days, 90);
    const replay = await app.inject({ method: 'POST', url: '/api/billing/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': sig } });
    assert.equal(replay.json().duplicate, true);
  });

  test('checkout requires a claimed account', async () => {
    const g = await guest(app);
    assert.equal((await g.post('/api/billing/checkout')).status, 403);
  });
});

describe('billing disabled', () => {
  test('everything unlocked and billing routes 404', async () => {
    const app = await makeApp();
    const c = await guest(app);
    assert.equal((await c.get('/api/me')).json.user.isPremium, true);
    assert.equal((await c.get(`/api/stats?today=${today()}&days=365`)).json.days, 365);
    assert.equal((await c.post('/api/billing/checkout')).status, 404);
    await app.close();
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
