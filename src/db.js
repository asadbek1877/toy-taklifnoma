// Bu fayl bazaga ulanishni sozlaydi va bazaga yozish/o'qish funksiyalarini beradi.
// Boshqa fayllar bevosita SQL yozmaydi — shu yerdagi funksiyalarni chaqiradi.

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

  // ================= v2: to'liq mahsulot (shablonlar, kontent, media, mehmonlar, analitika) =================
  // Barcha o'zgarishlar IF NOT EXISTS / ADD COLUMN IF NOT EXISTS — eski ma'lumotlar saqlanadi.
  await pool.query("ALTER TABLE weddings ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 't01'");
  await pool.query('ALTER TABLE weddings ADD COLUMN IF NOT EXISTS theme TEXT');           // JSON: {id,bg,surface,ink,soft,accent,accent2}
  await pool.query("ALTER TABLE weddings ADD COLUMN IF NOT EXISTS font TEXT NOT NULL DEFAULT 'classic'");
  await pool.query('ALTER TABLE weddings ADD COLUMN IF NOT EXISTS content TEXT');         // JSON: bo'limlar (hikoya, dastur, menyu, galereya...)
  await pool.query("ALTER TABLE weddings ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public'"); // public | private
  await pool.query('ALTER TABLE weddings ADD COLUMN IF NOT EXISTS published BOOLEAN');
  await pool.query('ALTER TABLE weddings ADD COLUMN IF NOT EXISTS settings TEXT');        // JSON: eslatmalar, bildirishnomalar
  // Avval yaratilgan to'ylar allaqachon mehmonlarga yuborilgan — ular e'lon qilingan hisoblanadi
  await pool.query('UPDATE weddings SET published = TRUE WHERE published IS NULL');

  // A'zolar: egasi va hammuallif (co-host). Bir foydalanuvchi — bitta to'y.
  await pool.query(`
    CREATE TABLE IF NOT EXISTS wedding_members (
      id SERIAL PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      tg_id BIGINT NOT NULL UNIQUE,
      role TEXT NOT NULL CHECK (role IN ('owner', 'cohost')),
      name TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_members_wedding ON wedding_members (wedding_id)');
  await pool.query(`
    INSERT INTO wedding_members (wedding_id, tg_id, role, name)
    SELECT w.id, w.owner_id, 'owner', w.owner_name FROM weddings w
     WHERE NOT EXISTS (SELECT 1 FROM wedding_members m WHERE m.tg_id = w.owner_id)`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS cohost_invites (
      token TEXT PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      created_by BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at TIMESTAMPTZ NOT NULL,
      used_by BIGINT,
      used_at TIMESTAMPTZ
    )`);

  // Media: foto, video, musiqa — bazada (Render diski vaqtinchalik, baza doimiy)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS media (
      id TEXT PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
      mime TEXT NOT NULL,
      size INTEGER NOT NULL,
      data BYTEA NOT NULL,
      thumb BYTEA,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_media_wedding ON media (wedding_id)');

  // Mehmonlar va guruhlar
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guest_groups (
      id SERIAL PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      name TEXT NOT NULL,
      emoji TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (wedding_id, name)
    )`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS guests (
      id SERIAL PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      group_id INTEGER,
      name TEXT NOT NULL,
      token TEXT NOT NULL UNIQUE,
      max_party INTEGER NOT NULL DEFAULT 1,
      phone TEXT,
      note TEXT,
      tg_id BIGINT,
      open_count INTEGER NOT NULL DEFAULT 0,
      first_opened_at TIMESTAMPTZ,
      last_opened_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_guests_wedding ON guests (wedding_id)');
  await pool.query('ALTER TABLE guests ADD COLUMN IF NOT EXISTS lang TEXT');
  await pool.query('ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_id INTEGER');
  await pool.query('CREATE INDEX IF NOT EXISTS idx_rsvp_guest ON rsvp_responses (guest_id)');

  // Analitika / real-time lenta: link_start (bot), open, rsvp, section...
  await pool.query(`
    CREATE TABLE IF NOT EXISTS events (
      id BIGSERIAL PRIMARY KEY,
      wedding_id INTEGER NOT NULL,
      guest_id INTEGER,
      type TEXT NOT NULL,
      tg_id BIGINT,
      meta TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`);
  await pool.query('CREATE INDEX IF NOT EXISTS idx_events_wedding ON events (wedding_id, created_at)');

  // AI so'rovlari limiti (foydalanuvchi/kun)
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ai_usage (
      tg_id BIGINT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (tg_id, day)
    )`);
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
         (guest_name, status, guest_count, comment, language, wedding_id, guest_tg_id, guest_username, client_id, guest_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [rsvp.guestName, rsvp.status, rsvp.guestCount || 1, rsvp.comment || null, rsvp.language || 'uz',
       rsvp.weddingId || null, rsvp.guestTgId || null, rsvp.guestUsername || null, rsvp.clientId || null, rsvp.guestId || null]
    );
    const row = ins.rows[0];
    // Bir yoki bir nechta xabar (egasi + hammuallif): har biri o'z dedupe kaliti bilan, hammasi bir tranzaksiyada
    const list = [].concat((buildNotification && buildNotification(row)) || []);
    for (const n of list) await outbox.enqueue(client, { ...n, dedupeKey: n.dedupeKey || `rsvp:${row.id}` });
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
    `SELECT id, guest_name, status, guest_count, comment, guest_username, guest_id, created_at
       FROM rsvp_responses WHERE wedding_id = $1 ORDER BY created_at DESC`,
    [weddingId]
  );
  return result.rows;
}

module.exports = { pool, ready, saveRsvpDurable, getAllRsvps, getRsvpsByWedding };
