PRAGMA foreign_keys = ON;

ALTER TABLE symptom_rules ADD COLUMN category TEXT NOT NULL DEFAULT 'other'
  CHECK (category IN ('pain', 'breathing', 'fever', 'injury', 'other'));
ALTER TABLE symptom_rules ADD COLUMN urgency_level TEXT NOT NULL DEFAULT 'routine'
  CHECK (urgency_level IN ('routine', 'urgent', 'emergency'));
ALTER TABLE symptom_rules ADD COLUMN is_enabled INTEGER NOT NULL DEFAULT 0
  CHECK (is_enabled IN (0, 1));
ALTER TABLE symptom_rules ADD COLUMN reviewer_qualification TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS symptom_questions (
  id TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('pain', 'breathing', 'fever', 'injury', 'other')),
  prompt TEXT NOT NULL CHECK (length(prompt) BETWEEN 5 AND 500),
  input_type TEXT NOT NULL CHECK (input_type IN ('yes_no', 'single_choice')),
  options_json TEXT NOT NULL CHECK (json_valid(options_json)),
  is_required INTEGER NOT NULL DEFAULT 1 CHECK (is_required IN (0, 1)),
  position INTEGER NOT NULL CHECK (position BETWEEN 1 AND 50),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  is_enabled INTEGER NOT NULL DEFAULT 0 CHECK (is_enabled IN (0, 1)),
  clinical_source TEXT NOT NULL DEFAULT '',
  reviewed_by TEXT NOT NULL DEFAULT '',
  reviewer_qualification TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  created_at TEXT NOT NULL,
  CHECK (is_enabled = 0 OR (status = 'approved' AND length(clinical_source) > 8 AND length(reviewed_by) > 2 AND length(reviewer_qualification) > 4 AND reviewed_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_symptom_questions_order
  ON symptom_questions(category, position) WHERE status != 'retired';

CREATE TABLE IF NOT EXISTS symptom_engine_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  public_enabled INTEGER NOT NULL DEFAULT 0 CHECK (public_enabled IN (0, 1)),
  review_status TEXT NOT NULL DEFAULT 'pending' CHECK (review_status IN ('pending', 'approved', 'suspended')),
  reviewer_name TEXT NOT NULL DEFAULT '',
  reviewer_qualification TEXT NOT NULL DEFAULT '',
  review_evidence TEXT NOT NULL DEFAULT '',
  reviewed_at TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  CHECK (public_enabled = 0 OR (review_status = 'approved' AND length(reviewer_name) > 2 AND length(reviewer_qualification) > 4 AND length(review_evidence) > 8 AND reviewed_at IS NOT NULL))
);
INSERT OR IGNORE INTO symptom_engine_settings (id, public_enabled, review_status, updated_at)
VALUES (1, 0, 'pending', '2026-01-01T00:00:00Z');

CREATE TABLE IF NOT EXISTS clinical_reviewers (
  admin_id TEXT PRIMARY KEY REFERENCES admin_users(id) ON DELETE CASCADE,
  reviewer_name TEXT NOT NULL CHECK (length(reviewer_name) BETWEEN 3 AND 120),
  qualification TEXT NOT NULL CHECK (length(qualification) BETWEEN 5 AND 200),
  registration_reference TEXT NOT NULL CHECK (length(registration_reference) BETWEEN 3 AND 200),
  verified_by TEXT NOT NULL CHECK (length(verified_by) BETWEEN 3 AND 120),
  verified_at TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 0 CHECK (is_active IN (0, 1))
);

CREATE TABLE IF NOT EXISTS symptom_rule_audit (
  id TEXT PRIMARY KEY,
  admin_id TEXT NOT NULL REFERENCES admin_users(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('question', 'rule', 'engine')),
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (length(action) BETWEEN 3 AND 100),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_symptom_rule_audit_time ON symptom_rule_audit(created_at DESC);

CREATE TRIGGER IF NOT EXISTS enforce_question_review_before_enable
BEFORE UPDATE OF is_enabled ON symptom_questions
WHEN NEW.is_enabled = 1 AND (
  NEW.status != 'approved' OR length(NEW.clinical_source) <= 8 OR
  length(NEW.reviewed_by) <= 2 OR length(NEW.reviewer_qualification) <= 4 OR NEW.reviewed_at IS NULL
)
BEGIN SELECT RAISE(ABORT, 'Question requires qualified clinical review before enabling'); END;

CREATE TRIGGER IF NOT EXISTS enforce_rule_review_before_enable
BEFORE UPDATE OF is_enabled ON symptom_rules
WHEN NEW.is_enabled = 1 AND (
  NEW.status != 'approved' OR length(NEW.clinical_source) <= 8 OR
  length(NEW.reviewed_by) <= 2 OR length(NEW.reviewer_qualification) <= 4 OR
  NEW.reviewed_at IS NULL OR NOT EXISTS (
    SELECT 1 FROM symptom_questions q WHERE q.id = NEW.question_key
      AND q.category = NEW.category AND q.status = 'approved' AND q.is_enabled = 1
  )
)
BEGIN SELECT RAISE(ABORT, 'Rule and question require qualified clinical review before enabling'); END;

CREATE TRIGGER IF NOT EXISTS enforce_engine_review_before_enable
BEFORE UPDATE OF public_enabled ON symptom_engine_settings
WHEN NEW.public_enabled = 1 AND (
  NEW.review_status != 'approved' OR length(NEW.reviewer_name) <= 2 OR
  length(NEW.reviewer_qualification) <= 4 OR length(NEW.review_evidence) <= 8 OR NEW.reviewed_at IS NULL OR
  NOT EXISTS (SELECT 1 FROM symptom_questions WHERE status = 'approved' AND is_enabled = 1) OR
  NOT EXISTS (SELECT 1 FROM symptom_rules WHERE status = 'approved' AND is_enabled = 1 AND urgency_level = 'emergency')
)
BEGIN SELECT RAISE(ABORT, 'Engine requires reviewed questions and an emergency rule before enabling'); END;
