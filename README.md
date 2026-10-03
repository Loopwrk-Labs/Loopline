# Loopwrk. Loopline

Internal service delivery tool for the Loopwrk team: projects, epics, stories, tasks and sprints,
with a Kanban board, a spreadsheet-style Grid, a time-stamped Logbook, scope vs actual hours,
light/dark themes and Serbian/English per project.

Runs entirely on the Cloudflare Workers **Free** plan: one Worker (Hono API + static SPA) and one D1 database.

## Stack

| Part | Tech |
|---|---|
| API | [Hono](https://hono.dev) on Cloudflare Workers, organised as a modular monolith (`src/worker/modules/*`) |
| Database | Cloudflare D1 (SQLite), SQL migrations in `migrations/` |
| Frontend | Preact + Vite, served as Workers static assets (`web/` → `dist/`) |
| Auth | Built-in email + password (PBKDF2 via WebCrypto, rate limited, HttpOnly session cookie) |

## Modules

`auth` · `users` · `projects` · `items` (epic/story/bug/task) · `sprints` (+ capacity) · `logbook` ·
`views` (saved Grid views) · `imports` (Excel import + undo) · `metrics` (sprint scorecard) ·
`pm` (correspondence, customer acceptance & change requests, decision log, backup, inbound email)

Screens: Dashboard · Board · Backlog & sprint planning · Grid (Excel import/export, saved views) · Epics · Sprints ·
Logbook · Metrics · Project (overview, correspondence, acceptance & CR, decisions) · Settings (team, projects, backup).
Clients confirm acceptance / change requests on a public link (`/#/a/<token>`) without an account.

Every change to status, assignee, sprint, points, scope/actual hours, due date and parent is written to the
Logbook automatically. Actual hours lock when an item is Done (managers can still change them). Scope hours get a
baseline when the sprint starts.

## Local development

```bash
npm install
npm run db:migrate:local      # create the local D1 database
npx wrangler d1 execute loopline --local --command \
  "INSERT INTO app_settings (k,v) VALUES ('setup_code_sha256', '<sha256 of a code you choose>')"
npm run dev                   # http://127.0.0.1:8787 (builds the frontend first)
```

Open the app, enter the setup code and create the first admin account.

## Deploy

Pushes to `main` deploy automatically through Cloudflare Workers Builds (`npx wrangler deploy`, which runs
`npm run build` first). Database migrations are applied separately:

```bash
npx wrangler d1 migrations apply loopline --remote
```

### Client email capture (optional)

1. In Cloudflare, add a subdomain for mail (e.g. `in.lpwrk.dev`) under **Email → Email Routing**, so it does not
   clash with Google Workspace on the main domain.
2. Add a catch-all rule for that subdomain: **Send to a Worker → `loopline`**.
3. In the Worker settings add a variable `INBOUND_DOMAIN = in.lpwrk.dev`.

Emails to `<projectkey>@in.lpwrk.dev` (e.g. `lwd@in.lpwrk.dev`) are stored in that project's correspondence.
Attachments are listed by name only (no file storage, to stay on the free plan).

Optional hardening: set a Worker secret `AUTH_PEPPER` (a long random string) **before** creating users.
Changing it later invalidates existing passwords.

## Cost guardrails

Only Workers, D1, static assets and (optionally) Email Routing are used — all on the Free plan. No R2, KV, Queues or paid add-ons.
If a daily free limit is ever exceeded, requests fail until the next day; nothing is billed.


