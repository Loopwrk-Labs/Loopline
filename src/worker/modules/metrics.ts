import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { getProject } from './projects';

/**
 * Team metrics computed from data the tool already has (statuses, timestamps,
 * points, hours, Logbook). The only manual input is sprint capacity.
 */
export const metrics = new Hono<AppEnv>();

type It = {
  id: string; type: string; status: string; parent_id: string | null; sprint_id: string | null; assignee_id: string | null;
  points: number | null; scope_hours: number | null; scope_baseline: number | null; actual_hours: number | null; billable: number;
  started_at: number | null; done_at: number | null; created_at: number; key: string; title: string;
};
type Sp = { id: string; name: string; status: string; start_date: string | null; end_date: string | null; committed_points: number | null; committed_items: number | null; started_at: number | null; closed_at: number | null };
type Log = { item_id: string; field: string; old_value: string | null; new_value: string | null; created_at: number };

const DAY = 86400_000;
const median = (xs: number[]) => {
  if (!xs.length) return null;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const r1 = (n: number | null) => (n === null || !Number.isFinite(n) ? null : Math.round(n * 10) / 10);
const sum = (xs: (number | null)[]) => xs.reduce<number>((a, x) => a + (x ?? 0), 0);

function leafItems(items: It[], inSprint: It[]) {
  const hasTasks = new Set(items.filter((i) => i.type === 'task' && i.parent_id).map((i) => i.parent_id));
  return inSprint.filter((i) => i.type === 'task' || ((i.type === 'story' || i.type === 'bug') && !hasTasks.has(i.id)));
}

function sprintMetrics(sp: Sp, items: Item[], cap: { user_id: string; hours: number }[], logs: Log[], sprints: Sp[]) {
  const inSprint = items.filter((i) => i.sprint_id === sp.id);
  const work = inSprint.filter((i) => i.type === 'story' || i.type === 'bug');
  const done = work.filter((i) => i.status === 'done');
  const committedPts = sp.committed_points ?? sum(work.map((i) => i.points));
  const donePts = sum(done.map((i) => i.points));
  const leaves = leafItems(items, inSprint);
  const capacity = sum(cap.map((c) => c.hours));
  const planned = sum(leaves.map((i) => i.scope_hours));
  const actual = sum(leaves.map((i) => i.actual_hours));
  const billable = sum(leaves.filter((i) => i.billable).map((i) => i.actual_hours));
  const doneLeaves = leaves.filter((i) => i.status === 'done' && (i.scope_baseline ?? i.scope_hours));
  const accScope = sum(doneLeaves.map((i) => i.scope_baseline ?? i.scope_hours));
  const accActual = sum(doneLeaves.map((i) => i.actual_hours));
  const cycles = inSprint.filter((i) => i.status === 'done' && i.started_at && i.done_at).map((i) => (i.done_at! - i.started_at!) / DAY);

  // Waiting time: share of cycle spent in Blocked or In Review (from status changes).
  let waiting = 0;
  let total = 0;
  for (const it of inSprint.filter((i) => i.status === 'done' && i.started_at && i.done_at)) {
    const ch = logs.filter((l) => l.item_id === it.id && l.field === 'status').sort((a, b) => a.created_at - b.created_at);
    total += it.done_at! - it.started_at!;
    for (let k = 0; k < ch.length; k++) {
      if (ch[k].new_value === 'blocked' || ch[k].new_value === 'in_review') {
        const end = ch[k + 1]?.created_at ?? it.done_at!;
        waiting += Math.max(0, end - ch[k].created_at);
      }
    }
  }

  // Scope added after the sprint started.
  let addedPts = 0;
  let addedItems = 0;
  if (sp.started_at) {
    const movedIn = new Set(logs.filter((l) => l.field === 'sprint' && l.new_value === sp.name && l.created_at > sp.started_at!).map((l) => l.item_id));
    for (const i of work) {
      if (movedIn.has(i.id) || (i.created_at > sp.started_at + 60_000 && i.sprint_id === sp.id)) {
        addedItems++;
        addedPts += i.points ?? 0;
      }
    }
  }

  // Carry-over: items moved out of a closed sprint two or more times.
  const closedNames = new Set(sprints.filter((s) => s.status === 'closed').map((s) => s.name));
  const outCount = new Map<string, number>();
  for (const l of logs) if (l.field === 'sprint' && l.old_value && closedNames.has(l.old_value)) outCount.set(l.item_id, (outCount.get(l.item_id) ?? 0) + 1);
  const touched = new Set([...inSprint.map((i) => i.id), ...logs.filter((l) => l.field === 'sprint' && l.old_value === sp.name).map((l) => l.item_id)]);
  const carry = [...touched].filter((id) => (outCount.get(id) ?? 0) >= 2).map((id) => items.find((i) => i.id === id)).filter(Boolean) as It[];

  const now = Date.now();
  const aging = sp.status === 'active' ? inSprint.filter((i) => i.status === 'in_progress' && i.started_at && now - i.started_at > 5 * DAY) : [];
  const startMs = sp.started_at ?? (sp.start_date ? Date.parse(sp.start_date) : 0);
  const endMs = sp.closed_at ?? (sp.end_date ? Date.parse(sp.end_date) + DAY : now);
  const bugs = items.filter((i) => i.type === 'bug' && i.created_at >= startMs && i.created_at <= endMs).length;

  const people = new Map<string, { user_id: string; capacity: number; planned: number; actual: number }>();
  const person = (uid: string) => {
    if (!people.has(uid)) people.set(uid, { user_id: uid, capacity: 0, planned: 0, actual: 0 });
    return people.get(uid)!;
  };
  for (const c of cap) person(c.user_id).capacity = c.hours;
  for (const l of leaves) {
    if (!l.assignee_id) continue;
    const p = person(l.assignee_id);
    p.planned += l.scope_hours ?? 0;
    p.actual += l.actual_hours ?? 0;
  }

  return {
    sprint: { id: sp.id, name: sp.name, status: sp.status, start_date: sp.start_date, end_date: sp.end_date },
    committed_points: committedPts,
    committed_items: sp.committed_items ?? work.length,
    done_points: donePts,
    done_items: done.length,
    say_do: committedPts ? r1((donePts / committedPts) * 100) : null,
    cycle_median_days: r1(median(cycles)),
    capacity,
    planned_hours: r1(planned),
    actual_hours: r1(actual),
    billable_hours: r1(billable),
    load: capacity ? r1((planned / capacity) * 100) : null,
    utilization: capacity ? r1((actual / capacity) * 100) : null,
    billable_share: actual ? r1((billable / actual) * 100) : null,
    estimate_accuracy: accScope ? r1((accActual / accScope - 1) * 100) : null,
    waiting_share: total ? r1((waiting / total) * 100) : null,
    scope_added_points: addedPts,
    scope_added_items: addedItems,
    carry_over: carry.map((i) => ({ key: i.key, title: i.title })),
    aging_wip: aging.map((i) => ({ key: i.key, title: i.title, days: Math.floor((now - i.started_at!) / DAY) })),
    bugs,
    bug_ratio: done.filter((i) => i.type === 'story').length ? r1(bugs / done.filter((i) => i.type === 'story').length) : null,
    people: [...people.values()].map((p) => ({ ...p, planned: r1(p.planned), actual: r1(p.actual), load: p.capacity ? r1((p.planned / p.capacity) * 100) : null, utilization: p.capacity ? r1((p.actual / p.capacity) * 100) : null })),
  };
}
type Item = It;

metrics.get('/projects/:pid/metrics', async (c) => {
  const db = c.env.DB;
  const pid = c.req.param('pid');
  await getProject(db, pid);
  const [itemsR, sprintsR, capR, logsR] = await Promise.all([
    db.prepare('SELECT * FROM items WHERE project_id = ? AND archived = 0').bind(pid).all<It>(),
    db.prepare(`SELECT * FROM sprints WHERE project_id = ? AND status != 'planned' ORDER BY COALESCE(started_at, created_at)`).bind(pid).all<Sp>(),
    db.prepare('SELECT sc.sprint_id, sc.user_id, sc.hours FROM sprint_capacity sc JOIN sprints s ON s.id = sc.sprint_id WHERE s.project_id = ?').bind(pid).all<{ sprint_id: string; user_id: string; hours: number }>(),
    db.prepare(`SELECT item_id, field, old_value, new_value, created_at FROM logbook WHERE project_id = ? AND kind = 'change' AND field IN ('status','sprint') AND item_id IS NOT NULL`).bind(pid).all<Log>(),
  ]);
  const sprints = sprintsR.results;
  const all = sprints.map((sp) => sprintMetrics(sp, itemsR.results, capR.results.filter((x) => x.sprint_id === sp.id), logsR.results, sprints));
  const sel = c.req.query('sprint');
  const current = (sel && all.find((m) => m.sprint.id === sel)) || [...all].reverse().find((m) => m.sprint.status === 'closed') || all[all.length - 1] || null;
  const trend = all.slice(-6).map((m) => ({ name: m.sprint.name, id: m.sprint.id, status: m.sprint.status, done_points: m.done_points, say_do: m.say_do, cycle: m.cycle_median_days }));
  const closed = all.filter((m) => m.sprint.status === 'closed').slice(-6);
  const avg = (f: (m: (typeof all)[number]) => number | null) => {
    const v = closed.map(f).filter((x): x is number => x !== null);
    return v.length ? r1(v.reduce((a, b) => a + b, 0) / v.length) : null;
  };
  return c.json({
    current,
    trend,
    averages: { done_points: avg((m) => m.done_points), say_do: avg((m) => m.say_do), cycle: avg((m) => m.cycle_median_days) },
    sprints: all.map((m) => ({ id: m.sprint.id, name: m.sprint.name, status: m.sprint.status })),
  });
});
