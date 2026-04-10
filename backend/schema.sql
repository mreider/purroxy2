-- Purroxy D1 Database Schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'trial', -- trial, active, canceled, expired
  plan TEXT NOT NULL DEFAULT 'trial', -- trial, monthly, contributor
  trial_ends_at TEXT,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_subscriptions_user ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe ON subscriptions(stripe_customer_id);

-- Community library
CREATE TABLE IF NOT EXISTS community_capabilities (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  hostname TEXT NOT NULL,
  actions_json TEXT NOT NULL,
  parameters_json TEXT NOT NULL,
  extraction_rules_json TEXT NOT NULL,
  viewport_json TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected
  install_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_community_status ON community_capabilities(status);
CREATE INDEX IF NOT EXISTS idx_community_hostname ON community_capabilities(hostname);
CREATE INDEX IF NOT EXISTS idx_community_user ON community_capabilities(user_id);
