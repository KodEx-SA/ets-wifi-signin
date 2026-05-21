PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS plans (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  name             TEXT    NOT NULL,
  duration_hours   REAL    NOT NULL,
  data_limit_mb    REAL    NOT NULL,
  description      TEXT,
  is_active        INTEGER NOT NULL DEFAULT 1,
  created_at       TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS users (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name_enc    TEXT,
  full_name_ga     TEXT,
  email_enc        TEXT,
  email_ga         TEXT,
  email_hash       TEXT UNIQUE,
  phone_enc        TEXT,
  phone_ga         TEXT,
  phone_hash       TEXT UNIQUE,
  sa_id_enc        TEXT,
  sa_id_ga         TEXT,
  sa_id_hash       TEXT UNIQUE,
  auth_method      TEXT NOT NULL DEFAULT 'email',
  status           TEXT NOT NULL DEFAULT 'active',
  plan_id          INTEGER REFERENCES plans(id),
  created_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_users_email_hash  ON users(email_hash);
CREATE INDEX IF NOT EXISTS idx_users_phone_hash  ON users(phone_hash);
CREATE INDEX IF NOT EXISTS idx_users_sa_id_hash  ON users(sa_id_hash);

CREATE TABLE IF NOT EXISTS credentials (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  password_hash TEXT    NOT NULL,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS devices (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  mac_hash         TEXT    NOT NULL UNIQUE,
  mac_enc          TEXT    NOT NULL,
  mac_ga           TEXT    NOT NULL,
  user_id          INTEGER REFERENCES users(id) ON DELETE SET NULL,
  device_info_enc  TEXT,
  first_seen       TEXT    NOT NULL DEFAULT (datetime('now')),
  last_seen        TEXT    NOT NULL DEFAULT (datetime('now')),
  is_blocked       INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_devices_mac_hash ON devices(mac_hash);

CREATE TABLE IF NOT EXISTS sessions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  device_id      INTEGER REFERENCES devices(id) ON DELETE SET NULL,
  session_token  TEXT    NOT NULL UNIQUE,
  plan_id        INTEGER REFERENCES plans(id),
  ip_enc         TEXT,
  started_at     TEXT    NOT NULL DEFAULT (datetime('now')),
  expires_at     TEXT    NOT NULL,
  data_used_mb   REAL    NOT NULL DEFAULT 0,
  data_limit_mb  REAL    NOT NULL,
  period_number  INTEGER NOT NULL DEFAULT 1,
  period_start   TEXT    NOT NULL DEFAULT (datetime('now')),
  period_end     TEXT    NOT NULL,
  status         TEXT    NOT NULL DEFAULT 'active',
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_sessions_token  ON sessions(session_token);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);

CREATE TABLE IF NOT EXISTS otp_codes (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  phone_hash  TEXT    NOT NULL,
  code_hash   TEXT    NOT NULL,
  expires_at  TEXT    NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS admins (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  username_hash  TEXT    NOT NULL UNIQUE,
  username_enc   TEXT    NOT NULL,
  username_ga    TEXT    NOT NULL,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL DEFAULT 'admin',
  is_active      INTEGER NOT NULL DEFAULT 1,
  last_login_at  TEXT,
  created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  admin_id    INTEGER REFERENCES admins(id) ON DELETE SET NULL,
  event_type  TEXT    NOT NULL,
  ip_enc      TEXT,
  mac_hash    TEXT,
  auth_method TEXT,
  detail_enc  TEXT,
  detail_ga   TEXT,
  created_at  TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_logs_event_type ON logs(event_type);
CREATE INDEX IF NOT EXISTS idx_logs_created_at ON logs(created_at);
