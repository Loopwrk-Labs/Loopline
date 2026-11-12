-- Statements imported from formatted documents keep the document's formatting (lists, bold, italic, colours).
-- `quote` stays the plain text (search, SHA-256 proof); `quote_html` is the sanitised display version.
ALTER TABLE statements ADD COLUMN quote_html TEXT;
