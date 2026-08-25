const crypto = require('crypto');

// Cryptographically-random temp password for newly created accounts / password resets.
// Uses base64url so it's copy-paste/typing friendly (no +, /, or = padding characters).
function generateTempPassword(bytes = 9) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { generateTempPassword };
