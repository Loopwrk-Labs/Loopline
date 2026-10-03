import { render } from 'preact';
import { useCallback, useEffect, useMemo, useState } from 'preact/hooks';
import './styles.css';
import { api, ApiError, type Item, type Me, type Project, type Sprint, type User } from './api';
import { LangCtx, makeT, type Lang } from './i18n';
import { AppCtx, useRoute, type AppState } from './state';
import { ChangePassword, Login, Setup } from './pages/Auth';
import { Shell } from './pages/Shell';
import { AcceptPage } from './pages/AcceptPage';

type Phase = 'loading' | 'setup' | 'login' | 'mustchange' | 'app';

const browserLang = (): Lang => (/^(sr|hr|bs|sh)/i.test(navigator.language) ? 'sr' : 'en');

function applyTheme(theme: Me['theme'] | undefined) {
  if (!theme || theme === 'auto') document.documentElement.removeAttribute('data-theme');
  else document.documentElement.setAttribute('data-theme', theme);
}

function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [toastMsg, setToast] = useState<{ msg: string; kind: 'ok' | 'err' } | null>(null);
  const route = useRoute();

  const projectKey = route[0] === 'p' ? route[1] : null;
  const project = projects.find((p) => p.key === projectKey) ?? null;

  const toast = useCallback((msg: string, kind: 'ok' | 'err' = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast((x) => (x?.msg === msg ? null : x)), 3200);
  }, []);

  const boot = useCallback(async () => {
    try {
      const st = await api.get<{ needsSetup: boolean }>('/setup/status');
      if (st.needsSetup) return setPhase('setup');
      const m = await api.get<Me>('/me');
      setMe(m);
      applyTheme(m.theme);
      if (m.must_change_pw) return setPhase('mustchange');
      const [u, p] = await Promise.all([api.get<User[]>('/users'), api.get<Project[]>('/projects')]);
      setUsers(u);
      setProjects(p);
      setPhase('app');
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setPhase('login');
      else setPhase('login');
    }
  }, []);

  useEffect(() => {
    if (location.hash.startsWith('#/a/')) return; // public approval page: no sign-in
    boot();
    const unauth = () => setPhase('login');
    const must = () => setPhase('mustchange');
    addEventListener('ll:unauth', unauth);
    addEventListener('ll:mustchange', must);
    return () => {
      removeEventListener('ll:unauth', unauth);
      removeEventListener('ll:mustchange', must);
    };
  }, [boot]);

  const reloadProject = useCallback(async () => {
    if (!project) {
      setItems([]);
      setSprints([]);
      return;
    }
    const [i, s] = await Promise.all([api.get<Item[]>(`/projects/${project.id}/items`), api.get<Sprint[]>(`/projects/${project.id}/sprints`)]);
    setItems(i);
    setSprints(s);
  }, [project?.id]);

  useEffect(() => {
    if (phase === 'app') reloadProject();
  }, [phase, reloadProject]);

  const lang: Lang = me ? (me.lang_pref === 'project' ? project?.lang ?? (projects[0]?.lang as Lang) ?? browserLang() : me.lang_pref) : browserLang();
  useEffect(() => {
    document.documentElement.lang = lang === 'sr' ? 'sr-Latn' : 'en';
  }, [lang]);
  const langCtx = useMemo(() => ({ lang, t: makeT(lang) }), [lang]);

  const state: AppState | null = me
    ? {
        me,
        users,
        projects,
        project,
        items,
        sprints,
        toast,
        reloadMe: async () => {
          const m = await api.get<Me>('/me');
          setMe(m);
          applyTheme(m.theme);
        },
        reloadProjects: async () => setProjects(await api.get<Project[]>('/projects')),
        reloadUsers: async () => setUsers(await api.get<User[]>('/users')),
        reloadProject,
        saveItem: async (id, patch) => {
          const before = items;
          setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...patch } : x)));
          try {
            const saved = await api.patch<Item>(`/items/${id}`, patch);
            setItems((xs) => xs.map((x) => (x.id === id ? saved : x)));
            if ('sprint_id' in patch || 'status' in patch || 'points' in patch) api.get<Sprint[]>(`/projects/${saved.project_id}/sprints`).then(setSprints);
            return saved;
          } catch (e) {
            setItems(before);
            toast(e instanceof ApiError ? e.message : 'Network error.', 'err');
            return null;
          }
        },
      }
    : null;

  let view;
  if (route[0] === 'a' && route[1]) view = <AcceptPage token={route[1]} />;
  else if (phase === 'loading') view = <div class="auth faint mono">…</div>;
  else if (phase === 'setup') view = <Setup onDone={boot} />;
  else if (phase === 'login') view = <Login onDone={boot} />;
  else if (phase === 'mustchange') view = <ChangePassword forced onDone={boot} />;
  else if (state) view = (
    <AppCtx.Provider value={state}>
      <Shell route={route} />
    </AppCtx.Provider>
  );

  return (
    <LangCtx.Provider value={langCtx}>
      {view}
      {toastMsg && <div class={'toast' + (toastMsg.kind === 'err' ? ' err' : '')} role="status">{toastMsg.msg}</div>}
    </LangCtx.Provider>
  );
}

render(<App />, document.getElementById('app')!);
