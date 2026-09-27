// Bu fayl bazaga ulanishni sozlaydi va bazaga yozish/o'qish funksiyalarini beradi.
// Boshqa fayllar bevosita SQL yozmaydi — shu yerdagi funksiyalarni chaqiradi.

const { Pool } = require('pg');

// Pool = bir nechta bazaga ulanishni boshqaradigan "hovuz".
// DATABASE_URL .env faylidan olinadi.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render'dagi Postgres SSL talab qiladi:
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
});

// Yangi RSVP javobini bazaga yozadi
async function saveRsvp({ guestName, status, guestCount, comment, language }) {
  const result = await pool.query(
    `INSERT INTO rsvp_responses (guest_name, status, guest_count, comment, language)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [guestName, status, guestCount || 1, comment || null, language || 'uz']
  );
  return result.rows[0];
}

// Barcha RSVP javoblarini oladi (bot /ro'yxat buyrug'i uchun)
async function getAllRsvps() {
  const result = await pool.query(
    `SELECT * FROM rsvp_responses ORDER BY created_at DESC`
  );
  return result.rows;
}

module.exports = { pool, saveRsvp, getAllRsvps };
