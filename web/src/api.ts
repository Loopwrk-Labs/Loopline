export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function req<T>(method: string, path: string, data?: unknown): Promise<T> {
  const res = await fetch('/api' + path, {
    method,
    credentials: 'same-origin',
    headers: data !== undefined || method !== 'GET' ? { 'Content-Type': 'application/json' } : undefined,
    body: data !== undefined ? JSON.stringify(data) : method !== 'GET' ? '{}' : undefined,
  });
  const text = await res.text();
  const json = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const err = new ApiError(res.status, json?.error ?? 'error', json?.message ?? res.statusText);
    if (res.status === 401 && path !== '/auth/login') window.dispatchEvent(new CustomEvent('ll:unauth'));
    if (err.code === 'must_change_password') window.dispatchEvent(new CustomEvent('ll:mustchange'));
    throw err;
  }
  return json as T;
}

export const api = {
  get: <T>(p: string) => req<T>('GET', p),
  post: <T>(p: string, d?: unknown) => req<T>('POST', p, d ?? {}),
  patch: <T>(p: string, d: unknown) => req<T>('PATCH', p, d),
  del: <T>(p: string) => req<T>('DELETE', p),
};

export type Role = 'admin' | 'manager' | 'member';
export type Status = 'todo' | 'in_progress' | 'in_review' | 'blocked' | 'done';
export type ItemType = 'epic' | 'story' | 'bug' | 'task';
export const STATUSES: Status[] = ['todo', 'in_progress', 'in_review', 'blocked', 'done'];
export const TYPES: ItemType[] = ['epic', 'story', 'bug', 'task'];

export type Me = {
  id: string;
  email: string;
  name: string;
  initials: string;
  role: Role;
  lang_pref: 'project' | 'sr' | 'en';
  theme: 'auto' | 'light' | 'dark';
  must_change_pw: number;
};
export type User = { id: string; name: string; initials: string; role: Role; active: number; email?: string; must_change_pw?: number };
export type Project = { id: string; key: string; name: string; client: string | null; lang: 'sr' | 'en'; archived: number; open_items: number };
export type Sprint = {
  id: string;
  project_id: string;
  name: string;
  goal: string | null;
  start_date: string | null;
  end_date: string | null;
  status: 'planned' | 'active' | 'closed';
  item_count: number;
  done_count: number;
  points: number;
  done_points: number;
};
export type Item = {
  id: string;
  project_id: string;
  key: string;
  type: ItemType;
  title: string;
  description: string;
  status: Status;
  parent_id: string | null;
  sprint_id: string | null;
  assignee_id: string | null;
  reporter_id: string | null;
  points: number | null;
  scope_hours: number | null;
  scope_baseline: number | null;
  actual_hours: number | null;
  due_date: string | null;
  labels: string;
  billable: number;
  position: number;
  done_at: number | null;
  created_at: number;
  updated_at: number;
};
export type LogEntry = {
  id: string;
  item_id: string | null;
  kind: 'note' | 'change';
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  body: string | null;
  pinned: number;
  created_at: number;
  user_id: string | null;
  user_name: string | null;
  user_initials: string | null;
  item_key: string | null;
  item_title: string | null;
};
