import { useState } from 'preact/hooks';
import { api, ApiError, type Project, type Role, type User } from '../api';
import { useT } from '../i18n';
import { go, useApp } from '../state';
import { Avatar, Icon, Modal } from '../components/ui';
import { ChangePassword } from './Auth';

function useRun() {
  const app = useApp();
  const [err, setErr] = useState('');
  const run = async (fn: () => Promise<unknown>) => {
    setErr('');
    try {
      await fn();
      return true;
    } catch (x) {
      setErr(x instanceof ApiError ? x.message : 'Network error.');
      return false;
    }
  };
  return { err, setErr, run, app };
}

function Profile() {
  const { t } = useT();
  const { app, run, err } = useRun();
  const [name, setName] = useState(app.me.name);
  const save = async (patch: Record<string, string>) => {
    if (await run(() => api.patch('/me', patch))) {
      await app.reloadMe();
      app.toast(t('saved'));
    }
  };
  return (
    <div class="panel">
      <h3>{t('profile')}</h3>
      <div class="form">
        <label class="field">
          <span class="label">{t('name')}</span>
          <div class="row" style={{ flexWrap: 'nowrap' }}>
            <input id="me-name" class="input" value={name} onInput={(e) => setName(e.currentTarget.value)} />
            <button class="btn" onClick={() => save({ name })} disabled={!name.trim() || name === app.me.name}>
              {t('save')}
            </button>
          </div>
        </label>
        <div class="field">
          <span class="label">{t('email')}</span>
          <span class="mono">{app.me.email}</span>
        </div>
        <div class="field">
          <span class="label">{t('language')}</span>
          <div class="seg">
            {(['project', 'sr', 'en'] as const).map((l) => (
              <button aria-pressed={app.me.lang_pref === l} onClick={() => save({ lang_pref: l })}>
                {t(`lang_${l}` as never)}
              </button>
            ))}
          </div>
        </div>
        <div class="field">
          <span class="label">{t('theme')}</span>
          <div class="seg">
            {(['auto', 'light', 'dark'] as const).map((th) => (
              <button aria-pressed={app.me.theme === th} onClick={() => save({ theme: th })}>
                {t(`th_${th}` as never)}
              </button>
            ))}
          </div>
        </div>
        {err && <div class="err">{err}</div>}
      </div>
    </div>
  );
}

function Password() {
  const { t } = useT();
  const app = useApp();
  return (
    <div class="panel">
      <h3>{t('change_pw')}</h3>
      <ChangePassword onDone={() => app.toast(t('pw_changed'))} />
    </div>
  );
}

function Projects() {
  const { t } = useT();
  const { app, run, err, setErr } = useRun();
  const [edit, setEdit] = useState<Partial<Project> | null>(null);
  const canManage = app.me.role !== 'member';

  const submit = async (e: Event) => {
    e.preventDefault();
    const p = edit!;
    const ok = await run(async () => {
      if (p.id) await api.patch(`/projects/${p.id}`, { name: p.name, client: p.client ?? null, lang: p.lang, archived: !!p.archived });
      else {
        await api.post('/projects', { key: p.key, name: p.name, client: p.client ?? null, lang: p.lang ?? 'sr' });
      }
    });
    if (ok) {
      await app.reloadProjects();
      if (!p.id) go(`p/${p.key!.toUpperCase()}/board`);
      setEdit(null);
    }
  };

  return (
    <div class="panel">
      <div class="row" style={{ marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>{t('projects')}</h3>
        {canManage && (
          <button class="btn solid sm" style={{ marginLeft: 'auto' }} onClick={() => { setErr(''); setEdit({ lang: 'sr' }); }}>
            <Icon name="plus" />
            {t('new_project')}
          </button>
        )}
      </div>
      {app.projects.length === 0 ? (
        <div class="empty">
          <h3>{t('no_projects')}</h3>
          {t('create_first_project')}
        </div>
      ) : (
        <div class="list">
          {app.projects.map((p) => (
            <div class="list-row">
              <span class="key">{p.key}</span>
              <a class="main-t" href={`#/p/${p.key}/board`} style={{ textDecoration: 'none' }}>
                {p.name}
              </a>
              {p.client && <span class="muted">{p.client}</span>}
              <span class="sp">
                <span class="tag">{p.lang.toUpperCase()}</span>
                {p.archived ? <span class="tag">{t('archived')}</span> : null}
                {canManage && (
                  <button class="btn sm" onClick={() => { setErr(''); setEdit(p); }}>
                    {t('edit')}
                  </button>
                )}
              </span>
            </div>
          ))}
        </div>
      )}
      {edit && (
        <Modal
          title={edit.id ? `${edit.key} · ${edit.name}` : t('new_project')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" form="project-form">{edit.id ? t('save') : t('create')}</button>
            </>
          }
        >
          <form id="project-form" class="form" onSubmit={submit}>
            <div class="two">
              <label class="field">
                <span class="label">{t('project_key')}</span>
                <input
                  id="project-key"
                  class="input mono"
                  required
                  disabled={!!edit.id}
                  maxLength={6}
                  placeholder="LWD"
                  value={edit.key ?? ''}
                  onInput={(e) => setEdit({ ...edit, key: e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, '') })}
                />
              </label>
              <label class="field">
                <span class="label">{t('client')}</span>
                <input id="project-client" class="input" value={edit.client ?? ''} onInput={(e) => setEdit({ ...edit, client: e.currentTarget.value })} />
              </label>
            </div>
            <label class="field">
              <span class="label">{t('project_name')}</span>
              <input id="project-name" class="input" required value={edit.name ?? ''} onInput={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </label>
            <div class="field">
              <span class="label">{t('project_lang')}</span>
              <div class="seg">
                {(['sr', 'en'] as const).map((l) => (
                  <button type="button" aria-pressed={(edit.lang ?? 'sr') === l} onClick={() => setEdit({ ...edit, lang: l })}>
                    {t(`lang_${l}` as never)}
                  </button>
                ))}
              </div>
              <span class="hint">{t('project_lang_hint')}</span>
            </div>
            {edit.id && (
              <label class="chk">
                <input type="checkbox" checked={!!edit.archived} onChange={(e) => setEdit({ ...edit, archived: e.currentTarget.checked ? 1 : 0 })} />
                {t('archived')}
              </label>
            )}
            {err && <div class="err">{err}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

function Team() {
  const { t } = useT();
  const { app, run, err, setErr } = useRun();
  const [edit, setEdit] = useState<(Partial<User> & { tempPassword?: string; resetPassword?: string }) | null>(null);
  const isAdmin = app.me.role === 'admin';

  const submit = async (e: Event) => {
    e.preventDefault();
    const u = edit!;
    const ok = await run(() =>
      u.id
        ? api.patch(`/users/${u.id}`, { name: u.name, email: u.email, role: u.role, active: !!u.active, ...(u.resetPassword ? { resetPassword: u.resetPassword } : {}) })
        : api.post('/users', { name: u.name, email: u.email, role: u.role ?? 'member', tempPassword: u.tempPassword }),
    );
    if (ok) {
      await app.reloadUsers();
      app.toast(t('saved'));
      setEdit(null);
    }
  };

  return (
    <div class="panel">
      <div class="row" style={{ marginBottom: '12px' }}>
        <h3 style={{ margin: 0 }}>{t('team')}</h3>
        {isAdmin && (
          <button class="btn solid sm" style={{ marginLeft: 'auto' }} onClick={() => { setErr(''); setEdit({ role: 'member', active: 1 }); }}>
            <Icon name="plus" />
            {t('add_user')}
          </button>
        )}
      </div>
      <div class="list">
        {app.users.map((u) => (
          <div class="list-row">
            <Avatar user={u} lg />
            <span>
              <span class="main-t">{u.name}</span>
              {u.email && (
                <>
                  <br />
                  <span class="key">{u.email}</span>
                </>
              )}
            </span>
            <span class="sp">
              <span class={'tag' + (u.role === 'admin' ? ' on' : '')}>{t(`r_${u.role}` as never)}</span>
              {!u.active && <span class="tag">{t('inactive')}</span>}
              {u.must_change_pw ? <span class="tag warn">{t('pending_pw')}</span> : null}
              {isAdmin && (
                <button class="btn sm" onClick={() => { setErr(''); setEdit({ ...u }); }}>
                  {t('edit')}
                </button>
              )}
            </span>
          </div>
        ))}
      </div>
      {edit && (
        <Modal
          title={edit.id ? edit.name ?? '' : t('add_user')}
          onClose={() => setEdit(null)}
          footer={
            <>
              <button class="btn" onClick={() => setEdit(null)}>{t('cancel')}</button>
              <button class="btn solid" form="user-form">{edit.id ? t('save') : t('create')}</button>
            </>
          }
        >
          <form id="user-form" class="form" onSubmit={submit}>
            <label class="field">
              <span class="label">{t('name')}</span>
              <input id="user-name" class="input" required value={edit.name ?? ''} onInput={(e) => setEdit({ ...edit, name: e.currentTarget.value })} />
            </label>
            <label class="field">
              <span class="label">{t('email')}</span>
              <input id="user-email" class="input" type="email" required value={edit.email ?? ''} onInput={(e) => setEdit({ ...edit, email: e.currentTarget.value })} />
            </label>
            <div class="field">
              <span class="label">{t('role')}</span>
              <div class="seg">
                {(['member', 'manager', 'admin'] as Role[]).map((r) => (
                  <button type="button" aria-pressed={(edit.role ?? 'member') === r} onClick={() => setEdit({ ...edit, role: r })}>
                    {t(`r_${r}` as never)}
                  </button>
                ))}
              </div>
            </div>
            {!edit.id ? (
              <label class="field">
                <span class="label">{t('temp_pw')}</span>
                <input id="user-temp-pw" class="input mono" required minLength={12} value={edit.tempPassword ?? ''} onInput={(e) => setEdit({ ...edit, tempPassword: e.currentTarget.value })} />
                <span class="hint">{t('temp_pw_hint')} {t('pw_rule')}</span>
              </label>
            ) : (
              <>
                <label class="field">
                  <span class="label">{t('reset_pw')}</span>
                  <input id="user-reset-pw" class="input mono" minLength={12} placeholder="—" value={edit.resetPassword ?? ''} onInput={(e) => setEdit({ ...edit, resetPassword: e.currentTarget.value })} />
                  <span class="hint">{t('temp_pw_hint')}</span>
                </label>
                <label class="chk">
                  <input type="checkbox" checked={!!edit.active} onChange={(e) => setEdit({ ...edit, active: e.currentTarget.checked ? 1 : 0 })} />
                  {t('active')}
                </label>
              </>
            )}
            {err && <div class="err">{err}</div>}
          </form>
        </Modal>
      )}
    </div>
  );
}

export function Settings() {
  return (
    <div class="settings-grid">
      <div>
        <Projects />
        <Team />
      </div>
      <div>
        <Profile />
        <Password />
      </div>
    </div>
  );
}
