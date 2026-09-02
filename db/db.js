// SQLite connection + schema bootstrap.
// Uses Node's built-in node:sqlite module (stable in Node 22.5+) instead of a native
// npm dependency — no compiled binary to download/build, which makes deploys more reliable.
const path = require('path');
const fs = require('fs');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = path.join(DATA_DIR, 'tho.db');

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
db.exec(schema);

// ===================== Lightweight migrations =====================
// schema.sql only uses CREATE TABLE IF NOT EXISTS, so it never touches tables that already
// exist on a live database. Anything added to the schema after first release needs an
// explicit, idempotent migration here so existing deployments (with real data) pick it up.

function columnExists(table, column) {
  return db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column);
}

// answers.photo — plain additive column, safe to ALTER TABLE directly.
if (!columnExists('answers', 'photo')) {
  db.exec("ALTER TABLE answers ADD COLUMN photo TEXT DEFAULT ''");
  console.log('[migrate] answers.photo column added');
}

// hotels.logo_data — plain additive column, safe to ALTER TABLE directly.
if (!columnExists('hotels', 'logo_data')) {
  db.exec("ALTER TABLE hotels ADD COLUMN logo_data TEXT DEFAULT ''");
  console.log('[migrate] hotels.logo_data column added');
}

// hotels.photo_data — a real photo of the property (building/exterior), shown on the report
// cover next to the logo. Separate column from logo_data since they serve different visual
// roles on the report (small mark vs. a large hero image) and a hotel may want one without
// the other.
if (!columnExists('hotels', 'photo_data')) {
  db.exec("ALTER TABLE hotels ADD COLUMN photo_data TEXT DEFAULT ''");
  console.log('[migrate] hotels.photo_data column added');
}

// users.token_version — closes a real security gap: JWTs are stateless and were valid for
// their full 30-day life regardless of a later password/username change, so a session/cookie
// obtained before a credential change (e.g. during the earlier demo-credentials incident)
// kept working as that user on whatever device held it. requireAuth now rejects any token
// whose "tv" claim doesn't match the user's current token_version, and password/username
// changes bump it — which also means every token issued before this migration (none of which
// carry a "tv" claim at all) is invalidated the moment this deploys, forcing a fresh login
// everywhere. That's intentional here, not a side effect to work around.
if (!columnExists('users', 'token_version')) {
  db.exec("ALTER TABLE users ADD COLUMN token_version INTEGER NOT NULL DEFAULT 0");
  console.log('[migrate] users.token_version column added — all existing sessions will need to log in again');
}

// users.email — additive column for self-service "forgot password" (sends a reset link to
// whatever's on file here). Existing accounts simply have '' until an admin fills it in.
if (!columnExists('users', 'email')) {
  db.exec("ALTER TABLE users ADD COLUMN email TEXT DEFAULT ''");
  console.log('[migrate] users.email column added');
}

// users: allow role='hotel' + hotel_id column. SQLite can't ALTER a CHECK constraint, so an
// existing users table (created before this change) needs to be rebuilt.
const usersTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get();
if (usersTableSql && !usersTableSql.sql.includes("'hotel'")) {
  db.exec('PRAGMA foreign_keys = OFF');
  // legacy_alter_table=ON stops SQLite from rewriting OTHER tables' stored "REFERENCES users(id)"
  // schema text to "REFERENCES users_old(id)" when we rename users below. Those references stay
  // pointed at the name "users", which becomes valid again once we recreate that table further down.
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE users RENAME TO users_old');
    db.exec(`CREATE TABLE users (
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
    )`);
    const oldHasEmail = columnExists('users_old', 'email');
    const oldHasTokenVersion = columnExists('users_old', 'token_version');
    db.exec(`INSERT INTO users (id, role, username, password_hash, name_en, name_ar, title_en, title_ar, email, hotel_id, token_version, created_at)
      SELECT id, role, username, password_hash, name_en, name_ar, title_en, title_ar, ${oldHasEmail ? 'email' : "''"}, NULL, ${oldHasTokenVersion ? 'token_version' : '0'}, created_at FROM users_old`);
    db.exec('DROP TABLE users_old');
    db.exec('COMMIT');
    console.log('[migrate] users table upgraded — hotel role + hotel_id column added');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA legacy_alter_table = OFF');
    db.exec('PRAGMA foreign_keys = ON');
    throw e;
  }
  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
}

// inspections.inspector_id: change ON DELETE CASCADE to ON DELETE SET NULL (and drop the
// NOT NULL) so that deleting an inspector's user account no longer cascades into silently
// destroying every completed inspection report they ever filed. See the comment on this
// column in schema.sql for the full rationale. SQLite can't ALTER a foreign key's ON DELETE
// action in place, so an existing inspections table (created before this fix) needs to be
// rebuilt, same rename/recreate/copy/drop approach used for the users table migration above.
const inspectionsTableSql = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='inspections'").get();
if (inspectionsTableSql && inspectionsTableSql.sql.includes('inspector_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE')) {
  db.exec('PRAGMA foreign_keys = OFF');
  db.exec('PRAGMA legacy_alter_table = ON');
  db.exec('BEGIN');
  try {
    db.exec('ALTER TABLE inspections RENAME TO inspections_old');
    db.exec(`CREATE TABLE inspections (
      id TEXT PRIMARY KEY,
      assignment_id TEXT REFERENCES assignments(id) ON DELETE SET NULL,
      hotel_id TEXT NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
      inspector_id TEXT REFERENCES users(id) ON DELETE SET NULL,
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
    )`);
    db.exec(`INSERT INTO inspections (id, assignment_id, hotel_id, inspector_id, standard_id, property_name, property_type_label, city, inspector_name, visit_date, ref, status, signature, completed_at, created_at)
      SELECT id, assignment_id, hotel_id, inspector_id, standard_id, property_name, property_type_label, city, inspector_name, visit_date, ref, status, signature, completed_at, created_at FROM inspections_old`);
    db.exec('DROP TABLE inspections_old');
    db.exec('COMMIT');
    console.log('[migrate] inspections.inspector_id changed from ON DELETE CASCADE to ON DELETE SET NULL -- deleting an inspector no longer deletes their past reports');
  } catch (e) {
    db.exec('ROLLBACK');
    db.exec('PRAGMA legacy_alter_table = OFF');
    db.exec('PRAGMA foreign_keys = ON');
    throw e;
  }
  db.exec('PRAGMA legacy_alter_table = OFF');
  db.exec('PRAGMA foreign_keys = ON');
}

module.exports = db;
