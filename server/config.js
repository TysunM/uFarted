import path from 'node:path';

const env = process.env;
const int = (v, d) => (Number.isFinite(Number.parseInt(v, 10)) ? Number.parseInt(v, 10) : d);

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? './data');
  const cfg = {
    appName: env.APP_NAME || 'uFart',
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    port: int(env.PORT, 3000),
    host: env.HOST || '0.0.0.0',
    production: env.NODE_ENV === 'production',
    trustProxy: env.TRUST_PROXY ?? 'loopback,uniquelocal',
    dataDir,
    dbFile: path.join(dataDir, 'ufart.db'),
    audioDir: path.join(dataDir, 'audio'),
    backupDir: path.join(dataDir, 'backups'),
    backupKeep: int(env.BACKUP_KEEP, 7),
    supportEmail: env.SUPPORT_EMAIL || '',
    reportHideThreshold: int(env.REPORT_HIDE_THRESHOLD, 3),
    modWebhookUrl: env.MOD_WEBHOOK_URL || '',
    maxClipSeconds: int(env.MAX_CLIP_SECONDS, 15),
    ffmpegConcurrency: int(env.FFMPEG_CONCURRENCY, 2),
    ...overrides,
  };
  if (cfg.production && !/^https:\/\//.test(cfg.publicUrl)) {
    throw new Error('PUBLIC_URL must be set to your https:// address in production (used for CSRF checks and share links).');
  }
  return cfg;
}
