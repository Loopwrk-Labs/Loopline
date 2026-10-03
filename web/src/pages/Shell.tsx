import { useEffect, useRef, useState } from 'preact/hooks';
import { api } from '../api';
import { useT } from '../i18n';
import { go, useApp } from '../state';
import { Avatar, Brand, Icon } from '../components/ui';
import { Board } from './Board';
import { Grid } from './Grid';
import { ItemPage } from './ItemPage';
import { Sprints } from './Sprints';
import { Epics } from './Epics';
import { Feed } from './Feed';
import { Settings } from './Settings';

export function Shell({ route }: { route: string[] }) {
  const app = useApp();
  const { t } = useT();
  const [open, setOpen] = useState(false);
  const jumpRef = useRef<HTMLInputElement>(null);
  const [jump, setJump] = useState('');
  const { project, projects } = app;
  const view = route[0] === 'p' ? route[2] ?? 'board' : route[0] ?? '';

  // Redirect empty routes and unknown projects.
  useEffect(() => {
    if (route[0] === 'settings') return;
    if (route[0] !== 'p' || !project) {
      const first = projects.find((p) => !p.archived);
      go(first ? `p/${first.key}/board` : 'settings');
    }
  }, [route.join('/'), project?.id, projects.length]);

  useEffect(() => setOpen(false), [route.join('/')]);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        jumpRef.current?.focus();
      }
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, []);

  const doJump = (e: Event) => {
    e.preventDefault();
    const q = jump.trim().toUpperCase();
    if (!q) return;
    const hit =
      app.items.find((i) => i.key === q) ??
      app.items.find((i) => project && i.key === `${project.key}-${q}`) ??
      app.items.find((i) => i.title.toUpperCase().includes(q));
    if (hit && project) {
      go(`p/${project.key}/i/${hit.key}`);
      setJump('');
      jumpRef.current?.blur();
    } else {
      app.toast('—', 'err');
    }
  };

  const logout = async () => {
    await api.post('/auth/logout');
    location.hash = '';
    location.reload();
  };

  const nav = (v: string, icon: string, label: string) =>
    project && (
      <a href={`#/p/${project.key}/${v}`} class={view === v || (v === 'board' && view === 'i' && false) ? 'on' : ''}>
        <Icon name={icon} />
        {label}
      </a>
    );

  const crumbView: Record<string, string> = { board: t('board'), grid: t('grid'), epics: t('epics'), sprints: t('sprints'), logbook: t('logbook'), i: route[3] ?? '' };

  let page = null;
  if (route[0] === 'settings') page = <Settings />;
  else if (project) {
    if (view === 'board') page = <Board />;
    else if (view === 'grid') page = <Grid />;
    else if (view === 'epics') page = <Epics />;
    else if (view === 'sprints') page = <Sprints />;
    else if (view === 'logbook') page = <Feed />;
    else if (view === 'i' && route[3]) page = <ItemPage itemKey={route[3]} />;
  }

  return (
    <div class="shell">
      <aside class={'side' + (open ? ' open' : '')}>
        <a href="#/" style={{ textDecoration: 'none', padding: '4px 6px 0' }}>
          <Brand />
        </a>
        {projects.length > 0 && (
          <label class="proj-sel">
            <small>{t('project').toUpperCase()}</small>
            <select
              id="project-switch"
              value={project?.key ?? ''}
              onChange={(e) => go(`p/${e.currentTarget.value}/${['board', 'grid', 'epics', 'sprints', 'logbook'].includes(view) ? view : 'board'}`)}
            >
              {!project && <option value="">—</option>}
              {projects
                .filter((p) => !p.archived || p.id === project?.id)
                .map((p) => (
                  <option value={p.key}>
                    {p.key} · {p.name}
                  </option>
                ))}
            </select>
          </label>
        )}
        <nav class="nav">
          {project && <div class="grp">{t('nav_work')}</div>}
          {nav('board', 'board', t('board'))}
          {nav('grid', 'grid', t('grid'))}
          {nav('epics', 'epic', t('epics'))}
          {nav('sprints', 'sprint', t('sprints'))}
          {nav('logbook', 'log', t('logbook'))}
          <div class="grp">{t('nav_ops')}</div>
          <a href="#/settings" class={route[0] === 'settings' ? 'on' : ''}>
            <Icon name="set" />
            {t('settings')}
          </a>
        </nav>
        <div class="me">
          <Avatar user={app.me} lg />
          <div>
            {app.me.name}
            <br />
            <small>{t(`r_${app.me.role}` as never)}</small>
          </div>
          <button class="btn ghost sm" onClick={logout} title={t('signout')} aria-label={t('signout')}>
            <Icon name="out" />
          </button>
        </div>
      </aside>
      <div class="main">
        <div class="bar">
          <button class="btn ghost sm menu-btn" onClick={() => setOpen(!open)} aria-label="Menu">
            <Icon name="menu" />
          </button>
          <span class="crumb">
            {route[0] === 'settings' ? (
              <b>{t('settings')}</b>
            ) : project ? (
              <>
                {project.key} / <b>{crumbView[view] ?? ''}</b>
              </>
            ) : null}
          </span>
          <span class="grow" />
          {project && (
            <form class="jump" onSubmit={doJump}>
              <Icon name="search" />
              <input id="jump" ref={jumpRef} placeholder={t('search')} value={jump} onInput={(e) => setJump(e.currentTarget.value)} />
              <span class="kbd">⌘K</span>
            </form>
          )}
        </div>
        <div class="content">{page}</div>
      </div>
    </div>
  );
}
