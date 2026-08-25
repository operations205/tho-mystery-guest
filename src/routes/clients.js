const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withinLength } = require('../utils/validate');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id,
    name: { en: row.name_en, ar: row.name_ar },
    hotelName: { en: row.hotel_name_en, ar: row.hotel_name_ar },
    contact: row.contact, phone: row.phone, email: row.email,
    createdAt: row.created_at
  };
}

router.get('/', (req, res) => {
  if (req.user.role === 'hotel') return res.json([]); // other clients' data isn't relevant/visible here
  const rows = db.prepare('SELECT * FROM clients ORDER BY created_at DESC').all();
  res.json(rows.map(toPublic));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, hotel_name_en, hotel_name_ar, contact, phone, email } = req.body || {};
  if (!name_en || !name_ar) return res.status(400).json({ error: 'missing_fields' });
  if (![name_en, name_ar, hotel_name_en, hotel_name_ar].every(v => withinLength(v, 200))
    || !withinLength(contact, 200) || !withinLength(phone, 50) || !withinLength(email, 200)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  const id = 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.prepare(`INSERT INTO clients (id, name_en, name_ar, hotel_name_en, hotel_name_ar, contact, phone, email, created_at)
    VALUES (?,?,?,?,?,?,?,?,?)`)
    .run(id, name_en, name_ar, hotel_name_en || '', hotel_name_ar || '', contact || '', phone || '', email || '', Date.now());
  res.status(201).json(toPublic(db.prepare('SELECT * FROM clients WHERE id=?').get(id)));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, hotel_name_en, hotel_name_ar, contact, phone, email } = req.body || {};
  const existing = db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  if (![name_en, name_ar, hotel_name_en, hotel_name_ar].every(v => withinLength(v, 200))
    || !withinLength(contact, 200) || !withinLength(phone, 50) || !withinLength(email, 200)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  db.prepare(`UPDATE clients SET name_en=?, name_ar=?, hotel_name_en=?, hotel_name_ar=?, contact=?, phone=?, email=? WHERE id=?`)
    .run(
      name_en ?? existing.name_en, name_ar ?? existing.name_ar,
      hotel_name_en ?? existing.hotel_name_en, hotel_name_ar ?? existing.hotel_name_ar,
      contact ?? existing.contact, phone ?? existing.phone, email ?? existing.email,
      req.params.id
    );
  res.json(toPublic(db.prepare('SELECT * FROM clients WHERE id=?').get(req.params.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM clients WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
