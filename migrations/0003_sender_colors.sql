-- Colour per sender in a project's client correspondence (Threads-style view).
CREATE TABLE correspondence_senders (
  project_id  TEXT NOT NULL REFERENCES projects(id),
  sender_key  TEXT NOT NULL,          -- lower-case email, or the name when there is no email
  color       TEXT NOT NULL,          -- palette key, e.g. 'blue'
  updated_by  TEXT REFERENCES users(id),
  updated_at  INTEGER NOT NULL,
  PRIMARY KEY (project_id, sender_key)
);
