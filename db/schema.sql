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
  hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL
);

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
