const express = require('express');
const multer = require('multer');
const PizZip = require('pizzip');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Note: we deliberately do NOT filter on file extension or browser-reported mimetype here —
// both are unreliable across browsers/OS (a genuine .docx can arrive as
// application/octet-stream, a renamed file can have any extension, etc.). Instead we accept
// any upload and validate the actual file content below (a real .docx is a zip archive that
// contains word/document.xml).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 } // 15MB
});

function toPublic(row) {
  if (!row) return null;
  return { type: row.type, originalName: row.original_name, uploadedAt: row.uploaded_at, uploadedBy: row.uploaded_by };
}

router.get('/', (req, res) => {
  if (req.user.role === 'hotel') return res.json({}); // not relevant to the hotel view
  const rows = db.prepare('SELECT type, original_name, uploaded_at, uploaded_by FROM doc_templates').all();
  const byType = {};
  rows.forEach(r => { byType[r.type] = toPublic(r); });
  res.json(byType);
});

router.post('/:type', requireRole('admin'), (req, res) => {
  const type = req.params.type;
  if (type !== 'proposal' && type !== 'contract') return res.status(400).json({ error: 'invalid_type' });

  upload.single('file')(req, res, (err) => {
    if (err) {
      const errorCode = err.code === 'LIMIT_FILE_SIZE' ? 'file_too_large' : 'upload_failed';
      return res.status(400).json({ error: errorCode, detail: { message: err.message } });
    }
    if (!req.file) return res.status(400).json({ error: 'no_file' });

    try {
      const zip = new PizZip(req.file.buffer);
      if (!zip.file('word/document.xml')) throw new Error('not_a_docx');
    } catch (e) {
      return res.status(400).json({
        error: 'invalid_file_type',
        detail: { originalname: req.file.originalname, mimetype: req.file.mimetype }
      });
    }

    const base64 = req.file.buffer.toString('base64');
    db.prepare(`INSERT INTO doc_templates (type, original_name, file_data, uploaded_at, uploaded_by)
      VALUES (?,?,?,?,?)
      ON CONFLICT(type) DO UPDATE SET original_name=excluded.original_name, file_data=excluded.file_data,
        uploaded_at=excluded.uploaded_at, uploaded_by=excluded.uploaded_by`)
      .run(type, req.file.originalname, base64, Date.now(), req.user.username);
    res.status(201).json(toPublic(db.prepare('SELECT type, original_name, uploaded_at, uploaded_by FROM doc_templates WHERE type=?').get(type)));
  });
});

router.delete('/:type', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM doc_templates WHERE type=?').run(req.params.type);
  res.json({ ok: true });
});

module.exports = router;
