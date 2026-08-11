const express = require('express');
const { requireAuth } = require('../middleware/auth');
const std = require('../lib/standards');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  res.json({
    STANDARDS: std.STANDARDS,
    CLASS_META: std.CLASS_META,
    PILLAR_DESC: std.PILLAR_DESC,
    PROPERTY_TYPES: std.PROPERTY_TYPES
  });
});

router.get('/:id/categories', (req, res) => {
  const cats = std.catsForStandard(req.params.id);
  res.json(cats);
});

module.exports = router;
