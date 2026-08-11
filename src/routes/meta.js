const express = require('express');
const std = require('../lib/standards');
const router = express.Router();

// Public — needed by the login screen before auth, and for the i18n string table.
router.get('/strings', (req, res) => { res.json(std.S); });

module.exports = router;
