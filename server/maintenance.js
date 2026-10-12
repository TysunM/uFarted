import fs from 'node:fs/promises';
import path from 'node:path';

const DAY = 86_400_000;

// Daily: online SQLite backup (rotated), purge expired sessions and abandoned guest accounts.
export async function runMaintenance(app) {
  const { db, cfg, audio, log } = app;
  await fs.mkdir(cfg.backupDir, { recursive: true });
  const file = path.join(cfg.backupDir, `ufarted-${new Date().toISOString().slice(0, 10)}.db`);
  await db.backup(file);
  const backups = (await fs.readdir(cfg.backupDir)).filter((f) => /^ufarted-\d{4}-\d{2}-\d{2}\.db$/.test(f)).sort();
  await Promise.all(backups.slice(0, -cfg.backupKeep).map((f) => fs.rm(path.join(cfg.backupDir, f), { force: true })));

  const now = Date.now();
  const expired = db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now).changes;
  // Guests can't log back in once their session is gone, so their data is unreachable: delete it.
  const orphanFilter = `username IS NULL AND last_seen_at < @cutoff AND NOT EXISTS (SELECT 1 FROM sessions s WHERE s.user_id = users.id)`;
  const cutoff = now - 7 * DAY;
  const orphanAudio = db.prepare(`SELECT audio_id FROM logs WHERE audio_id IS NOT NULL AND user_id IN (SELECT id FROM users WHERE ${orphanFilter})`)
    .all({ cutoff }).map((r) => r.audio_id);
  const guests = db.prepare(`DELETE FROM users WHERE ${orphanFilter}`).run({ cutoff }).changes;
  await audio.remove(orphanAudio);
  db.pragma('optimize');
  log.info({ backup: file, expiredSessions: expired, guestsRemoved: guests }, 'maintenance complete');
  return { file, expired, guests };
}
