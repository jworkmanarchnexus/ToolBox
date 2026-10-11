-- Toolbox schema. Written to port to SQL Server or PostgreSQL: plain types, no SQLite-only features.
-- Times are milliseconds since epoch (BIGINT-sized integers). Ids are app-generated text.

CREATE TABLE IF NOT EXISTS schema_info (
  version INTEGER NOT NULL
);

-- ---- core tables (shared by every module) ----

CREATE TABLE IF NOT EXISTS people (
  id             TEXT PRIMARY KEY,
  username       TEXT NOT NULL UNIQUE,          -- the domain account in production
  display_name   TEXT NOT NULL,
  email          TEXT,
  title          TEXT,
  firm_role      TEXT,                          -- NULL, 'admin' or 'viewer'. Toolbox data, not from Vantagepoint
  vp_employee_id TEXT UNIQUE,
  active         INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS projects (
  id             TEXT PRIMARY KEY,
  number         TEXT NOT NULL,
  name           TEXT NOT NULL,
  client         TEXT,
  status         TEXT NOT NULL,                 -- 'active' or 'archived'
  vp_project_id  TEXT UNIQUE,
  vp_number      TEXT,
  source         TEXT NOT NULL,                 -- 'local' or 'vantagepoint'
  schema_version INTEGER NOT NULL,
  rev            INTEGER NOT NULL,
  created_at     BIGINT NOT NULL,
  created_by     TEXT,
  updated_at     BIGINT NOT NULL,
  updated_by     TEXT
);

CREATE TABLE IF NOT EXISTS project_team (
  project_id TEXT NOT NULL,
  person_id  TEXT NOT NULL,
  role       TEXT NOT NULL,                     -- 'pic', 'pm', 'pa' or 'team'
  PRIMARY KEY (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS access_overrides (
  id         TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  person_id  TEXT NOT NULL,
  kind       TEXT NOT NULL,                     -- 'deny', 'grant_viewer' or 'grant_editor'
  reason     TEXT,
  created_by TEXT,
  created_at BIGINT NOT NULL,
  UNIQUE (project_id, person_id)
);

CREATE TABLE IF NOT EXISTS firm_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,                     -- JSON
  rev        INTEGER NOT NULL,
  updated_at BIGINT NOT NULL,
  updated_by TEXT
);

-- ---- module records (one table for every module; see docs/DECISIONS.md) ----

CREATE TABLE IF NOT EXISTS records (
  module         TEXT NOT NULL,
  collection     TEXT NOT NULL,
  id             TEXT NOT NULL,
  project_id     TEXT,                          -- NULL for firm-level or personal records
  rev            INTEGER NOT NULL,
  schema_version INTEGER NOT NULL,
  data           TEXT NOT NULL,                 -- JSON
  created_at     BIGINT NOT NULL,
  created_by     TEXT NOT NULL,
  updated_at     BIGINT NOT NULL,
  updated_by     TEXT NOT NULL,
  deleted        INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (module, collection, id)
);
CREATE INDEX IF NOT EXISTS records_since ON records (module, collection, updated_at);
CREATE INDEX IF NOT EXISTS records_project ON records (project_id);

-- short-lived "who is editing" markers, refreshed by the poll
CREATE TABLE IF NOT EXISTS locks (
  module     TEXT NOT NULL,
  collection TEXT NOT NULL,
  record_id  TEXT NOT NULL,
  person_id  TEXT NOT NULL,
  expires_at BIGINT NOT NULL,
  PRIMARY KEY (module, collection, record_id)
);
