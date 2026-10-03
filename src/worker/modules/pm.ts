import { Hono } from 'hono';
import type { AppEnv, Env } from '../lib/types';
import { body, date, fail, isManager, now, num, requireRole, str, uid } from '../lib/http';
import { randomHex, sha256 } from '../lib/crypto';
import { getProject } from './projects';

/**
 * Project management: client correspondence, customer acceptance and change
 * requests (one approval mechanism), and the decision log.
 */
export const pm = new Hono<AppEnv>();
export const publicPm = new Hono<AppEnv>();

// ---------------- correspondence ----------------

pm.get('/projects/:pid/correspondence', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT c.*, i.key AS item_key, u.name AS created_by_name FROM correspondence c
     LEFT JOIN items i ON i.id = c.item_id LEFT JOIN users u ON u.id = c.created_by
     WHERE c.project_id = ? ORDER BY c.sent_at DESC LIMIT 500`,
  )
    .bind(c.req.param('pid'))
    .all();
  return c.json(results);
});

pm.post('/projects/:pid/correspondence', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const subject = str(b.subject, 300);
  const text = str(b.body, 100000);
  if (!subject && !text) fail(400, 'empty', 'Add a subject or the message text.');
  const sentOn = date(b.sent_on);
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO correspondence (id, project_id, item_id, source, direction, from_addr, to_addr, subject, body, sent_at, created_by, created_at)
     VALUES (?, ?, ?, 'manual', ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      id, pid, str(b.item_id, 64), b.direction === 'out' ? 'out' : 'in', str(b.from_addr, 300), str(b.to_addr, 500), subject, text ?? '',
      sentOn ? Date.parse(sentOn + 'T12:00:00Z') : now(), c.get('user').id, now(),
    )
    .run();
  return c.json({ id });
});

pm.patch('/correspondence/:id', async (c) => {
  const b = await body(c);
  const r = await c.env.DB.prepare('UPDATE correspondence SET item_id = ? WHERE id = ?').bind(str(b.item_id, 64), c.req.param('id')).run();
  if (!r.meta.changes) fail(404, 'not_found');
  return c.json({ ok: true });
});

/** Inbound email (Cloudflare Email Routing → this Worker). Address: <projectkey>@<domain>. */
export async function receiveEmail(message: ForwardableEmailMessage, env: Env) {
  const local = message.to.split('@')[0].toLowerCase().replace(/\+.*$/, '');
  const project = await env.DB.prepare('SELECT id FROM projects WHERE lower(key) = ? AND archived = 0').bind(local).first<{ id: string }>();
  if (!project) {
    message.setReject('Unknown Loopline project address');
    return;
  }
  const { default: PostalMime } = await import('postal-mime');
  const raw = await new Response(message.raw).arrayBuffer();
  const mail = await PostalMime.parse(raw);
  const addr = (a?: { name?: string; address?: string }) => (a ? (a.name ? `${a.name} <${a.address}>` : a.address ?? '') : '');
  const list = (xs?: { name?: string; address?: string }[]) => (xs ?? []).map(addr).join(', ');
  const text = (mail.text ?? (mail.html ?? '').replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+\n/g, '\n')).slice(0, 100000);
  const attachments = (mail.attachments ?? []).map((a) => ({ name: a.filename ?? 'attachment', type: a.mimeType, size: (a.content as ArrayBuffer)?.byteLength ?? 0 }));
  const sent = mail.date ? Date.parse(mail.date) : Date.now();
  await env.DB.prepare(
    `INSERT OR IGNORE INTO correspondence (id, project_id, source, direction, from_addr, to_addr, cc_addr, subject, body, attachments, message_id, sent_at, created_at)
     VALUES (?, ?, 'email', 'in', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      uid(), project.id, addr(mail.from), list(mail.to), list(mail.cc), (mail.subject ?? '').slice(0, 300), text, JSON.stringify(attachments).slice(0, 4000),
      mail.messageId ?? null, Number.isFinite(sent) ? sent : Date.now(), Date.now(),
    )
    .run();
}

// ---------------- approvals (acceptance + change requests) ----------------

const APPROVAL_COLS = `a.id, a.project_id, a.kind, a.key, a.item_id, a.title, a.body, a.impact_hours, a.impact_cost, a.impact_days, a.currency,
  a.status, a.sent_at, a.content_sha256, a.client_name, a.client_email, a.decided_at, a.decided_ip, a.decided_ua, a.decision_note,
  a.created_by, a.created_at, a.updated_at`;

async function contentHash(a: Record<string, unknown>) {
  return sha256(JSON.stringify([a.kind, a.key, a.title, a.body, a.impact_hours, a.impact_cost, a.impact_days, a.currency]));
}

pm.get('/projects/:pid/approvals', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT ${APPROVAL_COLS}, i.key AS item_key, u.name AS created_by_name FROM approvals a
     LEFT JOIN items i ON i.id = a.item_id LEFT JOIN users u ON u.id = a.created_by WHERE a.project_id = ? ORDER BY a.created_at DESC`,
  )
    .bind(c.req.param('pid'))
    .all();
  return c.json(results);
});

pm.post('/projects/:pid/approvals', async (c) => {
  requireRole(c, 'admin', 'manager');
  const db = c.env.DB;
  const pid = c.req.param('pid');
  const project = await getProject(db, pid);
  const b = await body(c);
  const kind = b.kind === 'change_request' ? 'change_request' : 'acceptance';
  const title = str(b.title, 200);
  if (!title) fail(400, 'bad_title', 'Enter a title.');
  const ctr = await db.prepare('UPDATE projects SET next_cr = next_cr + 1 WHERE id = ? RETURNING next_cr - 1 AS n').bind(pid).first<{ n: number }>();
  const key = `${project.key}-${kind === 'acceptance' ? 'ACC' : 'CR'}${ctr!.n}`;
  const id = uid();
  const t = now();
  await db
    .prepare(
      `INSERT INTO approvals (id, project_id, kind, key, item_id, title, body, impact_hours, impact_cost, impact_days, currency, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, pid, kind, key, str(b.item_id, 64), title, str(b.body, 20000) ?? '', num(b.impact_hours), num(b.impact_cost), num(b.impact_days), str(b.currency, 8), c.get('user').id, t, t)
    .run();
  return c.json({ id, key });
});

pm.patch('/approvals/:id', async (c) => {
  requireRole(c, 'admin', 'manager');
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM approvals WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!a) fail(404, 'not_found');
  if (a.status !== 'draft') fail(400, 'locked', 'Only drafts can be edited. Withdraw it and create a new version.');
  const b = await body(c);
  const pick = <T,>(k: string, parse: (v: unknown) => T) => (b[k] !== undefined ? parse(b[k]) : (a[k] as T));
  const title = pick('title', (v) => str(v, 200));
  if (!title) fail(400, 'bad_title', 'Enter a title.');
  await db
    .prepare('UPDATE approvals SET title=?, body=?, item_id=?, impact_hours=?, impact_cost=?, impact_days=?, currency=?, updated_at=? WHERE id=?')
    .bind(
      title, pick('body', (v) => str(v, 20000) ?? ''), pick('item_id', (v) => str(v, 64)), pick('impact_hours', num), pick('impact_cost', num),
      pick('impact_days', num), pick('currency', (v) => str(v, 8)), now(), a.id,
    )
    .run();
  return c.json({ ok: true });
});

/** Lock the content and create the client link. The raw token is returned once. */
pm.post('/approvals/:id/send', async (c) => {
  requireRole(c, 'admin', 'manager');
  const db = c.env.DB;
  const a = await db.prepare('SELECT * FROM approvals WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!a) fail(404, 'not_found');
  if (!['draft', 'sent'].includes(a.status as string)) fail(400, 'bad_state', 'This item is already decided.');
  const token = randomHex(24);
  await db
    .prepare(`UPDATE approvals SET status = 'sent', token_hash = ?, sent_at = COALESCE(sent_at, ?), content_sha256 = ?, updated_at = ? WHERE id = ?`)
    .bind(await sha256(token), now(), await contentHash(a), now(), a.id)
    .run();
  return c.json({ token });
});

pm.post('/approvals/:id/withdraw', async (c) => {
  requireRole(c, 'admin', 'manager');
  const r = await c.env.DB.prepare(`UPDATE approvals SET status = 'withdrawn', token_hash = NULL, updated_at = ? WHERE id = ? AND status IN ('draft','sent')`)
    .bind(now(), c.req.param('id'))
    .run();
  if (!r.meta.changes) fail(400, 'bad_state', 'Only open items can be withdrawn.');
  return c.json({ ok: true });
});

async function byToken(db: D1Database, token: string) {
  if (!/^[a-f0-9]{48}$/.test(token)) fail(404, 'not_found', 'This link is not valid.');
  const a = await db
    .prepare(`SELECT ${APPROVAL_COLS}, p.name AS project_name, p.client AS project_client, p.lang AS lang FROM approvals a JOIN projects p ON p.id = a.project_id WHERE a.token_hash = ?`)
    .bind(await sha256(token))
    .first<Record<string, unknown>>();
  if (!a) fail(404, 'not_found', 'This link is not valid or was withdrawn.');
  return a;
}

const publicView = (a: Record<string, unknown>) => ({
  kind: a.kind, key: a.key, title: a.title, body: a.body, impact_hours: a.impact_hours, impact_cost: a.impact_cost, impact_days: a.impact_days,
  currency: a.currency, status: a.status, sent_at: a.sent_at, content_sha256: a.content_sha256, client_name: a.client_name, client_email: a.client_email,
  decided_at: a.decided_at, decision_note: a.decision_note, project_name: a.project_name, project_client: a.project_client, lang: a.lang,
});

publicPm.get('/public/approval/:token', async (c) => c.json(publicView(await byToken(c.env.DB, c.req.param('token')))));

publicPm.post('/public/approval/:token/decide', async (c) => {
  const db = c.env.DB;
  const a = await byToken(db, c.req.param('token'));
  if (a.status !== 'sent') fail(409, 'already_decided', 'This was already decided.');
  if ((await contentHash(a)) !== a.content_sha256) fail(409, 'changed', 'The content changed after it was sent. Ask for a new link.');
  const b = await body(c);
  const decision = b.decision === 'accept' ? 'accepted' : b.decision === 'reject' ? 'rejected' : null;
  if (!decision) fail(400, 'bad_decision');
  const name = str(b.name, 120);
  const email = str(b.email, 200);
  if (!name) fail(400, 'bad_name', 'Enter your full name.');
  if (!email || !email.includes('@')) fail(400, 'bad_email', 'Enter your email.');
  if (decision === 'rejected' && !str(b.note, 2000)) fail(400, 'note_required', 'Please say what needs to change.');
  await db
    .prepare(`UPDATE approvals SET status = ?, client_name = ?, client_email = ?, decided_at = ?, decided_ip = ?, decided_ua = ?, decision_note = ?, updated_at = ? WHERE id = ? AND status = 'sent'`)
    .bind(decision, name, email, now(), c.req.header('cf-connecting-ip') ?? null, (c.req.header('user-agent') ?? '').slice(0, 300), str(b.note, 2000), now(), a.id)
    .run();
  return c.json(publicView(await byToken(db, c.req.param('token'))));
});

// ---------------- decision log ----------------

pm.get('/projects/:pid/decisions', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT d.*, u.name AS created_by_name, i.key AS item_key, co.subject AS correspondence_subject FROM decisions d
     LEFT JOIN users u ON u.id = d.created_by LEFT JOIN items i ON i.id = d.item_id LEFT JOIN correspondence co ON co.id = d.correspondence_id
     WHERE d.project_id = ? ORDER BY COALESCE(d.decided_on, '') DESC, d.created_at DESC`,
  )
    .bind(c.req.param('pid'))
    .all();
  return c.json(results);
});

pm.post('/projects/:pid/decisions', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const title = str(b.title, 200);
  const decision = str(b.decision, 5000);
  if (!title || !decision) fail(400, 'empty', 'Enter the topic and what was decided.');
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO decisions (id, project_id, title, decision, decided_by, decided_on, source, correspondence_id, item_id, created_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(id, pid, title, decision, str(b.decided_by, 200), date(b.decided_on), str(b.source, 300), str(b.correspondence_id, 64), str(b.item_id, 64), c.get('user').id, now())
    .run();
  return c.json({ id });
});

pm.patch('/decisions/:id', async (c) => {
  const d = await c.env.DB.prepare('SELECT * FROM decisions WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!d) fail(404, 'not_found');
  if (d.created_by !== c.get('user').id && !isManager(c)) fail(403, 'forbidden');
  const b = await body(c);
  const pick = <T,>(k: string, parse: (v: unknown) => T) => (b[k] !== undefined ? parse(b[k]) : (d[k] as T));
  const title = pick('title', (v) => str(v, 200));
  const decision = pick('decision', (v) => str(v, 5000));
  if (!title || !decision) fail(400, 'empty', 'Enter the topic and what was decided.');
  await c.env.DB.prepare('UPDATE decisions SET title=?, decision=?, decided_by=?, decided_on=?, source=?, item_id=? WHERE id=?')
    .bind(title, decision, pick('decided_by', (v) => str(v, 200)), pick('decided_on', date), pick('source', (v) => str(v, 300)), pick('item_id', (v) => str(v, 64)), d.id)
    .run();
  return c.json({ ok: true });
});

// ---------------- full backup (admin) ----------------

pm.get('/backup', async (c) => {
  requireRole(c, 'admin');
  const db = c.env.DB;
  const tables: Record<string, string> = {
    projects: 'SELECT * FROM projects',
    users: 'SELECT id, email, name, initials, role, active, created_at FROM users',
    sprints: 'SELECT * FROM sprints',
    sprint_capacity: 'SELECT * FROM sprint_capacity',
    items: 'SELECT * FROM items',
    logbook: 'SELECT * FROM logbook',
    correspondence: 'SELECT * FROM correspondence',
    approvals: 'SELECT id, project_id, kind, key, item_id, title, body, impact_hours, impact_cost, impact_days, currency, status, sent_at, content_sha256, client_name, client_email, decided_at, decided_ip, decision_note, created_at FROM approvals',
    decisions: 'SELECT * FROM decisions',
  };
  const out: Record<string, unknown[]> = {};
  const res = await db.batch(Object.values(tables).map((q) => db.prepare(q)));
  Object.keys(tables).forEach((k, i) => (out[k] = res[i].results));
  return c.json({ exported_at: new Date().toISOString(), tables: out });
});
