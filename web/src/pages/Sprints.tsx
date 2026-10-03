import { useState } from 'preact/hooks';
import { api, ApiError, type Sprint } from '../api';
import { fmtDate, fmtNum, useT } from '../i18n';
import { go, useApp } from '../state';
import { Icon, Modal } from '../components/ui';

export function Sprints() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, sprints } = app;
  const canManage = app.me.role !== 'member';
  const [edit, setEdit] = useState<Partial<Sprint> | null>(null);
  const [closing, setClosing] = useState<Sprint | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [err, setErr] = useState('');

  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      await app.reloadProject();
      return true;
    } catch (x) {
      const m = x instanceof ApiError ? x.message : 'Network error.';
      setErr(m);
      app.toast(m, 'err');
      return false;
    }
  };

  const saveSprint = async (e: Event) => {
    e.preventDefault();
    const s = edit!;
    const data = { name: s.name, goal: s.goal ?? null, start_date: s.start_date || null, end_date: s.end_date || null };
    const ok = await run(() => (s.id ? api.patch(`/sprints/${s.id}`, data) : api.post(`/projects/${project!.id}/sprints`, data)));
    if (ok) setEdit(null);
  };

  const nextName = () => {
    const nums = sprints.map((s) => Number(s.name.match(/(\d+)\s*$/)?.[1] ?? 0));
    return `Sprint ${Math.max(0, ...nums) + 1}`;
  };

  const statusTag = (s: Sprint) => <span class={'tag' + (s.status === 'active' ? ' on' : '')}>{t(`sp_${s.status}` as never)}</span>;

  return (
    <>
      <div class="tb">
        <h2>{t('sprints')}</h2>
        <div class="row sp">
          {canManage && (
            <button class="btn solid" onClick={() => setEdit({ name: nextName() })}>
              <Icon name="plus" />
              {t('new_sprint')}
            </button>
          )}
        </div>
      </div>
      {sprints.length === 0 ? (
        <div class="empty">{t('empty_col')}</div>
      ) : (
        <div class="list">
          {sprints.map((s) => {
            const pct = s.points ? Math.round((s.done_points / s.points) * 100) : 0;
            return (
              <div class="list-row">
                {statusTag(s)}
                <a class="main-t" href={`#/p/${project!.key}/board`} onClick={() => { try { localStorage.setItem(`ll:board:${project!.id}`, s.id); } catch { /* ignore */ } }} style={{ textDecoration: 'none' }}>
                  {s.name}
                </a>
                <span class="key">
                  {fmtDate(s.start_date)} → {fmtDate(s.end_date)}
                </span>
                {s.goal && <span class="muted" style={{ fontSize: '.82rem' }}>{s.goal}</span>}
                <span class="sp">
                  <span class="key">
                    {s.done_count}/{s.item_count} {t('items_done')} · {fmtNum(s.done_points, lang)}/{fmtNum(s.points, lang)} pts
                  </span>
                  <span class="progress">
                    <i style={{ width: `${pct}%` }} />
                  </span>
                  {canManage && s.status !== 'closed' && (
                    <button class="btn sm" onClick={() => setEdit(s)}>
                      {t('edit')}
                    </button>
                  )}
                  {canManage && s.status === 'planned' && (
                    <button class="btn sm solid" onClick={() => run(() => api.post(`/sprints/${s.id}/start`))}>
                      {t('start_sprint')}
                    </button>
                  )}
                  {canManage && s.status === 'active' && (
                    <button
                      class="btn sm"
                      onClick={() => {
                        setMoveTo(sprints.find((x) => x.status === 'planned')?.id ?? '');
                        setClosing(s);
                      }}
                    >
                      {t('close_sprint')}
                    </button>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {edit && (
        <Modal
          title={edit.id ? edit.name ?? '' : t('new_sprint')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" form="sprint-form">{t('save')}</button>
            </>
          }
        >
          <form id="sprint-form" class="form" onSubmit={saveSprint}>
            <label class="field">
              <span class="label">{t('sprint_name')}</span>
              <input id="sprint-name" class="input" required value={edit.name ?? ''} onInput={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('goal')}</span>
              <input id="sprint-goal" class="input" value={edit.goal ?? ''} onInput={(e) => setEdit({ ...edit, goal: e.currentTarget.value })} />
            </label>
            <div class="two">
              <label class="field">
                <span class="label">{t('start_date')}</span>
                <input id="sprint-start" class="input" type="date" value={edit.start_date ?? ''} onInput={(e) => setEdit({ ...edit, start_date: e.currentTarget.value })} />
              </label>
              <label class="field">
                <span class="label">{t('end_date')}</span>
                <input id="sprint-end" class="input" type="date" value={edit.end_date ?? ''} onInput={(e) => setEdit({ ...edit, end_date: e.currentTarget.value })} />
              </label>
            </div>
            {err && <div class="err">{err}</div>}
          </form>
        </Modal>
      )}

      {closing && (
        <Modal
          title={`${t('close_sprint')}: ${closing.name}`}
          onClose={() => setClosing(null)}
          footer={
            <>
              <button class="btn" onClick={() => setClosing(null)}>{t('cancel')}</button>
              <button
                class="btn solid"
                onClick={async () => {
                  if (await run(() => api.post(`/sprints/${closing.id}/close`, { moveTo: moveTo || null }))) {
                    setClosing(null);
                    if (moveTo) go(`p/${project!.key}/sprints`);
                  }
                }}
              >
                {t('close_sprint')}
              </button>
            </>
          }
        >
          <div class="form">
            <p class="muted" style={{ margin: 0 }}>{t('close_sprint_lede')}</p>
            <label class="field">
              <span class="label">{t('move_unfinished')}</span>
              <select id="close-move" class="select" value={moveTo} onChange={(e) => setMoveTo(e.currentTarget.value)}>
                <option value="">{t('to_backlog')}</option>
                {sprints
                  .filter((s) => s.status === 'planned')
                  .map((s) => (
                    <option value={s.id}>{s.name}</option>
                  ))}
              </select>
            </label>
            {err && <div class="err">{err}</div>}
          </div>
        </Modal>
      )}
    </>
  );
}
