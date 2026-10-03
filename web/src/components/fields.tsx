import { useState } from 'preact/hooks';
import { api, ApiError, STATUSES, TYPES, type Item, type ItemType } from '../api';
import { useT } from '../i18n';
import { useApp } from '../state';
import { Modal } from './ui';

export function StatusSelect({ value, onChange, cls = 'cell', id }: { value: string; onChange: (v: string) => void; cls?: string; id?: string }) {
  const { t } = useT();
  return (
    <select id={id} class={cls} value={value} onChange={(e) => onChange(e.currentTarget.value)}>
      {STATUSES.map((s) => (
        <option value={s}>{t(`st_${s}` as never)}</option>
      ))}
    </select>
  );
}

export function UserSelect({ value, onChange, cls = 'cell', id }: { value: string | null; onChange: (v: string | null) => void; cls?: string; id?: string }) {
  const { t } = useT();
  const { users } = useApp();
  return (
    <select id={id} class={cls} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
      <option value="">{t('unassigned')}</option>
      {users
        .filter((u) => u.active || u.id === value)
        .map((u) => (
          <option value={u.id}>{u.name}</option>
        ))}
    </select>
  );
}

export function SprintSelect({ value, onChange, cls = 'cell', id }: { value: string | null; onChange: (v: string | null) => void; cls?: string; id?: string }) {
  const { t } = useT();
  const { sprints } = useApp();
  return (
    <select id={id} class={cls} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)}>
      <option value="">{t('backlog')}</option>
      {sprints
        .filter((s) => s.status !== 'closed' || s.id === value)
        .map((s) => (
          <option value={s.id}>{s.name}</option>
        ))}
    </select>
  );
}

/** Items that may be the parent of a given type. */
export function parentOptions(items: Item[], type: ItemType) {
  const allowed: ItemType[] = type === 'task' ? ['story', 'bug'] : type === 'epic' ? [] : ['epic'];
  return items.filter((i) => allowed.includes(i.type) && i.status !== 'done');
}

export function ParentSelect({ type, value, onChange, cls = 'cell', id, selfId }: { type: ItemType; value: string | null; onChange: (v: string | null) => void; cls?: string; id?: string; selfId?: string }) {
  const { t } = useT();
  const { items } = useApp();
  const opts = parentOptions(items, type).filter((i) => i.id !== selfId);
  const cur = value ? items.find((i) => i.id === value) : null;
  if (cur && !opts.includes(cur)) opts.unshift(cur);
  return (
    <select id={id} class={cls} value={value ?? ''} onChange={(e) => onChange(e.currentTarget.value || null)} disabled={type === 'epic'}>
      <option value="">{type === 'task' ? t('none') : t('no_epic')}</option>
      {opts.map((i) => (
        <option value={i.id}>
          {i.key} · {i.title.slice(0, 50)}
        </option>
      ))}
    </select>
  );
}

/** Epic an item belongs to (directly, or through its parent story). */
export function epicOf(items: Item[], it: Item): Item | null {
  let p = it.parent_id ? items.find((x) => x.id === it.parent_id) : undefined;
  if (p && p.type !== 'epic' && p.parent_id) p = items.find((x) => x.id === p!.parent_id);
  return p && p.type === 'epic' ? p : null;
}

export function NewItemModal({ onClose, defaults }: { onClose: () => void; defaults?: Partial<Item> }) {
  const { t } = useT();
  const app = useApp();
  const [type, setType] = useState<ItemType>((defaults?.type as ItemType) ?? 'story');
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState<string | null>(defaults?.parent_id ?? null);
  const [sprint, setSprint] = useState<string | null>(defaults?.sprint_id ?? null);
  const [assignee, setAssignee] = useState<string | null>(defaults?.assignee_id ?? null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const submit = async (e: Event) => {
    e.preventDefault();
    if (!app.project) return;
    setBusy(true);
    setErr('');
    try {
      await api.post(`/projects/${app.project.id}/items`, {
        type,
        title,
        parent_id: type === 'epic' ? null : parent,
        sprint_id: type === 'epic' ? null : sprint,
        assignee_id: assignee,
        status: defaults?.status ?? 'todo',
      });
      await app.reloadProject();
      onClose();
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Network error.');
      setBusy(false);
    }
  };

  return (
    <Modal
      title={t('new_item')}
      onClose={onClose}
      footer={
        <>
          <button class="btn" onClick={onClose}>{t('cancel')}</button>
          <button class="btn solid" form="new-item-form" disabled={busy || !title.trim()}>{t('create')}</button>
        </>
      }
    >
      <form id="new-item-form" class="form" onSubmit={submit}>
        <div class="field">
          <span class="label">{t('f_type')}</span>
          <div class="seg">
            {TYPES.map((ty) => (
              <button type="button" aria-pressed={type === ty} onClick={() => { setType(ty); setParent(null); }}>
                {t(`ty_${ty}` as never)}
              </button>
            ))}
          </div>
        </div>
        <label class="field">
          <span class="label">{t('f_title')}</span>
          <input id="new-item-title" class="input" autoFocus required value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
        </label>
        {type !== 'epic' && (
          <div class="two">
            <label class="field">
              <span class="label">{type === 'task' ? t('f_parent') : t('f_epic')}</span>
              <ParentSelect id="new-item-parent" cls="select" type={type} value={parent} onChange={setParent} />
            </label>
            <label class="field">
              <span class="label">{t('f_sprint')}</span>
              <SprintSelect id="new-item-sprint" cls="select" value={sprint} onChange={setSprint} />
            </label>
          </div>
        )}
        <label class="field">
          <span class="label">{t('f_assignee')}</span>
          <UserSelect id="new-item-assignee" cls="select" value={assignee} onChange={setAssignee} />
        </label>
        {err && <div class="err">{err}</div>}
      </form>
    </Modal>
  );
}
