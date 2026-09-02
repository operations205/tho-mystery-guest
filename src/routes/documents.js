const express = require('express');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const db = require('../../db/db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

function newId(prefix) { return prefix + '_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

function refFor(type) {
  const ymd = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.floor(1000 + Math.random() * 9000);
  return (type === 'proposal' ? 'PRO' : 'CON') + '-' + ymd + '-' + rand;
}

function toPublic(row) {
  return {
    id: row.id, type: row.type, clientId: row.client_id,
    fileName: row.file_name, data: JSON.parse(row.data_json || '{}'),
    createdAt: row.created_at, createdBy: row.created_by
  };
}

// Client proposals/contracts (with pricing) are an admin-only concern — inspectors have no
// business need to see them, and hotel accounts already got a blanket [] below.
router.get('/', requireRole('admin'), (req, res) => {
  const clientId = req.query.clientId;
  const rows = clientId
    ? db.prepare('SELECT id,type,client_id,file_name,data_json,created_at,created_by FROM generated_documents WHERE client_id=? ORDER BY created_at DESC').all(clientId)
    : db.prepare('SELECT id,type,client_id,file_name,data_json,created_at,created_by FROM generated_documents ORDER BY created_at DESC').all();
  res.json(rows.map(toPublic));
});

router.post('/generate', requireRole('admin'), (req, res) => {
  const body = req.body || {};
  const { type, clientId } = body;
  if (type !== 'proposal' && type !== 'contract') return res.status(400).json({ error: 'invalid_type' });

  const client = db.prepare('SELECT * FROM clients WHERE id=?').get(clientId);
  if (!client) return res.status(404).json({ error: 'client_not_found' });

  const tpl = db.prepare('SELECT * FROM doc_templates WHERE type=?').get(type);
  if (!tpl) return res.status(400).json({ error: 'no_template' });

  const settings = db.prepare('SELECT * FROM company_settings WHERE id=1').get();
  const today = new Date().toISOString().slice(0, 10);

  const data = {
    client_name: client.name_ar, client_name_en: client.name_en,
    hotel_name: client.hotel_name_ar || '', hotel_name_en: client.hotel_name_en || '',
    client_contact: client.contact || '', client_phone: client.phone || '', client_email: client.email || '',
    num_visits: body.numVisits ?? '', visit_frequency: body.visitFrequency ?? '',
    price_per_visit: body.pricePerVisit ?? '', total_price: body.totalPrice ?? '',
    currency: body.currency || 'ريال سعودي',
    contract_duration: body.contractDuration ?? '',
    start_date: body.startDate || '', end_date: body.endDate || '',
    document_date: body.documentDate || today,
    document_ref: body.documentRef || refFor(type),
    company_name: settings.company_name_ar, company_name_en: settings.company_name_en,
    company_email: settings.email || '', company_phone: settings.phone || '', company_website: settings.website || ''
  };

  let outputBuffer;
  try {
    const zip = new PizZip(Buffer.from(tpl.file_data, 'base64'));
    const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' } });
    doc.render(data);
    outputBuffer = doc.getZip().generate({ type: 'nodebuffer' });
  } catch (e) {
    const detail = (e && e.properties && e.properties.errors)
      ? e.properties.errors.map(er => er.properties && er.properties.explanation).filter(Boolean).join('; ')
      : ((e && e.message) || String(e));
    return res.status(400).json({ error: 'template_render_failed', detail });
  }

  const id = newId('doc');
  const clientLabel = (client.name_en || client.name_ar || 'client').replace(/[^a-zA-Z0-9؀-ۿ]+/g, '_');
  const fileName = `${type === 'proposal' ? 'Proposal' : 'Contract'}_${clientLabel}_${today}.docx`;
  const base64Out = outputBuffer.toString('base64');

  db.prepare(`INSERT INTO generated_documents (id, type, client_id, file_name, file_data, data_json, created_at, created_by)
    VALUES (?,?,?,?,?,?,?,?)`)
    .run(id, type, clientId, fileName, base64Out, JSON.stringify(data), Date.now(), req.user.username);

  res.status(201).json(toPublic(db.prepare('SELECT id,type,client_id,file_name,data_json,created_at,created_by FROM generated_documents WHERE id=?').get(id)));
});

router.get('/:id/download', requireRole('admin'), (req, res) => {
  const row = db.prepare('SELECT * FROM generated_documents WHERE id=?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  const buf = Buffer.from(row.file_data, 'base64');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  // fileName is built in the /generate route as e.g. "Proposal_<client name>_<date>.docx", and
  // client names are frequently Arabic -- encodeURIComponent() inside a plain filename="..."
  // isn't a real encoding scheme for that quoted-string param (RFC 6266/2616), so several
  // browsers show the literal percent-escaped text ("Proposal_%D9%81...docx") as the saved
  // filename instead of decoding it. Send both: an ASCII-safe filename= fallback (non-ASCII
  // bytes stripped) for any client that ignores filename*=, and the correct RFC 5987
  // filename*=UTF-8''<percent-encoded> form that every modern browser actually uses.
  const asciiFallback = row.file_name.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'") || 'document.docx';
  res.setHeader('Content-Disposition',
    `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeURIComponent(row.file_name)}`);
  res.send(buf);
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  db.prepare('DELETE FROM generated_documents WHERE id=?').run(req.params.id);
  res.json({ ok: true });
});

module.exports = router;
