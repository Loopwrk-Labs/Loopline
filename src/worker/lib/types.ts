export type Env = {
  DB: D1Database;
  ASSETS: Fetcher;
  /** Optional server-side secret mixed into password hashes (set as a Worker secret). */
  AUTH_PEPPER?: string;
  /** Domain that receives client emails, e.g. in.lpwrk.dev (Email Routing → this Worker). */
  INBOUND_DOMAIN?: string;
};

export type Role = 'admin' | 'manager' | 'member';

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: Role;
  lang_pref: 'project' | 'sr' | 'en';
  theme: 'auto' | 'light' | 'dark';
  must_change_pw: number;
};

export type AppEnv = {
  Bindings: Env;
  Variables: { user: SessionUser };
};

export const STATUSES = ['todo', 'in_progress', 'in_review', 'blocked', 'done'] as const;
export const TYPES = ['epic', 'story', 'bug', 'task'] as const;
export type Status = (typeof STATUSES)[number];
export type ItemType = (typeof TYPES)[number];
