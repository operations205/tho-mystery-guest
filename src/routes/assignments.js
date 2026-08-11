const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    id: row.id, hotelId: row.hotel_id, inspectorId: row.inspector_id,
    dueDate: row.due_date, priority: row.priority, standardId: row.standard_id,
    status: row.status, inspectionId: row.inspection_id, createdAt: row.created_at
  };
}

router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'inspector') {
    rows = db.prepare('SELECT * FROM assignments WHERE inspector_id=? ORDER BY created_at DESC').all(req.user.id);
  } else {
    rows = db.prepare('SELECT * FROM assignments ORDER BY created_at DESC').all();
  }
  res.json(rows.map(toPublic));
});

router.post('/', requireRole('admin'), (req, res) => {
  const { hotelId, inspectorId, dueDate, priority, standardId } = req.body || {};
  if (!hotelId || !inspectorId || !dueDate) return res.status(400).json({ error: 'missing_fields' });
  const id = 'as_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  db.prepare(`INSERT INTO assignments (id, hotel_id, inspector_id, due_date, priority, standard_id, status, inspection_id, created_at)
    VALUES (?,?,?,?,?,?, 'pending', NULL, ?)`)
    .run(id, hotelId, inspectorId, dueDate, priority || 'normal', standardId || 'audit4', Date.now());
  res.status(201).json(toPublic(db.prepare('SELECT * FROM assignments WHERE id=?').get(id)));
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const existing = db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const { hotelId, inspectorId, dueDate, priority, standardId } = req.body || {};
  db.prepare('UPDATE assignments SET hotel_id=?, inspector_id=?, due_date=?, priority=?, standard_id=? WHERE id=?')
    .run(hotelId ?? existing.hotel_id, inspectorId ?? existing.inspector_id, dueDate ?? existing.due_date,
      priority ?? existing.priority, standardId ?? existing.standard_id, req.params.id);
  res.json(toPublic(db.prepare('SELECT * FROM assignments WHERE id=?').get(req.params.id)));
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM assignments WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
