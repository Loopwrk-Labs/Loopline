import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, date, fail, now, requireRole, str, uid } from '../lib/http';
import { getProject } from './projects';
import { changeEntry } from './logbook';

export const sprints = new Hono<AppEnv>();

type Sprint = { id: string; project_id: string; name: string; goal: string | null; start_date: string | null; end_date: string | null; status: string };

async function loadSprint(db: D1Database, id: string) {
  const s = await db.prepare('SELECT * FROM sprints WHERE id = ?').bind(id).first<Sprint>();
  if (!s) fail(404, 'not_found', 'Sprint not found.');
  return s;
}

sprints.get('/projects/:pid/sprints', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const { results } = await c.env.DB.prepare(
    `SELECT s.*,
       COUNT(i.id) AS item_count,
       SUM(CASE WHEN i.status = 'done' THEN 1 ELSE 0 END) AS done_count,
       COALESCE(SUM(CASE WHEN i.type != 'task' THEN i.points END), 0) AS points,
       COALESCE(SUM(CASE WHEN i.type != 'task' AND i.status = 'done' THEN i.points END), 0) AS done_points
     FROM sprints s LEFT JOIN items i ON i.sprint_id = s.id AND i.archived = 0
     WHERE s.project_id = ? GROUP BY s.id
     ORDER BY CASE s.status WHEN 'active' THEN 0 WHEN 'planned' THEN 1 ELSE 2 END, s.start_date DESC, s.created_at DESC`,
  )
    .bind(pid)
    .all();
  return c.json(results);
});

sprints.post('/projects/:pid/sprints', async (c) => {
  requireRole(c, 'admin', 'manager');
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const name = str(b.name, 80);
  if (!name) fail(400, 'bad_name', 'Enter a sprint name.');
  const start = date(b.start_date);
  const end = date(b.end_date);
  if (start && end && end < start) fail(400, 'bad_dates', 'End date is before start date.');
  const id = uid();
  await c.env.DB.prepare('INSERT INTO sprints (id, project_id, name, goal, start_date, end_date, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, pid, name, str(b.goal, 300), start, end, now())
    .run();
  return c.json({ id });
});

sprints.patch('/sprints/:id', async (c) => {
  requireRole(c, 'admin', 'manager');
  const s = await loadSprint(c.env.DB, c.req.param('id'));
  const b = await body(c);
  const name = b.name !== undefined ? str(b.name, 80) : s.name;
  if (!name) fail(400, 'bad_name', 'Enter a sprint name.');
  const goal = b.goal !== undefined ? str(b.goal, 300) : s.goal;
  const start = b.start_date !== undefined ? date(b.start_date) : s.start_date;
  const end = b.end_date !== undefined ? date(b.end_date) : s.end_date;
  if (start && end && end < start) fail(400, 'bad_dates', 'End date is before start date.');
  await c.env.DB.prepare('UPDATE sprints SET name = ?, goal = ?, start_date = ?, end_date = ? WHERE id = ?').bind(name, goal, start, end, s.id).run();
  return c.json({ ok: true });
});

/** Start: one active sprint per project; current scope estimates become the baseline. */
sprints.post('/sprints/:id/start', async (c) => {
  requireRole(c, 'admin', 'manager');
  const db = c.env.DB;
  const s = await loadSprint(db, c.req.param('id'));
  if (s.status !== 'planned') fail(400, 'bad_state', 'Only a planned sprint can be started.');
  const active = await db.prepare(`SELECT name FROM sprints WHERE project_id = ? AND status = 'active'`).bind(s.project_id).first<{ name: string }>();
  if (active) fail(409, 'active_exists', `Close "${active.name}" before starting a new sprint.`);
  const today = new Date().toISOString().slice(0, 10);
  await db.batch([
    db.prepare(`UPDATE sprints SET status = 'active', start_date = COALESCE(start_date, ?) WHERE id = ?`).bind(today, s.id),
    db.prepare('UPDATE items SET scope_baseline = scope_hours WHERE sprint_id = ? AND scope_baseline IS NULL AND scope_hours IS NOT NULL').bind(s.id),
    changeEntry(db, { projectId: s.project_id, itemId: null, userId: c.get('user').id, field: 'sprint_started', oldValue: null, newValue: s.name }),
  ]);
  return c.json({ ok: true });
});

/** Close: unfinished items move to another open sprint or back to the backlog. */
sprints.post('/sprints/:id/close', async (c) => {
  requireRole(c, 'admin', 'manager');
  const db = c.env.DB;
  const s = await loadSprint(db, c.req.param('id'));
  if (s.status !== 'active') fail(400, 'bad_state', 'Only the active sprint can be closed.');
  const b = await body(c);
  const moveTo = str(b.moveTo, 64);
  let target: Sprint | null = null;
  if (moveTo) {
    target = await loadSprint(db, moveTo);
    if (target.project_id !== s.project_id || target.status === 'closed' || target.id === s.id) fail(400, 'bad_target', 'Choose an open sprint in this project.');
  }
  const open = await db.prepare(`SELECT id FROM items WHERE sprint_id = ? AND status != 'done' AND archived = 0`).bind(s.id).all<{ id: string }>();
  const userId = c.get('user').id;
  const t = now();
  const stmts = [
    db.prepare(`UPDATE sprints SET status = 'closed', end_date = COALESCE(end_date, ?) WHERE id = ?`).bind(new Date().toISOString().slice(0, 10), s.id),
    changeEntry(db, { projectId: s.project_id, itemId: null, userId, field: 'sprint_closed', oldValue: null, newValue: s.name, at: t }),
  ];
  for (const it of open.results) {
    stmts.push(db.prepare('UPDATE items SET sprint_id = ?, updated_at = ? WHERE id = ?').bind(target?.id ?? null, t, it.id));
    stmts.push(changeEntry(db, { projectId: s.project_id, itemId: it.id, userId, field: 'sprint', oldValue: s.name, newValue: target?.name ?? null, at: t }));
  }
  await db.batch(stmts);
  return c.json({ ok: true, moved: open.results.length });
});
