// Moderation & ops CLI. Usage: node server/admin.js <command> [arg]
//   reports              list reported / auto-hidden posts
//   hide <postId>        hide a post          restore <postId>   un-hide a post (clears reports)
//   ban <username>       suspend community access (hides all their posts)   unban <username>
//   premium <username>   grant lifetime premium (comps)
//   admin <username>     give in-app moderator powers   unadmin <username>
//   backup               write a database backup now
//   stats                quick usage numbers
import { loadConfig } from './config.js';
import { openDb } from './db.js';

const [cmd, arg] = process.argv.slice(2);
const cfg = loadConfig();
const db = openDb(cfg);
const user = (name) => db.prepare('SELECT id, username FROM users WHERE username = ?').get(name) || die(`No user ${name}`);
function die(msg) { console.error(msg); process.exit(1); }

const commands = {
  reports: () => console.table(db.prepare(`SELECT p.id AS post, u.username, p.kind, p.type, p.report_count AS reports, p.hidden,
      (SELECT group_concat(reason) FROM reports r WHERE r.post_id = p.id) AS reasons, datetime(p.created_at/1000,'unixepoch') AS posted
      FROM posts p JOIN users u ON u.id = p.user_id WHERE p.report_count > 0 OR p.hidden = 1 ORDER BY p.hidden DESC, p.report_count DESC LIMIT 100`).all()),
  hide: () => console.log(db.prepare('UPDATE posts SET hidden = 1 WHERE id = ?').run(Number(arg)).changes ? `Hidden #${arg}` : 'No such post'),
  restore: () => {
    db.prepare('DELETE FROM reports WHERE post_id = ?').run(Number(arg));
    console.log(db.prepare('UPDATE posts SET hidden = 0, report_count = 0 WHERE id = ?').run(Number(arg)).changes ? `Restored #${arg}` : 'No such post');
  },
  ban: () => { db.prepare('UPDATE users SET banned = 1 WHERE id = ?').run(user(arg).id); console.log(`Banned ${arg}`); },
  unban: () => { db.prepare('UPDATE users SET banned = 0 WHERE id = ?').run(user(arg).id); console.log(`Unbanned ${arg}`); },
  admin: () => { db.prepare('UPDATE users SET is_admin = 1 WHERE id = ?').run(user(arg).id); console.log(`${arg} is now an admin`); },
  unadmin: () => { db.prepare('UPDATE users SET is_admin = 0 WHERE id = ?').run(user(arg).id); console.log(`${arg} is no longer an admin`); },
  premium: () => { db.prepare('UPDATE users SET premium_until = 253402300799000 WHERE id = ?').run(user(arg).id); console.log(`Premium granted to ${arg}`); },
  backup: async () => {
    const file = `${cfg.backupDir}/manual-${Date.now()}.db`;
    await import('node:fs').then((fs) => fs.mkdirSync(cfg.backupDir, { recursive: true }));
    await db.backup(file);
    console.log(`Backup written: ${file}`);
  },
  stats: () => console.table(db.prepare(`SELECT
      (SELECT COUNT(*) FROM users) AS users, (SELECT COUNT(*) FROM users WHERE username IS NOT NULL) AS claimed,
      (SELECT COUNT(*) FROM users WHERE premium_until > strftime('%s','now')*1000) AS premium,
      (SELECT COUNT(*) FROM logs) AS logs, (SELECT COUNT(*) FROM logs WHERE created_at > strftime('%s','now')*1000 - 86400000) AS logs_24h,
      (SELECT COUNT(DISTINCT user_id) FROM logs WHERE created_at > strftime('%s','now')*1000 - 86400000) AS dau,
      (SELECT COUNT(*) FROM posts) AS posts`).all()),
};

if (!commands[cmd] || (['hide', 'restore', 'ban', 'unban', 'premium', 'admin', 'unadmin'].includes(cmd) && !arg)) {
  console.log('Commands: reports | hide <postId> | restore <postId> | ban <user> | unban <user> | premium <user> | admin <user> | unadmin <user> | backup | stats');
  process.exit(cmd ? 1 : 0);
}
await commands[cmd]();
db.close();
