import path from 'node:path';

const env = process.env;
const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);
const int = (v, d) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : d);

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? './data');
  const cfg = {
    appName: env.APP_NAME || 'TootTally',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY ?? 'loopback,uniquelocal',
    dataDir,
    dbFile: path.join(dataDir, 'toottally.db'),
    audioDir: path.join(dataDir, 'audio'),
    backupDir: path.join(dataDir, 'backups'),
    backupKeep: int(env.BACKUP_KEEP, 7),
    supportEmail: env.SUPPORT_EMAIL || '',
    adminUsernames: list(env.ADMIN_USERNAMES).map((u) => u.toLowerCase()),
    reportHideThreshold: int(env.REPORT_HIDE_THRESHOLD, 3),
    modWebhookUrl: env.MOD_WEBHOOK_URL || '',
    maxClipSeconds: int(env.MAX_CLIP_SECONDS, 15),
    ffmpegConcurrency: int(env.FFMPEG_CONCURRENCY, 2),
    freeHistoryDays: 30,
    stripe: {
      secretKey: env.STRIPE_SECRET_KEY || '',
      webhookSecret: env.STRIPE_WEBHOOK_SECRET || '',
      priceId: env.STRIPE_PRICE_ID || '',
      mode: env.STRIPE_MODE === 'subscription' ? 'subscription' : 'payment',
      priceLabel: env.PREMIUM_PRICE_LABEL || '$4.99 one-time',
    },
    ...overrides,
  };
  cfg.billingEnabled = Boolean(cfg.stripe.secretKey && cfg.stripe.priceId && cfg.stripe.webhookSecret);
  if (cfg.production && !/^https:\/\//.test(cfg.publicUrl)) {
    throw new Error('PUBLIC_URL must be set to your https:// address in production (used for CSRF checks and payment redirects).');
  }
  const stripeParts = [cfg.stripe.secretKey, cfg.stripe.priceId, cfg.stripe.webhookSecret].filter(Boolean).length;
  if (stripeParts > 0 && stripeParts < 3) {
    throw new Error('Set all of STRIPE_SECRET_KEY, STRIPE_PRICE_ID and STRIPE_WEBHOOK_SECRET, or none of them.');
  }
  return cfg;
}
