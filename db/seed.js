// Seeds the DB with demo hotels/inspectors/assignments/one completed inspection,
// only if the users table is empty (first boot). Safe to call on every startup.
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { generateTempPassword } = require('../src/utils/tempPassword');

const seedData = JSON.parse(fs.readFileSync(path.join(__dirname, 'seed-data.json'), 'utf8'));

function alreadySeeded() {
  const row = db.prepare('SELECT COUNT(*) AS c FROM users').get();
  return row.c > 0;
}

function seed() {
  if (alreadySeeded()) return;
  console.log('[seed] first boot — seeding demo data...');

  const insertUser = db.prepare(`INSERT INTO users
    (id, role, username, password_hash, name_en, name_ar, title_en, title_ar, created_at)
    VALUES (@id, @role, @username, @password_hash, @name_en, @name_ar, @title_en, @title_ar, @created_at)`);

  // Real, random one-time passwords instead of the fixed demo123 that used to ship with every
  // install — printed once to the local server console below, never written to source control or
  // shown in the UI. Change every one of these from the app as soon as you log in.
  const seededCredentials = [];

  db.exec('BEGIN');
  try {
    seedData.USERS.forEach(u => {
      const tempPassword = generateTempPassword();
      seededCredentials.push({ username: u.username, role: u.role, password: tempPassword });
      insertUser.run({
        id: u.id,
        role: u.role,
        username: u.username,
        password_hash: bcrypt.hashSync(tempPassword, 10),
        name_en: u.name.en,
        name_ar: u.name.ar,
        title_en: (u.title && u.title.en) || '',
        title_ar: (u.title && u.title.ar) || '',
        created_at: Date.now()
      });
    });

    const insertHotel = db.prepare(`INSERT INTO hotels
      (id, name_en, name_ar, city_en, city_ar, type, contact, phone, created_at)
      VALUES (@id, @name_en, @name_ar, @city_en, @city_ar, @type, @contact, @phone, @created_at)`);
    seedData.defaultHotelsData.forEach(h => {
      insertHotel.run({
        id: h.id, name_en: h.name.en, name_ar: h.name.ar,
        city_en: h.city.en, city_ar: h.city.ar, type: h.type,
        contact: h.contact || '', phone: h.phone || '', created_at: Date.now()
      });
    });

    const insertAssignment = db.prepare(`INSERT INTO assignments
      (id, hotel_id, inspector_id, due_date, priority, standard_id, status, inspection_id, created_at)
      VALUES (@id, @hotel_id, @inspector_id, @due_date, @priority, @standard_id, @status, @inspection_id, @created_at)`);
    seedData.defaultAssignmentsData.forEach(a => {
      insertAssignment.run({
        id: a.id, hotel_id: a.hotelId, inspector_id: a.inspectorId,
        due_date: a.dueDate, priority: a.priority, standard_id: a.standardId || 'audit4',
        status: a.status, inspection_id: a.inspectionId || null, created_at: a.createdAt
      });
    });

    // demo completed inspection (Red Sea Resort)
    const di = seedData.demoInspection;
    db.prepare(`INSERT INTO inspections
      (id, assignment_id, hotel_id, inspector_id, standard_id, property_name, property_type_label, city, inspector_name, visit_date, ref, status, signature, completed_at, created_at)
      VALUES (@id, @assignment_id, @hotel_id, @inspector_id, @standard_id, @property_name, @property_type_label, @city, @inspector_name, @visit_date, @ref, @status, @signature, @completed_at, @created_at)`
    ).run({
      id: di.id, assignment_id: di.assignmentId, hotel_id: di.hotelId, inspector_id: 'u_lama',
      standard_id: di.standardId || 'audit4', property_name: di.property, property_type_label: di.propertyTypeLabel,
      city: di.city, inspector_name: di.inspector, visit_date: di.visitDate, ref: di.ref || '',
      status: di.status, signature: null, completed_at: di.createdAt, created_at: di.createdAt
    });

    const insertAnswer = db.prepare(`INSERT INTO answers (inspection_id, item_id, value, note) VALUES (?, ?, ?, ?)`);
    Object.keys(di.answers).forEach(itemId => {
      const a = di.answers[itemId];
      insertAnswer.run(di.id, itemId, a.value, a.note || '');
    });

    // Only the admin's own bootstrap password goes to the console -- there is no session yet at
    // first boot, so that one credential has to reach the operator through *some* side channel,
    // and the process log is the least-bad option for a single secret. Every other seeded
    // account's password is stashed in seed_credentials instead of also being printed: the admin
    // logs in with the console-printed credential, then views (and permanently clears) the rest
    // from an authenticated one-time screen in the app (GET/DELETE /api/auth/seed-credentials) --
    // so N secrets no longer sit in Render's retained logs forever, only the one that's
    // unavoidable.
    const insertSeedCred = db.prepare(`INSERT INTO seed_credentials (username, role, password, created_at) VALUES (?, ?, ?, ?)`);
    const now = Date.now();
    seededCredentials.forEach(c => {
      if (c.role !== 'admin') insertSeedCred.run(c.username, c.role, c.password, now);
    });

    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
  const adminCred = seededCredentials.find(c => c.role === 'admin');
  console.log('[seed] done. Admin bootstrap password (change this immediately from the app):');
  if (adminCred) console.log(`[seed]   ${adminCred.username} (admin): ${adminCred.password}`);
  console.log('[seed] Other seeded accounts\' one-time passwords are available in-app: log in as admin, then check the "Seeded accounts" prompt (GET /api/auth/seed-credentials).');
}

module.exports = { seed };
