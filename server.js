const path = require('path');
const express = require('express');
const cookieParser = require('cookie-parser');
const cors = require('cors');
const helmet = require('helmet');
const { rateLimit, ipKeyGenerator } = require('express-rate-limit');

const { seed } = require('./db/seed');
seed();

// Break-glass admin password recovery. There is no self-service "forgot password" flow yet
// (that's a separate feature), so a locked-out admin has no way back in without direct DB
// access. If ADMIN_RESET_PASSWORD is set at boot, the oldest admin account's password is force
// -reset to it and every existing session for that account is invalidated (token_version bump)
// so old/leaked sessions can't linger. This is meant to be set for exactly one restart and then
// removed immediately — leaving it set means anyone who discovers the value could reset the
// admin password again on the next restart.
if (process.env.ADMIN_RESET_PASSWORD) {
  const bcrypt = require('bcryptjs');
  const db = require('./db/db');
  const admin = db.prepare("SELECT * FROM users WHERE role='admin' ORDER BY created_at ASC LIMIT 1").get();
  if (admin) {
    const hash = bcrypt.hashSync(process.env.ADMIN_RESET_PASSWORD, 10);
    db.prepare('UPDATE users SET password_hash=?, token_version = token_version + 1 WHERE id=?').run(hash, admin.id);
    console.log(`[recovery] password for admin account '${admin.username}' was reset via ADMIN_RESET_PASSWORD. REMOVE THIS ENV VAR NOW.`);
  } else {
    console.log('[recovery] ADMIN_RESET_PASSWORD was set but no admin user exists.');
  }
}

const authRoutes = require('./src/routes/auth');
const hotelRoutes = require('./src/routes/hotels');
const inspectorRoutes = require('./src/routes/inspectors');
const assignmentRoutes = require('./src/routes/assignments');
const inspectionRoutes = require('./src/routes/inspections');
const standardsRoutes = require('./src/routes/standards');
const metaRoutes = require('./src/routes/meta');
const settingsRoutes = require('./src/routes/settings');
const clientsRoutes = require('./src/routes/clients');
const templatesRoutes = require('./src/routes/templates');
const documentsRoutes = require('./src/routes/documents');

const app = express();

// Security headers. The app renders most of its UI via inline onclick="" handlers and inline
// style="" attributes (a vanilla-JS single-file SPA), so a strict default CSP would break the
// whole app — script-src/style-src need 'unsafe-inline'. This still meaningfully restricts where
// scripts/frames/connections can come from, blocks MIME-sniffing, and sets a sane referrer policy.
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"], // Chart.js is now self-hosted under /vendor, no external script CDN needed
      // Helmet defaults script-src-attr to 'none', which silently overrides scriptSrc's
      // 'unsafe-inline' specifically for onclick="" etc. attributes — without this the whole
      // app's inline event handlers are inert (buttons render but do nothing on click).
      scriptSrcAttr: ["'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"], // fonts are self-hosted under /vendor/fonts now, no external font CDN needed
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      frameAncestors: ["'self'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Only the app's own known origins may make credentialed cross-origin requests. Set
// ALLOWED_ORIGINS (comma-separated) in the hosting environment to override/extend this list;
// falls back to the production domain + localhost dev ports if unset.
const allowedOrigins = (process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
  : ['https://thehotelieroffice.org', 'https://www.thehotelieroffice.org', 'https://tho-mystery-guest.onrender.com', 'http://localhost:3000']);
app.use(cors({
  origin(origin, callback) {
    // requests with no Origin header (same-origin, curl, server-to-server) are always allowed
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('not allowed by CORS'));
  },
  credentials: true,
}));

app.use(express.json({ limit: '8mb' })); // signatures + logo are base64 images
app.use(cookieParser());

// Brute-force protection on login: a handful of attempts per IP+username pair every 15 minutes.
// Keyed on IP alone would let an attacker lock out a legitimate user by spamming their username
// from elsewhere, so scope the counter to the (ip, username) pair instead.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => `${ipKeyGenerator(req.ip)}:${(req.body && req.body.username) || ''}`,
  message: { error: 'too_many_attempts' },
});

app.use('/api/auth/login', loginLimiter);
app.use('/api/auth', authRoutes);
app.use('/api/hotels', hotelRoutes);
app.use('/api/inspectors', inspectorRoutes);
app.use('/api/assignments', assignmentRoutes);
app.use('/api/inspections', inspectionRoutes);
app.use('/api/standards', standardsRoutes);
app.use('/api/meta', metaRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/templates', templatesRoutes);
app.use('/api/documents', documentsRoutes);

app.use(express.static(path.join(__dirname, 'public')));
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not_found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Final error handler — must be registered last, after all routes. Express only reaches this for
// errors passed to next(err) or thrown inside synchronous route handlers (this app's routes are
// synchronous, so that covers them). Logs the real error server-side but never leaks stack traces
// or internal details to the client, regardless of NODE_ENV.
app.use((err, req, res, next) => {
  if (err && err.message === 'not allowed by CORS') {
    return res.status(403).json({ error: 'origin_not_allowed' });
  }
  console.error('[unhandled error]', err);
  // Genuine 4xx client errors (e.g. body-parser rejecting malformed JSON) keep their real status
  // code so the client knows it was their request, not us — but the message is always a generic,
  // safe label, never the raw error text/stack.
  const status = (err && typeof err.status === 'number' && err.status >= 400 && err.status < 500) ? err.status : 500;
  res.status(status).json({ error: status < 500 ? 'bad_request' : 'internal_error' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`THO Mystery Guest platform running on port ${PORT}`);
});
