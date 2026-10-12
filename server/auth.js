import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const DAY = 86_400_000;
export const SESSION_DAYS = 180;
export const COOKIE = 'ifart_sid';

export async function hashSecret(secret) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(secret, salt, 32, SCRYPT);
  return `s1$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifySecret(secret, stored) {
  // Always run scrypt so response time doesn't reveal whether the account exists.
  const [, saltB64, keyB64] = (stored || 's1$AAAAAAAAAAAAAAAAAAAAAA==$').split('$');
  const key = await scrypt(secret, Buffer.from(saltB64, 'base64'), 32, SCRYPT);
  const expected = Buffer.from(keyB64 || '', 'base64');
  return Boolean(stored) && expected.length === key.length && crypto.timingSafeEqual(key, expected);
}

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// 20 chars of Crockford-ish base32, grouped for readability: ABCD-EFGH-JKMN-PQRS-TVWX
export function newRecoveryCode() {
  const alphabet = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
  const bytes = crypto.randomBytes(20);
  const chars = [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
  return chars.match(/.{5}/g).join('-');
}
export const normalizeRecovery = (code) => String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const profanity = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const RESERVED = new Set(['admin', 'administrator', 'root', 'support', 'moderator', 'mod', 'staff', 'system',
  'ifart', 'official', 'null', 'undefined', 'anonymous', 'guest', 'help', 'api']);

export function usernameProblem(username) {
  if (typeof username !== 'string' || !/^[A-Za-z0-9_]{3,20}$/.test(username)) {
    return 'Usernames are 3–20 letters, numbers or underscores.';
  }
  if (RESERVED.has(username.toLowerCase()) || profanity.hasMatch(username.replace(/_/g, ' '))) {
    return 'That username isn’t available.';
  }
  return null;
}
export const passwordProblem = (pw) =>
  typeof pw !== 'string' || pw.length < 8 || pw.length > 128 ? 'Passwords need 8–128 characters.' : null;

export function createSessionStore(db) {
  const q = {
    insert: db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'),
    lookup: db.prepare(`SELECT s.token_hash, s.expires_at, u.* FROM sessions s JOIN users u ON u.id = s.user_id
                        WHERE s.token_hash = ? AND s.expires_at > ?`),
    touch: db.prepare('UPDATE sessions SET expires_at = ? WHERE token_hash = ?'),
    seen: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeOthers: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?'),
  };
  return {
    create(userId) {
      const token = crypto.randomBytes(32).toString('base64url');
      const now = Date.now();
      q.insert.run(sha256(token), userId, now, now + SESSION_DAYS * DAY);
      return token;
    },
    resolve(token) {
      if (!token || token.length > 100) return null;
      const now = Date.now();
      const row = q.lookup.get(sha256(token), now);
      if (!row) return null;
      // Sliding expiry, written at most once a day per session.
      if (row.expires_at - now < (SESSION_DAYS - 1) * DAY) {
        q.touch.run(now + SESSION_DAYS * DAY, row.token_hash);
        q.seen.run(now, row.id);
        row.refreshed = true; // caller must re-send the cookie, or the browser still expires it on the old date
      }
      return row;
    },
    destroy: (token) => token && q.remove.run(sha256(token)),
    destroyOthers: (userId, token) => q.removeOthers.run(userId, sha256(token)),
  };
}

export function cookieOptions(cfg) {
  return { path: '/', httpOnly: true, sameSite: 'lax', secure: cfg.production, maxAge: SESSION_DAYS * 86400 };
}
