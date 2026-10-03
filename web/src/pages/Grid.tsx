import { useMemo, useState } from 'preact/hooks';
import { api, ApiError, TYPES, type Item, type ItemType } from '../api';
import { fmtNum, useT } from '../i18n';
import { useApp } from '../state';
import { TypeBadge, VarChip } from '../components/ui';
import { ParentSelect, SprintSelect, StatusSelect, UserSelect, epicOf } from '../components/fields';
import { DateCell, NumCell, TextCell } from '../components/cells';
import { isLate, isLeaf, rolled } from '../hours';

export function Grid() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items, sprints } = app;
  const [showDone, setShowDone] = useState(false);
  const [byEpic, setByEpic] = useState(true);
  const [typeSel, setTypeSel] = useState<'work' | ItemType>('work');
  const [sprintSel, setSprintSel] = useState('');
  const [newType, setNewType] = useState<ItemType>('story');
  const [newTitle, setNewTitle] = useState('');

  const rows = useMemo(
    () =>
      items.filter((i) => {
        if (typeSel === 'work' ? i.type === 'epic' : i.type !== typeSel) return false;
        if (!showDone && i.status === 'done') return false;
        if (sprintSel === 'backlog' ? !!i.sprint_id : sprintSel && i.sprint_id !== sprintSel) return false;
        return true;
      }),
    [items, typeSel, showDone, sprintSel],
  );

  const groups = useMemo(() => {
    if (!byEpic || typeSel === 'epic') return [{ epic: null as Item | null, rows }];
    const map = new Map<string, { epic: Item | null; rows: Item[] }>();
    for (const r of rows) {
      const ep = epicOf(items, r);
      const k = ep?.id ?? '-';
      if (!map.has(k)) map.set(k, { epic: ep, rows: [] });
      map.get(k)!.rows.push(r);
    }
    return [...map.values()].sort((a, b) => (a.epic ? a.epic.position : 1e12) - (b.epic ? b.epic.position : 1e12));
  }, [rows, byEpic, typeSel, items]);

  const leaves = rows.filter((r) => isLeaf(items, r));
  const sumScope = leaves.reduce((a, r) => a + (r.scope_hours ?? 0), 0);
  const sumActual = leaves.reduce((a, r) => a + (r.actual_hours ?? 0), 0);
  const sumPts = rows.reduce((a, r) => a + (r.type !== 'task' ? r.points ?? 0 : 0), 0);
  const over = rows.filter((r) => {
    const h = rolled(items, r);
    return h.scope && h.actual !== null && h.actual / h.scope > 1.2;
  }).length;

  const save = (id: string, patch: Partial<Item>) => app.saveItem(id, patch);

  const addRow = async (e: Event) => {
    e.preventDefault();
    if (!newTitle.trim()) return;
    try {
      await api.post(`/projects/${project!.id}/items`, {
        type: newType,
        title: newTitle,
        sprint_id: newType !== 'epic' && sprintSel && sprintSel !== 'backlog' ? sprintSel : null,
      });
      setNewTitle('');
      await app.reloadProject();
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };

  const row = (r: Item) => {
    const h = rolled(items, r);
    const lockedActual = r.status === 'done' && app.me.role === 'member';
    return (
      <tr key={r.id}>
        <td class="k">
          <a href={`#/p/${project!.key}/i/${r.key}`}>{r.key}</a>
        </td>
        <td style={{ textAlign: 'center' }}>
          <TypeBadge type={r.type} />
        </td>
        <td>
          <TextCell cls="cell title" value={r.title} onCommit={(v) => save(r.id, { title: v })} />
        </td>
        <td>{r.type === 'epic' ? <span class="faint">—</span> : <ParentSelect cls="cell c-parent" type={r.type} value={r.parent_id} selfId={r.id} onChange={(v) => save(r.id, { parent_id: v })} />}</td>
        <td>{r.type === 'epic' ? <span class="faint">—</span> : <SprintSelect cls="cell c-sprint" value={r.sprint_id} onChange={(v) => save(r.id, { sprint_id: v })} />}</td>
        <td>
          <StatusSelect cls="cell c-status" value={r.status} onChange={(v) => save(r.id, { status: v as Item['status'] })} />
        </td>
        <td>
          <UserSelect cls="cell c-user" value={r.assignee_id} onChange={(v) => save(r.id, { assignee_id: v })} />
        </td>
        <td class="r">{r.type === 'task' ? <span class="faint">·</span> : <NumCell value={r.points} onCommit={(v) => save(r.id, { points: v })} />}</td>
        <td>
          <DateCell value={r.due_date} late={isLate(r)} onCommit={(v) => save(r.id, { due_date: v })} />
        </td>
        <td class="r">
          {h.rolled ? (
            <span class="mono" title={t('rollup_note')} style={{ paddingRight: '8px' }}>{fmtNum(h.scope, lang)}</span>
          ) : (
            <NumCell value={r.scope_hours} onCommit={(v) => save(r.id, { scope_hours: v })} />
          )}
        </td>
        <td class="r">
          {h.rolled ? (
            <span class="mono" title={t('rollup_note')} style={{ paddingRight: '8px' }}>{fmtNum(h.actual, lang)}</span>
          ) : (
            <NumCell value={r.actual_hours} disabled={lockedActual} title={lockedActual ? t('actual_locked_hint') : undefined} onCommit={(v) => save(r.id, { actual_hours: v })} />
          )}
        </td>
        <td class="r" style={{ paddingRight: '10px' }}>
          <VarChip scope={h.scope} actual={h.actual} show={r.status === 'done' || r.status === 'in_review'} />
        </td>
      </tr>
    );
  };

  return (
    <>
      <div class="tb">
        <h2>{t('grid')}</h2>
        <span class="meta">
          {rows.length} {t('rows').toLowerCase()}
        </span>
        <div class="row sp">
          <select id="grid-type" class="select" value={typeSel} onChange={(e) => setTypeSel(e.currentTarget.value as never)} aria-label={t('types')}>
            <option value="work">
              {t('ty_story')} · {t('ty_bug')} · {t('ty_task')}
            </option>
            {TYPES.map((ty) => (
              <option value={ty}>{t(`ty_${ty}` as never)}</option>
            ))}
          </select>
          <select id="grid-sprint" class="select" value={sprintSel} onChange={(e) => setSprintSel(e.currentTarget.value)} aria-label={t('f_sprint')}>
            <option value="">
              {t('f_sprint')}: {t('all')}
            </option>
            {sprints.map((s) => (
              <option value={s.id}>{s.name}</option>
            ))}
            <option value="backlog">{t('backlog')}</option>
          </select>
          <label class="chk">
            <input type="checkbox" checked={byEpic} onChange={(e) => setByEpic(e.currentTarget.checked)} />
            {t('group_by_epic')}
          </label>
          <label class="chk">
            <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.currentTarget.checked)} />
            {t('show_done')}
          </label>
        </div>
      </div>
      <div class="grid-wrap">
        <table class="sheet">
          <thead>
            <tr>
              <th>{t('f_key')}</th>
              <th>T</th>
              <th>{t('f_title')}</th>
              <th>{t('f_parent')}</th>
              <th>{t('f_sprint')}</th>
              <th>{t('f_status')}</th>
              <th>{t('f_assignee')}</th>
              <th class="r">{t('f_points')}</th>
              <th>{t('f_due')}</th>
              <th class="r">{t('f_scope_short')}</th>
              <th class="r">{t('f_actual_short')}</th>
              <th class="r">{t('f_var')}</th>
            </tr>
          </thead>
          <tbody>
            {groups.map((g) => (
              <>
                {byEpic && typeSel !== 'epic' && (
                  <tr class="grp">
                    <td colSpan={12} class="grpc">
                      {g.epic ? g.epic.title : t('no_epic')}
                      {g.epic && <span class="key">{g.epic.key}</span>}
                      <span class="key">· {g.rows.length}</span>
                    </td>
                  </tr>
                )}
                {g.rows.map(row)}
              </>
            ))}
          </tbody>
        </table>
        <form class="addrow" onSubmit={addRow}>
          <select id="grid-new-type" class="select" value={newType} onChange={(e) => setNewType(e.currentTarget.value as ItemType)}>
            {TYPES.map((ty) => (
              <option value={ty}>{t(`ty_${ty}` as never)}</option>
            ))}
          </select>
          <input id="grid-new-title" class="input" placeholder={t('quick_add_ph')} value={newTitle} onInput={(e) => setNewTitle(e.currentTarget.value)} />
          <button class="btn" disabled={!newTitle.trim()}>{t('add_row')}</button>
        </form>
        <div class="sumbar">
          <span>
            {t('rows')} <b>{rows.length}</b>
          </span>
          <span>
            {t('sum_points')} <b>{fmtNum(sumPts, lang)}</b>
          </span>
          <span>
            {t('sum_scope')} <b>{fmtNum(sumScope, lang)}h</b>
          </span>
          <span>
            {t('sum_actual')} <b>{fmtNum(sumActual, lang)}h</b>
          </span>
          <span>
            {t('over20')} <b style={{ color: over ? 'var(--bad)' : undefined }}>{over}</b>
          </span>
        </div>
      </div>
    </>
  );
}
