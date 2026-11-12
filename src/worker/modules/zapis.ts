import { Hono } from 'hono';
import type { Context } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, fail, now, str, uid } from '../lib/http';
import { sha256 } from '../lib/crypto';
import { getProject } from './projects';

/**
 * "Zapis": who said what in a multi-party project. Statements come from documents (brief, contract),
 * Loopthreads messages, meetings and calls; they can be linked (changes / contradicts / confirms).
 * Imported statements are locked: the quote can't be edited, and its SHA-256 proves it.
 * Statements live in records ("zapisi"): one per source document, each shown as its own project tab.
 * A record can also be created empty (e.g. "Sastanci") and filled by hand or from Loopthreads.
 */
export const zapis = new Hono<AppEnv>();

const KINDS = ['requirement', 'promise', 'claim', 'decision', 'question'];
const STATUS = ['open', 'done', 'dropped'];
const SOURCES = ['document', 'message', 'meeting', 'call', 'other'];
const LINKS = ['changes', 'contradicts', 'confirms'];
const ROLES = ['client', 'agency', 'partner', 'us'];
const num = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Math.round(Number(v)));

async function inProject(c: Context<AppEnv>, table: string, id: string | null, pid: string) {
  if (!id) return null;
  const extra = table === 'statement_docs' ? ` AND kind = 'statements'` : '';
  const r = await c.env.DB.prepare(`SELECT id FROM ${table} WHERE id = ? AND project_id = ?${extra}`).bind(id, pid).first();
  return r ? id : null;
}

// ---------- parties (the chain: client → agency → partner → us)

zapis.get('/projects/:pid/parties', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM project_parties WHERE project_id = ? ORDER BY position').bind(c.req.param('pid')).all();
  return c.json(results);
});

/** Replaces the whole chain at once (it's short and edited as a list). */
zapis.put('/projects/:pid/parties', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const list = Array.isArray(b.parties) ? (b.parties as Record<string, unknown>[]).slice(0, 12) : [];
  const existing = new Set(((await c.env.DB.prepare('SELECT id FROM project_parties WHERE project_id = ?').bind(pid).all()).results as { id: string }[]).map((r) => r.id));
  const keep = new Set<string>();
  const stmts: D1PreparedStatement[] = [];
  list.forEach((p, i) => {
    const name = str(p.name, 80);
    if (!name) return;
    const role = ROLES.includes(p.role as string) ? (p.role as string) : 'partner';
    const id = typeof p.id === 'string' && existing.has(p.id) ? p.id : uid();
    keep.add(id);
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO project_parties (id, project_id, name, role, position, people, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, role = excluded.role, position = excluded.position, people = excluded.people`,
      ).bind(id, pid, name, role, i, str(p.people, 500) ?? '', now()),
    );
  });
  for (const id of existing) {
    if (keep.has(id)) continue;
    stmts.push(c.env.DB.prepare('UPDATE statements SET party_id = NULL WHERE party_id = ?').bind(id));
    stmts.push(c.env.DB.prepare('UPDATE statements SET via_party_id = NULL WHERE via_party_id = ?').bind(id));
    stmts.push(c.env.DB.prepare('DELETE FROM project_parties WHERE id = ?').bind(id));
  }
  if (stmts.length) await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});

// ---------- statements

zapis.get('/projects/:pid/statements', async (c) => {
  const pid = c.req.param('pid');
  const [s, l, d] = await c.env.DB.batch([
    c.env.DB.prepare(
      `SELECT s.*, u.name AS created_by_name, cm.subject AS source_msg_subject FROM statements s
       LEFT JOIN users u ON u.id = s.created_by LEFT JOIN correspondence cm ON cm.id = s.source_msg_id
       WHERE s.project_id = ? ORDER BY s.said_at, s.created_at`,
    ).bind(pid),
    c.env.DB.prepare('SELECT id, from_id, to_id, kind FROM statement_links WHERE project_id = ?').bind(pid),
    c.env.DB.prepare(`SELECT d.*, u.name AS created_by_name FROM statement_docs d LEFT JOIN users u ON u.id = d.created_by WHERE d.project_id = ? AND d.kind = 'statements' ORDER BY d.created_at DESC`).bind(pid),
  ]);
  return c.json({ statements: s.results, links: l.results, docs: d.results });
});

function fields(b: Record<string, unknown>) {
  return {
    topic: str(b.topic, 120),
    kind: KINDS.includes(b.kind as string) ? (b.kind as string) : 'claim',
    said_by: str(b.said_by, 120),
    said_at: num(b.said_at) ?? now(),
    quote: str(b.quote, 20000),
    note: str(b.note, 5000),
    status: STATUS.includes(b.status as string) ? (b.status as string) : 'open',
    due_at: num(b.due_at),
    source_type: SOURCES.includes(b.source_type as string) ? (b.source_type as string) : 'other',
    source_label: str(b.source_label, 300),
  };
}

zapis.post('/projects/:pid/statements', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const f = fields(b);
  if (!f.quote) fail(400, 'empty', 'Upiši šta je rečeno.');
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO statements (id, project_id, topic, kind, party_id, via_party_id, said_by, said_at, quote, note, status, due_at, source_type, source_label, source_msg_id, content_sha256, locked, created_by, created_at, doc_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
  )
    .bind(
      id, pid, f.topic, f.kind, await inProject(c, 'project_parties', str(b.party_id, 64), pid), await inProject(c, 'project_parties', str(b.via_party_id, 64), pid),
      f.said_by, f.said_at, f.quote, f.note, f.status, f.due_at, f.source_type, f.source_label,
      await inProject(c, 'correspondence', str(b.source_msg_id, 64), pid), await sha256(f.quote!), c.get('user').id, now(),
      await inProject(c, 'statement_docs', str(b.doc_id, 64), pid),
    )
    .run();
  return c.json({ id });
});

zapis.patch('/statements/:id', async (c) => {
  const id = c.req.param('id');
  const s = await c.env.DB.prepare('SELECT project_id, locked, created_by FROM statements WHERE id = ?').bind(id).first<{ project_id: string; locked: number; created_by: string }>();
  if (!s) fail(404, 'not_found');
  const b = await body(c);
  const sets: string[] = [];
  const vals: unknown[] = [];
  const set = (col: string, v: unknown) => (sets.push(`${col} = ?`), vals.push(v));
  const f = fields(b);
  if ('topic' in b) set('topic', f.topic);
  if ('kind' in b) set('kind', f.kind);
  if ('status' in b) set('status', f.status);
  if ('due_at' in b) set('due_at', f.due_at);
  if ('note' in b) set('note', f.note);
  if ('party_id' in b) set('party_id', await inProject(c, 'project_parties', str(b.party_id, 64), s!.project_id));
  if ('via_party_id' in b) set('via_party_id', await inProject(c, 'project_parties', str(b.via_party_id, 64), s!.project_id));
  if ('doc_id' in b && !s!.locked) set('doc_id', await inProject(c, 'statement_docs', str(b.doc_id, 64), s!.project_id));
  // The record itself (what, who, when, where from) is frozen once locked.
  const recordKeys = ['quote', 'said_by', 'said_at', 'source_type', 'source_label'];
  if (recordKeys.some((k) => k in b)) {
    if (s!.locked) fail(409, 'locked', 'Ova izjava je zaključana (uvezena iz dokumenta). Tekst, autor, datum i izvor se ne menjaju.');
    if ('quote' in b) {
      if (!f.quote) fail(400, 'empty', 'Upiši šta je rečeno.');
      set('quote', f.quote);
      set('content_sha256', await sha256(f.quote!));
    }
    if ('said_by' in b) set('said_by', f.said_by);
    if ('said_at' in b) set('said_at', f.said_at);
    if ('source_type' in b) set('source_type', f.source_type);
    if ('source_label' in b) set('source_label', f.source_label);
  }
  if (!sets.length) return c.json({ ok: true });
  set('updated_at', now());
  await c.env.DB.prepare(`UPDATE statements SET ${sets.join(', ')} WHERE id = ?`).bind(...vals, id).run();
  return c.json({ ok: true });
});

zapis.delete('/statements/:id', async (c) => {
  const id = c.req.param('id');
  const s = await c.env.DB.prepare('SELECT created_by, locked FROM statements WHERE id = ?').bind(id).first<{ created_by: string; locked: number }>();
  if (!s) fail(404, 'not_found');
  const u = c.get('user');
  if (u.role !== 'admin' && (s!.locked || s!.created_by !== u.id)) fail(403, 'forbidden', 'Zaključane izjave briše samo admin; ostale autor ili admin.');
  await c.env.DB.batch([
    c.env.DB.prepare('DELETE FROM statement_links WHERE from_id = ? OR to_id = ?').bind(id, id),
    c.env.DB.prepare('DELETE FROM statements WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});

// ---------- links between statements

zapis.post('/projects/:pid/statement-links', async (c) => {
  const pid = c.req.param('pid');
  const b = await body(c);
  const from = await inProject(c, 'statements', str(b.from_id, 64), pid);
  const to = await inProject(c, 'statements', str(b.to_id, 64), pid);
  if (!from || !to || from === to) fail(400, 'bad_link', 'Izaberi dve različite izjave.');
  const kind = LINKS.includes(b.kind as string) ? (b.kind as string) : 'contradicts';
  await c.env.DB.prepare('INSERT OR IGNORE INTO statement_links (id, project_id, from_id, to_id, kind, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(uid(), pid, from, to, kind, c.get('user').id, now())
    .run();
  return c.json({ ok: true });
});

zapis.delete('/statement-links/:id', async (c) => {
  await c.env.DB.prepare('DELETE FROM statement_links WHERE id = ?').bind(c.req.param('id')).run();
  return c.json({ ok: true });
});

// ---------- records ("zapisi")

zapis.get('/projects/:pid/statement-docs', async (c) => {
  const pid = c.req.param('pid');
  // Every project has exactly one 'thread' record (its correspondence); create it on first use.
  const has = await c.env.DB.prepare(`SELECT 1 FROM statement_docs WHERE project_id = ? AND kind = 'thread'`).bind(pid).first();
  if (!has) {
    await getProject(c.env.DB, pid);
    await c.env.DB.prepare(`INSERT INTO statement_docs (id, project_id, title, count, created_at, kind) VALUES (?, ?, 'Prepiska', 0, 0, 'thread')`).bind(uid(), pid).run();
  }
  const { results } = await c.env.DB.prepare(
    `SELECT d.id, d.kind, d.title, d.file_name, d.created_at,
            CASE WHEN d.kind = 'thread' THEN (SELECT COUNT(*) FROM correspondence m WHERE m.project_id = d.project_id)
                 ELSE (SELECT COUNT(*) FROM statements s WHERE s.doc_id = d.id) END AS count,
            CASE WHEN d.kind = 'thread' THEN (SELECT MAX(m.sent_at) FROM correspondence m WHERE m.project_id = d.project_id)
                 ELSE (SELECT MAX(s.said_at) FROM statements s WHERE s.doc_id = d.id) END AS last_at
     FROM statement_docs d WHERE d.project_id = ? ORDER BY d.kind = 'thread' DESC, d.created_at`,
  )
    .bind(pid)
    .all();
  return c.json(results);
});

/** An empty record (no source document), e.g. "Sastanci" or "Telefonski dogovori". */
zapis.post('/projects/:pid/statement-docs/empty', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const title = str(b.title, 120);
  if (!title) fail(400, 'empty', 'Upiši naziv zapisa.');
  const id = uid();
  await c.env.DB.prepare('INSERT INTO statement_docs (id, project_id, file_name, title, content_sha256, count, created_by, created_at) VALUES (?, ?, NULL, ?, NULL, 0, ?, ?)')
    .bind(id, pid, title, c.get('user').id, now())
    .run();
  return c.json({ id });
});

zapis.patch('/projects/:pid/statement-docs/:id', async (c) => {
  const b = await body(c);
  const title = str(b.title, 120);
  if (!title) fail(400, 'empty', 'Upiši naziv zapisa.');
  const r = await c.env.DB.prepare('UPDATE statement_docs SET title = ? WHERE id = ? AND project_id = ?').bind(title, c.req.param('id'), c.req.param('pid')).run();
  if (!r.meta.changes) fail(404, 'not_found');
  return c.json({ ok: true });
});

// ---------- document import (brief, contract, minutes): one locked statement per item

zapis.post('/projects/:pid/statement-docs', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const b = await body(c);
  const items = Array.isArray(b.items) ? (b.items as Record<string, unknown>[]).slice(0, 2000) : [];
  if (!items.length) fail(400, 'empty', 'Nema stavki za uvoz.');
  const docId = uid();
  const user = c.get('user').id;
  const party = await inProject(c, 'project_parties', str(b.party_id, 64), pid);
  const via = await inProject(c, 'project_parties', str(b.via_party_id, 64), pid);
  const saidAt = num(b.said_at) ?? now();
  const title = str(b.title, 200) ?? str(b.file_name, 200);
  const stmts: D1PreparedStatement[] = [];
  for (const it of items) {
    const quote = str(it.quote, 20000);
    if (!quote) continue;
    const kind = KINDS.includes(it.kind as string) ? (it.kind as string) : 'requirement';
    stmts.push(
      c.env.DB.prepare(
        `INSERT INTO statements (id, project_id, topic, kind, party_id, via_party_id, said_by, said_at, quote, status, due_at, source_type, source_label, doc_id, content_sha256, locked, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, 'document', ?, ?, ?, 1, ?, ?)`,
      ).bind(
        uid(), pid, str(it.topic, 120), kind, party, via, str(b.said_by, 120), saidAt, quote, num(it.due_at),
        [title, str(it.section, 120)].filter(Boolean).join(' · '), docId, await sha256(quote), user, now(),
      ),
    );
  }
  if (!stmts.length) fail(400, 'empty', 'Nema stavki za uvoz.');
  stmts.unshift(
    c.env.DB.prepare('INSERT INTO statement_docs (id, project_id, file_name, title, content_sha256, count, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(
      docId, pid, str(b.file_name, 200), title, await sha256(String(b.full_text ?? '')), stmts.length, user, now(),
    ),
  );
  for (let i = 0; i < stmts.length; i += 400) await c.env.DB.batch(stmts.slice(i, i + 400));
  return c.json({ doc_id: docId, count: stmts.length - 1 });
});

zapis.delete('/projects/:pid/statement-docs/:id', async (c) => {
  const pid = c.req.param('pid');
  const id = c.req.param('id');
  const d = await c.env.DB.prepare('SELECT created_by, kind FROM statement_docs WHERE id = ? AND project_id = ?').bind(id, pid).first<{ created_by: string; kind: string }>();
  if (!d) fail(404, 'not_found');
  if (d!.kind === 'thread') fail(409, 'locked', 'Prepiska se ne briše kao zapis; poruke se brišu pojedinačno ili poništavanjem uvoza.');
  const u = c.get('user');
  if (u.role !== 'admin' && d!.created_by !== u.id) fail(403, 'forbidden', 'Uvoz poništava onaj ko ga je uradio ili admin.');
  const ids = 'SELECT id FROM statements WHERE doc_id = ?';
  await c.env.DB.batch([
    c.env.DB.prepare(`DELETE FROM statement_links WHERE from_id IN (${ids}) OR to_id IN (${ids})`).bind(id, id),
    c.env.DB.prepare('DELETE FROM statements WHERE doc_id = ?').bind(id),
    c.env.DB.prepare('DELETE FROM statement_docs WHERE id = ?').bind(id),
  ]);
  return c.json({ ok: true });
});
