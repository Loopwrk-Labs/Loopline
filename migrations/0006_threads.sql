-- Thread metadata for Prepiska. A thread is identified by its first (root) message.
-- status NULL = automatic (derived from who wrote last); priority NULL = normal.
CREATE TABLE correspondence_threads (
  root_id     TEXT PRIMARY KEY REFERENCES correspondence(id),
  project_id  TEXT NOT NULL REFERENCES projects(id),
  category    TEXT,
  subtopic    TEXT,
  status      TEXT,          -- open | waiting_us | waiting_client | resolved
  priority    TEXT,          -- low | high
  tags        TEXT NOT NULL DEFAULT '[]',  -- JSON array of strings
  updated_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_corr_threads_project ON correspondence_threads(project_id);
