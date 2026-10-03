import { HTTPException } from 'hono/http-exception';
import type { Context } from 'hono';
import type { AppEnv, Role } from './types';

export const now = () => Date.now();
export const uid = () => crypto.randomUUID();

export function fail(status: 400 | 401 | 403 | 404 | 409 | 429, code: string, message?: string): never {
  throw new HTTPException(status, { message: message ?? code, cause: code });
}

export function requireRole(c: Context<AppEnv>, ...roles: Role[]) {
  const u = c.get('user');
  if (!roles.includes(u.role)) fail(403, 'forbidden', 'You do not have permission for this action.');
}

export const isManager = (c: Context<AppEnv>) => ['admin', 'manager'].includes(c.get('user').role);

/** Read and loosely validate a JSON body. */
export async function body<T = Record<string, unknown>>(c: Context): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    fail(400, 'bad_json', 'Request body must be JSON.');
  }
}

export function str(v: unknown, max = 500): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length ? s.slice(0, max) : null;
}

export function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 100000) fail(400, 'bad_number', 'Invalid number.');
  return Math.round(n * 100) / 100;
}

export function date(v: unknown): string | null {
  const s = str(v, 10);
  if (!s) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) fail(400, 'bad_date', 'Dates must be YYYY-MM-DD.');
  return s;
}
