import type { Item } from './api';

/** Hours roll up from tasks: a story/bug with tasks shows the sum of its tasks. */
export function childrenOf(items: Item[], id: string) {
  return items.filter((i) => i.parent_id === id);
}

export function rolled(items: Item[], it: Item): { scope: number | null; actual: number | null; rolled: boolean } {
  if (it.type === 'story' || it.type === 'bug') {
    const kids = items.filter((i) => i.parent_id === it.id && i.type === 'task');
    if (kids.length) {
      const sum = (f: 'scope_hours' | 'actual_hours') => (kids.some((k) => k[f] !== null) ? kids.reduce((a, k) => a + (k[f] ?? 0), 0) : null);
      return { scope: sum('scope_hours'), actual: sum('actual_hours'), rolled: true };
    }
  }
  if (it.type === 'epic') {
    const leaves = leafItemsUnder(items, it.id);
    const sum = (f: 'scope_hours' | 'actual_hours') => (leaves.some((k) => k[f] !== null) ? leaves.reduce((a, k) => a + (k[f] ?? 0), 0) : null);
    return { scope: sum('scope_hours'), actual: sum('actual_hours'), rolled: true };
  }
  return { scope: it.scope_hours, actual: it.actual_hours, rolled: false };
}

/** Items that carry their own hours (tasks, and stories/bugs without tasks). */
export function isLeaf(items: Item[], it: Item) {
  if (it.type === 'epic') return false;
  if (it.type === 'task') return true;
  return !items.some((i) => i.parent_id === it.id && i.type === 'task');
}

export function leafItemsUnder(items: Item[], epicId: string) {
  const stories = items.filter((i) => i.parent_id === epicId);
  const out: Item[] = [];
  for (const s of stories) {
    const tasks = items.filter((i) => i.parent_id === s.id && i.type === 'task');
    if (tasks.length) out.push(...tasks);
    else out.push(s);
  }
  return out;
}

export const isLate = (it: Item) => !!it.due_date && it.status !== 'done' && it.due_date < new Date().toISOString().slice(0, 10);

/** All descendants of the given items (epic > story/bug > task), the items themselves excluded. */
export function descendants(items: Item[], ids: string[]): Item[] {
  const out: Item[] = [];
  const seen = new Set(ids);
  let frontier = ids;
  while (frontier.length) {
    const kids = items.filter((i) => i.parent_id && frontier.includes(i.parent_id) && !seen.has(i.id));
    kids.forEach((k) => seen.add(k.id));
    out.push(...kids);
    frontier = kids.map((k) => k.id);
  }
  return out;
}
