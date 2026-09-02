// SQLite backup strategy for the persistent-disk database.
//
// The DB lives on a single Render disk with no automatic snapshotting of its own -- an
// accidental deletion, a bad migration, or the disk itself failing would take every report,
// signature, and photo with it, with nothing to restore from. VACUUM INTO gives a
// transactionally-consistent, fully independent copy of the live database (safe to run while
// the app keeps serving requests) without needing a native sqlite3 CLI binary or any extra
// dependency -- just a single SQL statement the already-loaded db connection can run.
//
// This alone only protects against *logical* loss (bad data, accidental deletes, corruption)
// as long as backups are copied off the same disk before a *physical* loss (the whole Render
// disk going away). Two escape hatches for that: (1) an admin-only download route below, so an
// operator can periodically pull the latest backup off-instance by hand, and (2) if SMTP_USER/
// SMTP_APP_PASSWORD are configured (see mailer.js), each backup is additionally emailed to the
// admin as an attachment -- true off-instance delivery with zero extra infrastructure, reusing
// the mail setup that already exists for password resets.
const fs = require('fs');
const path = require('path');
const db = require('../../db/db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', '..', 'data');
const BACKUP_DIR = path.join(DATA_DIR, 'backups');
const MAX_BACKUPS = 7; // keep roughly a week of daily backups on-disk; older ones are pruned

function ensureBackupDir() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
}

function timestampedFilename() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `tho-backup-${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}.db`;
}

function pruneOldBackups() {
  const files = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('tho-backup-') && f.endsWith('.db'))
    .sort(); // filenames are zero-padded/UTC, so lexical sort == chronological sort
  const excess = files.length - MAX_BACKUPS;
  if (excess > 0) {
    files.slice(0, excess).forEach(f => {
      try { fs.unlinkSync(path.join(BACKUP_DIR, f)); } catch (e) { /* best-effort */ }
    });
  }
}

// Runs a single backup cycle: VACUUM INTO a fresh timestamped file, prune anything past the
// retention window, and (if mail is configured) email the fresh copy to the admin. Errors are
// caught and logged rather than thrown -- a failed backup should never crash the server or block
// a request; it should just be visible in the logs so it can be noticed and fixed.
async function runBackup() {
  try {
    ensureBackupDir();
    const filePath = path.join(BACKUP_DIR, timestampedFilename());
    // VACUUM INTO refuses to overwrite an existing file, but the timestamp in the filename
    // (down to the second) already makes collisions practically impossible.
    db.exec(`VACUUM INTO '${filePath.replace(/'/g, "''")}'`);
    pruneOldBackups();
    console.log(`[backup] wrote ${path.basename(filePath)}`);

    const { sendBackupEmail, isConfigured } = require('./mailer');
    if (isConfigured() && process.env.BACKUP_EMAIL_TO) {
      try {
        await sendBackupEmail({ to: process.env.BACKUP_EMAIL_TO, filePath });
        console.log('[backup] emailed off-instance copy to', process.env.BACKUP_EMAIL_TO);
      } catch (e) {
        console.error('[backup] failed to email off-instance copy', e.message);
      }
    }
  } catch (e) {
    console.error('[backup] backup cycle failed', e.message);
  }
}

function listBackups() {
  ensureBackupDir();
  return fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('tho-backup-') && f.endsWith('.db'))
    .sort()
    .reverse()
    .map(f => {
      const stat = fs.statSync(path.join(BACKUP_DIR, f));
      return { fileName: f, sizeBytes: stat.size, createdAt: stat.mtimeMs };
    });
}

function backupFilePath(fileName) {
  // Guard against path traversal (../../etc) -- only a bare filename matching our own naming
  // scheme is ever accepted.
  if (!/^tho-backup-[0-9]{8}-[0-9]{6}\.db$/.test(fileName)) return null;
  const full = path.join(BACKUP_DIR, fileName);
  return fs.existsSync(full) ? full : null;
}

// Schedules the first backup shortly after boot (so a short-lived dev/test run doesn't leave
// junk files, but any real deployment gets covered quickly) and then on a fixed interval.
function scheduleBackups(intervalMs = 24 * 60 * 60 * 1000) {
  setTimeout(runBackup, 60 * 1000);
  setInterval(runBackup, intervalMs);
}

module.exports = { runBackup, listBackups, backupFilePath, scheduleBackups, BACKUP_DIR };
