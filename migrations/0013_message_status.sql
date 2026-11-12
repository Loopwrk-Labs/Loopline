-- Each Loopthreads message can carry its own status (open / waiting_us / waiting_client / resolved); NULL = not tracked.
ALTER TABLE correspondence ADD COLUMN status TEXT;
