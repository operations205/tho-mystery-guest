const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id, name: { en: row.name_en, ar: row.name_ar },
    city: { en: row.city_en, ar: row.city_ar }, type: row.type,
    contact: row.contact, phone: row.phone, logo: row.logo_data || '',
    createdAt: row.created_at
  };
}

router.get('/', (req, res) => {
  // A hotel-login account only ever needs its own property, not the full portfolio.
  const rows = req.user.role === 'hotel'
    ? db.prepare('SELECT * FROM hotels WHERE id=?').all(req.user.hotel_id)
    : db.prepare('SELECT * FROM hotels ORDER BY created_at DESC').all();
  res.json(rows.map(toPublic));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, city_en, city_ar, type, contact, phone } = req.body || {};
  if (!name_en || !name_ar) return res.status(400).json({ error: 'missing_fields' });
  const id = 'h_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.prepare(`INSERT INTO hotels (id, name_en, name_ar, city_en, city_ar, type, contact, phone, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`).run(id, name_en, name_ar, city_en || '', city_ar || '', type || 0, contact || '', phone || '', Date.now());
  res.status(201).json(toPublic(db.prepare('SELECT * FROM hotels WHERE id=?').get(id)));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, city_en, city_ar, type, contact, phone } = req.body || {};
  const existing = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  db.prepare(`UPDATE hotels SET name_en=?, name_ar=?, city_en=?, city_ar=?, type=?, contact=?, phone=? WHERE id=?`)
    .run(name_en ?? existing.name_en, name_ar ?? existing.name_ar, city_en ?? existing.city_en, city_ar ?? existing.city_ar,
      type ?? existing.type, contact ?? existing.contact, phone ?? existing.phone, req.params.id);
  res.json(toPublic(db.prepare('SELECT * FROM hotels WHERE id=?').get(req.params.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM hotels WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

// Hotel logo (admin only) — shown next to the property name on that hotel's inspection reports.
// The client compresses/resizes the image before sending, but we still cap the stored size here
// as a backstop against an oversized payload.
router.put('/:id/logo', requireRole('admin'), (req, res) => {
  const hotel = db.prepare('SELECT id FROM hotels WHERE id=?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'not_found' });
  const { logo } = req.body || {};
  if (typeof logo !== 'string') return res.status(400).json({ error: 'invalid_logo' });
  if (logo.length > 2 * 1024 * 1024) return res.status(400).json({ error: 'logo_too_large' });
  db.prepare('UPDATE hotels SET logo_data=? WHERE id=?').run(logo, req.params.id);
  res.json({ ok: true, logo });
});

router.delete('/:id/logo', requireRole('admin'), (req, res) => {
  db.prepare("UPDATE hotels SET logo_data='' WHERE id=?").run(req.params.id);
  res.json({ ok: true });
});

// ===================== Hotel login account (admin-managed) =====================
// One login account per hotel, so the hotel's responsible person can sign in and view their
// own completed inspection reports. Deleting the hotel cascades and removes this account too
// (users.hotel_id has ON DELETE CASCADE).

function toPublicAccount(row) {
  if (!row) return null;
  return {
    id: row.id, username: row.username,
    name: { en: row.name_en, ar: row.name_ar }
  };
}

// Bulk lookup so the admin Properties list can show account status per hotel in one request.
router.get('/accounts', requireRole('admin'), (req, res) => {
  const rows = db.prepare("SELECT * FROM users WHERE role='hotel'").all();
  const byHotel = {};
  rows.forEach(r => { byHotel[r.hotel_id] = toPublicAccount(r); });
  res.json(byHotel);
});

router.get('/:id/account', requireRole('admin'), (req, res) => {
  const hotel = db.prepare('SELECT id FROM hotels WHERE id=?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'not_found' });
  const row = db.prepare("SELECT * FROM users WHERE role='hotel' AND hotel_id=?").get(req.params.id);
  res.json(toPublicAccount(row));
});

router.post('/:id/account', requireRole('admin'), (req, res) => {
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(req.params.id);
  if (!hotel) return res.status(404).json({ error: 'not_found' });
  const already = db.prepare("SELECT id FROM users WHERE role='hotel' AND hotel_id=?").get(req.params.id);
  if (already) return res.status(409).json({ error: 'account_exists' });

  const { username, name_en, name_ar } = req.body || {};
  const base = (username || hotel.name_en.split(' ')[0]).toLowerCase().replace(/[^a-z0-9_.]/g, '');
  let uname = base || 'hotel';
  let n = 1;
  while (db.prepare('SELECT id FROM users WHERE username=?').get(uname)) {
    uname = base + (++n);
  }
  const id = 'u_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const tempPassword = Math.random().toString(36).slice(2, 10);
  db.prepare(`INSERT INTO users (id, role, username, password_hash, name_en, name_ar, hotel_id, created_at)
    VALUES (?, 'hotel', ?, ?, ?, ?, ?, ?)`)
    .run(id, uname, bcrypt.hashSync(tempPassword, 10), name_en || hotel.name_en, name_ar || hotel.name_ar, req.params.id, Date.now());
  const row = db.prepare('SELECT * FROM users WHERE id=?').get(id);
  res.status(201).json({ ...toPublicAccount(row), tempPassword });
});

router.post('/:id/account/reset-password', requireRole('admin'), (req, res) => {
  const row = db.prepare("SELECT * FROM users WHERE role='hotel' AND hotel_id=?").get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const tempPassword = Math.random().toString(36).slice(2, 10);
  db.prepare('UPDATE users SET password_hash=? WHERE id=?').run(bcrypt.hashSync(tempPassword, 10), row.id);
  res.json({ ok: true, tempPassword });
});

router.delete('/:id/account', requireRole('admin'), (req, res) => {
  db.prepare("DELETE FROM users WHERE role='hotel' AND hotel_id=?").run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
