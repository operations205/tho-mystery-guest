const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { generateTempPassword } = require('../utils/tempPassword');
const { withinLength } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id, role: row.role, username: row.username,
    name: { en: row.name_en, ar: row.name_ar },
    title: { en: row.title_en, ar: row.title_ar }
  };
}

router.get('/', (req, res) => {
  if (req.user.role === 'hotel') return res.json([]); // not relevant to the hotel side
  const rows = db.prepare("SELECT * FROM users WHERE role='inspector' ORDER BY created_at DESC").all();
  res.json(rows.map(toPublic));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, username, title_en, title_ar } = req.body || {};
  if (!name_en || !name_ar) return res.status(400).json({ error: 'missing_fields' });
  if (![name_en, name_ar, title_en, title_ar].every(v => withinLength(v, 200)) || !withinLength(username, 50)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const uname = (username || name_en.split(' ')[0]).toLowerCase().replace(/[^a-z0-9_.]/g, '');
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(uname);
  if (existing) return res.status(409).json({ error: 'username_taken' });
  const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tempPassword = generateTempPassword();
  db.prepare(`INSERT INTO users (id, role, username, password_hash, name_en, name_ar, title_en, title_ar, created_at)
    VALUES (?, 'inspector', ?, ?, ?, ?, ?, ?, ?)`)
    .run(id, uname, bcrypt.hashSync(tempPassword, 10), name_en, name_ar, title_en || 'Inspector', title_ar || 'مفتش', Date.now());
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.status(201).json({ ...toPublic(row), tempPassword });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, title_en, title_ar, username } = req.body || {};
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='inspector'").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (![name_en, name_ar, title_en, title_ar].every(v => withinLength(v, 200)) || !withinLength(username, 50)) {
    return res.status(400).json({ error: 'field_too_long' });
  }

  let uname = existing.username;
  if (username !== undefined && String(username).trim() && String(username).trim() !== existing.username) {
    uname = String(username).trim().toLowerCase().replace(/[^a-z0-9_.]/g, '');
    const clash = db.prepare('SELECT id FROM users WHERE username=? AND id != ?').get(uname, req.params.id);
    if (clash) return res.status(409).json({ error: 'username_taken' });
  }
  // Changing the login username is a credential change — bump token_version so any session
  // still logged in under the old username is forced to sign in again (see requireAuth).
  const usernameChanged = uname !== existing.username;

  db.prepare('UPDATE users SET name_en=?, name_ar=?, title_en=?, title_ar=?, username=?, token_version = token_version + ? WHERE id=?')
    .run(name_en ?? existing.name_en, name_ar ?? existing.name_ar, title_en ?? existing.title_en, title_ar ?? existing.title_ar, uname, usernameChanged ? 1 : 0, req.params.id);
  res.json(toPublic(db.prepare('SELECT * FROM users WHERE id=?').get(req.params.id)));
});

router.post('/:id/reset-password', requireRole('admin'), (req, res) => {
  const existing = db.prepare("SELECT * FROM users WHERE id=? AND role='inspector'").get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const tempPassword = generateTempPassword();
  // token_version bump forces out any device still logged in under the old password.
  db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?').run(bcrypt.hashSync(tempPassword, 10), req.params.id);
  res.json({ ok: true, tempPassword });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare("DELETE FROM users WHERE id=? AND role='inspector'").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
