const express = require('express');
const multer = require('multer');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    const okExt = /\.docx$/i.test(file.originalname);
    const okMime = file.mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    if (okExt || okMime) return cb(null, true);
    cb(new Error('invalid_file_type'));
  }
});

function toPublic(row) {
  if (!row) return null;
  return { type: row.type, originalName: row.original_name, uploadedAt: row.uploaded_at, uploadedBy: row.uploaded_by };
}

router.get('/', (req, res) => {
  const rows = db.prepare('SELECT type, original_name, uploaded_at, uploaded_by FROM doc_templates').all();
  const byType = {};
  rows.forEach(r => { byType[r.type] = toPublic(r); });
  res.json(byType);
});

router.post('/:type', requireRole('admin'), (req, res) => {
  const type = req.params.type;
  if (type !== 'proposal' && type !== 'contract') return res.status(400).json({ error: 'invalid_type' });
  upload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message === 'invalid_file_type' ? 'invalid_file_type' : 'upload_failed' });
    if (!req.file) return res.status(400).json({ error: 'no_file' });
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
