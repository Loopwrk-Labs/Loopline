-- Loopline initial schema

CREATE TABLE users (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name          TEXT NOT NULL,
  initials      TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin','manager','member')),
  pass_hash     TEXT NOT NULL,
  pass_salt     TEXT NOT NULL,
  pass_iter     INTEGER NOT NULL,
  lang_pref     TEXT NOT NULL DEFAULT 'project' CHECK (lang_pref IN ('project','sr','en')),
  theme         TEXT NOT NULL DEFAULT 'auto' CHECK (theme IN ('auto','light','dark')),
  must_change_pw INTEGER NOT NULL DEFAULT 0,
  active        INTEGER NOT NULL DEFAULT 1,
  created_at    INTEGER NOT NULL
);

CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,           -- SHA-256 of the cookie token
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE login_attempts (
  k   TEXT NOT NULL,                      -- 'email:<x>' or 'ip:<x>'
  at  INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(k, at);

CREATE TABLE projects (
  id          TEXT PRIMARY KEY,
  key         TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  client      TEXT,
  lang        TEXT NOT NULL DEFAULT 'sr' CHECK (lang IN ('sr','en')),
  next_num    INTEGER NOT NULL DEFAULT 1,
  next_epic   INTEGER NOT NULL DEFAULT 1,
  archived    INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE TABLE sprints (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  goal        TEXT,
  start_date  TEXT,                       -- YYYY-MM-DD
  end_date    TEXT,
  status      TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned','active','closed')),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_sprints_project ON sprints(project_id);

CREATE TABLE sprint_capacity (
  sprint_id   TEXT NOT NULL REFERENCES sprints(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  hours       REAL NOT NULL,
  PRIMARY KEY (sprint_id, user_id)
);

CREATE TABLE items (
  id              TEXT PRIMARY KEY,
  project_id      TEXT NOT NULL REFERENCES projects(id),
  key             TEXT NOT NULL,
  type            TEXT NOT NULL CHECK (type IN ('epic','story','bug','task')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL DEFAULT '',
  status          TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo','in_progress','in_review','blocked','done')),
  parent_id       TEXT REFERENCES items(id),
  sprint_id       TEXT REFERENCES sprints(id),
  assignee_id     TEXT REFERENCES users(id),
  reporter_id     TEXT REFERENCES users(id),
  points          REAL,
  scope_hours     REAL,
  scope_baseline  REAL,
  actual_hours    REAL,
  due_date        TEXT,
  labels          TEXT NOT NULL DEFAULT '',
  billable        INTEGER NOT NULL DEFAULT 1,
  position        REAL NOT NULL DEFAULT 0,
  started_at      INTEGER,
  done_at         INTEGER,
  archived        INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL,
  updated_at      INTEGER NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX idx_items_project ON items(project_id, archived);
CREATE INDEX idx_items_parent ON items(parent_id);
CREATE INDEX idx_items_sprint ON items(sprint_id);

CREATE TABLE logbook (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  item_id     TEXT REFERENCES items(id),
  user_id     TEXT REFERENCES users(id),
  kind        TEXT NOT NULL CHECK (kind IN ('note','change')),
  field       TEXT,
  old_value   TEXT,
  new_value   TEXT,
  body        TEXT,
  pinned      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_logbook_item ON logbook(item_id, created_at);
CREATE INDEX idx_logbook_project ON logbook(project_id, created_at);

-- One-time setup code (SHA-256). First-admin setup is refused unless a matching code is given.
CREATE TABLE app_settings (
  k  TEXT PRIMARY KEY,
  v  TEXT NOT NULL
);
