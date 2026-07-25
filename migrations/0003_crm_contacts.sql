CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  line_uid TEXT NOT NULL,
  display_name TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  source TEXT NOT NULL DEFAULT 'chat_auto_capture',
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  last_chat_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE(user_id, line_uid)
);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_user_updated
  ON crm_contacts(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_crm_contacts_user_status
  ON crm_contacts(user_id, status);
