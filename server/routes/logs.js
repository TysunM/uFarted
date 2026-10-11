import { isValidType, TRIGGER_IDS } from '../../public/js/catalog.js';
import { ACCEPTED_AUDIO, MAX_UPLOAD_BYTES, AudioError } from '../audio.js';
import { computeStats, DATE_RE, addDays } from '../stats.js';
import { requireUser, userKey } from '../app.js';

const DAY = 86_400_000;
const logBody = {
  type: 'object',
  properties: {
    kind: { enum: ['fart', 'burp'] },
    type: { type: 'string', maxLength: 30 },
    occurredAt: { type: 'integer' },
    tzOffset: { type: 'integer', minimum: -900, maximum: 900 }, // minutes, as from Date#getTimezoneOffset
    smell: { type: ['integer', 'null'], minimum: 0, maximum: 4 }, // type list (not anyOf) so AJV won't coerce null to 0
    discomfort: { type: ['integer', 'null'], minimum: 0, maximum: 3 },
    triggers: { type: 'array', maxItems: 20, items: { type: 'string', maxLength: 20 } },
    note: { type: 'string', maxLength: 280 },
  },
  additionalProperties: false,
};

export function serializeLog(r) {
  return {
    id: r.id, kind: r.kind, type: r.type, occurredAt: r.occurred_at, localDate: r.local_date,
    smell: r.smell, discomfort: r.discomfort, triggers: JSON.parse(r.triggers), note: r.note,
    hasAudio: Boolean(r.audio_id), audioId: r.audio_id, durationMs: r.audio_ms,
    peaks: r.peaks ? JSON.parse(r.peaks) : null, postId: r.post_id ?? null,
  };
}

// Server computes the user's local date/hour from the client's UTC offset so day buckets are correct.
function localParts(occurredAt, tzOffset) {
  const local = new Date(occurredAt - tzOffset * 60_000);
  return { date: local.toISOString().slice(0, 10), hour: local.getUTCHours() };
}

function todayParam(req, reply) {
  const today = req.query.today;
  const nowUtc = new Date().toISOString().slice(0, 10);
  if (!DATE_RE.test(today || '') || today < addDays(nowUtc, -1) || today > addDays(nowUtc, 1)) {
    reply.code(400).send({ error: 'Invalid date.' });
    return null;
  }
  return today;
}

export default async function logRoutes(app) {
  const { db, cfg, audio } = app;
  const q = {
    insert: db.prepare(`INSERT INTO logs (user_id, kind, type, occurred_at, local_date, local_hour, smell, discomfort, triggers, note, created_at)
                        VALUES (@userId, @kind, @type, @occurredAt, @date, @hour, @smell, @discomfort, @triggers, @note, @now)`),
    get: db.prepare(`SELECT l.*, p.id AS post_id FROM logs l LEFT JOIN posts p ON p.log_id = l.id WHERE l.id = ? AND l.user_id = ?`),
    byDate: db.prepare(`SELECT l.*, p.id AS post_id FROM logs l LEFT JOIN posts p ON p.log_id = l.id
                        WHERE l.user_id = ? AND l.local_date = ? ORDER BY l.occurred_at DESC LIMIT 500`),
    update: db.prepare(`UPDATE logs SET kind=@kind, type=@type, occurred_at=@occurredAt, local_date=@date, local_hour=@hour,
                        smell=@smell, discomfort=@discomfort, triggers=@triggers, note=@note WHERE id=@id AND user_id=@userId`),
    setAudio: db.prepare('UPDATE logs SET audio_id = ?, audio_ms = ?, peaks = ? WHERE id = ? AND user_id = ?'),
    remove: db.prepare('DELETE FROM logs WHERE id = ? AND user_id = ?'),
    rangeRows: db.prepare(`SELECT kind, type, local_date, local_hour, smell, discomfort, triggers FROM logs
                           WHERE user_id = ? AND local_date BETWEEN ? AND ?`),
    dayTotals: db.prepare(`SELECT local_date, SUM(kind='fart') AS fart, SUM(kind='burp') AS burp FROM logs
                           WHERE user_id = ? AND local_date <= ? GROUP BY local_date`),
    totals: db.prepare(`SELECT COALESCE(SUM(kind='fart'),0) AS fart, COALESCE(SUM(kind='burp'),0) AS burp,
                        MIN(local_date) AS firstDate, COUNT(audio_id) AS recorded,
                        COALESCE(SUM(local_hour < 4), 0) AS nightOwl FROM logs WHERE user_id = ?`),
    symphony: db.prepare(`SELECT 1 FROM logs WHERE user_id = ? GROUP BY local_date
                          HAVING COUNT(DISTINCT kind || type) >= 5 LIMIT 1`),
    bothEnds: db.prepare(`SELECT 1 FROM logs WHERE user_id = ? GROUP BY local_date
                          HAVING COUNT(DISTINCT kind) = 2 LIMIT 1`),
    exportAll: db.prepare('SELECT * FROM logs WHERE user_id = ? ORDER BY occurred_at'),
  };

  function normalize(body, existing) {
    const merged = {
      kind: body.kind ?? existing?.kind,
      type: body.type ?? existing?.type ?? 'classic',
      occurredAt: body.occurredAt ?? existing?.occurred_at ?? Date.now(),
      smell: body.smell !== undefined ? body.smell : existing?.smell ?? null,
      discomfort: body.discomfort !== undefined ? body.discomfort : existing?.discomfort ?? null,
      triggers: body.triggers ?? (existing ? JSON.parse(existing.triggers) : []),
      note: (body.note ?? existing?.note ?? '').trim(),
    };
    if (!merged.kind) return { error: 'Pick fart or burp.' };
    if (!isValidType(merged.kind, merged.type)) return { error: 'Unknown type.' };
    const now = Date.now();
    if (body.occurredAt !== undefined && (merged.occurredAt > now + 5 * 60_000 || merged.occurredAt < now - 30 * DAY)) {
      return { error: 'Time must be within the last 30 days.' };
    }
    const tz = body.tzOffset ?? 0;
    const { date, hour } = body.occurredAt !== undefined || !existing
      ? localParts(merged.occurredAt, tz) : { date: existing.local_date, hour: existing.local_hour };
    const triggers = [...new Set(merged.triggers)].filter((t) => TRIGGER_IDS.has(t));
    return { ...merged, date, hour, triggers: JSON.stringify(triggers) };
  }

  const writeLimit = { rateLimit: { max: 120, timeWindow: '1 hour', keyGenerator: userKey } };

  app.post('/logs', { preHandler: requireUser, config: writeLimit, schema: { body: { ...logBody, required: ['kind'] } } },
    async (req, reply) => {
      const v = normalize(req.body);
      if (v.error) return reply.code(400).send({ error: v.error });
      const id = Number(q.insert.run({ ...v, userId: req.user.id, now: Date.now() }).lastInsertRowid);
      return reply.code(201).send(serializeLog(q.get.get(id, req.user.id)));
    });

  app.patch('/logs/:id', { preHandler: requireUser, config: writeLimit, schema: { body: logBody } }, async (req, reply) => {
    const existing = q.get.get(Number(req.params.id), req.user.id);
    if (!existing) return reply.code(404).send({ error: 'Log not found.' });
    const v = normalize(req.body, existing);
    if (v.error) return reply.code(400).send({ error: v.error });
    q.update.run({ ...v, id: existing.id, userId: req.user.id });
    if (existing.post_id && (v.kind !== existing.kind || v.type !== existing.type)) {
      db.prepare('UPDATE posts SET kind = ?, type = ? WHERE id = ?').run(v.kind, v.type, existing.post_id);
    }
    return serializeLog(q.get.get(existing.id, req.user.id));
  });

  app.delete('/logs/:id', { preHandler: requireUser }, async (req, reply) => {
    const existing = q.get.get(Number(req.params.id), req.user.id);
    if (!existing) return reply.code(404).send({ error: 'Log not found.' });
    q.remove.run(existing.id, req.user.id);
    await audio.remove([existing.audio_id]);
    return { ok: true };
  });

  app.get('/logs', { preHandler: requireUser }, async (req, reply) => {
    if (!DATE_RE.test(req.query.date || '')) return reply.code(400).send({ error: 'Invalid date.' });
    return { logs: q.byDate.all(req.user.id, req.query.date).map(serializeLog) };
  });

  // Raw audio upload for an existing log. Body is the recording itself (no multipart needed).
  app.register(async (scoped) => {
    scoped.addContentTypeParser(ACCEPTED_AUDIO, { parseAs: 'buffer', bodyLimit: MAX_UPLOAD_BYTES }, (_req, body, done) => done(null, body));
    scoped.put('/logs/:id/audio', {
      preHandler: requireUser,
      bodyLimit: MAX_UPLOAD_BYTES,
      config: { rateLimit: { max: 30, timeWindow: '1 hour', keyGenerator: userKey } },
    }, async (req, reply) => {
      if (!Buffer.isBuffer(req.body) || req.body.length < 100) return reply.code(415).send({ error: 'Send an audio recording.' });
      const existing = q.get.get(Number(req.params.id), req.user.id);
      if (!existing) return reply.code(404).send({ error: 'Log not found.' });
      if (existing.post_id) return reply.code(409).send({ error: 'Unshare this clip before replacing it.' });
      let clip;
      try {
        clip = await audio.process(req.body);
      } catch (err) {
        if (err instanceof AudioError) return reply.code(422).send({ error: err.message });
        throw err;
      }
      const changed = q.setAudio.run(clip.id, clip.durationMs, JSON.stringify(clip.peaks), existing.id, req.user.id).changes;
      if (!changed) { await audio.remove([clip.id]); return reply.code(404).send({ error: 'Log not found.' }); }
      await audio.remove([existing.audio_id]);
      return serializeLog(q.get.get(existing.id, req.user.id));
    });
  });

  app.delete('/logs/:id/audio', { preHandler: requireUser }, async (req, reply) => {
    const existing = q.get.get(Number(req.params.id), req.user.id);
    if (!existing) return reply.code(404).send({ error: 'Log not found.' });
    if (existing.post_id) db.prepare('DELETE FROM posts WHERE id = ?').run(existing.post_id);
    q.setAudio.run(null, null, null, existing.id, req.user.id);
    await audio.remove([existing.audio_id]);
    return serializeLog(q.get.get(existing.id, req.user.id));
  });

  app.get('/stats', { preHandler: requireUser }, async (req, reply) => {
    const today = todayParam(req, reply);
    if (!today) return reply;
    const premium = req.user.isPremium;
    const requested = Math.min(Math.max(Number.parseInt(req.query.days, 10) || 7, 1), 365);
    const days = premium ? requested : Math.min(requested, cfg.freeHistoryDays);
    const lookback = Math.max(days, 7);
    const t = q.totals.get(req.user.id);
    const stats = computeStats({
      today, days, premium,
      rows: q.rangeRows.all(req.user.id, addDays(today, -(lookback - 1)), today),
      dayTotals: q.dayTotals.all(req.user.id, today),
      totals: { ...t, symphony: Boolean(q.symphony.get(req.user.id)), bothEnds: Boolean(q.bothEnds.get(req.user.id)) },
    });
    return { ...stats, limited: days < requested };
  });

  app.get('/export.csv', { preHandler: requireUser, config: { rateLimit: { max: 10, timeWindow: '1 hour', keyGenerator: userKey } } },
    async (req, reply) => {
      const cell = (v) => {
        let s = v == null ? '' : String(v);
        if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // neutralise spreadsheet formula injection
        return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const header = ['id', 'kind', 'type', 'occurred_at_utc', 'local_date', 'local_hour', 'smell_0_4', 'discomfort_0_3', 'triggers', 'note', 'has_recording'];
      const lines = q.exportAll.all(req.user.id).map((r) => [r.id, r.kind, r.type, new Date(r.occurred_at).toISOString(),
        r.local_date, r.local_hour, r.smell, r.discomfort, JSON.parse(r.triggers).join('|'), r.note, r.audio_id ? 'yes' : 'no'].map(cell).join(','));
      reply.header('Content-Type', 'text/csv; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${cfg.appName.toLowerCase()}-export.csv"`);
      return [header.join(','), ...lines].join('\r\n') + '\r\n';
    });
}
