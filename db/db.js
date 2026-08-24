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
      hotel_id TEXT REFERENCES hotels(id) ON DELETE CASCADE,
      created_at INTEGER NOT NULL
    )`);
    db.exec(`INSERT INTO users (id, role, username, password_hash, name_en, name_ar, title_en, title_ar, hotel_id, created_at)
      SELECT id, role, username, password_hash, name_en, name_ar, title_en, title_ar, NULL, created_at FROM users_old`);
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

module.exports = db;
