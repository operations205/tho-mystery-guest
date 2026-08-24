const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_PRODUCTION_' + Math.random().toString(36);
if (!process.env.JWT_SECRET) {
  console.warn('[auth] WARNING: JWT_SECRET not set in environment — using a random one-time secret. Set JWT_SECRET in your hosting environment variables for stable sessions across restarts.');
}

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, username: user.username, hotel_id: user.hotel_id || null },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.tho_token;
  if (!token) return res.status(401).json({ error: 'not_authenticated' });
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'invalid_token' });
  }
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
