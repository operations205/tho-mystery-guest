-- THO Mystery Guest Platform — SQLite schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('admin','inspector','hotel')),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  title_en TEXT DEFAULT '',
  title_ar TEXT DEFAULT '',
  email TEXT DEFAULT '',
  hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
  token_version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

-- Self-service "forgot password" reset tokens. Only a hash of the raw token is stored (like
-- password_hash) so a DB read alone can never be used to reset an account. Tokens are single-use
-- (used flag) and short-lived (expires_at); requesting a new one for the same user should
-- invalidate any earlier unused tokens (enforced in the route, not here).
CREATE TABLE IF NOT EXISTS password_resets (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets(user_id);
CREATE INDEX IF NOT EXISTS idx_password_resets_hash ON password_resets(token_hash);

CREATE TABLE IF NOT EXISTS hotels (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  city_en TEXT NOT NULL,
  city_ar TEXT NOT NULL,
  type INTEGER NOT NULL,
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  logo_data TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS assignments (
  id TEXT PRIMARY KEY,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  inspector_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  due_date TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'normal' CHECK(priority IN ('low','normal','high')),
  standard_id TEXT NOT NULL DEFAULT 'audit4' CHECK(standard_id IN ('audit4','plus5')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','in_progress','completed')),
  inspection_id TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS inspections (
  id TEXT PRIMARY KEY,
  assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
  hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  inspector_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  standard_id TEXT NOT NULL DEFAULT 'audit4' CHECK(standard_id IN ('audit4','plus5')),
  property_name TEXT,
  property_type_label TEXT,
  city TEXT,
  inspector_name TEXT,
  visit_date TEXT,
  ref TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK(status IN ('in_progress','completed')),
  signature TEXT,
  completed_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS answers (
  inspection_id TEXT NOT NULL REFERENCES inspections(id) ON DELETE CASCADE,
  item_id TEXT NOT NULL,
  value TEXT CHECK(value IN ('yes','no','na') OR value IS NULL),
  note TEXT DEFAULT '',
  photo TEXT DEFAULT '',
  PRIMARY KEY (inspection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_inspector ON assignments(inspector_id);
CREATE INDEX IF NOT EXISTS idx_assignments_hotel ON assignments(hotel_id);
CREATE INDEX IF NOT EXISTS idx_inspections_hotel ON inspections(hotel_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_answers_inspection ON answers(inspection_id);

-- ===================== Settings (company profile) =====================
CREATE TABLE IF NOT EXISTS company_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  company_name_en TEXT NOT NULL DEFAULT 'THE HOTELIER OFFICE',
  company_name_ar TEXT NOT NULL DEFAULT 'ذا هوتيلير أوفيس',
  logo_data TEXT DEFAULT '',
  email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  website TEXT DEFAULT '',
  address TEXT DEFAULT '',
  updated_at INTEGER NOT NULL DEFAULT 0
);
INSERT OR IGNORE INTO company_settings (id) VALUES (1);

-- ===================== Document generator (proposals & contracts) =====================
-- One active template per type; uploading a new one replaces the previous.
CREATE TABLE IF NOT EXISTS doc_templates (
  type TEXT PRIMARY KEY CHECK(type IN ('proposal','contract')),
  original_name TEXT NOT NULL,
  file_data TEXT NOT NULL,
  uploaded_at INTEGER NOT NULL,
  uploaded_by TEXT
);

CREATE TABLE IF NOT EXISTS clients (
  id TEXT PRIMARY KEY,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  hotel_name_en TEXT DEFAULT '',
  hotel_name_ar TEXT DEFAULT '',
  contact TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  email TEXT DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS generated_documents (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK(type IN ('proposal','contract')),
  client_id TEXT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  file_data TEXT NOT NULL,
  data_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  created_by TEXT
);
CREATE INDEX IF NOT EXISTS idx_documents_client ON generated_documents(client_id);

-- One-time delivery for seeded demo-account passwords (see db/seed.js). Only the admin
-- bootstrap credential still goes to the process console (it's the only way to log in before
-- any session exists) -- every OTHER seeded account's temp password is stashed here instead of
-- being blasted into logs that Render retains indefinitely. The admin views this list exactly
-- once from an authenticated in-app screen after their first login; the route that serves it
-- deletes every row it returns, so it's gone from the DB the moment it's been shown.
CREATE TABLE IF NOT EXISTS seed_credentials (
  username TEXT PRIMARY KEY,
  role TEXT NOT NULL,
  password TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
