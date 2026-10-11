import {
  COOKIE, cookieOptions, hashSecret, verifySecret, newRecoveryCode, normalizeRecovery,
  usernameProblem, passwordProblem,
} from '../auth.js';
import { requireUser, requireAccount } from '../app.js';

const strictLimit = { rateLimit: { max: 10, timeWindow: '15 minutes' } };
// Keyed by IP, not session: free guest sessions must not each get their own password-guessing budget.
const ipLimit = (max) => ({ rateLimit: { max, timeWindow: '15 minutes', keyGenerator: (req) => req.ip } });

// Per-account throttle so a botnet spread over many IPs still can't hammer one username.
function accountThrottle({ max = 20, windowMs = 15 * 60_000 } = {}) {
  const hits = new Map();
  return (username) => {
    const key = String(username).toLowerCase();
    const now = Date.now();
    if (hits.size > 50_000) for (const [k, v] of hits) if (v.reset < now) hits.delete(k);
    const e = hits.get(key);
    if (!e || e.reset < now) { hits.set(key, { n: 1, reset: now + windowMs }); return true; }
    return ++e.n <= max;
  };
}

export function publicUser(u) {
  if (!u) return null;
  return {
    id: u.id, username: u.username, isGuest: u.isGuest, isAdmin: u.isAdmin,
    banned: Boolean(u.banned), createdAt: u.created_at,
  };
}

export default async function authRoutes(app) {
  const { db, cfg, sessions } = app;
  const q = {
    createUser: db.prepare('INSERT INTO users (created_at, last_seen_at) VALUES (?, ?)'),
    byName: db.prepare('SELECT * FROM users WHERE username = ?'),
    claim: db.prepare('UPDATE users SET username = ?, pass_hash = ?, recovery_hash = ? WHERE id = ? AND username IS NULL'),
    setPass: db.prepare('UPDATE users SET pass_hash = ? WHERE id = ?'),
    setPassAndRecovery: db.prepare('UPDATE users SET pass_hash = ?, recovery_hash = ? WHERE id = ?'),
    moveLogs: db.prepare('UPDATE logs SET user_id = ? WHERE user_id = ?'),
    moveChecks: db.prepare('UPDATE OR IGNORE gut_checks SET user_id = ? WHERE user_id = ?'),
    deleteUser: db.prepare('DELETE FROM users WHERE id = ?'),
    userAudio: db.prepare('SELECT audio_id FROM logs WHERE user_id = ? AND audio_id IS NOT NULL'),
  };

  const startSession = (reply, userId) => reply.setCookie(COOKIE, sessions.create(userId), cookieOptions(cfg));
  const throttled = accountThrottle();
  // Signing in from a guest session: bring that device's logs into the account and drop the guest.
  const switchTo = (req, reply, userId) => {
    if (req.user?.isGuest && req.user.id !== userId) {
      db.transaction(() => { q.moveLogs.run(userId, req.user.id); q.moveChecks.run(userId, req.user.id); q.deleteUser.run(req.user.id); })();
    } else {
      sessions.destroy(req.cookies[COOKIE]);
    }
    startSession(reply, userId);
  };

  app.get('/me', async (req) => ({
    user: publicUser(req.user),
    config: {
      appName: cfg.appName,
      supportEmail: cfg.supportEmail,
      maxClipSeconds: cfg.maxClipSeconds,
    },
  }));

  app.post('/auth/guest', {
    config: { rateLimit: { max: 60, timeWindow: '1 hour' } }, // generous: carrier NAT puts many people on one IP
    schema: { body: { type: 'object', required: ['ageOk'], properties: { ageOk: { const: true } } } },
  }, async (req, reply) => {
    if (req.user) return { user: publicUser(req.user) };
    const now = Date.now();
    const id = Number(q.createUser.run(now, now).lastInsertRowid);
    startSession(reply, id);
    return { user: { id, username: null, isGuest: true, isAdmin: false, banned: false, createdAt: now } };
  });

  const credsSchema = {
    type: 'object', required: ['username', 'password'],
    properties: { username: { type: 'string', maxLength: 40 }, password: { type: 'string', maxLength: 200 } },
  };

  app.post('/auth/claim', { config: strictLimit, preHandler: requireUser, schema: { body: credsSchema } }, async (req, reply) => {
    if (!req.user.isGuest) return reply.code(400).send({ error: 'You already have a username.' });
    const { username, password } = req.body;
    const problem = usernameProblem(username) || passwordProblem(password);
    if (problem) return reply.code(400).send({ error: problem });
    if (q.byName.get(username)) return reply.code(409).send({ error: 'That username is taken.' });
    const recoveryCode = newRecoveryCode();
    const [passHash, recHash] = await Promise.all([hashSecret(password), hashSecret(normalizeRecovery(recoveryCode))]);
    try {
      q.claim.run(username, passHash, recHash, req.user.id);
    } catch (err) {
      if (String(err.code).startsWith('SQLITE_CONSTRAINT')) return reply.code(409).send({ error: 'That username is taken.' });
      throw err;
    }
    return { username, recoveryCode };
  });

  app.post('/auth/login', { config: ipLimit(10), schema: { body: credsSchema } }, async (req, reply) => {
    if (!throttled(req.body.username)) return reply.code(429).send({ error: 'Too many attempts for this account. Try again in 15 minutes.' });
    const user = q.byName.get(req.body.username);
    const ok = await verifySecret(req.body.password, user?.pass_hash);
    if (!ok) return reply.code(401).send({ error: 'Wrong username or password.' });
    switchTo(req, reply, user.id);
    return { ok: true };
  });

  app.post('/auth/recover', {
    config: ipLimit(5),
    schema: { body: { type: 'object', required: ['username', 'recoveryCode', 'password'], properties: {
      username: { type: 'string', maxLength: 40 }, recoveryCode: { type: 'string', maxLength: 60 },
      password: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const problem = passwordProblem(req.body.password);
    if (problem) return reply.code(400).send({ error: problem });
    if (!throttled(req.body.username)) return reply.code(429).send({ error: 'Too many attempts for this account. Try again in 15 minutes.' });
    const user = q.byName.get(req.body.username);
    const ok = await verifySecret(normalizeRecovery(req.body.recoveryCode), user?.recovery_hash);
    if (!ok) return reply.code(401).send({ error: 'That recovery code doesn’t match.' });
    const recoveryCode = newRecoveryCode();
    const [passHash, recHash] = await Promise.all([hashSecret(req.body.password), hashSecret(normalizeRecovery(recoveryCode))]);
    db.transaction(() => {
      q.setPassAndRecovery.run(passHash, recHash, user.id);
      db.prepare('DELETE FROM sessions WHERE user_id = ?').run(user.id);
    })();
    switchTo(req, reply, user.id);
    return { recoveryCode };
  });

  app.post('/auth/password', {
    config: strictLimit, preHandler: requireAccount,
    schema: { body: { type: 'object', required: ['currentPassword', 'password'], properties: {
      currentPassword: { type: 'string', maxLength: 200 }, password: { type: 'string', maxLength: 200 } } } },
  }, async (req, reply) => {
    const problem = passwordProblem(req.body.password);
    if (problem) return reply.code(400).send({ error: problem });
    if (!(await verifySecret(req.body.currentPassword, req.user.pass_hash))) {
      return reply.code(401).send({ error: 'Current password is wrong.' });
    }
    q.setPass.run(await hashSecret(req.body.password), req.user.id);
    sessions.destroyOthers(req.user.id, req.cookies[COOKIE]);
    return { ok: true };
  });

  app.post('/auth/logout', async (req, reply) => {
    sessions.destroy(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.delete('/me', {
    config: strictLimit, preHandler: requireUser,
    schema: { body: { type: 'object', required: ['confirm'], properties: { confirm: { type: 'string', maxLength: 40 } } } },
  }, async (req, reply) => {
    const expected = req.user.username || 'DELETE';
    if (req.body.confirm.toLowerCase() !== expected.toLowerCase()) {
      return reply.code(400).send({ error: `Type ${expected} to confirm.` });
    }
    const audioIds = q.userAudio.all(req.user.id).map((r) => r.audio_id);
    q.deleteUser.run(req.user.id); // cascades to sessions, logs, posts, reactions, reports, blocks
    await app.audio.remove(audioIds);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });
}
