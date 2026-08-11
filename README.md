# THO Mystery Guest Platform

A real, hosted web application (and installable "app") for THE HOTELIER OFFICE's Mystery Guest inspection program — built on two evaluation standards, **THO-Audit 4** (323 criteria) and **THO-5 Plus** (439 criteria, the elevated ultra-luxury tier).

This is not the single HTML-file demo anymore. It is a full client–server application:

- **Backend**: Node.js + Express, with a real SQLite database (`better-sqlite3`) storing hotels, inspectors, assignments, inspections, and every answer.
- **Frontend**: the same bilingual (Arabic/English) admin dashboard and inspector mobile app, now talking to the backend over a REST API instead of storing data only in one browser's `localStorage`.
- **Auth**: real login with hashed passwords (bcrypt) and secure session cookies (JWT).
- **Installable app (PWA)**: has a manifest and service worker, so staff can "Add to Home Screen" on their phones and it behaves like a native app icon — no app store needed.

Everyone on the team — admin and every inspector — sees the same live data, from any device, at any time, as long as the app is running on a server.

## What you need to do (no coding required)

This app needs somewhere to run 24/7 so your team can reach it from their phones. That's the only step that needs you:

1. In the chat, click **Connect** on the **Render** card (a free hosting service). You'll sign in with your email/Google account and approve access — a few clicks, no code.
2. Tell me once it's connected, and I will create the hosting service and deploy the app for you. You'll get back a real web address (like `https://tho-mystery-guest.onrender.com`) that your admin and inspectors can open from any browser or add to their phone's home screen.

Everything below this point is technical reference — you don't need to read it unless you or a future developer wants to understand or modify the code.

## Project structure

```
tho-app-src/
  server.js              Express app entry point
  package.json
  db/
    schema.sql            SQLite table definitions
    db.js                 opens/creates the SQLite database file
    seed.js                first-boot demo data (hotels, inspectors, one sample inspection)
    seed-data.json         THO-Audit 4 / THO-5 Plus criteria + bilingual UI strings
  src/
    middleware/auth.js     JWT session handling
    routes/                REST API: auth, hotels, inspectors, assignments, inspections, standards, meta
    lib/standards.js       shared scoring logic (also used to validate answers)
  public/
    index.html, app.js, styles.css   the actual app UI (same design as before, now API-driven)
    manifest.json, sw.js, icons/     PWA installability
```

## Local run (for a developer)

```bash
npm install
npm start
```

Then open `http://localhost:3000`. On first boot it seeds demo data automatically (same as before: admin/demo123, sara/omar/lama with demo123).

Environment variables (set these in production):

- `JWT_SECRET` — any long random string. If not set, a random one is generated each restart, which will log everyone out on every deploy. **Must be set for production.**
- `PORT` — defaults to 3000; most hosts set this automatically.
- `DATA_DIR` — where the SQLite file is stored (defaults to `./data`). On Render this should point at the attached persistent disk so data survives redeploys.

## Data model

- `users` — admin + inspectors, bcrypt-hashed passwords.
- `hotels` — client properties.
- `assignments` — property ↔ inspector ↔ due date ↔ **which standard** (`audit4` or `plus5`) ↔ status.
- `inspections` — one per completed/in-progress inspection walkthrough, tied to a standard.
- `answers` — one row per checklist item per inspection (`yes`/`no`/`na` + note).

## API summary

All routes are under `/api`. Auth is a cookie-based session (`POST /api/auth/login`, `GET /api/auth/me`, `POST /api/auth/logout`). Everything else requires being logged in; hotel/inspector/assignment create-edit-delete requires the `admin` role.

- `GET/POST/PUT/DELETE /api/hotels`
- `GET/POST/PUT/DELETE /api/inspectors`
- `GET/POST/PUT/DELETE /api/assignments`
- `GET /api/inspections`, `GET /api/inspections/:id`, `POST /api/inspections/start`, `PUT /api/inspections/:id/answers/:itemId`, `POST /api/inspections/:id/complete`, `GET /api/inspections/:id/score`
- `GET /api/standards`, `GET /api/standards/:id/categories` (`audit4` or `plus5`)
- `GET /api/meta/strings` (bilingual UI text, public — used by the login screen)

## Notes for whoever hosts this

- The demo/seed data (6 sample hotels, 3 inspectors, 1 completed inspection) is only inserted the very first time the app starts against an empty database. Once real data exists, it's never overwritten.
- Signatures are stored as base64 PNG data URLs directly in the database (fine at this scale; consider object storage if the team grows very large).
- There is no built-in "forgot password" flow. An admin can reset an inspector's password via `POST /api/inspectors/:id/reset-password`, which returns a new temporary password to share with them directly.
