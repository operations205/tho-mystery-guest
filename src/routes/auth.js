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

module.exports = router;
