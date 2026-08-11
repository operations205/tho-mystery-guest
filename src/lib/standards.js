// Loads the THO-Audit 4 / THO-5 Plus standard definitions and exposes shared helpers.
const fs = require('fs');
const path = require('path');

const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'db', 'seed-data.json'), 'utf8'));

const CATS = raw.CATS;
const CATS_PLUS_EXTRA = raw.CATS_PLUS_EXTRA;
const CLASS_META = raw.CLASS_META;
const PILLAR_DESC = raw.PILLAR_DESC;
const STANDARDS = raw.STANDARDS;
const PROPERTY_TYPES = raw.PROPERTY_TYPES;
const S = raw.S;

function catsForStandard(id) {
  return id === 'plus5' ? CATS.concat(CATS_PLUS_EXTRA) : CATS;
}

function allItemIds(standardId) {
  const cats = catsForStandard(standardId);
  const ids = [];
  cats.forEach(c => c.items.forEach(i => ids.push(i.id)));
  return ids;
}

function itemById(standardId, itemId) {
  const cats = catsForStandard(standardId);
  for (const c of cats) {
    const it = c.items.find(i => i.id === itemId);
    if (it) return { item: it, category: c };
  }
  return null;
}

// Port of the client-side computeScores() — operates on a plain {itemId: {value, note}} answers map.
function computeScores(standardId, answers) {
  const cats = catsForStandard(standardId);
  let yes = 0, no = 0, na = 0;
  const catScores = {};
  const clsScores = {};
  const criticalFails = [];

  cats.forEach(cat => {
    let cy = 0, cn = 0;
    cat.items.forEach(item => {
      const a = answers[item.id];
      if (!a || !a.value) return;
      if (a.value === 'yes') { yes++; cy++; clsAdd(item.cls, 1, 1); }
      else if (a.value === 'no') {
        no++; cn++; clsAdd(item.cls, 0, 1);
        if (item.crit) criticalFails.push({ catId: cat.id, itemId: item.id, note: a.note || '' });
      } else if (a.value === 'na') { na++; }
    });
    const catTotal = cy + cn;
    catScores[cat.id] = catTotal > 0 ? Math.round((cy / catTotal) * 100) : null;
  });

  function clsAdd(cls, y, total) {
    if (!clsScores[cls]) clsScores[cls] = { y: 0, t: 0 };
    clsScores[cls].y += y; clsScores[cls].t += total;
  }

  const total = yes + no;
  const overall = total > 0 ? Math.round((yes / total) * 100) : 0;
  const clsPct = {};
  Object.keys(clsScores).forEach(k => { clsPct[k] = Math.round((clsScores[k].y / clsScores[k].t) * 100); });
  const answeredCount = yes + no + na;
  const totalItems = cats.reduce((s, c) => s + c.items.length, 0);

  return { overall, catScores, clsPct, criticalFails, answeredCount, totalItems, yes, no, na };
}

module.exports = {
  CATS, CATS_PLUS_EXTRA, CLASS_META, PILLAR_DESC, STANDARDS, PROPERTY_TYPES, S,
  catsForStandard, allItemIds, itemById, computeScores
};
