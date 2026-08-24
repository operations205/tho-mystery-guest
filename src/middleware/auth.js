const jwt = require('jsonwebtoken');
const db = require('../../db/db');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION_' + Math.random().toString(36);
if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set in environment — using a random one-time secret. Set JWT_SECRET in your hosting environment variables for stable sessions across restarts.');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, username: user.username, hotel_id: user.hotel_id || null, tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.tho_token;
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
  // A JWT is otherwise stateless — a token stays "valid" for its full 30-day life no matter
  // what happens to the account afterward. That's what let an old session (e.g. from before a
  // password was changed) keep working as that user on whatever device held it. The "tv"
  // claim ties each token to the token_version the user had at sign-in time; changing a
  // password or username bumps token_version, which immediately makes every other
  // already-issued token mismatch and get rejected here. Tokens signed before this claim
  // existed have no "tv" at all, so they're rejected too — that's intentional, not a bug.
  if (typeof payload.tv !== 'number') return res.status(401).json({ error: 'invalid_token' });
  const row = db.prepare('SELECT token_version FROM users WHERE id = ?').get(payload.id);
  if (!row || row.token_version !== payload.tv) return res.status(401).json({ error: 'invalid_token' });
  req.user = payload;
  next();
}

function requireRole(role) {
  // Accepts a single role string or an array of allowed roles.
  const allowed = Array.isArray(role) ? role : [role];
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) {
      return res.status(403).json({ error: 'forbidden' });
    }
    next();
  };
}

module.exports = { signToken, requireAuth, requireRole, JWT_SECRET };
