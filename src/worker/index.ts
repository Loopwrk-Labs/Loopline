import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import type { AppEnv } from './lib/types';
import { csrfGuard, privateAuth, publicAuth, requireUser } from './modules/auth';
import { users } from './modules/users';
import { projects } from './modules/projects';
import { items } from './modules/items';
import { sprints } from './modules/sprints';
import { logbook } from './modules/logbook';

// Modular monolith: each module owns its routes; this file only wires them together.
const app = new Hono<AppEnv>().basePath('/api');

app.use('*', async (c, next) => {
  await next();
  c.header('Cache-Control', 'no-store');
  c.header('X-Content-Type-Options', 'nosniff');
});
app.use('*', csrfGuard);

app.get('/health', (c) => c.json({ ok: true }));
app.route('/', publicAuth);

app.use('*', requireUser);
app.route('/', privateAuth);
app.route('/', users);
app.route('/', projects);
app.route('/', items);
app.route('/', sprints);
app.route('/', logbook);

app.notFound((c) => c.json({ error: 'not_found', message: 'Not found.' }, 404));

app.onError((err, c) => {
  if (err instanceof HTTPException) {
    return c.json({ error: String(err.cause ?? 'error'), message: err.message }, err.status);
  }
  console.error(err);
  return c.json({ error: 'server_error', message: 'Something went wrong on the server.' }, 500);
});

export default app;
