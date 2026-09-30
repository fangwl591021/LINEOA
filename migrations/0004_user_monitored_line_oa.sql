-- Optional for existing/self-registered users; required by the admin-create API.
-- A declared LINE@ is metadata, not proof of LINE ownership or authorization.
ALTER TABLE users ADD COLUMN monitored_line_oa TEXT NOT NULL DEFAULT '';
