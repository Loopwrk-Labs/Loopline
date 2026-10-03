import { createContext } from 'preact';
import { useContext, useEffect, useState } from 'preact/hooks';
import type { Item, Me, Project, Sprint, User } from './api';

export type AppState = {
  me: Me;
  users: User[];
  projects: Project[];
  project: Project | null;
  items: Item[];
  sprints: Sprint[];
  reloadMe: () => Promise<void>;
  reloadProjects: () => Promise<void>;
  reloadUsers: () => Promise<void>;
  reloadProject: () => Promise<void>;
  /** Optimistically patch an item and persist it; reverts and toasts on error. */
  saveItem: (id: string, patch: Partial<Item>) => Promise<Item | null>;
  toast: (msg: string, kind?: 'ok' | 'err') => void;
};

export const AppCtx = createContext<AppState>(null as unknown as AppState);
export const useApp = () => useContext(AppCtx);

/** Minimal hash router: #/p/LWD/board → ['p','LWD','board'] */
export function useRoute(): string[] {
  const read = () => location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  const [r, setR] = useState(read);
  useEffect(() => {
    const on = () => setR(read());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const go = (path: string) => {
  location.hash = '#/' + path.replace(/^\//, '');
};

export const userById = (users: User[], id: string | null) => (id ? users.find((u) => u.id === id) ?? null : null);
