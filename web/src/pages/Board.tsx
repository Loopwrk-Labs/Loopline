import { useEffect, useMemo, useState } from 'preact/hooks';
import { api, ApiError, STATUSES, type Item, type Status } from '../api';
import { fmtNum, useT } from '../i18n';
import { go, useApp, userById } from '../state';
import { Avatar, Icon, StatusLabel, TypeBadge } from '../components/ui';
import { NewItemModal, epicOf } from '../components/fields';

const OLD_DONE_MS = 14 * 86400_000;

function readPref(k: string, d: string) {
  try {
    return localStorage.getItem(k) ?? d;
  } catch {
    return d;
  }
}
function writePref(k: string, v: string) {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
}

export function Board() {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items, sprints, users } = app;
  const active = sprints.find((s) => s.status === 'active');
  const [sprintSel, setSprintSel] = useState<string>(() => readPref(`ll:board:${project!.id}`, '') || active?.id || 'open');
  const [who, setWho] = useState('');
  const [hideOld, setHideOld] = useState(true);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overCol, setOverCol] = useState<Status | null>(null);
  const [quick, setQuick] = useState('');
  const [modal, setModal] = useState(false);

  useEffect(() => {
    if (sprintSel !== 'open' && sprintSel !== 'backlog' && !sprints.some((s) => s.id === sprintSel)) setSprintSel(active?.id ?? 'open');
  }, [sprints.length, active?.id]);
  useEffect(() => writePref(`ll:board:${project!.id}`, sprintSel), [sprintSel]);

  const shown = useMemo(() => {
    const now = Date.now();
    return items.filter((i) => {
      if (i.type === 'epic') return false;
      if (sprintSel === 'backlog' && i.sprint_id) return false;
      if (sprintSel !== 'open' && sprintSel !== 'backlog' && i.sprint_id !== sprintSel) return false;
      if (who === '-' ? i.assignee_id : who && i.assignee_id !== who) return false;
      if (hideOld && i.status === 'done' && i.done_at && now - i.done_at > OLD_DONE_MS) return false;
      return true;
    });
  }, [items, sprintSel, who, hideOld]);

  const sel = sprints.find((s) => s.id === sprintSel);
  const realSprint = sel && sel.status !== 'closed' ? sel.id : null;

  const drop = (status: Status) => {
    setOverCol(null);
    const it = items.find((x) => x.id === dragId);
    setDragId(null);
    if (it && it.status !== status) app.saveItem(it.id, { status });
  };

  const addQuick = async (e: Event) => {
    e.preventDefault();
    const title = quick.trim();
    if (!title) return;
    try {
      await api.post(`/projects/${project!.id}/items`, { type: 'story', title, sprint_id: realSprint, assignee_id: who && who !== '-' ? who : null });
      setQuick('');
      await app.reloadProject();
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };

  return (
    <>
      <div class="tb">
        <h2>{sel ? sel.name : sprintSel === 'backlog' ? t('backlog') : t('open_work')}</h2>
        {sel?.goal && <span class="meta">{sel.goal}</span>}
        <div class="row sp">
          <select id="board-sprint" class="select" value={sprintSel} onChange={(e) => setSprintSel(e.currentTarget.value)} aria-label={t('sprint_filter')}>
            <option value="open">{t('open_work')}</option>
            {sprints
              .filter((s) => s.status !== 'closed')
              .map((s) => (
                <option value={s.id}>
                  {s.name}
                  {s.status === 'active' ? ' ●' : ''}
                </option>
              ))}
            <option value="backlog">{t('backlog')}</option>
          </select>
          <select id="board-who" class="select" value={who} onChange={(e) => setWho(e.currentTarget.value)} aria-label={t('assignee_filter')}>
            <option value="">{t('assignee_filter')}: {t('all')}</option>
            <option value="-">{t('unassigned')}</option>
            {users
              .filter((u) => u.active)
              .map((u) => (
                <option value={u.id}>{u.name}</option>
              ))}
          </select>
          <label class="chk">
            <input type="checkbox" checked={hideOld} onChange={(e) => setHideOld(e.currentTarget.checked)} />
            {t('hide_done')}
          </label>
          <button class="btn solid" onClick={() => setModal(true)}>
            <Icon name="plus" />
            {t('new_item')}
          </button>
        </div>
      </div>
      <div class="cols">
        {STATUSES.map((st) => {
          const list = shown.filter((i) => i.status === st);
          const pts = list.reduce((a, i) => a + (i.type !== 'task' ? i.points ?? 0 : 0), 0);
          return (
            <section
              class={'col' + (overCol === st ? ' over' : '')}
              onDragOver={(e) => {
                e.preventDefault();
                setOverCol(st);
              }}
              onDragLeave={() => setOverCol((c) => (c === st ? null : c))}
              onDrop={(e) => {
                e.preventDefault();
                drop(st);
              }}
              aria-label={t(`st_${st}` as never)}
            >
              <div class="col-h">
                <StatusLabel s={st} />
                <span class="c">
                  {list.length} · {fmtNum(pts, lang)} pts
                </span>
              </div>
              <div class="col-b">
                {list.map((i) => {
                  const ep = epicOf(items, i);
                  return (
                    <button
                      class={'card' + (i.status === 'blocked' ? ' blocked' : '') + (dragId === i.id ? ' dragging' : '')}
                      draggable
                      onDragStart={(e) => {
                        setDragId(i.id);
                        e.dataTransfer?.setData('text/plain', i.id);
                      }}
                      onDragEnd={() => setDragId(null)}
                      onClick={() => go(`p/${project!.key}/i/${i.key}`)}
                    >
                      <span class="rw">
                        <TypeBadge type={i.type} />
                        <span class="key">{i.key}</span>
                        {(i.actual_hours !== null || i.scope_hours !== null) && (
                          <span class="r hrs">
                            {fmtNum(i.actual_hours ?? 0, lang)}/{fmtNum(i.scope_hours, lang)}h
                          </span>
                        )}
                      </span>
                      <span class="t">{i.title}</span>
                      <span class="rw">
                        {ep ? <span class="ep-tag">{ep.title}</span> : <span />}
                        <span class="r">
                          {i.points !== null && <span class="pts">{fmtNum(i.points, lang)}</span>}
                          <Avatar user={userById(users, i.assignee_id)} />
                        </span>
                      </span>
                    </button>
                  );
                })}
                {st === 'todo' && (
                  <form class="quick" onSubmit={addQuick}>
                    <input id="board-quick" class="input" placeholder={t('quick_add_ph')} value={quick} onInput={(e) => setQuick(e.currentTarget.value)} />
                  </form>
                )}
                {list.length === 0 && st !== 'todo' && <span class="key" style={{ padding: '6px 2px' }}>{t('empty_col')}</span>}
              </div>
            </section>
          );
        })}
      </div>
      {modal && <NewItemModal onClose={() => setModal(false)} defaults={{ sprint_id: realSprint }} />}
    </>
  );
}
