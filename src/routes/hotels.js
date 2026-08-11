const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id, name: { en: row.name_en, ar: row.name_ar },
    city: { en: row.city_en, ar: row.city_ar }, type: row.type,
    contact: row.contact, phone: row.phone, createdAt: row.created_at
  };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT * FROM hotels ORDER BY created_at DESC').all();
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

module.exports = router;
