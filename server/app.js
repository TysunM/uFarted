import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { openDb } from './db.js';
import { createSessionStore, COOKIE } from './auth.js';
import { createAudioService } from './audio.js';
import authRoutes from './routes/auth.js';
import logRoutes from './routes/logs.js';
import communityRoutes from './routes/community.js';
import billingRoutes from './routes/billing.js';
import pageRoutes from './routes/pages.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIR = path.join(ROOT, 'public');
const TEMPLATE_DIR = path.join(ROOT, 'templates');

export async function buildApp(cfg, { logger = true } = {}) {
  const app = Fastify({
    logger: logger && { level: cfg.production ? 'info' : 'debug', redact: ['req.headers.cookie', 'req.headers.authorization'] },
    trustProxy: cfg.trustProxy,
    bodyLimit: 64 * 1024,
  });
  const db = openDb(cfg);
  const sessions = createSessionStore(db);
  const audio = createAudioService(cfg);
  app.decorate('cfg', cfg);
  app.decorate('db', db);
  app.decorate('sessions', sessions);
  app.decorate('audio', audio);
  app.decorateRequest('user', null);
  app.addHook('onClose', async () => db.close());

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        mediaSrc: ["'self'", 'blob:'],
        connectSrc: ["'self'"],
        formAction: ["'self'", 'https://checkout.stripe.com', 'https://billing.stripe.com'],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests: cfg.production ? [] : null,
      },
    },
    crossOriginEmbedderPolicy: false,
    strictTransportSecurity: cfg.production ? { maxAge: 31536000, includeSubDomains: true } : false,
  });

  // Resolve the session first so rate limits can key on the user instead of a shared IP.
  app.addHook('onRequest', async (req) => {
    const row = sessions.resolve(req.cookies[COOKIE]);
    if (row) {
      req.user = row;
      req.user.isGuest = !row.username;
      req.user.isAdmin = Boolean(row.username) && cfg.adminUsernames.includes(row.username.toLowerCase());
      req.user.isPremium = !cfg.billingEnabled || (row.premium_until ?? 0) > Date.now();
    }
  });

  // CSRF defence in depth (on top of SameSite=Lax cookies and JSON-only bodies).
  app.addHook('onRequest', async (req, reply) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || req.url.startsWith('/api/billing/webhook')) return;
    if (req.headers['sec-fetch-site'] === 'cross-site') return reply.code(403).send({ error: 'Cross-site request blocked.' });
    const origin = req.headers.origin;
    if (origin && origin !== 'null') {
      const allowed = cfg.publicUrl || `${req.protocol}://${req.headers.host}`;
      if (origin !== allowed) return reply.code(403).send({ error: 'Cross-site request blocked.' });
    }
  });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    keyGenerator: (req) => (req.user ? `u${req.user.id}` : req.ip),
    errorResponseBuilder: (_req, ctx) => ({ statusCode: 429, error: `Slow down! Try again in ${Math.ceil(ctx.ttl / 1000)}s.` }),
  });

  app.setErrorHandler((err, req, reply) => {
    const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
    if (status >= 500) req.log.error(err);
    const message = status === 500 ? 'Something went wrong on our end.'
      : err.validation ? 'Some of that input wasn’t valid.' : err.message;
    reply.code(status).send({ error: message });
  });

  await app.register(fastifyStatic, {
    root: PUBLIC_DIR,
    index: false,
    wildcard: true,
    // Also runs for reply.sendFile, so private audio must never get a public cache header.
    setHeaders: (reply, file) => {
      if (file.startsWith(cfg.audioDir)) reply.header('Cache-Control', 'private, max-age=3600');
      else if (/\.(html|js|css|webmanifest)$/.test(file)) reply.header('Cache-Control', 'no-cache');
      else reply.header('Cache-Control', 'public, max-age=604800');
    },
  });

  app.get('/healthz', { config: { rateLimit: false } }, async () => {
    db.prepare('SELECT 1').get();
    return { ok: true };
  });

  await app.register(authRoutes, { prefix: '/api' });
  await app.register(logRoutes, { prefix: '/api' });
  await app.register(communityRoutes, { prefix: '/api' });
  await app.register(billingRoutes, { prefix: '/api/billing' });
  await app.register(pageRoutes, { templateDir: TEMPLATE_DIR });

  app.setNotFoundHandler((req, reply) => reply.code(404).send({ error: 'Not found.' }));
  return app;
}

// Shared route guards.
export function requireUser(req, reply, done) {
  if (!req.user) return reply.code(401).send({ error: 'Please start a session first.' });
  done();
}
export function requireAccount(req, reply, done) {
  if (!req.user) return reply.code(401).send({ error: 'Please start a session first.' });
  if (req.user.isGuest) return reply.code(403).send({ error: 'Claim a username first.' });
  done();
}
export const userKey = (req) => (req.user ? `u${req.user.id}` : req.ip);
