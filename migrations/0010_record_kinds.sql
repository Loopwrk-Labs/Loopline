-- Records ("zapisi") have a kind: 'statements' (documents, meetings…) or 'thread' (the project's correspondence,
-- shown as Loopthreads). Each project gets one thread record so correspondence sits next to the documents and can be renamed.
ALTER TABLE statement_docs ADD COLUMN kind TEXT NOT NULL DEFAULT 'statements';
