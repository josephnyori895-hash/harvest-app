CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal_kes REAL NOT NULL CHECK (goal_kes > 0),
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('upcoming','active','paused','completed','closed')),
  auto_advertise INTEGER NOT NULL DEFAULT 1 CHECK (auto_advertise IN (0,1)),
  advertise_from TEXT,
  advertise_until TEXT,
  advertise_frequency_days INTEGER NOT NULL DEFAULT 3 CHECK (advertise_frequency_days BETWEEN 1 AND 30),
  icon TEXT NOT NULL DEFAULT '🤲',
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_projects_status_ad ON projects(status, auto_advertise, created_at DESC);

CREATE TABLE IF NOT EXISTS project_participants (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commitment_kes REAL NOT NULL DEFAULT 0 CHECK (commitment_kes >= 0),
  reminder_enabled INTEGER NOT NULL DEFAULT 1 CHECK (reminder_enabled IN (0,1)),
  last_reminded_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (project_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_participants_user ON project_participants(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_contributions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  giving_transaction_id TEXT UNIQUE REFERENCES giving_transactions(id) ON DELETE SET NULL,
  amount_kes REAL NOT NULL CHECK (amount_kes > 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_project_contributions_project ON project_contributions(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_project_contributions_user ON project_contributions(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS project_reminders (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  scheduled_for TEXT NOT NULL,
  sent_at TEXT,
  UNIQUE(project_id, user_id, kind, scheduled_for)
);
CREATE INDEX IF NOT EXISTS idx_project_reminders_due ON project_reminders(scheduled_for, sent_at);

ALTER TABLE giving_transactions ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_giving_project ON giving_transactions(project_id, created_at DESC);
