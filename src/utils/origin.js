// Shared helper for resolving which of the app's known, CORS-allowed origins a request should
// be treated as belonging to -- used for building absolute links back into the app (password
// reset emails) and for internal same-app HTTP calls (PDF export) that must present an Origin
// the server's own CORS allowlist will actually accept.
function resolveAppOrigin(req) {
  const allowedOrigins = (process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim()).filter(Boolean)
    : ['https://thehotelieroffice.org', 'https://www.thehotelieroffice.org', 'https://tho-mystery-guest.onrender.com', 'http://localhost:3000']);
  const origin = req.headers.origin;
  if (origin && allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0];
}

module.exports = { resolveAppOrigin };
