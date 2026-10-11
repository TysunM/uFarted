import fs from 'node:fs';
import path from 'node:path';
import { typeInfo, KINDS } from '../../public/js/catalog.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export default async function pageRoutes(app, { templateDir }) {
  const { cfg, db } = app;
  const read = (f) => fs.readFileSync(path.join(templateDir, f), 'utf8');
  const fill = (html) => html.replaceAll('{{APP}}', esc(cfg.appName))
    .replaceAll('{{EMAIL}}', esc(cfg.supportEmail || 'the support address listed in the app'))
    .replaceAll('{{UPDATED}}', '11 October 2026');
  // Cache templates in production; re-read in development so edits show up immediately.
  const cache = new Map();
  const page = (f) => {
    if (!cfg.production) return fill(read(f));
    if (!cache.has(f)) cache.set(f, fill(read(f)));
    return cache.get(f);
  };
  const send = (reply, html) => reply.type('text/html; charset=utf-8').header('Cache-Control', 'no-cache').send(html);

  app.get('/', async (_req, reply) => send(reply, page('index.html')));
  app.get('/manifest.webmanifest', async (_req, reply) =>
    reply.type('application/manifest+json').header('Cache-Control', 'no-cache').send(page('manifest.webmanifest')));
  for (const name of ['privacy', 'terms']) {
    app.get(`/${name}`, async (_req, reply) => send(reply, page(`${name}.html`)));
  }
  app.get('/report', async (_req, reply) => send(reply, page('report.html')));

  // Shared post links get real link-preview tags, then boot the normal app straight to that post.
  const findPost = db.prepare(`SELECT p.id, p.kind, p.type, u.username FROM posts p JOIN users u ON u.id = p.user_id
                               WHERE p.id = ? AND p.hidden = 0 AND u.banned = 0`);
  app.get('/p/:id', async (req, reply) => {
    const post = findPost.get(Number(req.params.id) || 0);
    let html = page('index.html');
    if (post) {
      const t = typeInfo(post.kind, post.type);
      const title = `${t.emoji} ${t.name} by @${post.username}`;
      const desc = `Hear this ${KINDS[post.kind].name.toLowerCase()} on ${cfg.appName} — free gut-health tracking with a sense of humor.`;
      const base = cfg.publicUrl || `${req.protocol}://${req.headers.host}`;
      const meta = [
        `<meta property="og:title" content="${esc(title)}">`,
        `<meta property="og:description" content="${esc(desc)}">`,
        `<meta property="og:image" content="${esc(base)}/icons/og.png">`,
        `<meta property="og:url" content="${esc(base)}/p/${post.id}">`,
        '<meta name="twitter:card" content="summary_large_image">',
      ].join('\n    ');
      html = html.replace('<!--og-->', meta).replace(/<title>[^<]*<\/title>/, `<title>${esc(title)} · ${esc(cfg.appName)}</title>`);
    }
    return send(reply, html);
  });
}
