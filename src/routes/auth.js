const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');
const db = require('../../db/db');
const { signToken, requireAuth } = require('../middleware/auth');
const { sendPasswordResetEmail, isConfigured: mailerConfigured } = require('../lib/mailer');
const { withinLength } = require('../utils/validate');

const router = express.Router();

function toPublicUser(row) {
  return {
    id: row.id, role: row.role, username: row.username,
    name: { en: row.name_en, ar: row.name_ar },
    title: { en: row.title_en, ar: row.title_ar },
    email: row.email || '',
    hotelId: row.hotel_id || null
  };
}

// Same per-(ip, username) brute-force protection pattern as the login route — a forgot-password
// endpoint is just as easy to abuse for spamming a target's inbox or enumerating usernames, so
// it gets the same limiter treatment.
const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body && req.body.username) || ''}`,
  message: { error: 'too_many_attempts' },
});

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashResetToken(rawToken) {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
}

// The reset link needs an absolute URL back to whichever origin the person is actually using —
// the app is reachable at both the custom domain and the onrender.com URL (see the CORS
// allowlist in server.js), so trust the request's own Origin header when it's one of the
// allowed ones instead of hardcoding a single base URL.
function resolveAppOrigin(req) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : ['https://thehotelieroffice.org', 'https://www.thehotelieroffice.org', 'https://tho-mystery-guest.onrender.com', 'http://localhost:3000']);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0];
}

router.post('/login', (req, res) => {
  const { username, password, role } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'missing_fields' });
  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(String(username).trim());
  if (!row || !bcrypt.compareSync(password, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  // The login screen has separate Admin / Inspector / Hotel tabs — a set of credentials only
  // works from the tab matching its actual role, so picking the wrong tab gives a clear error
  // instead of silently signing the person into a different role than the one they selected.
  if (role && row.role !== role) {
    return res.status(401).json({ error: 'invalid_credentials' });
  }
  const token = signToken(row);
  res.cookie('tho_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ user: toPublicUser(row) });
});

router.post('/logout', (req, res) => {
  res.clearCookie('tho_token');
  res.json({ ok: true });
});

router.get('/me', requireAuth, (req, res) => {
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row) return res.status(404).json({ error: 'not_found' });
  res.json({ user: toPublicUser(row) });
});

// Self-service display-name edit — any logged-in role (admin/inspector/hotel) can fix the
// name shown for their own account. Deliberately scoped to name_en/name_ar only: username,
// password and role are not editable here.
router.put('/me', requireAuth, (req, res) => {
  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!existing) return res.status(404).json({ error: 'not_found' });
  const { name_en, name_ar, email } = req.body || {};
  if (!name_en || !name_ar) return res.status(400).json({ error: 'missing_fields' });
  if (!withinLength(email, 200)) return res.status(400).json({ error: 'field_too_long' });
  // email is optional and only used for the "forgot password" flow, so a blank value is fine —
  // undefined (field not sent at all) leaves whatever's already on file untouched.
  const nextEmail = email === undefined ? existing.email : String(email).trim();
  db.prepare('UPDATE users SET name_en=?, name_ar=?, email=? WHERE id=?').run(name_en, name_ar, nextEmail, req.user.id);
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  res.json({ user: toPublicUser(row) });
});

// Self-service password change — any logged-in role. Requires the current password so a
// hijacked/left-open session can't be used to silently lock the real owner out.
router.post('/change-password', requireAuth, (req, res) => {
  const { current_password, new_password } = req.body || {};
  if (!current_password || !new_password) return res.status(400).json({ error: 'missing_fields' });
  if (String(new_password).length < 6) return res.status(400).json({ error: 'password_too_short' });
  const row = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  if (!row || !bcrypt.compareSync(current_password, row.password_hash)) {
    return res.status(401).json({ error: 'invalid_current_password' });
  }
  // Bumping token_version invalidates every OTHER device/session currently holding an old
  // token for this account (see requireAuth) — the whole point of this change. But that would
  // also kick out this very request's own session on its next call, so immediately re-sign and
  // re-set the cookie for the current device so the person doesn't get logged out by their own
  // password change.
  db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), req.user.id);
  const updated = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user.id);
  const token = signToken(updated);
  res.cookie('tho_token', token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 30 * 24 * 60 * 60 * 1000
  });
  res.json({ ok: true });
});

// Request a password-reset link by username. Always responds with the same generic success
// message regardless of whether the username exists or has an email on file — revealing either
// would let someone enumerate valid usernames just by watching the response change.
router.post('/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { username } = req.body || {};
  const generic = { ok: true };
  if (!username || typeof username !== 'string') return res.json(generic);

  const row = db.prepare('SELECT * FROM users WHERE username = ?').get(username.trim());
  if (!row || !row.email) return res.json(generic);

  if (!mailerConfigured()) {
    // Fail loudly server-side (so this misconfiguration is easy to spot in logs) but keep the
    // client-facing response identical — no reason to leak infrastructure details either way.
    console.error('[forgot-password] SMTP_USER/SMTP_APP_PASSWORD not configured — cannot send reset email');
    return res.json(generic);
  }

  // A fresh request supersedes any earlier unused link for this account, so only the most
  // recently requested link is ever valid.
  db.prepare('UPDATE password_resets SET used = 1 WHERE user_id = ? AND used = 0').run(row.id);

  const rawToken = crypto.randomBytes(32).toString('hex');
  const id = 'pr_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const now = Date.now();
  db.prepare(`INSERT INTO password_resets (id, user_id, token_hash, expires_at, used, created_at)
    VALUES (?, ?, ?, ?, 0, ?)`)
    .run(id, row.id, hashResetToken(rawToken), now + RESET_TOKEN_TTL_MS, now);

  const resetUrl = `${resolveAppOrigin(req)}/reset-password?token=${rawToken}`;
  try {
    await sendPasswordResetEmail({ to: row.email, name: row.name_en, resetUrl });
  } catch (e) {
    console.error('[forgot-password] failed to send reset email', e.message);
    // Still return the generic success response — from the requester's point of view this
    // looks identical to "email sent", which is the intended behavior either way.
  }
  res.json(generic);
});

// Complete a password reset using the token emailed by /forgot-password.
router.post('/reset-password', (req, res) => {
  const { token, new_password } = req.body || {};
  if (!token || typeof token !== 'string') return res.status(400).json({ error: 'invalid_or_expired_token' });
  if (!new_password || String(new_password).length < 6) return res.status(400).json({ error: 'password_too_short' });

  const tokenHash = hashResetToken(token);
  const reset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ? AND used = 0').get(tokenHash);
  if (!reset || reset.expires_at < Date.now()) {
    return res.status(400).json({ error: 'invalid_or_expired_token' });
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(reset.user_id);
  if (!user) return res.status(400).json({ error: 'invalid_or_expired_token' });

  db.prepare('UPDATE password_resets SET used = 1 WHERE id = ?').run(reset.id);
  // token_version bump invalidates any other active session on this account too, same as a
  // normal password change — a password reset via a lost/leaked-then-recovered account
  // shouldn't leave an old session still logged in somewhere.
  db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?')
    .run(bcrypt.hashSync(new_password, 10), user.id);
  res.json({ ok: true });
});

module.exports = router;
