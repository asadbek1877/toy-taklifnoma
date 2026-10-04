// Bu fayl bazaga ulanishni sozlaydi va bazaga yozish/o'qish funksiyalarini beradi.
// Boshqa fayllar bevosita SQL yozmaydi — shu yerdagi funksiyalarni chaqiradi.

const crypto = require('crypto');
const { Pool } = require('pg');
const outbox = require('./outbox');

// Pool = bir nechta bazaga ulanishni boshqaradigan "hovuz".
// DATABASE_URL .env faylidan olinadi.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Render'dagi Postgres SSL talab qiladi:
  ssl: process.env.DATABASE_URL?.includes('localhost')
    ? false
    : { rejectUnauthorized: false },
  max: 5,
  keepAlive: true, // ulanish uzilib qolmasin
  idleTimeoutMillis: 0, // ulanishlar yopilmasin — har so'rovda qayta SSL handshake bo'lmasin
});

// ---------- MIGRATSIYA ----------
// Server ishga tushganda bir marta ishlaydi va qayta ishga tushirish xavfsiz (IF NOT EXISTS).
// Shu sababli schema.sql'ni qo'lda ishga tushirish shart emas.
async function migrate() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS rsvp_responses (
      id SERIAL PRIMARY KEY,
      guest_name TEXT NOT NULL,
      status TEXT NOT NULL CHECK (status IN ('yes', 'no')),
      guest_count INTEGER NOT NULL DEFAULT 1,
      comment TEXT,
      language TEXT DEFAULT 'uz',
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS weddings (
      id SERIAL PRIMARY KEY,
      code TEXT UNIQUE NOT NULL,
      owner_id BIGINT UNIQUE NOT NULL,
      owner_name TEXT,
      design TEXT NOT NULL DEFAULT 'gold',
      groom TEXT NOT NULL,
      bride TEXT NOT NULL,
      wedding_date TEXT NOT NULL,
      ceremony_time TEXT,
      banquet_time TEXT,
      starts_at TEXT,
      venue_name TEXT,
      venue_address TEXT,
      map_query TEXT,
      message TEXT,
      photo TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMP NOT NULL DEFAULT NOW()
    )`);
  await pool.query('ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS wedding_id INTEGER');
  await pool.query('ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_tg_id BIGINT');
  await pool.query('ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_username TEXT');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rsvp_wedding ON rsvp_responses (wedding_id)');

  // Idempotentlik: ilova har javobga noyob clientId beradi — qayta yuborilsa (tarmoq uzilishi, qayta urinish)
  // ikkinchi yozuv yaratilmaydi. (UNIQUE'da NULL'lar bir-biriga to'qnashmaydi — eski clientId'siz yozuvlar ta'sirlanmaydi.)
  await pool.query('ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS client_id TEXT');
  await pool.query('CREATE UNIQUE INDEX IF NOT EXISTS ux_rsvp_client ON rsvp_responses (client_id)');

  // Ishonchli yetkazish navbati (src/outbox.js)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS outbox (
      id BIGSERIAL PRIMARY KEY,
      type TEXT NOT NULL,
      chat_id BIGINT NOT NULL,
      payload TEXT NOT NULL,
      dedupe_key TEXT NOT NULL UNIQUE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
      attempts INTEGER NOT NULL DEFAULT 0,
      next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      locked_at TIMESTAMPTZ,
      last_error TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      sent_at TIMESTAMPTZ
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (status, next_attempt_at)');
}

// Baza vaqtincha mavjud bo'lmasa (masalan Render'da baza "uyg'onmoqda") server yiqilmaydi va
// "abadiy 500" holatiga tushmaydi: migratsiya muvaffaqiyatli bo'lguncha qayta uriniladi.
// Shu vaqt ichida kelgan so'rovlar kutadi (ilova 15s dan keyin uzib, o'z navbatidan qayta yuboradi).
const ready = (async () => {
  for (let attempt = 1; ; attempt++) {
    try { await migrate(); return; }
    catch (err) {
      console.error(`Migratsiyada xatolik (${attempt}-urinish, qayta uriniladi):`, err.code || "", err.message);
      await new Promise((r) => setTimeout(r, Math.min(2000 * attempt, 15000)));
    }
  }
})();


// ---------- RSVP ----------
// Javobni va egasiga xabarni BIR TRANZAKSIYADA yozadi: yoki ikkalasi saqlanadi, yoki hech biri.
// Shu sababli "javob saqlandi, lekin xabar navbatga tushmadi" holati bo'lmaydi; xabarni keyin worker yetkazadi.
//  • buildNotification(savedRow) -> { chatId, type, text, parseMode } yoki null
//  • rsvp.clientId bo'yicha idempotent: takroriy so'rov mavjud yozuvni qaytaradi (duplicate: true)
async function saveRsvpDurable(rsvp, buildNotification) {
  await ready;
  // 1) Tez yo'l: shu clientId bilan allaqachon saqlangan bo'lsa — o'sha yozuvni qaytaramiz
  const existing = async () =>
    rsvp.clientId ? (await pool.query('SELECT * FROM rsvp_responses WHERE client_id = $1', [rsvp.clientId])).rows[0] : null;
  const dup = await existing();
  if (dup) return { row: dup, duplicate: true };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const ins = await client.query(
      `INSERT INTO rsvp_responses
         (guest_name, status, guest_count, comment, language, wedding_id, guest_tg_id, guest_username, client_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [rsvp.guestName, rsvp.status, rsvp.guestCount || 1, rsvp.comment || null, rsvp.language || 'uz',
       rsvp.weddingId || null, rsvp.guestTgId || null, rsvp.guestUsername || null, rsvp.clientId || null]
    );
    const row = ins.rows[0];
    const n = buildNotification && buildNotification(row);
    if (n) await outbox.enqueue(client, { ...n, dedupeKey: `rsvp:${row.id}` });
    await client.query('COMMIT');
    return { row, duplicate: false };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ulanish uzilgan bo'lishi mumkin */ }
    // 2) Poyga: ikki bir xil so'rov bir vaqtda keldi — unikal indeks bittasini rad etdi (23505).
    //    Bu xato emas: g'olibning yozuvini qaytaramiz (dublikat).
    if (err && err.code === '23505' && rsvp.clientId) {
      const winner = await existing();
      if (winner) return { row: winner, duplicate: true };
    }
    throw err;
  } finally {
    client.release();
  }
}

// Barcha RSVP javoblarini oladi (bot /ro'yxat buyrug'i uchun)
async function getAllRsvps() {
  await ready;
  const result = await pool.query(
    `SELECT * FROM rsvp_responses ORDER BY created_at DESC`
  );
  return result.rows;
}

// Bitta to'y mehmonlarining javoblari (egasi uchun)
async function getRsvpsByWedding(weddingId) {
  await ready;
  const result = await pool.query(
    `SELECT id, guest_name, status, guest_count, comment, guest_username, created_at
       FROM rsvp_responses WHERE wedding_id = $1 ORDER BY created_at DESC`,
    [weddingId]
  );
  return result.rows;
}

// ---------- TO'YLAR ----------
// Taklifnoma ko'p o'qiladi (har mehmon ochganda va har RSVP'da) — qisqa muddat xotirada saqlaymiz.
// Yangilanganda (upsertWedding) kesh o'chiriladi, shuning uchun eskirgan ma'lumot ko'rinmaydi.
const weddingCache = new Map(); // code -> { row, at }
const CACHE_TTL = 60 * 1000;

async function getWeddingByCode(code) {
  const hit = weddingCache.get(code);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.row;
  await ready;
  const r = await pool.query('SELECT * FROM weddings WHERE code = $1', [code]);
  const row = r.rows[0] || null;
  if (row) {
    if (weddingCache.size > 200) weddingCache.clear(); // foto ham ichida — xotira chegarasi
    weddingCache.set(code, { row, at: Date.now() });
  }
  return row;
}

async function getWeddingByOwner(ownerId) {
  await ready;
  const r = await pool.query('SELECT * FROM weddings WHERE owner_id = $1', [ownerId]);
  return r.rows[0] || null;
}

// Havola kodi: 8 ta belgi (url-safe). Taxmin qilib bo'lmaydigan, lekin sir emas —
// xavfsizlik kod emas, Telegram imzosi bilan ta'minlanadi.
function newCode() {
  return crypto.randomBytes(6).toString('base64url');
}

// Egasi uchun to'yni yaratadi yoki yangilaydi (bitta egasi — bitta to'y). Kod o'zgarmaydi.
async function upsertWedding(ownerId, ownerName, w) {
  await ready;
  const existing = await getWeddingByOwner(ownerId);
  const values = [
    w.design, w.groom, w.bride, w.date, w.ceremonyTime, w.banquetTime, w.startsAt,
    w.venueName, w.venueAddress, w.mapQuery, w.message, w.photo,
  ];
  if (existing) {
    const r = await pool.query(
      `UPDATE weddings SET design=$1, groom=$2, bride=$3, wedding_date=$4, ceremony_time=$5,
         banquet_time=$6, starts_at=$7, venue_name=$8, venue_address=$9, map_query=$10,
         message=$11, photo=$12, owner_name=$13, updated_at=NOW()
       WHERE owner_id=$14 RETURNING *`,
      [...values, ownerName || null, ownerId]
    );
    weddingCache.delete(existing.code);
    return r.rows[0];
  }
  const r = await pool.query(
    `INSERT INTO weddings (code, owner_id, owner_name, design, groom, bride, wedding_date, ceremony_time,
       banquet_time, starts_at, venue_name, venue_address, map_query, message, photo)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [newCode(), ownerId, ownerName || null, ...values]
  );
  return r.rows[0];
}

module.exports = {
  pool, ready, saveRsvpDurable, getAllRsvps, getRsvpsByWedding,
  getWeddingByCode, getWeddingByOwner, upsertWedding,
};
