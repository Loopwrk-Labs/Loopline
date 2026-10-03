import { Hono } from 'hono';
import type { AppEnv, ItemType, Status } from '../lib/types';
import { body, fail, isManager, now, str, uid } from '../lib/http';
import { getProject } from './projects';
import { changeEntry } from './logbook';

/**
 * Excel import. The browser reads the .xlsx and sends mapped rows; the server
 * resolves names (types, statuses, people, sprints, parents), validates,
 * and either returns a preview (dryRun) or writes everything in one batch.
 */
export const imports = new Hono<AppEnv>();

type Row = Record<string, unknown> & { row: number };
type Issue = { row: number; level: 'error' | 'warn'; msg: string };

const TYPE_WORDS: Record<string, ItemType> = { epic: 'epic', story: 'story', storija: 'story', bug: 'bug', task: 'task', zadatak: 'task' };
const STATUS_WORDS: Record<string, Status> = {
  todo: 'todo', 'to do': 'todo', 'za uraditi': 'todo', open: 'todo',
  in_progress: 'in_progress', 'in progress': 'in_progress', 'u toku': 'in_progress',
  in_review: 'in_review', 'in review': 'in_review', review: 'in_review', 'na pregledu': 'in_review',
  blocked: 'blocked', blokirano: 'blocked',
  done: 'done', 'završeno': 'done', zavrseno: 'done', closed: 'done',
};
const ALLOWED_PARENT: Record<ItemType, ItemType[]> = { epic: [], story: ['epic'], bug: ['epic'], task: ['story', 'bug'] };
const ORDER: Record<ItemType, number> = { epic: 0, story: 1, bug: 1, task: 2 };
const FIELDS = ['type', 'title', 'parent', 'sprint', 'status', 'assignee', 'points', 'scope_hours', 'actual_hours', 'due_date', 'labels', 'description'] as const;

const s = (v: unknown) => (v === null || v === undefined ? '' : String(v).trim());

function parseNum(v: unknown, row: number, field: string, issues: Issue[]): number | null | undefined {
  const t = s(v).replace(',', '.');
  if (!t) return undefined;
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100000) {
    issues.push({ row, level: 'error', msg: `${field}: "${s(v)}" is not a number` });
    return undefined;
  }
  return Math.round(n * 100) / 100;
}

function parseDate(v: unknown, row: number, issues: Issue[]): string | undefined {
  const t = s(v);
  if (!t) return undefined;
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = t.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})\.?$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  issues.push({ row, level: 'error', msg: `Due: "${t}" is not a date (use dd.mm.yyyy)` });
  return undefined;
}

imports.get('/projects/:pid/imports', async (c) => {
  const { results } = await c.env.DB.prepare(
    `SELECT i.id, i.file_name, i.rows_new, i.rows_updated, i.undone, i.created_at, u.name AS user_name
     FROM imports i JOIN users u ON u.id = i.user_id WHERE i.project_id = ? ORDER BY i.created_at DESC LIMIT 20`,
  )
    .bind(c.req.param('pid'))
    .all();
  return c.json(results);
});

imports.post('/projects/:pid/import', async (c) => {
  const db = c.env.DB;
  const pid = c.req.param('pid');
  const project = await getProject(db, pid);
  const b = await body<{ rows?: Row[]; dryRun?: boolean; fileName?: string }>(c);
  const rows = Array.isArray(b.rows) ? b.rows.slice(0, 1000) : [];
  if (!rows.length) fail(400, 'empty', 'The file has no rows to import.');

  const [itemsR, usersR, sprintsR] = await Promise.all([
    db.prepare('SELECT * FROM items WHERE project_id = ? AND archived = 0').bind(pid).all<Record<string, unknown>>(),
    db.prepare('SELECT id, name, initials, email FROM users WHERE active = 1').all<{ id: string; name: string; initials: string; email: string }>(),
    db.prepare(`SELECT id, name, status FROM sprints WHERE project_id = ?`).bind(pid).all<{ id: string; name: string; status: string }>(),
  ]);
  const byKey = new Map(itemsR.results.map((i) => [String(i.key).toUpperCase(), i]));
  const issues: Issue[] = [];

  const findUser = (v: string) => {
    const t = v.toLowerCase();
    return usersR.results.find((u) => u.initials.toLowerCase() === t || u.name.toLowerCase() === t || u.email.toLowerCase() === t || u.name.toLowerCase().split(' ')[0] === t);
  };
  const findSprint = (v: string) => sprintsR.results.find((sp) => sp.name.toLowerCase() === v.toLowerCase());

  type Plan = { row: number; existing?: Record<string, unknown>; data: Record<string, unknown>; parentRef?: number; parentKey?: string; note?: string };
  const plans: Plan[] = [];
  const rowNumbers = new Set(rows.map((r) => r.row));

  for (const r of rows) {
    const keyText = s(r.key).toUpperCase();
    const existing = keyText ? byKey.get(keyText) : undefined;
    if (keyText && !existing) {
      issues.push({ row: r.row, level: 'error', msg: `Key ${keyText} does not exist in ${project.key}` });
      continue;
    }
    const data: Record<string, unknown> = {};
    const typeText = s(r.type).toLowerCase();
    if (typeText) {
      const ty = TYPE_WORDS[typeText];
      if (!ty) issues.push({ row: r.row, level: 'error', msg: `Unknown type "${s(r.type)}"` });
      else data.type = ty;
    }
    if (!existing && !data.type) data.type = 'story';
    const title = str(r.title, 300);
    if (title) data.title = title;
    else if (!existing) {
      issues.push({ row: r.row, level: 'error', msg: 'Title is empty' });
      continue;
    }
    if ('description' in r && s(r.description)) data.description = str(r.description, 20000);
    const stText = s(r.status).toLowerCase();
    if (stText) {
      const st = STATUS_WORDS[stText];
      if (!st) issues.push({ row: r.row, level: 'error', msg: `Unknown status "${s(r.status)}"` });
      else data.status = st;
    }
    const who = s(r.assignee);
    if (who) {
      const u = findUser(who);
      if (!u) issues.push({ row: r.row, level: 'warn', msg: `Unknown person "${who}" — left unassigned` });
      else data.assignee_id = u.id;
    }
    const sp = s(r.sprint);
    if (sp) {
      if (['backlog', '-', '—'].includes(sp.toLowerCase())) data.sprint_id = null;
      else {
        const f = findSprint(sp);
        if (!f) issues.push({ row: r.row, level: 'warn', msg: `Unknown sprint "${sp}" — put in backlog` });
        else if (f.status === 'closed') issues.push({ row: r.row, level: 'warn', msg: `Sprint "${sp}" is closed — put in backlog` });
        else data.sprint_id = f.id;
      }
    }
    for (const f of ['points', 'scope_hours', 'actual_hours'] as const) {
      const n = parseNum(r[f], r.row, f, issues);
      if (n !== undefined) data[f] = n;
    }
    const due = parseDate(r.due_date, r.row, issues);
    if (due) data.due_date = due;
    if (s(r.labels)) data.labels = str(r.labels, 300)!.replace(/[;,]\s*/g, ';');

    const plan: Plan = { row: r.row, existing, data };
    const parentText = s(r.parent);
    if (parentText) {
      const ref = parentText.match(/^\(?\s*(?:row|red)\s*(\d+)\s*\)?$/i);
      if (ref) {
        const n = Number(ref[1]);
        if (!rowNumbers.has(n)) issues.push({ row: r.row, level: 'error', msg: `Parent refers to row ${n}, which is not in the file` });
        else plan.parentRef = n;
      } else {
        const pk = parentText.toUpperCase();
        if (!byKey.has(pk)) issues.push({ row: r.row, level: 'error', msg: `Parent ${pk} does not exist` });
        else plan.parentKey = pk;
      }
    }
    if (s(r.note)) plan.note = str(r.note, 5000)!;
    plans.push(plan);
  }

  // Resolve parents and check type rules.
  const planByRow = new Map(plans.map((p) => [p.row, p]));
  const typeOf = (p: Plan) => (p.data.type ?? p.existing?.type) as ItemType;
  for (const p of plans) {
    let parentType: ItemType | null = null;
    if (p.parentKey) parentType = byKey.get(p.parentKey)!.type as ItemType;
    if (p.parentRef !== undefined) {
      const pp = planByRow.get(p.parentRef);
      if (!pp) {
        issues.push({ row: p.row, level: 'error', msg: `Row ${p.parentRef} has errors, so it cannot be the parent` });
        continue;
      }
      parentType = typeOf(pp);
    }
    if (parentType && !ALLOWED_PARENT[typeOf(p)].includes(parentType)) {
      issues.push({ row: p.row, level: 'error', msg: `A ${typeOf(p)} cannot go under an item of type ${parentType}` });
    }
  }

  const errorRows = new Set(issues.filter((i) => i.level === 'error').map((i) => i.row));
  const valid = plans.filter((p) => !errorRows.has(p.row));
  const summary = {
    total: rows.length,
    new: valid.filter((p) => !p.existing).length,
    updated: valid.filter((p) => p.existing).length,
    errors: errorRows.size,
    warnings: issues.filter((i) => i.level === 'warn').length,
    issues: issues.sort((a, z) => a.row - z.row).slice(0, 200),
  };
  if (b.dryRun || errorRows.size) return c.json({ ...summary, applied: false });

  // ---- apply ----
  const userId = c.get('user').id;
  const t = now();
  const newPlans = valid.filter((p) => !p.existing).sort((a, z) => ORDER[typeOf(a)] - ORDER[typeOf(z)]);
  const epics = newPlans.filter((p) => typeOf(p) === 'epic').length;
  const others = newPlans.length - epics;
  const ctr = await db
    .prepare('UPDATE projects SET next_num = next_num + ?, next_epic = next_epic + ? WHERE id = ? RETURNING next_num - ? AS n, next_epic - ? AS e')
    .bind(others, epics, pid, others, epics)
    .first<{ n: number; e: number }>();
  let nextNum = ctr!.n;
  let nextEpic = ctr!.e;
  const pos = await db.prepare('SELECT COALESCE(MAX(position), 0) AS p FROM items WHERE project_id = ?').bind(pid).first<{ p: number }>();
  let position = pos!.p;

  const idByRow = new Map<number, string>();
  const stmts: D1PreparedStatement[] = [];
  const createdIds: string[] = [];
  for (const p of newPlans) {
    const ty = typeOf(p);
    const id = uid();
    idByRow.set(p.row, id);
    createdIds.push(id);
    const key = ty === 'epic' ? `${project.key}-E${nextEpic++}` : `${project.key}-${nextNum++}`;
    const parentId = p.parentKey ? (byKey.get(p.parentKey)!.id as string) : p.parentRef !== undefined ? idByRow.get(p.parentRef) ?? null : null;
    const status = (p.data.status as Status) ?? 'todo';
    const sprintId = ty === 'epic' ? null : ((p.data.sprint_id as string | undefined) ?? null);
    const sprint = sprintId ? sprintsR.results.find((x) => x.id === sprintId) : null;
    const scope = (p.data.scope_hours as number | undefined) ?? null;
    stmts.push(
      db
        .prepare(
          `INSERT INTO items (id, project_id, key, type, title, description, status, parent_id, sprint_id, assignee_id, reporter_id,
            points, scope_hours, scope_baseline, actual_hours, due_date, labels, billable, position, started_at, done_at, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)`,
        )
        .bind(
          id, pid, key, ty, p.data.title, (p.data.description as string) ?? '', status, parentId, sprintId,
          (p.data.assignee_id as string | undefined) ?? null, userId,
          (p.data.points as number | undefined) ?? null, scope, sprint?.status === 'active' ? scope : null,
          (p.data.actual_hours as number | undefined) ?? null, (p.data.due_date as string | undefined) ?? null,
          (p.data.labels as string | undefined) ?? '', ++position, status === 'todo' ? null : t, status === 'done' ? t : null, t, t,
        ),
      changeEntry(db, { projectId: pid, itemId: id, userId, field: 'created', oldValue: null, newValue: ty, at: t }),
    );
    if (p.note) {
      stmts.push(
        db.prepare(`INSERT INTO logbook (id, project_id, item_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, 'note', ?, ?)`).bind(uid(), pid, id, userId, p.note, t + 1),
      );
    }
  }

  const updates: { id: string; before: Record<string, unknown> }[] = [];
  const COL: Record<string, string> = { type: 'type', title: 'title', description: 'description', status: 'status', assignee_id: 'assignee_id', sprint_id: 'sprint_id', points: 'points', scope_hours: 'scope_hours', actual_hours: 'actual_hours', due_date: 'due_date', labels: 'labels' };
  for (const p of valid.filter((x) => x.existing)) {
    const ex = p.existing!;
    const set: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(p.data)) if (COL[k] && ex[k] !== v) set[k] = v;
    if (p.parentKey || p.parentRef !== undefined) {
      const pid2 = p.parentKey ? (byKey.get(p.parentKey)!.id as string) : idByRow.get(p.parentRef!) ?? (planByRow.get(p.parentRef!)?.existing?.id as string);
      if (pid2 && pid2 !== ex.parent_id) set.parent_id = pid2;
    }
    if (ex.status === 'done' && 'actual_hours' in set && !isManager(c)) delete set.actual_hours;
    if ((set.type === 'epic') !== (ex.type === 'epic') && 'type' in set) delete set.type;
    if (!Object.keys(set).length) continue;
    if (set.status && set.status !== ex.status) {
      if (set.status !== 'todo' && !ex.started_at) set.started_at = t;
      set.done_at = set.status === 'done' ? t : null;
    }
    const before: Record<string, unknown> = {};
    for (const k of Object.keys(set)) before[k] = ex[k];
    updates.push({ id: ex.id as string, before });
    const cols = Object.keys(set);
    stmts.push(
      db.prepare(`UPDATE items SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((k) => set[k] ?? null), t, ex.id),
    );
    for (const k of cols) {
      if (['started_at', 'done_at', 'description'].includes(k)) continue;
      stmts.push(changeEntry(db, { projectId: pid, itemId: ex.id as string, userId, field: k.replace(/_id$/, ''), oldValue: ex[k], newValue: set[k], at: t }));
    }
    if (p.note) {
      stmts.push(db.prepare(`INSERT INTO logbook (id, project_id, item_id, user_id, kind, body, created_at) VALUES (?, ?, ?, ?, 'note', ?, ?)`).bind(uid(), pid, ex.id, userId, p.note, t + 1));
    }
  }

  const importId = uid();
  stmts.push(
    db
      .prepare('INSERT INTO imports (id, project_id, user_id, file_name, created_ids, updates, rows_new, rows_updated, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(importId, pid, userId, str(b.fileName, 200), JSON.stringify(createdIds), JSON.stringify(updates), createdIds.length, updates.length, t),
  );
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return c.json({ ...summary, applied: true, importId, new: createdIds.length, updated: updates.length });
});

/** Undo a whole import: archive what it created, restore what it changed. */
imports.post('/imports/:id/undo', async (c) => {
  const db = c.env.DB;
  const imp = await db.prepare('SELECT * FROM imports WHERE id = ?').bind(c.req.param('id')).first<Record<string, unknown>>();
  if (!imp) fail(404, 'not_found');
  if (imp.undone) fail(400, 'already_undone', 'This import was already undone.');
  if (imp.user_id !== c.get('user').id && !isManager(c)) fail(403, 'forbidden');
  const created: string[] = JSON.parse(String(imp.created_ids));
  const updates: { id: string; before: Record<string, unknown> }[] = JSON.parse(String(imp.updates));
  const t = now();
  const userId = c.get('user').id;
  const pid = imp.project_id as string;
  const stmts: D1PreparedStatement[] = [];
  for (const id of created) {
    stmts.push(db.prepare('UPDATE items SET archived = 1, updated_at = ? WHERE id = ?').bind(t, id));
    stmts.push(changeEntry(db, { projectId: pid, itemId: id, userId, field: 'archived', oldValue: null, newValue: 'import undo', at: t }));
  }
  const allowed = new Set(['type', 'title', 'description', 'status', 'assignee_id', 'sprint_id', 'parent_id', 'points', 'scope_hours', 'actual_hours', 'due_date', 'labels', 'started_at', 'done_at']);
  for (const u of updates) {
    const cols = Object.keys(u.before).filter((k) => allowed.has(k));
    if (!cols.length) continue;
    stmts.push(db.prepare(`UPDATE items SET ${cols.map((k) => `${k} = ?`).join(', ')}, updated_at = ? WHERE id = ?`).bind(...cols.map((k) => u.before[k] ?? null), t, u.id));
    stmts.push(changeEntry(db, { projectId: pid, itemId: u.id, userId, field: 'import_undo', oldValue: null, newValue: cols.join(', '), at: t }));
  }
  stmts.push(db.prepare('UPDATE imports SET undone = 1 WHERE id = ?').bind(imp.id));
  // D1 batches are limited in size; split large undos.
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return c.json({ ok: true, archived: created.length, restored: updates.length });
});
