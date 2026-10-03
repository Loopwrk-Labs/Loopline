import { useEffect, useRef, useState } from 'preact/hooks';
import { api, ApiError, type Item, type LogEntry } from '../api';
import { fmtNum, useT } from '../i18n';
import { go, useApp, userById } from '../state';
import { Avatar, Icon, StatusLabel, TypeBadge, VarChip } from '../components/ui';
import { NewItemModal, ParentSelect, SprintSelect, StatusSelect, UserSelect, epicOf } from '../components/fields';
import { DateCell, NumCell, TextCell } from '../components/cells';
import { Entry } from '../components/LogEntry';
import { isLate, rolled } from '../hours';

export function ItemPage({ itemKey }: { itemKey: string }) {
  const app = useApp();
  const { t, lang } = useT();
  const { project, items, users } = app;
  const it = items.find((i) => i.key === itemKey.toUpperCase());
  const [log, setLog] = useState<LogEntry[]>([]);
  const [tab, setTab] = useState<'all' | 'note' | 'change'>('all');
  const [draft, setDraft] = useState('');
  const [desc, setDesc] = useState('');
  const [modal, setModal] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  const loadLog = async () => {
    if (!it) return;
    setLog(await api.get<LogEntry[]>(`/items/${it.id}/logbook`));
  };
  useEffect(() => {
    loadLog();
  }, [it?.id, it?.updated_at]);
  useEffect(() => setDesc(it?.description ?? ''), [it?.id, it?.description]);
  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [log.length, tab]);

  if (!it) return <div class="empty">{items.length ? '404' : t('loading')}</div>;

  const save = async (patch: Partial<Item>) => {
    await app.saveItem(it.id, patch);
  };
  const ep = epicOf(items, it);
  const parent = it.parent_id ? items.find((i) => i.id === it.parent_id) : null;
  const kids = items.filter((i) => i.parent_id === it.id);
  const h = rolled(items, it);
  const lockedActual = it.status === 'done' && app.me.role === 'member';
  const pinned = log.filter((e) => e.pinned);
  const shown = (tab === 'all' ? log : log.filter((e) => e.kind === tab)).filter((e) => !e.pinned || tab === 'change');

  const addEntry = async () => {
    const body = draft.trim();
    if (!body) return;
    try {
      await api.post(`/items/${it.id}/logbook`, { body });
      setDraft('');
      loadLog();
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };
  const pin = async (e: LogEntry) => {
    await api.patch(`/logbook/${e.id}`, { pinned: !e.pinned });
    loadLog();
  };
  const archive = async () => {
    if (!window.confirm(t('confirm_archive'))) return;
    try {
      await api.del(`/items/${it.id}`);
      await app.reloadProject();
      go(`p/${project!.key}/board`);
    } catch (x) {
      app.toast(x instanceof ApiError ? x.message : 'Network error.', 'err');
    }
  };

  return (
    <div class="detail">
      <div class="d-left">
        <div>
          <div class="d-path">
            <a href={`#/p/${project!.key}/board`}>← {t('board')}</a>
            <span>/</span>
            {ep && ep.id !== it.id && (
              <>
                <TypeBadge type="epic" />
                <a href={`#/p/${project!.key}/i/${ep.key}`}>
                  {ep.key} {ep.title}
                </a>
                <span>/</span>
              </>
            )}
            {parent && parent.type !== 'epic' && (
              <>
                <TypeBadge type={parent.type} />
                <a href={`#/p/${project!.key}/i/${parent.key}`}>{parent.key}</a>
                <span>/</span>
              </>
            )}
            <TypeBadge type={it.type} />
            <span>{it.key}</span>
            <span style={{ marginLeft: 'auto' }}>
              <button class="btn ghost sm danger" onClick={archive}>
                {t('archive')}
              </button>
            </span>
          </div>
          <TextCell cls="d-title" value={it.title} onCommit={(v) => save({ title: v })} id="item-title" />
        </div>

        <div class="fields">
          <div>
            <span class="label">{t('f_status')}</span>
            <StatusSelect id="item-status" value={it.status} onChange={(v) => save({ status: v as Item['status'] })} />
          </div>
          <div>
            <span class="label">{t('f_assignee')}</span>
            <UserSelect id="item-assignee" value={it.assignee_id} onChange={(v) => save({ assignee_id: v })} />
          </div>
          <div>
            <span class="label">{t('f_sprint')}</span>
            {it.type === 'epic' ? <span class="faint">—</span> : <SprintSelect id="item-sprint" value={it.sprint_id} onChange={(v) => save({ sprint_id: v })} />}
          </div>
          <div>
            <span class="label">{t('f_points')}</span>
            {it.type === 'task' ? <span class="faint">—</span> : <NumCell id="item-points" value={it.points} onCommit={(v) => save({ points: v })} />}
          </div>
          <div>
            <span class="label">{t('f_due')}</span>
            <DateCell id="item-due" value={it.due_date} late={isLate(it)} onCommit={(v) => save({ due_date: v })} />
          </div>
          <div>
            <span class="label">
              {t('f_scope')}
              {it.scope_baseline !== null && !h.rolled && <span class="lock" title={`${t('baseline')}: ${fmtNum(it.scope_baseline, lang)}h`}>{t('baseline')} {fmtNum(it.scope_baseline, lang)}</span>}
            </span>
            {h.rolled ? (
              <span class="mono" title={t('rollup_note')}>
                {fmtNum(h.scope, lang)}h <span class="faint">Σ</span>
              </span>
            ) : (
              <NumCell id="item-scope" value={it.scope_hours} onCommit={(v) => save({ scope_hours: v })} />
            )}
          </div>
          <div>
            <span class="label">
              {t('f_actual')}
              {lockedActual && <span class="lock">{t('locked')}</span>}
            </span>
            <span class="row" style={{ gap: '6px', flexWrap: 'nowrap' }}>
              {h.rolled ? (
                <span class="mono" title={t('rollup_note')}>
                  {fmtNum(h.actual, lang)}h <span class="faint">Σ</span>
                </span>
              ) : (
                <NumCell id="item-actual" value={it.actual_hours} disabled={lockedActual} title={lockedActual ? t('actual_locked_hint') : undefined} onCommit={(v) => save({ actual_hours: v })} />
              )}
              <VarChip scope={h.scope} actual={h.actual} show />
            </span>
          </div>
          <div>
            <span class="label">{it.type === 'task' ? t('f_parent') : t('f_epic')}</span>
            {it.type === 'epic' ? (
              <label class="chk">
                <input type="checkbox" checked={!!it.billable} onChange={(e) => save({ billable: e.currentTarget.checked ? 1 : 0 })} />
                {t('f_billable')}
              </label>
            ) : (
              <ParentSelect id="item-parent" type={it.type} value={it.parent_id} selfId={it.id} onChange={(v) => save({ parent_id: v })} />
            )}
          </div>
        </div>

        <div>
          <div class="sec-h">{t('f_description')}</div>
          <textarea
            id="item-desc"
            class="textarea"
            value={desc}
            onInput={(e) => setDesc(e.currentTarget.value)}
            onBlur={() => desc !== it.description && save({ description: desc })}
          />
        </div>

        {it.type !== 'task' && (
          <div>
            <div class="sec-h">
              {it.type === 'epic' ? t('children') : t('tasks')} · {kids.filter((k) => k.status === 'done').length}/{kids.length}
              <button class="btn sm" style={{ marginLeft: 'auto' }} onClick={() => setModal(true)}>
                <Icon name="plus" />
                {it.type === 'epic' ? t('new_item') : t('add_task')}
              </button>
            </div>
            {kids.length > 0 && (
              <div class="subs">
                {kids.map((k) => {
                  const kh = rolled(items, k);
                  return (
                    <div class="sub">
                      <TypeBadge type={k.type} />
                      <span class="key">{k.key}</span>
                      <a href={`#/p/${project!.key}/i/${k.key}`}>{k.title}</a>
                      <span class="hrs">
                        {fmtNum(kh.actual ?? 0, lang)} / {fmtNum(kh.scope, lang)}h
                      </span>
                      <StatusLabel s={k.status} />
                      <Avatar user={userById(users, k.assignee_id)} />
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      <aside class="log" aria-label={t('logbook')}>
        <div class="log-h">
          <b>{t('logbook')}</b>
          <span class="log-tabs">
            <button aria-pressed={tab === 'all'} onClick={() => setTab('all')}>
              {t('log_all')} {log.length}
            </button>
            <button aria-pressed={tab === 'note'} onClick={() => setTab('note')}>
              {t('log_notes')} {log.filter((e) => e.kind === 'note').length}
            </button>
            <button aria-pressed={tab === 'change'} onClick={() => setTab('change')}>
              {t('log_changes')} {log.filter((e) => e.kind === 'change').length}
            </button>
          </span>
        </div>
        <div class="log-b" ref={logRef}>
          {tab !== 'change' && pinned.map((e) => <Entry e={e} onPin={pin} />)}
          {shown.map((e) => (
            <Entry e={e} onPin={e.kind === 'note' ? pin : undefined} />
          ))}
        </div>
        <div class="log-in">
          <textarea
            id="log-draft"
            class="textarea"
            placeholder={t('write_entry')}
            value={draft}
            onInput={(e) => setDraft(e.currentTarget.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                addEntry();
              }
            }}
          />
          <div class="row">
            <span>{t('stamped')}</span>
            <button class="btn solid sm" onClick={addEntry} disabled={!draft.trim()}>
              {t('add_entry')} ⌘↵
            </button>
          </div>
        </div>
      </aside>
      {modal && (
        <NewItemModal
          onClose={() => setModal(false)}
          defaults={{ type: it.type === 'epic' ? 'story' : 'task', parent_id: it.id, sprint_id: it.type === 'epic' ? null : it.sprint_id, assignee_id: it.type === 'epic' ? null : it.assignee_id }}
        />
      )}
    </div>
  );
}
