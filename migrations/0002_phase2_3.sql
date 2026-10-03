-- Phase 2 + 3: planning, saved views, metrics snapshots, project management

-- Sprint snapshot taken at start (for Say/Do and scope-added metrics).
ALTER TABLE sprints ADD COLUMN committed_points REAL;
ALTER TABLE sprints ADD COLUMN committed_items INTEGER;
ALTER TABLE sprints ADD COLUMN started_at INTEGER;
ALTER TABLE sprints ADD COLUMN closed_at INTEGER;

-- Project management fields.
ALTER TABLE projects ADD COLUMN description TEXT;
ALTER TABLE projects ADD COLUMN budget_hours REAL;
ALTER TABLE projects ADD COLUMN start_date TEXT;
ALTER TABLE projects ADD COLUMN end_date TEXT;
ALTER TABLE projects ADD COLUMN rag TEXT NOT NULL DEFAULT 'green' CHECK (rag IN ('green','amber','red'));
ALTER TABLE projects ADD COLUMN client_contact TEXT;
ALTER TABLE projects ADD COLUMN next_cr INTEGER NOT NULL DEFAULT 1;

-- Saved Grid views (filters + grouping), per user or shared with the team.
CREATE TABLE saved_views (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES users(id),
  name        TEXT NOT NULL,
  config      TEXT NOT NULL,
  shared      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_views_project ON saved_views(project_id);

-- Excel imports, so a whole import can be undone in one step.
CREATE TABLE imports (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  user_id     TEXT NOT NULL REFERENCES users(id),
  file_name   TEXT,
  created_ids TEXT NOT NULL DEFAULT '[]',
  updates     TEXT NOT NULL DEFAULT '[]',   -- [{id, before:{...}}]
  rows_new    INTEGER NOT NULL DEFAULT 0,
  rows_updated INTEGER NOT NULL DEFAULT 0,
  undone      INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

-- Client correspondence (inbound email or pasted manually).
CREATE TABLE correspondence (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  item_id     TEXT REFERENCES items(id),
  source      TEXT NOT NULL CHECK (source IN ('email','manual')),
  direction   TEXT NOT NULL DEFAULT 'in' CHECK (direction IN ('in','out')),
  from_addr   TEXT,
  to_addr     TEXT,
  cc_addr     TEXT,
  subject     TEXT,
  body        TEXT NOT NULL DEFAULT '',
  attachments TEXT NOT NULL DEFAULT '[]',     -- names and sizes only
  message_id  TEXT,
  sent_at     INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_corr_project ON correspondence(project_id, sent_at);
CREATE UNIQUE INDEX idx_corr_msgid ON correspondence(project_id, message_id) WHERE message_id IS NOT NULL;

-- Customer acceptance and change requests share one approval mechanism.
CREATE TABLE approvals (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id),
  kind          TEXT NOT NULL CHECK (kind IN ('acceptance','change_request')),
  key           TEXT NOT NULL,
  item_id       TEXT REFERENCES items(id),
  title         TEXT NOT NULL,
  body          TEXT NOT NULL DEFAULT '',
  impact_hours  REAL,
  impact_cost   REAL,
  impact_days   REAL,
  currency      TEXT,
  status        TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','accepted','rejected','withdrawn')),
  token_hash    TEXT,
  sent_at       INTEGER,
  content_sha256 TEXT,
  client_name   TEXT,
  client_email  TEXT,
  decided_at    INTEGER,
  decided_ip    TEXT,
  decided_ua    TEXT,
  decision_note TEXT,
  created_by    TEXT REFERENCES users(id),
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  UNIQUE (project_id, key)
);
CREATE INDEX idx_approvals_project ON approvals(project_id);
CREATE UNIQUE INDEX idx_approvals_token ON approvals(token_hash) WHERE token_hash IS NOT NULL;

-- Decision log.
CREATE TABLE decisions (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  title       TEXT NOT NULL,
  decision    TEXT NOT NULL,
  decided_by  TEXT,
  decided_on  TEXT,
  source      TEXT,
  correspondence_id TEXT REFERENCES correspondence(id),
  item_id     TEXT REFERENCES items(id),
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_decisions_project ON decisions(project_id, created_at);
