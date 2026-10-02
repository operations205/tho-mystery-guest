const jwt = require('jsonwebtoken');
const db = require('../../db/db');

// A missing JWT_SECRET used to silently fall back to a random per-process value — meaning every
// restart/deploy invalidated every session with no clear error, and (if ever scaled to more than
// one instance) different instances would mint mutually-incompatible tokens. Failing fast here
// turns that into an obvious boot-time error instead of a confusing "everyone got logged out".
if (!process.env.JWT_SECRET) {
  console.error('[auth] FATAL: JWT_SECRET is not set. Set it in your hosting environment variables (Render: Environment tab) before starting the server.');
  process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;

function signToken(user) {
  return jwt.sign(
    { id: user.id, role: user.role, username: user.username, hotel_id: user.hotel_id || null, tv: user.token_version || 0 },
    JWT_SECRET,
    { expiresIn: '30d' }
  );
}

// Optional machine access for THO's local automation (ClickUp/Sadeq pipeline). Disabled unless
// AUTOMATION_API_KEY (>= 32 chars) is set. The key only works on the routes below — never on
// users, settings, backups, auth or templates — and acts as the first admin account.
const crypto = require('crypto');
const AUTOMATION_KEY = process.env.AUTOMATION_API_KEY || '';
const AUTOMATION_ROUTES = [
  ['GET', /^\/api\/hotels(\/\d+)?$/],
  ['POST', /^\/api\/hotels$/],
  ['GET', /^\/api\/clients(\/\d+)?$/],
  ['GET', /^\/api\/inspectors$/],
  ['GET', /^\/api\/assignments$/],
  ['POST', /^\/api\/assignments$/],
  ['GET', /^\/api\/inspections(\/\d+(\/pdf)?)?$/],
  ['POST', /^\/api\/inspections\/\d+\/(approve|reject)$/],
];
function automationUser(req) {
  if (AUTOMATION_KEY.length < 32) return null;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) return null;
  const given = Buffer.from(h.slice(7));
  const want = Buffer.from(AUTOMATION_KEY);
  if (given.length !== want.length || !crypto.timingSafeEqual(given, want)) return null;
  const path = (req.originalUrl || '').split('?')[0];
  if (!AUTOMATION_ROUTES.some(([m, re]) => m === req.method && re.test(path))) return 'forbidden';
  const admin = db.prepare("SELECT id, username, token_version FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get();
  if (!admin) return null;
  return { id: admin.id, role: 'admin', username: admin.username, hotel_id: null, tv: admin.token_version || 0, automation: true };
}

function requireAuth(req, res, next) {
  const auto = automationUser(req);
  if (auto === 'forbidden') return res.status(403).json({ error: 'forbidden' });
  if (auto) { req.user = auto; return next(); }
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
