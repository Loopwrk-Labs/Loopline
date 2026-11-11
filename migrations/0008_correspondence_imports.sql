-- Imported conversations (WhatsApp, Viber, e-mail files, Word/PDF…): one row per import, so it can be undone.
CREATE TABLE correspondence_imports (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  file_name   TEXT,
  format      TEXT,
  count       INTEGER NOT NULL,
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_corr_imports_project ON correspondence_imports(project_id, created_at);
ALTER TABLE correspondence ADD COLUMN import_id TEXT;
