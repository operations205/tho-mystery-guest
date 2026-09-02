// Pins the behavior of src/lib/standards.js's computeScores() -- the server-side scoring logic
// used by GET /api/inspections (list summary) and GET /api/inspections/:id/score. Directly
// covers two real production incidents:
//   1. Unanswered items silently counting toward a 100% score (fixed: overall = yes/(yes+no),
//      and answeredCount is reported separately so a caller can tell "complete" from "blank").
//   2. A category with only a handful of items swinging to a misleading stark 0%/100% off a
//      single answered item (fixed: catCounts lets a caller apply a minimum-sample-size guard
//      before headlining a category as "weakest" -- see MIN_SAMPLE_FOR_FLAGGING).
// Run with: node --test test/computeScores.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { computeScores, catsForStandard, MIN_SAMPLE_FOR_FLAGGING } = require('../src/lib/standards');

const STANDARD_ID = 'audit4';
const allItems = catsForStandard(STANDARD_ID).flatMap(c => c.items);
const TOTAL_ITEMS = allItems.length;

// A real, small category from the seed data (5 items) -- exactly the shape that produced the
// misleading 0%/100% bug: catScores.elevators would swing to a stark extreme off just 1 real
// answer once the other 4 items are marked N/A.
const SMALL_CAT_ID = 'elevators';
const smallCatItems = catsForStandard(STANDARD_ID).find(c => c.id === SMALL_CAT_ID).items;
assert.ok(smallCatItems.length >= 4, 'fixture assumption: elevators category has several items');

// A real critical ("crit: true") item, used to test criticalFails detection.
let criticalItem = null;
for (const c of catsForStandard(STANDARD_ID)) {
  const it = c.items.find(i => i.crit);
  if (it) { criticalItem = { catId: c.id, itemId: it.id }; break; }
}
assert.ok(criticalItem, 'fixture assumption: at least one item is marked crit:true');

test('empty answers map: nothing answered yet', () => {
  const sc = computeScores(STANDARD_ID, {});
  assert.equal(sc.overall, 0, 'no yes/no answers -> 0, not a misleading 100%');
  assert.equal(sc.answeredCount, 0);
  assert.equal(sc.totalItems, TOTAL_ITEMS);
  assert.equal(sc.yes, 0);
  assert.equal(sc.no, 0);
  assert.equal(sc.na, 0);
  assert.deepEqual(sc.criticalFails, []);
  // every category has 0 answered items -> null score (no data), not 0% or 100%
  for (const catId of Object.keys(sc.catScores)) {
    assert.equal(sc.catScores[catId], null, `catScores.${catId} should be null with zero answers`);
    assert.equal(sc.catCounts[catId], 0);
  }
});

test('all items answered N/A: fully "answered" but no scoreable data', () => {
  const answers = {};
  allItems.forEach(it => { answers[it.id] = { value: 'na' }; });
  const sc = computeScores(STANDARD_ID, answers);
  assert.equal(sc.answeredCount, TOTAL_ITEMS, 'N/A counts as answered');
  assert.equal(sc.overall, 0, 'yes+no is still 0, so overall must not be a misleading 100%');
  assert.equal(sc.yes, 0);
  assert.equal(sc.no, 0);
  assert.equal(sc.na, TOTAL_ITEMS);
  for (const catId of Object.keys(sc.catScores)) {
    assert.equal(sc.catScores[catId], null, `catScores.${catId} should be null when every answer is N/A`);
  }
});

test('partial completion: unanswered items are excluded, not counted as failures or passes', () => {
  const answers = {};
  // Answer only the first 10 items, all 'yes'; leave the rest completely unanswered.
  allItems.slice(0, 10).forEach(it => { answers[it.id] = { value: 'yes' }; });
  const sc = computeScores(STANDARD_ID, answers);
  assert.equal(sc.answeredCount, 10);
  assert.equal(sc.overall, 100, 'the 10 answered items were all yes');
  assert.equal(sc.totalItems, TOTAL_ITEMS, 'totalItems always reflects the full checklist, not just what was answered');
});

test('full completion, all yes: overall 100 and every touched category scores 100', () => {
  const answers = {};
  allItems.forEach(it => { answers[it.id] = { value: 'yes' }; });
  const sc = computeScores(STANDARD_ID, answers);
  assert.equal(sc.overall, 100);
  assert.equal(sc.answeredCount, TOTAL_ITEMS);
  assert.equal(sc.na, 0);
  for (const cat of catsForStandard(STANDARD_ID)) {
    assert.equal(sc.catScores[cat.id], 100, `catScores.${cat.id} should be 100`);
    assert.equal(sc.catCounts[cat.id], cat.items.length);
  }
});

test('regression: single stray "no" in a small mostly-N/A category swings to 0%, but catCounts flags it as a thin sample (root cause of the "misleading weakest area" incident)', () => {
  const answers = {};
  // Everything yes, except the small category: all N/A except the first item, which is 'no'.
  allItems.forEach(it => { answers[it.id] = { value: 'yes' }; });
  smallCatItems.forEach((it, idx) => {
    answers[it.id] = { value: idx === 0 ? 'no' : 'na' };
  });
  const sc = computeScores(STANDARD_ID, answers);
  assert.equal(sc.catScores[SMALL_CAT_ID], 0, 'the category score itself is correctly 0 -- that part of the math is right');
  assert.equal(sc.catCounts[SMALL_CAT_ID], 1, 'but it is based on exactly 1 real answer');
  assert.ok(
    sc.catCounts[SMALL_CAT_ID] < MIN_SAMPLE_FOR_FLAGGING,
    'catCounts must be usable to detect this is too thin a sample to headline as "weakest area" -- this is the guard that fixed the real incident'
  );
  // Meanwhile the overall score should barely move -- one "no" among hundreds of "yes" answers.
  assert.ok(sc.overall >= 95, `overall (${sc.overall}) should stay high; a single stray no should not tank the whole report`);
});

test('critical item answered "no" is captured in criticalFails; "yes"/"na" are not', () => {
  const baseAnswers = {};
  allItems.forEach(it => { baseAnswers[it.id] = { value: 'yes' }; });

  const failScores = computeScores(STANDARD_ID, { ...baseAnswers, [criticalItem.itemId]: { value: 'no', note: 'broke' } });
  assert.equal(failScores.criticalFails.length, 1);
  assert.equal(failScores.criticalFails[0].itemId, criticalItem.itemId);
  assert.equal(failScores.criticalFails[0].note, 'broke');

  const passScores = computeScores(STANDARD_ID, baseAnswers); // critical item is 'yes' here
  assert.equal(passScores.criticalFails.length, 0);

  const naAnswers = { ...baseAnswers, [criticalItem.itemId]: { value: 'na' } };
  const naScores = computeScores(STANDARD_ID, naAnswers);
  assert.equal(naScores.criticalFails.length, 0, 'N/A on a critical item is not a failure');
});

test('MIN_SAMPLE_FOR_FLAGGING is a small positive threshold (guards against an accidental change silently reopening the incident)', () => {
  assert.equal(typeof MIN_SAMPLE_FOR_FLAGGING, 'number');
  assert.ok(MIN_SAMPLE_FOR_FLAGGING >= 2, 'must require more than a single answer before a category can be flagged');
});
