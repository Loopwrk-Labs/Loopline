import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env, SessionUser } from '../lib/types';
import { body, fail, now, str, uid } from '../lib/http';
import { PBKDF2_ITERATIONS, hashPassword, initialsOf, randomHex, safeEqual, sha256, validatePassword } from '../lib/crypto';

const COOKIE = 'll_session';
const SESSION_DAYS = 30;
const RATE_WINDOW_MS = 15 * 60 * 1000;
const RATE_MAX = 8;

const USER_COLS = 'id, email, name, initials, role, lang_pref, theme, must_change_pw';

export async function createPasswordFields(env: Env, password: string) {
  const salt = randomHex(16);
  const hash = await hashPassword(password, salt, PBKDF2_ITERATIONS, env.AUTH_PEPPER ?? '');
  return { pass_hash: hash, pass_salt: salt, pass_iter: PBKDF2_ITERATIONS };
}

async function verifyPassword(env: Env, password: string, row: { pass_hash: string; pass_salt: string; pass_iter: number }) {
  const h = await hashPassword(password, row.pass_salt, row.pass_iter, env.AUTH_PEPPER ?? '');
  return safeEqual(h, row.pass_hash);
}

async function startSession(c: Parameters<MiddlewareHandler<AppEnv>>[0], userId: string) {
  const token = randomHex(32);
  const t = now();
  await c.env.DB.prepare('INSERT INTO sessions (id, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)')
    .bind(await sha256(token), userId, t + SESSION_DAYS * 86400_000, t)
    .run();
  setCookie(c, COOKIE, token, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_DAYS * 86400,
  });
}

async function tooManyAttempts(db: D1Database, keys: string[]) {
  const since = now() - RATE_WINDOW_MS;
  for (const k of keys) {
    const r = await db.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE k = ? AND at > ?').bind(k, since).first<{ n: number }>();
    if ((r?.n ?? 0) >= RATE_MAX) return true;
  }
  return false;
}

/** Session middleware for all protected /api routes. */
export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, COOKIE);
  if (!token) fail(401, 'unauthenticated', 'Please sign in.');
  const row = await c.env.DB.prepare(
    `SELECT ${USER_COLS.split(', ').map((x) => 'u.' + x).join(', ')}, s.expires_at
     FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND u.active = 1`,
  )
    .bind(await sha256(token))
    .first<SessionUser & { expires_at: number }>();
  if (!row || row.expires_at < now()) fail(401, 'unauthenticated', 'Your session expired. Please sign in again.');
  const { expires_at: _e, ...user } = row;
  c.set('user', user);
  // Users with a temporary password may only change it.
  if (user.must_change_pw && !(c.req.path === '/api/me' || c.req.path === '/api/me/password' || c.req.path === '/api/auth/logout')) {
    fail(403, 'must_change_password', 'Please set a new password first.');
  }
  await next();
};

/** Mutating requests must carry JSON and come from our own origin (CSRF guard). */
export const csrfGuard: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (origin && origin !== new URL(c.req.url).origin) fail(403, 'bad_origin', 'Cross-site request blocked.');
    if (!c.req.header('content-type')?.includes('application/json')) fail(400, 'json_required', 'Requests must be JSON.');
  }
  await next();
};

export const publicAuth = new Hono<AppEnv>();

publicAuth.get('/setup/status', async (c) => {
  const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  return c.json({ needsSetup: (r?.n ?? 0) === 0 });
});

publicAuth.post('/setup', async (c) => {
  const b = await body(c);
  const r = await c.env.DB.prepare('SELECT COUNT(*) AS n FROM users').first<{ n: number }>();
  if ((r?.n ?? 0) > 0) fail(409, 'already_setup', 'Loopline is already set up. Please sign in.');
  // A one-time setup code (stored hashed) protects the window between deploy and first sign-in.
  const code = await c.env.DB.prepare(`SELECT v FROM app_settings WHERE k = 'setup_code_sha256'`).first<{ v: string }>();
  if (!code || !safeEqual(await sha256(String(b.setupCode ?? '').trim()), code.v)) fail(403, 'bad_setup_code', 'Setup code is missing or wrong.');
  const email = str(b.email, 200)?.toLowerCase();
  const name = str(b.name, 100);
  if (!email || !email.includes('@')) fail(400, 'bad_email', 'Enter a valid email.');
  if (!name) fail(400, 'bad_name', 'Enter your name.');
  const pwErr = validatePassword(b.password);
  if (pwErr) fail(400, 'weak_password', pwErr);
  const id = uid();
  const pw = await createPasswordFields(c.env, b.password as string);
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, initials, role, pass_hash, pass_salt, pass_iter, created_at)
     VALUES (?, ?, ?, ?, 'admin', ?, ?, ?, ?)`,
  )
    .bind(id, email, name, initialsOf(name), pw.pass_hash, pw.pass_salt, pw.pass_iter, now())
    .run();
  await c.env.DB.prepare(`DELETE FROM app_settings WHERE k = 'setup_code_sha256'`).run();
  await startSession(c, id);
  return c.json({ ok: true });
});

publicAuth.post('/auth/login', async (c) => {
  const b = await body(c);
  const email = str(b.email, 200)?.toLowerCase() ?? '';
  const password = typeof b.password === 'string' ? b.password : '';
  const ip = c.req.header('cf-connecting-ip') ?? 'local';
  const keys = [`email:${email}`, `ip:${ip}`];
  if (await tooManyAttempts(c.env.DB, keys)) fail(429, 'rate_limited', 'Too many attempts. Try again in 15 minutes.');

  const row = await c.env.DB.prepare('SELECT id, pass_hash, pass_salt, pass_iter, active FROM users WHERE email = ?')
    .bind(email)
    .first<{ id: string; pass_hash: string; pass_salt: string; pass_iter: number; active: number }>();
  const ok = row && row.active === 1 && (await verifyPassword(c.env, password, row));
  if (!ok) {
    const t = now();
    await c.env.DB.batch([
      ...keys.map((k) => c.env.DB.prepare('INSERT INTO login_attempts (k, at) VALUES (?, ?)').bind(k, t)),
      c.env.DB.prepare('DELETE FROM login_attempts WHERE at < ?').bind(t - RATE_WINDOW_MS),
    ]);
    fail(401, 'bad_credentials', 'Wrong email or password.');
  }
  await c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND expires_at < ?').bind(row.id, now()).run();
  await startSession(c, row.id);
  return c.json({ ok: true });
});

export const privateAuth = new Hono<AppEnv>();

privateAuth.post('/auth/logout', async (c) => {
  const token = getCookie(c, COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
  deleteCookie(c, COOKIE, { path: '/' });
  return c.json({ ok: true });
});

privateAuth.get('/me', (c) => c.json(c.get('user')));

privateAuth.patch('/me', async (c) => {
  const b = await body(c);
  const u = c.get('user');
  const name = b.name !== undefined ? str(b.name, 100) : u.name;
  if (!name) fail(400, 'bad_name', 'Enter your name.');
  const lang = b.lang_pref ?? u.lang_pref;
  const theme = b.theme ?? u.theme;
  if (!['project', 'sr', 'en'].includes(lang as string)) fail(400, 'bad_lang');
  if (!['auto', 'light', 'dark'].includes(theme as string)) fail(400, 'bad_theme');
  await c.env.DB.prepare('UPDATE users SET name = ?, initials = ?, lang_pref = ?, theme = ? WHERE id = ?')
    .bind(name, initialsOf(name), lang, theme, u.id)
    .run();
  return c.json({ ok: true });
});

privateAuth.post('/me/password', async (c) => {
  const b = await body(c);
  const u = c.get('user');
  const row = await c.env.DB.prepare('SELECT pass_hash, pass_salt, pass_iter FROM users WHERE id = ?')
    .bind(u.id)
    .first<{ pass_hash: string; pass_salt: string; pass_iter: number }>();
  if (!row || !(await verifyPassword(c.env, String(b.current ?? ''), row))) fail(400, 'bad_current', 'Current password is wrong.');
  const err = validatePassword(b.next);
  if (err) fail(400, 'weak_password', err);
  if (b.next === b.current) fail(400, 'same_password', 'Choose a different password.');
  const pw = await createPasswordFields(c.env, b.next as string);
  const token = getCookie(c, COOKIE)!;
  await c.env.DB.batch([
    c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, must_change_pw = 0 WHERE id = ?').bind(
      pw.pass_hash,
      pw.pass_salt,
      pw.pass_iter,
      u.id,
    ),
    // Sign out other devices.
    c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').bind(u.id, await sha256(token)),
  ]);
  return c.json({ ok: true });
});
