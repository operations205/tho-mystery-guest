// Simple max-length guard for free-text fields. `undefined`/`null` always pass (means "field not
// being set/changed" in these routes' PATCH-like semantics) — only checks actual string values.
function withinLength(value, max) {
  return value === undefined || value === null || (typeof value === 'string' && value.length <= max);
}

module.exports = { withinLength };
