const express = require('express');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');
const { withinLength } = require('../utils/validate');
const { isValidImageDataUrl } = require('../utils/validateImage');

const router = express.Router();
router.use(requireAuth);

function toPublic(row) {
  return {
    companyName: { en: row.company_name_en, ar: row.company_name_ar },
    logo: row.logo_data || '',
    email: row.email || '',
    phone: row.phone || '',
    website: row.website || '',
    address: row.address || '',
    updatedAt: row.updated_at
  };
}

router.get('/', (req, res) => {
  const row = db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  res.json(toPublic(row));
});

router.put('/', requireRole('admin'), (req, res) => {
  const { name_en, name_ar, logo, email, phone, website, address } = req.body || {};
  if (![name_en, name_ar, email, website].every(v => withinLength(v, 200))
    || !withinLength(phone, 50) || !withinLength(address, 500)) {
    return res.status(400).json({ error: 'field_too_long' });
  }
  // logo is optional here (undefined = leave as-is, '' = clear it) — only validate the format
  // when an actual non-empty value is being set, since it's rendered into <img src="..."> on
  // report letterheads.
  if (logo && !isValidImageDataUrl(logo)) {
    return res.status(400).json({ error: 'invalid_logo' });
  }
  const existing = db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  db.prepare(`UPDATE company_settings SET
      company_name_en=?, company_name_ar=?, logo_data=?, email=?, phone=?, website=?, address=?, updated_at=?
    WHERE id=1`)
    .run(
      name_en ?? existing.company_name_en,
      name_ar ?? existing.company_name_ar,
      logo !== undefined ? logo : existing.logo_data,
      email ?? existing.email,
      phone ?? existing.phone,
      website ?? existing.website,
      address ?? existing.address,
      Date.now()
    );
  res.json(toPublic(db.prepare('SELECT * FROM company_settings WHERE id=1').get()));
});

module.exports = router;
