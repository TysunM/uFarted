import { REACTION_IDS, REPORT_REASONS } from '../../public/js/catalog.js';
import { requireUser, requireAccount, userKey } from '../app.js';

const PAGE = 20;
const WEEK = 7 * 86_400_000;
const CHAMPION_MIN_SCORE = 3; // reactions a clip needs before it becomes the reference sound for its type
const TRUSTED_AGE = 86_400_000; // only accounts older than a day count toward auto-hiding (stops instant sockpuppets)

export default async function communityRoutes(app) {
  const { db, cfg } = app;

  // Visible = not hidden by moderation, author not banned, and author not blocked by the viewer.
  const visible = `p.hidden = 0 AND u.banned = 0 AND NOT EXISTS (SELECT 1 FROM blocks b WHERE b.user_id = @viewer AND b.blocked_id = p.user_id)`;
  const select = `SELECT p.*, u.username,
      (SELECT emoji FROM reactions r WHERE r.post_id = p.id AND r.user_id = @viewer) AS mine
    FROM posts p JOIN users u ON u.id = p.user_id`;
  const q = {
    feedNew: db.prepare(`${select} WHERE ${visible} AND p.id < @before ORDER BY p.id DESC LIMIT ${PAGE}`),
    feedTop: db.prepare(`${select} WHERE ${visible} AND p.created_at > @since AND (p.score < @cs OR (p.score = @cs AND p.id < @cid))
                         ORDER BY p.score DESC, p.id DESC LIMIT ${PAGE}`),
    feedMine: db.prepare(`${select} WHERE p.user_id = @viewer AND p.id < @before ORDER BY p.id DESC LIMIT ${PAGE}`),
    one: db.prepare(`${select} WHERE p.id = @id AND (${visible} OR p.user_id = @viewer)`),
    counts: (ids) => db.prepare(`SELECT post_id, emoji, COUNT(*) AS n FROM reactions WHERE post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id, emoji`).all(...ids),
    log: db.prepare(`SELECT l.*, p.id AS post_id FROM logs l LEFT JOIN posts p ON p.log_id = l.id WHERE l.id = ? AND l.user_id = ?`),
    createPost: db.prepare(`INSERT INTO posts (user_id, log_id, kind, type, audio_id, audio_ms, peaks, created_at)
                            VALUES (@userId, @logId, @kind, @type, @audioId, @audioMs, @peaks, @now)`),
    postById: db.prepare('SELECT * FROM posts WHERE id = ?'),
    deletePost: db.prepare('DELETE FROM posts WHERE id = ?'),
    upsertReaction: db.prepare(`INSERT INTO reactions (post_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)
                                ON CONFLICT (post_id, user_id) DO UPDATE SET emoji = excluded.emoji`),
    deleteReaction: db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ?'),
    rescore: db.prepare('UPDATE posts SET score = (SELECT COUNT(*) FROM reactions WHERE post_id = ?) WHERE id = ?'),
    report: db.prepare('INSERT OR IGNORE INTO reports (post_id, user_id, reason, created_at) VALUES (?, ?, ?, ?)'),
    recount: db.prepare(`UPDATE posts SET report_count = (SELECT COUNT(*) FROM reports WHERE post_id = @id),
                         hidden = CASE WHEN hidden = 0 AND (SELECT COUNT(*) FROM reports r JOIN users u ON u.id = r.user_id
                           WHERE r.post_id = @id AND u.created_at < r.created_at - @age) >= @threshold THEN 1 ELSE hidden END
                         WHERE id = @id RETURNING hidden, report_count`),
    userByName: db.prepare('SELECT id, username FROM users WHERE username = ?'),
    block: db.prepare('INSERT OR IGNORE INTO blocks (user_id, blocked_id, created_at) VALUES (?, ?, ?)'),
    unblock: db.prepare('DELETE FROM blocks WHERE user_id = ? AND blocked_id = ?'),
    blocks: db.prepare('SELECT u.username FROM blocks b JOIN users u ON u.id = b.blocked_id WHERE b.user_id = ? ORDER BY u.username'),
    champions: db.prepare(`SELECT kind, type, audio_id, username, score FROM (
        SELECT p.kind, p.type, p.audio_id, u.username, p.score,
               ROW_NUMBER() OVER (PARTITION BY p.kind, p.type ORDER BY p.score DESC, p.id DESC) AS rn
        FROM posts p JOIN users u ON u.id = p.user_id WHERE ${visible} AND p.score >= @min) WHERE rn = 1`),
    audioOwner: db.prepare('SELECT user_id FROM logs WHERE audio_id = ?'),
    audioPublic: db.prepare(`SELECT 1 FROM posts p JOIN users u ON u.id = p.user_id WHERE p.audio_id = ? AND p.hidden = 0 AND u.banned = 0`),
  };

  function serialize(rows) {
    if (!rows.length) return [];
    const counts = new Map();
    for (const c of q.counts(rows.map((r) => r.id))) {
      counts.set(c.post_id, { ...(counts.get(c.post_id) || {}), [c.emoji]: c.n });
    }
    return rows.map((r) => ({
      id: r.id, username: r.username, kind: r.kind, type: r.type, audioId: r.audio_id, durationMs: r.audio_ms,
      peaks: JSON.parse(r.peaks), createdAt: r.created_at, reactions: counts.get(r.id) || {}, mine: r.mine,
      score: r.score, hidden: Boolean(r.hidden),
    }));
  }
  const params = (req, extra = {}) => ({ viewer: req.user?.id ?? 0, ...extra });

  // Feed is public (read-only) so shared links work for people who haven't joined yet.
  app.get('/posts', async (req) => {
    const sort = req.query.sort;
    const before = Number.parseInt(req.query.before, 10) || Number.MAX_SAFE_INTEGER;
    if (sort === 'top') {
      // Keyset cursor "score:id" plus a window pinned by the first page, so paging stays stable.
      const now = Date.now();
      const since = Math.min(Math.max(Number(req.query.since) || now - WEEK, now - WEEK - 86_400_000), now);
      const m = /^(\d+):(\d+)$/.exec(req.query.cursor || '');
      const [cs, cid] = m ? [Number(m[1]), Number(m[2])] : [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER];
      const posts = serialize(q.feedTop.all(params(req, { since, cs, cid })));
      const last = posts.at(-1);
      return { posts, since, cursor: last ? `${last.score}:${last.id}` : null };
    }
    if (sort === 'mine') {
      if (!req.user) return { posts: [] };
      return { posts: serialize(q.feedMine.all(params(req, { before }))) };
    }
    return { posts: serialize(q.feedNew.all(params(req, { before }))) };
  });

  // The community's top-rated real clip for each type, played next to the studio samples in the type picker.
  app.get('/posts/champions', async (req) => {
    const champions = {};
    for (const r of q.champions.all(params(req, { min: CHAMPION_MIN_SCORE }))) {
      champions[`${r.kind}:${r.type}`] = { audioId: r.audio_id, username: r.username, score: r.score };
    }
    return { champions };
  });

  app.get('/posts/featured', async (req) => {
    const rows = q.feedTop.all(params(req, { since: Date.now() - 86_400_000, cs: Number.MAX_SAFE_INTEGER, cid: Number.MAX_SAFE_INTEGER })).filter((r) => r.score > 0);
    return { post: serialize(rows.slice(0, 1))[0] ?? null };
  });

  app.get('/posts/:id', async (req, reply) => {
    const row = q.one.get(params(req, { id: Number(req.params.id) || 0 }));
    if (!row) return reply.code(404).send({ error: 'Post not found.' });
    return { post: serialize([row])[0] };
  });

  const assertActive = (req, reply) => {
    if (req.user.banned) { reply.code(403).send({ error: 'Your community access is suspended.' }); return false; }
    return true;
  };

  app.post('/posts', {
    preHandler: requireAccount,
    config: { rateLimit: { max: 20, timeWindow: '1 hour', keyGenerator: userKey } },
    schema: { body: { type: 'object', required: ['logId'], properties: { logId: { type: 'integer' } } } },
  }, async (req, reply) => {
    if (!assertActive(req, reply)) return reply;
    const log = q.log.get(req.body.logId, req.user.id);
    if (!log) return reply.code(404).send({ error: 'Log not found.' });
    if (!log.audio_id) return reply.code(400).send({ error: 'Record a clip first.' });
    if (log.post_id) return { id: log.post_id };
    const id = Number(q.createPost.run({ userId: req.user.id, logId: log.id, kind: log.kind, type: log.type,
      audioId: log.audio_id, audioMs: log.audio_ms, peaks: log.peaks, now: Date.now() }).lastInsertRowid);
    return reply.code(201).send({ id });
  });

  app.delete('/posts/:id', { preHandler: requireUser }, async (req, reply) => {
    const post = q.postById.get(Number(req.params.id) || 0);
    if (!post || (post.user_id !== req.user.id && !req.user.isAdmin)) return reply.code(404).send({ error: 'Post not found.' });
    q.deletePost.run(post.id);
    return { ok: true };
  });

  app.put('/posts/:id/reaction', {
    preHandler: requireAccount,
    config: { rateLimit: { max: 300, timeWindow: '1 hour', keyGenerator: userKey } },
    schema: { body: { type: 'object', required: ['emoji'], properties: { emoji: { type: ['string', 'null'], maxLength: 10 } } } },
  }, async (req, reply) => {
    if (!assertActive(req, reply)) return reply;
    const row = q.one.get(params(req, { id: Number(req.params.id) || 0 }));
    if (!row || row.hidden) return reply.code(404).send({ error: 'Post not found.' });
    const { emoji } = req.body;
    if (emoji !== null && !REACTION_IDS.has(emoji)) return reply.code(400).send({ error: 'Unknown reaction.' });
    db.transaction(() => {
      if (emoji) q.upsertReaction.run(row.id, req.user.id, emoji, Date.now());
      else q.deleteReaction.run(row.id, req.user.id);
      q.rescore.run(row.id, row.id);
    })();
    return { post: serialize([q.one.get(params(req, { id: row.id }))])[0] };
  });

  app.post('/posts/:id/report', {
    preHandler: requireAccount,
    config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
    schema: { body: { type: 'object', required: ['reason'], properties: { reason: { enum: REPORT_REASONS.map((r) => r.id) } } } },
  }, async (req, reply) => {
    const post = q.postById.get(Number(req.params.id) || 0);
    if (!post) return reply.code(404).send({ error: 'Post not found.' });
    if (post.user_id === req.user.id) return reply.code(400).send({ error: 'You can’t report your own post.' });
    const inserted = q.report.run(post.id, req.user.id, req.body.reason, Date.now()).changes;
    const state = q.recount.get({ id: post.id, threshold: cfg.reportHideThreshold, age: TRUSTED_AGE });
    if (inserted) notifyModerators(app, post, req.body.reason, state);
    return { ok: true };
  });

  app.get('/blocks', { preHandler: requireUser }, async (req) => ({ blocks: q.blocks.all(req.user.id).map((r) => r.username) }));

  app.post('/blocks', {
    preHandler: requireUser,
    schema: { body: { type: 'object', required: ['username'], properties: { username: { type: 'string', maxLength: 40 } } } },
  }, async (req, reply) => {
    const target = q.userByName.get(req.body.username);
    if (!target || target.id === req.user.id) return reply.code(404).send({ error: 'User not found.' });
    q.block.run(req.user.id, target.id, Date.now());
    return { ok: true };
  });

  app.delete('/blocks/:username', { preHandler: requireUser }, async (req) => {
    const target = q.userByName.get(req.params.username);
    if (target) q.unblock.run(req.user.id, target.id);
    return { ok: true };
  });

  // Audio: owners can always play their own clips; everyone can play clips that are visibly posted.
  app.get('/audio/:id', async (req, reply) => {
    const id = req.params.id;
    if (!/^[0-9a-f-]{36}$/.test(id)) return reply.code(404).send({ error: 'Not found.' });
    const owner = q.audioOwner.get(id);
    const allowed = owner && ((req.user && owner.user_id === req.user.id) || q.audioPublic.get(id));
    if (!allowed) return reply.code(404).send({ error: 'Not found.' });
    return reply.sendFile(app.audio.file(id), cfg.audioDir, { acceptRanges: true, cacheControl: false });
  });
}

async function notifyModerators(app, post, reason, state) {
  const url = app.cfg.modWebhookUrl;
  if (!url) return;
  const text = `🚩 ${app.cfg.appName}: post #${post.id} reported (${reason}). Reports: ${state?.report_count ?? '?'}${state?.hidden ? ' — auto-hidden' : ''}.`;
  const discord = /discord(app)?\.com\/api\/webhooks/.test(url);
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': discord ? 'application/json' : 'text/plain' },
      body: discord ? JSON.stringify({ content: text }) : text,
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    app.log.warn({ err }, 'moderation webhook failed');
  }
}
