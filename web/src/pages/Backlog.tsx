import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError, type Capacity, type Item } from '../api';
import { fmtNum, useT } from '../i18n';
import { useApp, userById } from '../state';
import { Avatar, Icon, StatusLabel, TypeBadge } from '../components/ui';
import { NewItemModal, epicOf } from '../components/fields';
import { NumCell } from '../components/cells';
import { isLeaf } from '../hours';

export function Backlog() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items, sprints, users } = app;
  const canManage = app.me.role !== 'member';
  const open = sprints.filter((s) => s.status !== 'closed');
  const [target, setTarget] = useState<string>(() => (open.find((s) => s.status === 'planned') ?? open[0])?.id ?? '');
  const [cap, setCap] = useState<Capacity[]>([]);
  const [modal, setModal] = useState(false);
  const [q, setQ] = useState('');

  useEffect(() => {
    if (!open.some((s) => s.id === target)) setTarget((open.find((s) => s.status === 'planned') ?? open[0])?.id ?? '');
  }, [sprints.length]);
  useEffect(() => {
    if (target) api.get<Capacity[]>(`/sprints/${target}/capacity`).then(setCap).catch(() => setCap([]));
  }, [target]);

  const backlog = useMemo(
    () =>
      items
        .filter((i) => !i.sprint_id && i.type !== 'epic' && i.type !== 'task' && i.status !== 'done')
        .filter((i) => !q || (i.key + ' ' + i.title).toLowerCase().includes(q.toLowerCase()))
        .sort((a, b) => a.position - b.position),
    [items, q],
  );
  const inSprint = items.filter((i) => i.sprint_id === target && i.type !== 'task');
  const sprintTasks = items.filter((i) => i.sprint_id === target);
  const leaves = sprintTasks.filter((i) => isLeaf(items, i));
  const sp = sprints.find((s) => s.id === target);

  /** Move a story/bug and its tasks together. */
  const move = async (it: Item, sprintId: string | null) => {
    await app.saveItem(it.id, { sprint_id: sprintId });
    for (const k of items.filter((x) => x.parent_id === it.id && x.type === 'task' && x.status !== 'done')) await app.saveItem(k.id, { sprint_id: sprintId });
  };
  const reorder = async (it: Item, dir: -1 | 1) => {
    const idx = backlog.findIndex((x) => x.id === it.id);
    const other = backlog[idx + dir];
    if (!other) return;
    await app.saveItem(it.id, { position: other.position });
    await app.saveItem(other.id, { position: it.position });
  };
  const saveCap = async (userId: string, hours: number | null) => {
    const next = [...cap.filter((c) => c.user_id !== userId), ...(hours ? [{ user_id: userId, hours }] : [])];
    setCap(next);
    try {
      await api.put(`/sprints/${target}/capacity`, { entries: next });
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };

  const pts = inSprint.filter((i) => i.type !== 'epic').reduce((a, i) => a + (i.points ?? 0), 0);
  const plannedH = leaves.reduce((a, i) => a + (i.scope_hours ?? 0), 0);
  const capH = cap.reduce((a, c) => a + c.hours, 0);

  const row = (it: Item, inS: boolean) => {
    const ep = epicOf(items, it);
    const idx = backlog.findIndex((x) => x.id === it.id);
    return (
      <div class="plan-row">
        <TypeBadge type={it.type} />
        <span class="key">{it.key}</span>
        <a href={`#/p/${project!.key}/i/${it.key}`} title={ep ? ep.title : ''}>
          {it.title}
          {ep && <span class="key"> · {ep.title}</span>}
        </a>
        <span class="pts">{it.points !== null ? fmtNum(it.points, lang) : '–'}</span>
        <Avatar user={userById(users, it.assignee_id)} />
        <span class="row" style={{ gap: '4px', flexWrap: 'nowrap' }}>
          {inS ? (
            <>
              <StatusLabel s={it.status} />
              <button class="btn sm" onClick={() => move(it, null)} title={t('to_backlog')}>
                ←
              </button>
            </>
          ) : (
            <>
              <button class="btn sm ghost" disabled={idx === 0} onClick={() => reorder(it, -1)} aria-label="Up">↑</button>
              <button class="btn sm ghost" disabled={idx === backlog.length - 1} onClick={() => reorder(it, 1)} aria-label="Down">↓</button>
              <button class="btn sm" disabled={!target} onClick={() => move(it, target)} title={sp?.name}>
                →
              </button>
            </>
          )}
        </span>
      </div>
    );
  };

  return (
    <>
      <div class="tb">
        <h2>{t('backlog')}</h2>
        <span class="meta">{t('backlog_lede')}</span>
        <div class="row sp">
          <input id="backlog-q" class="input" style={{ width: '200px' }} placeholder={t('filter_ph')} value={q} onInput={(e) => setQ(e.currentTarget.value)} />
          <button class="btn solid" onClick={() => setModal(true)}>
            <Icon name="plus" />
            {t('new_item')}
          </button>
        </div>
      </div>
      <div class="plan">
        <section class="plan-list">
          <div class="plan-h">
            <h3>{t('backlog')}</h3>
            <span class="key">
              {backlog.length} · {fmtNum(backlog.reduce((a, i) => a + (i.points ?? 0), 0), lang)} pts
            </span>
          </div>
          {backlog.map((i) => row(i, false))}
          {!backlog.length && <div class="empty">{t('empty_col')}</div>}
        </section>
        <section class="plan-list">
          <div class="plan-h">
            {open.length ? (
              <select id="backlog-target" class="select" style={{ width: 'auto', fontWeight: 600 }} value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
                {open.map((s) => (
                  <option value={s.id}>
                    {s.name} · {t(`sp_${s.status}` as never)}
                  </option>
                ))}
              </select>
            ) : (
              <span class="hint">
                {t('no_open_sprint')}{' '}
                <a href={`#/p/${project!.key}/sprints`}>{t('new_sprint')}</a>
              </span>
            )}
            {sp && (
              <span class="key">
                {inSprint.length} · {fmtNum(pts, lang)} pts · {fmtNum(plannedH, lang)} / {capH ? fmtNum(capH, lang) : '—'}h
              </span>
            )}
          </div>
          {sp && (
            <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--hair)' }}>
              <div class="sec-h">{t('capacity')} · {t('capacity_hint')}</div>
              <table class="cap">
                <thead>
                  <tr>
                    <th>{t('f_assignee')}</th>
                    <th>{t('capacity')}</th>
                    <th>{t('planned')}</th>
                    <th>Load</th>
                  </tr>
                </thead>
                <tbody>
                  {users
                    .filter((u) => u.active)
                    .map((u) => {
                      const c = cap.find((x) => x.user_id === u.id)?.hours ?? null;
                      const p = leaves.filter((i) => i.assignee_id === u.id).reduce((a, i) => a + (i.scope_hours ?? 0), 0);
                      const load = c ? Math.round((p / c) * 100) : null;
                      return (
                        <tr>
                          <td>
                            <span class="row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
                              <Avatar user={u} />
                              {u.name}
                            </span>
                          </td>
                          <td>{canManage ? <NumCell value={c} onCommit={(v) => saveCap(u.id, v)} /> : c !== null ? fmtNum(c, lang) + 'h' : '—'}</td>
                          <td>{fmtNum(p, lang)}h</td>
                          <td class={load !== null && load > 105 ? 'bad' : ''}>{load !== null ? `${load}%` : '—'}</td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          )}
          {inSprint.map((i) => row(i, true))}
          {sp && !inSprint.length && <div class="empty">{t('plan_empty')}</div>}
        </section>
      </div>
      {modal && <NewItemModal onClose={() => setModal(false)} />}
    </>
  );
}
