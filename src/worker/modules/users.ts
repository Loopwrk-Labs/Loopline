import { Hono } from 'hono';
import type { AppEnv } from '../lib/types';
import { body, fail, now, requireRole, str, uid } from '../lib/http';
import { initialsOf, validatePassword } from '../lib/crypto';
import { createPasswordFields } from './auth';

export const users = new Hono<AppEnv>();

users.get('/users', async (c) => {
  const isAdmin = c.get('user').role === 'admin';
  const cols = isAdmin ? 'id, email, name, initials, role, active, must_change_pw, created_at' : 'id, name, initials, role, active';
  const { results } = await c.env.DB.prepare(`SELECT ${cols} FROM users ORDER BY active DESC, name`).all();
  return c.json(results);
});

users.post('/users', async (c) => {
  requireRole(c, 'admin');
  const b = await body(c);
  const email = str(b.email, 200)?.toLowerCase();
  const name = str(b.name, 100);
  const role = (b.role as string) ?? 'member';
  if (!email || !email.includes('@')) fail(400, 'bad_email', 'Enter a valid email.');
  if (!name) fail(400, 'bad_name', 'Enter a name.');
  if (!['admin', 'manager', 'member'].includes(role)) fail(400, 'bad_role');
  const err = validatePassword(b.tempPassword);
  if (err) fail(400, 'weak_password', err);
  const exists = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ?').bind(email).first();
  if (exists) fail(409, 'email_taken', 'A user with this email already exists.');
  const pw = await createPasswordFields(c.env, b.tempPassword as string);
  const id = uid();
  await c.env.DB.prepare(
    `INSERT INTO users (id, email, name, initials, role, pass_hash, pass_salt, pass_iter, must_change_pw, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  )
    .bind(id, email, name, initialsOf(name), role, pw.pass_hash, pw.pass_salt, pw.pass_iter, now())
    .run();
  return c.json({ id });
});

users.patch('/users/:id', async (c) => {
  requireRole(c, 'admin');
  const id = c.req.param('id');
  const b = await body(c);
  const cur = await c.env.DB.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<Record<string, unknown>>();
  if (!cur) fail(404, 'not_found');
  const me = c.get('user');

  const email = b.email !== undefined ? str(b.email, 200)?.toLowerCase() : (cur.email as string);
  const name = b.name !== undefined ? str(b.name, 100) : (cur.name as string);
  const role = (b.role as string) ?? (cur.role as string);
  const active = b.active !== undefined ? (b.active ? 1 : 0) : (cur.active as number);
  if (!email || !email.includes('@')) fail(400, 'bad_email', 'Enter a valid email.');
  if (!name) fail(400, 'bad_name', 'Enter a name.');
  if (!['admin', 'manager', 'member'].includes(role)) fail(400, 'bad_role');
  if (id === me.id && (role !== 'admin' || !active)) fail(400, 'self_lockout', 'You cannot remove your own admin access.');
  if (email !== cur.email) {
    const taken = await c.env.DB.prepare('SELECT 1 FROM users WHERE email = ? AND id != ?').bind(email, id).first();
    if (taken) fail(409, 'email_taken', 'A user with this email already exists.');
  }

  const stmts = [
    c.env.DB.prepare('UPDATE users SET email = ?, name = ?, initials = ?, role = ?, active = ? WHERE id = ?').bind(
      email,
      name,
      initialsOf(name),
      role,
      active,
      id,
    ),
  ];
  if (b.resetPassword !== undefined) {
    const err = validatePassword(b.resetPassword);
    if (err) fail(400, 'weak_password', err);
    const pw = await createPasswordFields(c.env, b.resetPassword as string);
    stmts.push(
      c.env.DB.prepare('UPDATE users SET pass_hash = ?, pass_salt = ?, pass_iter = ?, must_change_pw = 1 WHERE id = ?').bind(
        pw.pass_hash,
        pw.pass_salt,
        pw.pass_iter,
        id,
      ),
    );
  }
  if (!active || b.resetPassword !== undefined) stmts.push(c.env.DB.prepare('DELETE FROM sessions WHERE user_id = ?').bind(id));
  await c.env.DB.batch(stmts);
  return c.json({ ok: true });
});
