-- Statement status follows the thread workflow: open → waiting on us / waiting on client → resolved.
UPDATE statements SET status = 'resolved' WHERE status IN ('done', 'dropped');
