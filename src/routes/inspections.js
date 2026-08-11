const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { computeScores, catsForStandard } = require('../lib/standards');

const router = express.Router();
router.use(requireAuth);

function getAnswers(inspectionId) {
  const rows = db.prepare('SELECT item_id, value, note FROM answers WHERE inspection_id=?').all(inspectionId);
  const map = {};
  rows.forEach(r => { map[r.item_id] = { value: r.value, note: r.note || '' }; });
  return map;
}

function toPublic(row, includeAnswers) {
  const base = {
    id: row.id, assignmentId: row.assignment_id, hotelId: row.hotel_id, inspectorId: row.inspector_id,
    standardId: row.standard_id, property: row.property_name, propertyTypeLabel: row.property_type_label,
    city: row.city, inspector: row.inspector_name, visitDate: row.visit_date, ref: row.ref,
    status: row.status, signature: row.signature, completedAt: row.completed_at, createdAt: row.created_at
  };
  if (includeAnswers) base.answers = getAnswers(row.id);
  return base;
}

router.get('/', (req, res) => {
  let rows;
  if (req.user.role === 'inspector') {
    rows = db.prepare('SELECT * FROM inspections WHERE inspector_id=? ORDER BY created_at DESC').all(req.user.id);
  } else {
    rows = db.prepare('SELECT * FROM inspections ORDER BY created_at DESC').all();
  }
  // Include a lightweight computed score summary so dashboard/list views don't need full answers.
  res.json(rows.map(r => {
    const pub = toPublic(r, false);
    const sc = computeScores(r.standard_id, getAnswers(r.id));
    pub.overall = sc.overall;
    pub.totalItems = sc.totalItems;
    pub.answeredCount = sc.answeredCount;
    pub.criticalFailCount = sc.criticalFails.length;
    return pub;
  }));
});

router.get('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'inspector' && row.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  res.json(toPublic(row, true));
});

router.get('/:id/score', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'inspector' && row.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const answers = getAnswers(row.id);
  res.json(computeScores(row.standard_id, answers));
});

// Start a new inspection from a pending assignment (inspector only, own assignment)
router.post('/start', requireRole('inspector'), (req, res) => {
  const { assignmentId } = req.body || {};
  const as = db.prepare('SELECT * FROM assignments WHERE id=?').get(assignmentId);
  if (!as) return res.status(404).json({ error: 'assignment_not_found' });
  if (as.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (as.inspection_id) {
    // already started — resume
    return res.json(toPublic(db.prepare('SELECT * FROM inspections WHERE id=?').get(as.inspection_id), true));
  }
  const hotel = db.prepare('SELECT * FROM hotels WHERE id=?').get(as.hotel_id);
  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.user.id);
  const id = 'insp_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  db.prepare(`INSERT INTO inspections
    (id, assignment_id, hotel_id, inspector_id, standard_id, property_name, property_type_label, city, inspector_name, visit_date, ref, status, signature, completed_at, created_at)
    VALUES (?,?,?,?,?,?,?,?,?,?, '', 'in_progress', NULL, NULL, ?)`)
    .run(id, as.id, hotel.id, user.id, as.standard_id, hotel.name_en, '', hotel.city_en, user.name_en,
      new Date().toISOString().slice(0, 10), now);
  db.prepare("UPDATE assignments SET status='in_progress', inspection_id=? WHERE id=?").run(id, as.id);
  res.status(201).json(toPublic(db.prepare('SELECT * FROM inspections WHERE id=?').get(id), true));
});

// Set/update a single answer
router.put('/:id/answers/:itemId', requireRole('inspector'), (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'not_found' });
  if (insp.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (insp.status === 'completed') return res.status(400).json({ error: 'already_completed' });

  const { value, note } = req.body || {};
  const item = catsForStandard(insp.standard_id).flatMap(c => c.items).find(i => i.id === req.params.itemId);
  if (!item) return res.status(400).json({ error: 'invalid_item' });
  if (value !== null && value !== undefined && !['yes', 'no', 'na'].includes(value)) {
    return res.status(400).json({ error: 'invalid_value' });
  }

  db.prepare(`INSERT INTO answers (inspection_id, item_id, value, note) VALUES (?,?,?,?)
    ON CONFLICT(inspection_id, item_id) DO UPDATE SET value=excluded.value, note=excluded.note`)
    .run(req.params.id, req.params.itemId, value || null, note || '');

  res.json({ ok: true });
});

// Complete + sign
router.post('/:id/complete', requireRole('inspector'), (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'not_found' });
  if (insp.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  const { signature } = req.body || {}; // base64 PNG data URL, or null if skipped
  const now = Date.now();
  db.prepare("UPDATE inspections SET status='completed', signature=?, completed_at=? WHERE id=?")
    .run(signature || null, now, req.params.id);
  if (insp.assignment_id) {
    db.prepare("UPDATE assignments SET status='completed' WHERE id=?").run(insp.assignment_id);
  }
  res.json(toPublic(db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id), true));
});

module.exports = router;
