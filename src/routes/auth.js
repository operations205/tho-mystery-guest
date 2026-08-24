const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/db');
const { signToken, requireAuth } = require('../middleware/auth');

const router = express.Router();

function toPublicUser(row) {
  return {
    id: row.id, role: row.role, username: row.username,
    name: { en: row.name_en, ar: row.name_ar },
    title: { en: row.title_en, ar: row.title_ar },
    hotelId: row.hotel_id || null
  };
}

router.post('/login', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  // The login screen has separate Admin / Inspector / Hotel tabs — a set of credentials only
  // works from the tab matching its actual role, so picking the wrong tab gives a clear error
  // instead of silently signing the person into a different role than the one they selected.
  if (role && row.role !== role) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(row);
  res.cookie('tho_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ user: toPublicUser(row) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('tho_token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ user: toPublicUser(row) });
});

// Self-service display-name edit — any logged-in role (admin/inspector/hotel) can fix the
// name shown for their own account. Deliberately scoped to name_en/name_ar only: username,
// password and role are not editable here.
router.put('/me', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const { name_en, name_ar } = req.body || {};
  if (!name_en || !name_ar) return res.status(400).json({ error: 'missing_fields' });
  db.prepare('UPDATE users SET name_en=?, name_ar=? WHERE id=?').run(name_en, name_ar, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: toPublicUser(row) });
});

// Self-service password change — any logged-in role. Requires the current password so a
// hijacked/left-open session can't be used to silently lock the real owner out.
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'missing_fields' });
  if (String(new_password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(current_password, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }
  // Bumping token_version invalidates every OTHER device/session currently holding an old
  // token for this account (see requireAuth) — the whole point of this change. But that would
  // also kick out this very request's own session on its next call, so immediately re-sign and
  // re-set the cookie for the current device so the person doesn't get logged out by their own
  // password change.
  db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = signToken(updated);
  res.cookie('tho_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

module.exports = router;
