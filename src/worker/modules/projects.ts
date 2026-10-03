import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, date, fail, now, num, requireRole, str, uid } from '../lib/http';

export const projects = new Hono<AppEnv>();

export async function getProject(db: D1Database, id: string) {
  const p = await db.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<{ id: string; key: string; lang: string }>();
  if (!p) fail(404, 'not_found', 'Project not found.');
  return p;
}

projects.get('/projects', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT p.id, p.key, p.name, p.client, p.lang, p.archived, p.created_at, p.description, p.budget_hours, p.start_date, p.end_date, p.rag, p.client_contact,
       (SELECT COUNT(*) FROM items i WHERE i.project_id = p.id AND i.archived = 0 AND i.status != 'done' AND i.type != 'epic') AS open_items
     FROM projects p ORDER BY p.archived, p.name`,
  ).all();
  return c.json(results);
});

projects.post('/projects', async (c) => {
  requireRole(c, 'admin', 'manager');
  const b = await body(c);
  const key = str(b.key, 6)?.toUpperCase();
  const name = str(b.name, 120);
  const lang = (b.lang as string) ?? 'sr';
  if (!key || !/^[A-Z][A-Z0-9]{1,5}$/.test(key)) fail(400, 'bad_key', 'Key must be 2-6 letters or digits, starting with a letter.');
  if (!name) fail(400, 'bad_name', 'Enter a project name.');
  if (!['sr', 'en'].includes(lang)) fail(400, 'bad_lang');
  const exists = await c.env.DB.prepare('SELECT 1 FROM projects WHERE key = ?').bind(key).first();
  if (exists) fail(409, 'key_taken', 'This project key is already used.');
  const id = uid();
  await c.env.DB.prepare('INSERT INTO projects (id, key, name, client, lang, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, key, name, str(b.client, 120), lang, now())
    .run();
  return c.json({ id, key });
});

projects.patch('/projects/:id', async (c) => {
  requireRole(c, 'admin', 'manager');
  const id = c.req.param('id');
  const cur = await c.env.DB.prepare('SELECT * FROM projects WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!cur) fail(404, 'not_found');
  const b = await body(c);
  const name = b.name !== undefined ? str(b.name, 120) : (cur.name as string);
  const client = b.client !== undefined ? str(b.client, 120) : (cur.client as string | null);
  const lang = (b.lang as string) ?? (cur.lang as string);
  const archived = b.archived !== undefined ? (b.archived ? 1 : 0) : (cur.archived as number);
  if (!name) fail(400, 'bad_name', 'Enter a project name.');
  if (!['sr', 'en'].includes(lang)) fail(400, 'bad_lang');
  const pick = <T,>(k: string, parse: (v: unknown) => T) => (b[k] !== undefined ? parse(b[k]) : (cur[k] as T));
  const description = pick('description', (v) => str(v, 5000));
  const budget = pick('budget_hours', num);
  const start = pick('start_date', date);
  const end = pick('end_date', date);
  const rag = pick('rag', (v) => (['green', 'amber', 'red'].includes(v as string) ? (v as string) : fail(400, 'bad_rag')));
  const contact = pick('client_contact', (v) => str(v, 300));
  await c.env.DB.prepare(
    'UPDATE projects SET name = ?, client = ?, lang = ?, archived = ?, description = ?, budget_hours = ?, start_date = ?, end_date = ?, rag = ?, client_contact = ? WHERE id = ?',
  )
    .bind(name, client, lang, archived, description, budget, start, end, rag, contact, id)
    .run();
  return c.json({ ok: true });
});
