import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, fail, now, str, uid } from '../lib/http';

export const logbook = new Hono<AppEnv>();

/** Build a statement that records an automatic change entry. */
export function changeEntry(
  db: D1Database,
  e: { projectId: string; itemId: string | null; userId: string; field: string; oldValue: unknown; newValue: unknown; at?: number },
) {
  const v = (x: unknown) => (x === null || x === undefined || x === '' ? null : String(x));
  return db
    .prepare(
      `INSERT INTO logbook (id, project_id, item_id, user_id, kind, field, old_value, new_value, created_at)
       VALUES (?, ?, ?, ?, 'change', ?, ?, ?, ?)`,
    )
    .bind(uid(), e.projectId, e.itemId, e.userId, e.field, v(e.oldValue), v(e.newValue), e.at ?? now());
}

const SELECT = `SELECT l.id, l.item_id, l.kind, l.field, l.old_value, l.new_value, l.body, l.pinned, l.created_at,
  l.user_id, u.name AS user_name, u.initials AS user_initials, i.key AS item_key, i.title AS item_title
  FROM logbook l LEFT JOIN users u ON u.id = l.user_id LEFT JOIN items i ON i.id = l.item_id`;

logbook.get('/items/:id/logbook', async (c) => {
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE l.item_id = ? ORDER BY l.created_at ASC`).bind(c.req.param('id')).all();
  return c.json(results);
});

logbook.get('/projects/:pid/logbook', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100) || 100, 300);
  const before = Number(c.req.query('before') ?? 0) || Number.MAX_SAFE_INTEGER;
  const { results } = await c.env.DB.prepare(`${SELECT} WHERE l.project_id = ? AND l.created_at < ? ORDER BY l.created_at DESC LIMIT ?`)
    .bind(c.req.param('pid'), before, limit)
    .all();
  return c.json(results);
});

logbook.post('/items/:id/logbook', async (c) => {
  const item = await c.env.DB.prepare('SELECT id, project_id FROM items WHERE id = ?').bind(c.req.param('id')).first<{ id: string; project_id: string }>();
  if (!item) fail(404, 'not_found');
  const b = await body(c);
  const text = str(b.body, 5000);
  if (!text) fail(400, 'empty', 'Write something first.');
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO logbook (id, project_id, item_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, 'note', ?, ?)`,
  )
    .bind(id, item.project_id, item.id, c.get('user').id, text, now())
    .run();
  return c.json({ id });
});

/** Entries are append-only: the only allowed change is pinning. */
logbook.patch('/logbook/:id', async (c) => {
  const b = await body(c);
  const r = await c.env.DB.prepare(`UPDATE logbook SET pinned = ? WHERE id = ? AND kind = 'note'`)
    .bind(b.pinned ? 1 : 0, c.req.param('id'))
    .run();
  if (!r.meta.changes) fail(404, 'not_found');
  return c.json({ ok: true });
});
