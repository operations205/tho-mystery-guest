const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { isValidImageDataUrl } = require('../utils/validateImage');
const { computeScores, catsForStandard } = require('../lib/standards');
const { renderInspectionPdf } = require('../lib/pdfExport');
const { resolveAppOrigin } = require('../utils/origin');

const router = express.Router();
router.use(requireAuth);

function getAnswers(inspectionId) {
  const rows = db.prepare('SELECT item_id, value, note, photo FROM answers WHERE inspection_id=?').all(inspectionId);
  const map = {};
  rows.forEach(r => { map[r.item_id] = { value: r.value, note: r.note || '', photo: r.photo || '' }; });
  return map;
}

// A hotel-role user may only ever see their own hotel's *completed* reports — an in-progress
// inspection isn't a finished report yet, so it stays hidden from the hotel side.
function hotelCanSee(row, user) {
  return row.hotel_id === user.hotel_id && row.status === 'completed';
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
  } else if (req.user.role === 'hotel') {
    rows = db.prepare("SELECT * FROM inspections WHERE hotel_id=? AND status='completed' ORDER BY created_at DESC").all(req.user.hotel_id);
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
  if (req.user.role === 'hotel' && !hotelCanSee(row, req.user)) return res.status(403).json({ error: 'forbidden' });
  res.json(toPublic(row, true));
});

// PDF export -- same visibility rule as GET /:id (admin sees all, inspector sees own,
// hotel sees own *completed* reports), then hands off to a headless-Chrome render of the
// exact same report the browser shows, so Arabic/RTL content comes out correctly.
router.get('/:id/pdf', async (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'inspector' && row.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'hotel' && !hotelCanSee(row, req.user)) return res.status(403).json({ error: 'forbidden' });

  try {
    // Navigate Puppeteer to the app's own public origin rather than a bare loopback address.
    // The server's CORS allowlist checks the Origin header on every request -- including
    // same-page font/asset fetches, which browsers always send in CORS mode regardless of
    // same-origin-ness -- so a loopback origin like http://127.0.0.1:PORT that isn't on that
    // allowlist gets its own fonts blocked with a 403, breaking icons in the render. Reusing
    // resolveAppOrigin keeps this in lockstep with whatever's actually configured as allowed.
    const pdf = await renderInspectionPdf({
      origin: resolveAppOrigin(req),
      cookieName: 'tho_token',
      cookieValue: req.cookies.tho_token,
      inspectionId: row.id
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="report-${row.id}.pdf"`);
    res.send(Buffer.from(pdf));
  } catch (e) {
    console.error('[pdf-export] failed', e.message);
    res.status(500).json({ error: 'pdf_generation_failed' });
  }
});

router.get('/:id/score', (req, res) => {
  const row = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  if (req.user.role === 'inspector' && row.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (req.user.role === 'hotel' && !hotelCanSee(row, req.user)) return res.status(403).json({ error: 'forbidden' });
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

  const body = req.body || {};
  const item = catsForStandard(insp.standard_id).flatMap(c => c.items).find(i => i.id === req.params.itemId);
  if (!item) return res.status(400).json({ error: 'invalid_item' });
  if (body.value !== null && body.value !== undefined && !['yes', 'no', 'na'].includes(body.value)) {
    return res.status(400).json({ error: 'invalid_value' });
  }
  if (body.photo !== undefined && body.photo !== null && body.photo !== '') {
    if (typeof body.photo !== 'string' || body.photo.length > 6 * 1024 * 1024) {
      return res.status(400).json({ error: 'photo_too_large' });
    }
    // Must actually be an image data URL — this field gets rendered back into an <img src> and
    // an inline onclick handler on the report views, so anything that isn't a real image data
    // URL is rejected here rather than trusted to the frontend's HTML-escaping alone.
    if (!isValidImageDataUrl(body.photo)) {
      return res.status(400).json({ error: 'invalid_photo' });
    }
  }

  // This endpoint is called separately for value changes, note changes, and photo changes —
  // only overwrite a column when the request explicitly included that field, so e.g. attaching
  // a photo doesn't wipe out a note (or vice versa) that was saved a moment earlier.
  const existing = db.prepare('SELECT value, note, photo FROM answers WHERE inspection_id=? AND item_id=?')
    .get(req.params.id, req.params.itemId) || { value: null, note: '', photo: '' };
  const nextValue = Object.prototype.hasOwnProperty.call(body, 'value') ? (body.value || null) : existing.value;
  const nextNote = Object.prototype.hasOwnProperty.call(body, 'note') ? (body.note || '') : (existing.note || '');
  const nextPhoto = Object.prototype.hasOwnProperty.call(body, 'photo') ? (body.photo || '') : (existing.photo || '');

  db.prepare(`INSERT INTO answers (inspection_id, item_id, value, note, photo) VALUES (?,?,?,?,?)
    ON CONFLICT(inspection_id, item_id) DO UPDATE SET value=excluded.value, note=excluded.note, photo=excluded.photo`)
    .run(req.params.id, req.params.itemId, nextValue, nextNote, nextPhoto);

  res.json({ ok: true });
});

// Complete + sign
router.post('/:id/complete', requireRole('inspector'), (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'not_found' });
  if (insp.inspector_id !== req.user.id) return res.status(403).json({ error: 'forbidden' });
  if (insp.status === 'completed') return res.status(400).json({ error: 'already_completed' });

  // Guard against the score formula's blind spot: overall% = yes/(yes+no), which silently
  // excludes unanswered items from the denominator. Without this check, an inspector could
  // submit a checklist that's mostly blank and still get a misleading 100% report. Every item
  // must carry a real answer (yes/no/na — na is a legitimate "not applicable" answer) before
  // the inspection can be marked complete.
  const answers = getAnswers(req.params.id);
  const allItems = catsForStandard(insp.standard_id).flatMap(c => c.items);
  const unansweredCount = allItems.filter(it => !answers[it.id] || !answers[it.id].value).length;
  if (unansweredCount > 0) {
    return res.status(400).json({ error: 'incomplete', unansweredCount, totalItems: allItems.length });
  }

  const { signature } = req.body || {}; // base64 PNG data URL, or null if skipped
  if (signature !== undefined && signature !== null && signature !== '' && !isValidImageDataUrl(signature)) {
    return res.status(400).json({ error: 'invalid_signature' });
  }
  const now = Date.now();
  db.prepare("UPDATE inspections SET status='completed', signature=?, completed_at=? WHERE id=?")
    .run(signature || null, now, req.params.id);
  if (insp.assignment_id) {
    db.prepare("UPDATE assignments SET status='completed' WHERE id=?").run(insp.assignment_id);
  }
  res.json(toPublic(db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id), true));
});

// Delete a report (admin only) — e.g. to remove test/mistaken inspections. If it was started
// from an assignment, hand that assignment back to pending (cleared of the deleted inspection)
// instead of leaving it pointing at a now-missing report.
router.delete('/:id', requireRole('admin'), (req, res) => {
  const insp = db.prepare('SELECT * FROM inspections WHERE id=?').get(req.params.id);
  if (!insp) return res.status(404).json({ error: 'not_found' });
  if (insp.assignment_id) {
    db.prepare("UPDATE assignments SET status='pending', inspection_id=NULL WHERE id=?").run(insp.assignment_id);
  }
  db.prepare('DELETE FROM inspections WHERE id=?').run(req.params.id); // answers cascade via FK
  res.json({ ok: true });
});

module.exports = router;
