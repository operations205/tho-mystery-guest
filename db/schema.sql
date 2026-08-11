-- THO Mystery Guest Platform — SQLite schema

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  role TEXT NOT NULL CHECK(role IN ('admin','inspector')),
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name_en TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  title_en TEXT DEFAULT '',
  title_ar TEXT DEFAULT '',
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
  PRIMARY KEY (inspection_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_assignments_inspector ON assignments(inspector_id);
CREATE INDEX IF NOT EXISTS idx_assignments_hotel ON assignments(hotel_id);
CREATE INDEX IF NOT EXISTS idx_inspections_hotel ON inspections(hotel_id);
CREATE INDEX IF NOT EXISTS idx_inspections_inspector ON inspections(inspector_id);
CREATE INDEX IF NOT EXISTS idx_answers_inspection ON answers(inspection_id);
