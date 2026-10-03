import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, fail, isManager, now, str, uid } from '../lib/http';

/** Saved Grid views: a named set of filters/grouping, private or shared with the team. */
export const views = new Hono<AppEnv>();

views.get('/projects/:pid/views', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT v.id, v.name, v.config, v.shared, v.user_id, u.name AS user_name FROM saved_views v JOIN users u ON u.id = v.user_id
     WHERE v.project_id = ? AND (v.shared = 1 OR v.user_id = ?) ORDER BY v.name`,
  )
    .bind(c.req.param('pid'), c.get('user').id)
    .all();
  return c.json(results.map((r) => ({ ...r, config: JSON.parse(String(r.config)) })));
});

views.post('/projects/:pid/views', async (c) => {
  const b = await body(c);
  const name = str(b.name, 80);
  if (!name) fail(400, 'bad_name', 'Enter a name for the view.');
  const config = JSON.stringify(b.config ?? {});
  if (config.length > 4000) fail(400, 'too_big');
  const id = uid();
  await c.env.DB.prepare('INSERT INTO saved_views (id, project_id, user_id, name, config, shared, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, c.req.param('pid'), c.get('user').id, name, config, b.shared ? 1 : 0, now())
    .run();
  return c.json({ id });
});

views.delete('/views/:id', async (c) => {
  const v = await c.env.DB.prepare('SELECT user_id FROM saved_views WHERE id = ?').bind(c.req.param('id')).first<{ user_id: string }>();
  if (!v) fail(404, 'not_found');
  if (v.user_id !== c.get('user').id && !isManager(c)) fail(403, 'forbidden');
  await c.env.DB.prepare('DELETE FROM saved_views WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});
