CREATE TABLE IF NOT EXISTS feature_entitlements (
  user_id TEXT NOT NULL,
  feature TEXT NOT NULL,
  trial_started_at TEXT,
  trial_ends_at TEXT,
  subscription_started_at TEXT,
  subscription_ends_at TEXT,
  price_twd INTEGER NOT NULL DEFAULT 199,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, feature),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_feature_entitlements_feature
  ON feature_entitlements(feature);

CREATE INDEX IF NOT EXISTS idx_feature_entitlements_subscription_ends
  ON feature_entitlements(subscription_ends_at);
