-- "Zapis": a register of who said what (requirements, promises, claims, decisions, questions),
-- with the parties in the project chain, source documents, and links between statements.
CREATE TABLE project_parties (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  name        TEXT NOT NULL,
  role        TEXT NOT NULL,              -- client | agency | partner | us
  position    INTEGER NOT NULL,           -- order in the chain, client first
  people      TEXT NOT NULL DEFAULT '',   -- names / e-mail domains, comma separated (to recognise senders)
  created_at  INTEGER NOT NULL
);
CREATE INDEX idx_parties_project ON project_parties(project_id, position);

CREATE TABLE statement_docs (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  file_name      TEXT,
  title          TEXT,
  content_sha256 TEXT,
  count          INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id),
  created_at     INTEGER NOT NULL
);

CREATE TABLE statements (
  id             TEXT PRIMARY KEY,
  project_id     TEXT NOT NULL REFERENCES projects(id),
  topic          TEXT,
  kind           TEXT NOT NULL,            -- requirement | promise | claim | decision | question
  party_id       TEXT REFERENCES project_parties(id),
  via_party_id   TEXT REFERENCES project_parties(id),   -- delivered through (e.g. client brief via the partner)
  said_by        TEXT,
  said_at        INTEGER NOT NULL,
  quote          TEXT NOT NULL,
  note           TEXT,
  status         TEXT NOT NULL DEFAULT 'open',   -- open | done | dropped
  due_at         INTEGER,
  source_type    TEXT NOT NULL DEFAULT 'other',  -- document | message | meeting | call | other
  source_label   TEXT,
  source_msg_id  TEXT REFERENCES correspondence(id),
  doc_id         TEXT REFERENCES statement_docs(id),
  content_sha256 TEXT,
  locked         INTEGER NOT NULL DEFAULT 0,
  created_by     TEXT REFERENCES users(id),
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER
);
CREATE INDEX idx_statements_project ON statements(project_id, said_at);

CREATE TABLE statement_links (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id),
  from_id     TEXT NOT NULL REFERENCES statements(id),
  to_id       TEXT NOT NULL REFERENCES statements(id),
  kind        TEXT NOT NULL,              -- changes | contradicts | confirms
  created_by  TEXT REFERENCES users(id),
  created_at  INTEGER NOT NULL,
  UNIQUE (from_id, to_id, kind)
);
