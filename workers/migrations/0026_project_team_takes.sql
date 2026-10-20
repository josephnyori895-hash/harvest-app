-- Project team takes: a project can be taken individually (the default,
-- already covered by project_participants) or collectively — by a group,
-- a department or a whole community. The first member to pledge on behalf
-- of an entity creates the take ("taken by"); other members then opt in as
-- helpers with their own pledge (= 0 allowed: hands-on help without money).
-- Money actually moved still flows through project_contributions exactly
-- as before; takes and helpers are pledges only.

CREATE TABLE IF NOT EXISTS project_takes (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('group','department','community')),
  name TEXT NOT NULL,
  taken_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  committed_kes REAL NOT NULL DEFAULT 0 CHECK (committed_kes >= 0),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (project_id, kind, name)
);
CREATE INDEX IF NOT EXISTS idx_project_takes_project ON project_takes(project_id, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_project_takes_taken_by ON project_takes(taken_by, updated_at DESC);

CREATE TABLE IF NOT EXISTS project_take_helpers (
  take_id TEXT NOT NULL REFERENCES project_takes(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  commitment_kes REAL NOT NULL DEFAULT 0 CHECK (commitment_kes >= 0),
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (take_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_project_take_helpers_user ON project_take_helpers(user_id, updated_at DESC);
