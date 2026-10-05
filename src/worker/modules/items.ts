import { Hono } from 'hono';
import type { AppEnv, ItemType, Status } from '../lib/types';
import { STATUSES, TYPES } from '../lib/types';
import { body, date, fail, isManager, now, num, requireRole, str, uid } from '../lib/http';
import { getProject } from './projects';
import { changeEntry } from './logbook';

export const items = new Hono<AppEnv>();

type Item = {
  id: string;
  project_id: string;
  key: string;
  type: ItemType;
  title: string;
  description: string;
  status: Status;
  parent_id: string | null;
  sprint_id: string | null;
  assignee_id: string | null;
  reporter_id: string | null;
  points: number | null;
  scope_hours: number | null;
  scope_baseline: number | null;
  actual_hours: number | null;
  due_date: string | null;
  labels: string;
  billable: number;
  position: number;
  started_at: number | null;
  done_at: number | null;
  archived: number;
  created_at: number;
  updated_at: number;
};

const ALLOWED_PARENT: Record<ItemType, ItemType[]> = {
  epic: [],
  story: ['epic'],
  bug: ['epic'],
  task: ['story', 'bug'],
};

async function loadItem(db: D1Database, id: string) {
  const it = await db.prepare('SELECT * FROM items WHERE id = ?').bind(id).first<Item>();
  if (!it || it.archived) fail(404, 'not_found', 'Item not found.');
  return it;
}

async function checkParent(db: D1Database, projectId: string, type: ItemType, parentId: string | null, selfId?: string) {
  if (!parentId) return null;
  if (parentId === selfId) fail(400, 'bad_parent', 'An item cannot be its own parent.');
  const p = await db.prepare('SELECT id, key, type, project_id FROM items WHERE id = ? AND archived = 0').bind(parentId).first<Item>();
  if (!p || p.project_id !== projectId) fail(400, 'bad_parent', 'Parent not found in this project.');
  if (!ALLOWED_PARENT[type].includes(p.type)) fail(400, 'bad_parent', `This ${type} cannot be placed under a ${p.type}.`);
  return p;
}

async function checkSprint(db: D1Database, projectId: string, sprintId: string | null) {
  if (!sprintId) return null;
  const s = await db.prepare('SELECT id, name, status, project_id FROM sprints WHERE id = ?').bind(sprintId).first<{ id: string; name: string; status: string; project_id: string }>();
  if (!s || s.project_id !== projectId) fail(400, 'bad_sprint', 'Sprint not found in this project.');
  if (s.status === 'closed') fail(400, 'sprint_closed', 'This sprint is closed.');
  return s;
}

async function checkUser(db: D1Database, userId: string | null) {
  if (!userId) return null;
  const u = await db.prepare('SELECT id, name FROM users WHERE id = ? AND active = 1').bind(userId).first<{ id: string; name: string }>();
  if (!u) fail(400, 'bad_user', 'User not found.');
  return u;
}

items.get('/projects/:pid/items', async (c) => {
  const pid = c.req.param('pid');
  await getProject(c.env.DB, pid);
  const { results } = await c.env.DB.prepare('SELECT * FROM items WHERE project_id = ? AND archived = 0 ORDER BY position, created_at').bind(pid).all();
  return c.json(results);
});

items.get('/projects/:pid/items/by-key/:key', async (c) => {
  const it = await c.env.DB.prepare('SELECT * FROM items WHERE project_id = ? AND key = ? AND archived = 0')
    .bind(c.req.param('pid'), c.req.param('key').toUpperCase())
    .first();
  if (!it) fail(404, 'not_found', 'Item not found.');
  return c.json(it);
});

items.post('/projects/:pid/items', async (c) => {
  const pid = c.req.param('pid');
  const project = await getProject(c.env.DB, pid);
  const b = await body(c);
  const type = (b.type as ItemType) ?? 'story';
  if (!TYPES.includes(type)) fail(400, 'bad_type');
  const title = str(b.title, 300);
  if (!title) fail(400, 'bad_title', 'Enter a title.');
  const status = (b.status as Status) ?? 'todo';
  if (!STATUSES.includes(status)) fail(400, 'bad_status');
  const parentId = str(b.parent_id, 64);
  await checkParent(c.env.DB, pid, type, parentId);
  const sprintId = type === 'epic' ? null : str(b.sprint_id, 64);
  const sprint = await checkSprint(c.env.DB, pid, sprintId);
  const assigneeId = str(b.assignee_id, 64);
  await checkUser(c.env.DB, assigneeId);
  const scope = num(b.scope_hours);

  const counter = await c.env.DB.prepare(
    type === 'epic'
      ? 'UPDATE projects SET next_epic = next_epic + 1 WHERE id = ? RETURNING next_epic - 1 AS n'
      : 'UPDATE projects SET next_num = next_num + 1 WHERE id = ? RETURNING next_num - 1 AS n',
  )
    .bind(pid)
    .first<{ n: number }>();
  const key = type === 'epic' ? `${project.key}-E${counter!.n}` : `${project.key}-${counter!.n}`;
  const pos = await c.env.DB.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM items WHERE project_id = ?').bind(pid).first<{ p: number }>();
  const t = now();
  const id = uid();
  const userId = c.get('user').id;
  await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO items (id, project_id, key, type, title, description, status, parent_id, sprint_id, assignee_id, reporter_id,
        points, scope_hours, scope_baseline, actual_hours, due_date, labels, billable, position, started_at, done_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      id,
      pid,
      key,
      type,
      title,
      str(b.description, 20000) ?? '',
      status,
      parentId,
      sprintId,
      assigneeId,
      userId,
      num(b.points),
      scope,
      sprint?.status === 'active' ? scope : null,
      num(b.actual_hours),
      date(b.due_date),
      str(b.labels, 300) ?? '',
      b.billable === false ? 0 : 1,
      pos!.p,
      status === 'todo' ? null : t,
      status === 'done' ? t : null,
      t,
      t,
    ),
    changeEntry(c.env.DB, { projectId: pid, itemId: id, userId, field: 'created', oldValue: null, newValue: type, at: t }),
  ]);
  return c.json({ id, key });
});

/** Fields that the client may change, and how each one is parsed. */
const EDITABLE: Record<string, (v: unknown) => unknown> = {
  title: (v) => {
    const s = str(v, 300);
    if (!s) fail(400, 'bad_title', 'Enter a title.');
    return s;
  },
  description: (v) => str(v, 20000) ?? '',
  type: (v) => {
    if (!TYPES.includes(v as ItemType)) fail(400, 'bad_type');
    return v;
  },
  status: (v) => {
    if (!STATUSES.includes(v as Status)) fail(400, 'bad_status');
    return v;
  },
  parent_id: (v) => str(v, 64),
  sprint_id: (v) => str(v, 64),
  assignee_id: (v) => str(v, 64),
  points: num,
  scope_hours: num,
  actual_hours: num,
  due_date: date,
  labels: (v) => str(v, 300) ?? '',
  billable: (v) => (v ? 1 : 0),
  position: (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) fail(400, 'bad_position');
    return n;
  },
};

/** Changes to these fields are written to the Logbook automatically. */
const LOGGED = ['title', 'type', 'status', 'parent_id', 'sprint_id', 'assignee_id', 'points', 'scope_hours', 'actual_hours', 'due_date', 'billable'];

items.patch('/items/:id', async (c) => {
  const db = c.env.DB;
  const cur = await loadItem(db, c.req.param('id'));
  const b = await body(c);
  const next: Item = { ...cur };
  for (const [k, parse] of Object.entries(EDITABLE)) {
    if (k in b) (next as Record<string, unknown>)[k] = parse(b[k]);
  }

  // Validation of relations.
  if (next.type === 'epic') next.sprint_id = null;
  const parent = next.parent_id !== cur.parent_id || next.type !== cur.type ? await checkParent(db, cur.project_id, next.type, next.parent_id, cur.id) : null;
  const sprint = next.sprint_id !== cur.sprint_id ? await checkSprint(db, cur.project_id, next.sprint_id) : null;
  const assignee = next.assignee_id !== cur.assignee_id ? await checkUser(db, next.assignee_id) : null;
  if (next.type !== cur.type) {
    const kids = await db.prepare('SELECT type FROM items WHERE parent_id = ? AND archived = 0').bind(cur.id).all<{ type: ItemType }>();
    if (kids.results.some((k) => !ALLOWED_PARENT[k.type].includes(next.type))) fail(400, 'bad_type', 'Child items do not fit under the new type.');
    if ((cur.type === 'epic') !== (next.type === 'epic')) fail(400, 'bad_type', 'Epics cannot be converted to other types.');
  }

  // Actual hours are locked once an item is Done; only managers may change them.
  if (cur.status === 'done' && next.actual_hours !== cur.actual_hours && !isManager(c)) {
    fail(403, 'actual_locked', 'Actual hours are locked on Done items. Ask a manager to change them.');
  }

  const t = now();
  if (next.status !== cur.status) {
    if (next.status !== 'todo' && !cur.started_at) next.started_at = t;
    next.done_at = next.status === 'done' ? t : null;
  }
  // Baseline: the first scope estimate seen while the item is in an active sprint.
  if (next.scope_baseline === null && next.scope_hours !== null && next.sprint_id) {
    const s = sprint ?? (await db.prepare('SELECT status FROM sprints WHERE id = ?').bind(next.sprint_id).first<{ status: string }>());
    if (s?.status === 'active') next.scope_baseline = next.scope_hours;
  }

  const userId = c.get('user').id;
  const stmts = [
    db
      .prepare(
        `UPDATE items SET title=?, description=?, type=?, status=?, parent_id=?, sprint_id=?, assignee_id=?, points=?, scope_hours=?,
         scope_baseline=?, actual_hours=?, due_date=?, labels=?, billable=?, position=?, started_at=?, done_at=?, updated_at=? WHERE id=?`,
      )
      .bind(
        next.title,
        next.description,
        next.type,
        next.status,
        next.parent_id,
        next.sprint_id,
        next.assignee_id,
        next.points,
        next.scope_hours,
        next.scope_baseline,
        next.actual_hours,
        next.due_date,
        next.labels,
        next.billable,
        next.position,
        next.started_at,
        next.done_at,
        t,
        cur.id,
      ),
  ];

  // Human-readable values for the Logbook (names instead of ids).
  const label = async (field: string, id: string | null, resolved: { name?: string; key?: string } | null) => {
    if (!id) return null;
    if (resolved) return resolved.name ?? resolved.key ?? id;
    if (field === 'assignee_id') return (await db.prepare('SELECT name FROM users WHERE id = ?').bind(id).first<{ name: string }>())?.name ?? id;
    if (field === 'sprint_id') return (await db.prepare('SELECT name FROM sprints WHERE id = ?').bind(id).first<{ name: string }>())?.name ?? id;
    if (field === 'parent_id') return (await db.prepare('SELECT key FROM items WHERE id = ?').bind(id).first<{ key: string }>())?.key ?? id;
    return id;
  };
  for (const f of LOGGED) {
    const o = (cur as Record<string, unknown>)[f];
    const n = (next as Record<string, unknown>)[f];
    if (o === n) continue;
    let ov = o;
    let nv = n;
    if (f === 'assignee_id' || f === 'sprint_id' || f === 'parent_id') {
      const res = f === 'assignee_id' ? assignee : f === 'sprint_id' ? sprint : parent;
      ov = await label(f, o as string | null, null);
      nv = await label(f, n as string | null, res);
    }
    stmts.push(changeEntry(db, { projectId: cur.project_id, itemId: cur.id, userId, field: f.replace(/_id$/, ''), oldValue: ov, newValue: nv, at: t }));
  }
  await db.batch(stmts);
  return c.json(await loadItem(db, cur.id));
});

items.delete('/items/:id', async (c) => {
  const db = c.env.DB;
  const cur = await loadItem(db, c.req.param('id'));
  const kids = await db.prepare('SELECT COUNT(*) AS n FROM items WHERE parent_id = ? AND archived = 0').bind(cur.id).first<{ n: number }>();
  if ((kids?.n ?? 0) > 0) fail(409, 'has_children', 'Move or archive the child items first.');
  await db.batch([
    db.prepare('UPDATE items SET archived = 1, updated_at = ? WHERE id = ?').bind(now(), cur.id),
    changeEntry(db, { projectId: cur.project_id, itemId: cur.id, userId: c.get('user').id, field: 'archived', oldValue: null, newValue: cur.key }),
  ]);
  return c.json({ ok: true });
});

/**
 * Admin only: permanently delete items. With cascade (default) every descendant goes too
 * (epic -> stories/bugs -> tasks), archived ones included. Their Logbook entries are removed,
 * links from correspondence / approvals / decisions are cleared, and one project-level
 * Logbook entry records what was deleted.
 */
items.post('/items/delete', async (c) => {
  requireRole(c, 'admin');
  const db = c.env.DB;
  const b = await body<{ ids?: unknown; cascade?: boolean }>(c);
  const ids = Array.isArray(b.ids) ? b.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : [];
  if (!ids.length) fail(400, 'empty', 'Nothing selected.');
  const cascade = b.cascade !== false;

  const roots = (
    await db.prepare(`SELECT id, key, title, type, project_id, parent_id FROM items WHERE id IN (${ids.map(() => '?').join(',')})`).bind(...ids).all<Item>()
  ).results;
  if (!roots.length) fail(404, 'not_found', 'Item not found.');
  const projectId = roots[0].project_id;
  if (roots.some((r) => r.project_id !== projectId)) fail(400, 'mixed_projects', 'Select items from one project at a time.');

  // Collect descendants level by level (max depth is 3: epic > story > task).
  const all = new Map(roots.map((r) => [r.id, r]));
  let frontier = roots.map((r) => r.id);
  for (let depth = 0; depth < 4 && frontier.length; depth++) {
    const kids = (
      await db.prepare(`SELECT id, key, title, type, project_id, parent_id FROM items WHERE parent_id IN (${frontier.map(() => '?').join(',')})`).bind(...frontier).all<Item>()
    ).results.filter((k) => !all.has(k.id));
    if (kids.length && !cascade) fail(409, 'has_children', 'This item has child items. Delete them too, or move them first.');
    kids.forEach((k) => all.set(k.id, k));
    frontier = kids.map((k) => k.id);
  }

  // Children first so parent_id references never dangle.
  const depthOf = (it: Item): number => (it.parent_id && all.has(it.parent_id) ? 1 + depthOf(all.get(it.parent_id)!) : 0);
  const ordered = [...all.values()].sort((a, b2) => depthOf(b2) - depthOf(a));
  const stmts: D1PreparedStatement[] = [];
  for (const it of ordered) {
    stmts.push(db.prepare('DELETE FROM logbook WHERE item_id = ?').bind(it.id));
    for (const tbl of ['correspondence', 'approvals', 'decisions']) stmts.push(db.prepare(`UPDATE ${tbl} SET item_id = NULL WHERE item_id = ?`).bind(it.id));
    stmts.push(db.prepare('DELETE FROM items WHERE id = ?').bind(it.id));
  }
  const keys = roots.map((r) => r.key).join(', ');
  const extra = all.size - roots.length;
  stmts.push(
    changeEntry(db, {
      projectId,
      itemId: null,
      userId: c.get('user').id,
      field: 'deleted',
      oldValue: roots.length === 1 ? `${roots[0].key} ${roots[0].title}` : keys,
      newValue: extra ? `${all.size} items incl. ${extra} child items` : `${all.size} item${all.size === 1 ? '' : 's'}`,
    }),
  );
  for (let i = 0; i < stmts.length; i += 400) await db.batch(stmts.slice(i, i + 400));
  return c.json({ ok: true, deleted: all.size });
});
