-- Rich-text body for correspondence (sanitized HTML: p, br, b/strong, i/em, u, ul/ol/li, a[href], blockquote).
-- `body` keeps the plain-text version for search, filters and quotes.
ALTER TABLE correspondence ADD COLUMN body_html TEXT;
