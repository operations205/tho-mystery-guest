const express = require('express');
const fs = require('fs');
const { requireAuth, requireRole } = require('../middleware/auth');
const { runBackup, listBackups, backupFilePath } = require('../lib/backup');

const router = express.Router();
router.use(requireAuth);
router.use(requireRole('admin'));

router.get('/', (req, res) => {
  res.json({ backups: listBackups() });
});

// Trigger an out-of-cycle backup on demand (e.g. right before a risky manual DB operation),
// instead of only ever waiting for the scheduled daily run.
router.post('/run', async (req, res) => {
  await runBackup();
  res.json({ backups: listBackups() });
});

router.get('/:fileName/download', (req, res) => {
  const filePath = backupFilePath(req.params.fileName);
  if (!filePath) return res.status(404).json({ error: 'not_found' });
  res.download(filePath, req.params.fileName);
});

module.exports = router;
