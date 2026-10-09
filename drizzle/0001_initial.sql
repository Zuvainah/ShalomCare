PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS articles (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL CHECK (length(title) BETWEEN 3 AND 180),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 2 AND 80),
  summary TEXT NOT NULL CHECK (length(summary) BETWEEN 10 AND 500),
  body TEXT NOT NULL CHECK (length(body) BETWEEN 20 AND 12000),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved')),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  reviewed_by TEXT,
  reviewed_at TEXT,
  review_evidence TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (status != 'approved' OR (is_demo = 0 AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND review_evidence IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_articles_public ON articles(status, is_demo, updated_at DESC);

CREATE TABLE IF NOT EXISTS facilities (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 3 AND 180),
  region TEXT NOT NULL CHECK (length(region) BETWEEN 2 AND 100),
  locality TEXT,
  address TEXT,
  is_verified INTEGER NOT NULL DEFAULT 0 CHECK (is_verified IN (0, 1)),
  is_demo INTEGER NOT NULL DEFAULT 0 CHECK (is_demo IN (0, 1)),
  verification_source TEXT,
  verified_by TEXT,
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (is_verified = 0 OR (is_demo = 0 AND verification_source IS NOT NULL AND verified_by IS NOT NULL AND verified_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_facilities_public ON facilities(is_verified, is_demo, region, name);

CREATE TABLE IF NOT EXISTS facility_services (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  service_name TEXT NOT NULL CHECK (length(service_name) BETWEEN 2 AND 160),
  details TEXT,
  source TEXT,
  verified_at TEXT,
  UNIQUE (facility_id, service_name)
);
CREATE INDEX IF NOT EXISTS idx_facility_services_facility ON facility_services(facility_id);

CREATE TABLE IF NOT EXISTS facility_contacts (
  id TEXT PRIMARY KEY,
  facility_id TEXT NOT NULL REFERENCES facilities(id) ON DELETE CASCADE,
  contact_type TEXT NOT NULL CHECK (contact_type IN ('phone', 'email', 'website')),
  contact_value TEXT NOT NULL CHECK (length(contact_value) BETWEEN 3 AND 300),
  source TEXT,
  verified_at TEXT,
  UNIQUE (facility_id, contact_type, contact_value)
);

CREATE TABLE IF NOT EXISTS symptom_rules (
  id TEXT PRIMARY KEY,
  rule_key TEXT NOT NULL UNIQUE,
  question_key TEXT NOT NULL,
  answer_value TEXT NOT NULL,
  result_code TEXT NOT NULL,
  result_message TEXT NOT NULL CHECK (length(result_message) BETWEEN 10 AND 1000),
  clinical_source TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  created_at TEXT NOT NULL,
  CHECK (status != 'approved' OR (length(clinical_source) > 8 AND length(reviewed_by) > 2))
);
CREATE INDEX IF NOT EXISTS idx_symptom_rules_live ON symptom_rules(status, question_key, answer_value);

CREATE TABLE IF NOT EXISTS admin_users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('editor', 'publisher', 'admin')),
  is_disabled INTEGER NOT NULL DEFAULT 0 CHECK (is_disabled IN (0, 1)),
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  token_hash TEXT PRIMARY KEY,
  csrf_hash TEXT NOT NULL,
  admin_id TEXT NOT NULL REFERENCES admin_users(id) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_admin_sessions_expiry ON admin_sessions(expires_at);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 100),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('article', 'facility')),
  entity_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_events_time ON audit_events(created_at DESC);

CREATE TABLE IF NOT EXISTS rate_limits (
  bucket_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket_key, window_start)
);

-- Clearly fictional placeholders. They are drafts and never appear in public APIs.
INSERT OR IGNORE INTO articles
  (id, slug, title, category, summary, body, status, is_demo, created_at, updated_at)
VALUES
  ('demo-article-hydration', 'demo-hydration', 'Demonstration: Staying hydrated', 'Demo', 'Fictional placeholder for layout testing only.', 'This fictional placeholder is not medical guidance and has not been reviewed or approved.', 'draft', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z'),
  ('demo-article-handwashing', 'demo-handwashing', 'Demonstration: Handwashing basics', 'Demo', 'Fictional placeholder for layout testing only.', 'This fictional placeholder is not medical guidance and has not been reviewed or approved.', 'draft', 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');

INSERT OR IGNORE INTO facilities
  (id, name, region, locality, is_verified, is_demo, created_at, updated_at)
VALUES
  ('demo-facility-only', 'Demonstration record — not a real clinic', 'DEMO ONLY', 'Fictional record', 0, 1, '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z');
