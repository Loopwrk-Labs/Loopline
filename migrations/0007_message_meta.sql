-- Category, subtopic and tags per message (a reply inherits its parent's when created).
ALTER TABLE correspondence ADD COLUMN category TEXT;
ALTER TABLE correspondence ADD COLUMN subtopic TEXT;
ALTER TABLE correspondence ADD COLUMN tags TEXT NOT NULL DEFAULT '[]';
-- Carry over what was set per thread so far: it now lives on the thread's first message.
UPDATE correspondence SET
  category = (SELECT t.category FROM correspondence_threads t WHERE t.root_id = correspondence.id),
  subtopic = (SELECT t.subtopic FROM correspondence_threads t WHERE t.root_id = correspondence.id),
  tags = COALESCE((SELECT t.tags FROM correspondence_threads t WHERE t.root_id = correspondence.id), '[]')
WHERE id IN (SELECT root_id FROM correspondence_threads);
