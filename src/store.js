// To'y mahsuloti uchun ma'lumotlarga kirish qatlami (SQL shu yerda). Sxemani db.js yaratadi.
// Har funksiya aniq weddingId bilan ishlaydi — egalik tekshiruvi route'larda requireMember orqali bajariladi.

const crypto = require('crypto');
const db = require('./db');

const q = (text, params) => db.ready.then(() => db.pool.query(text, params));
const rand = (bytes = 6) => crypto.randomBytes(bytes).toString('base64url');
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

// ---------- to'y ----------
// Bazadagi qatordan mijozga/route'ga qulay obyekt (JSON maydonlari ochilgan)
function hydrate(w) {
  if (!w) return null;
  return {
    id: w.id, code: w.code, ownerId: String(w.owner_id),
    groom: w.groom, bride: w.bride, date: w.wedding_date,
    ceremonyTime: w.ceremony_time, banquetTime: w.banquet_time, startsAt: w.starts_at,
    message: w.message, template: w.template, font: w.font,
    theme: parse(w.theme, null), content: parse(w.content, {}), settings: parse(w.settings, {}),
    visibility: w.visibility, published: w.published === true,
    updatedAt: w.updated_at, createdAt: w.created_at,
    legacyPhoto: !!w.photo, // eski (base64) foto — mavjud bo'lsa hero'da ishlatiladi
  };
}

async function getWeddingRow(id) {
  const r = await q('SELECT * FROM weddings WHERE id = $1', [id]);
  return r.rows[0] || null;
}
async function getWeddingByCodeRow(code) {
  const r = await q('SELECT * FROM weddings WHERE code = $1', [code]);
  return r.rows[0] || null;
}

// Foydalanuvchining a'zoligi: { wedding(row), role } yoki null
async function getMembership(tgId) {
  const r = await q(
    `SELECT w.*, m.role AS member_role FROM wedding_members m JOIN weddings w ON w.id = m.wedding_id WHERE m.tg_id = $1`,
    [tgId]
  );
  const row = r.rows[0];
  return row ? { wedding: row, role: row.member_role } : null;
}

const cols = (v) => [
  v.groom, v.bride, v.date, v.ceremonyTime, v.banquetTime, v.startsAt, v.message,
  v.template, JSON.stringify(v.theme), v.font, JSON.stringify(v.content), v.visibility, JSON.stringify(v.settings),
  v.content.location.name || null, v.content.location.address || null, v.content.location.mapQuery || null,
];

// Yangi to'y (faqat egasi, bitta). Foydalanuvchi allaqachon a'zo bo'lsa 23505 xatosi ko'tariladi.
async function createWedding(user, v) {
  await db.ready;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const ownerName = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
    const code = rand(6);
    const ins = await client.query(
      `INSERT INTO weddings (code, owner_id, owner_name, design, published,
         groom, bride, wedding_date, ceremony_time, banquet_time, starts_at, message,
         template, theme, font, content, visibility, settings, venue_name, venue_address, map_query)
       VALUES ($1,$2,$3,'gold',FALSE,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
      [code, user.id, ownerName, ...cols(v)]
    );
    await client.query(`INSERT INTO wedding_members (wedding_id, tg_id, role, name) VALUES ($1,$2,'owner',$3)`, [ins.rows[0].id, user.id, ownerName]);
    await client.query('COMMIT');
    return ins.rows[0];
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* ulanish uzilgan */ }
    throw err;
  } finally { client.release(); }
}

async function updateWedding(id, v) {
  const r = await q(
    `UPDATE weddings SET groom=$1, bride=$2, wedding_date=$3, ceremony_time=$4, banquet_time=$5, starts_at=$6, message=$7,
       template=$8, theme=$9, font=$10, content=$11, visibility=$12, settings=$13,
       venue_name=$14, venue_address=$15, map_query=$16, updated_at=NOW()
     WHERE id=$17 RETURNING *`,
    [...cols(v), id]
  );
  return r.rows[0];
}

async function setPublished(id, published) {
  const r = await q('UPDATE weddings SET published=$1, updated_at=NOW() WHERE id=$2 RETURNING *', [!!published, id]);
  return r.rows[0];
}

// ---------- a'zolar / hammuallif ----------
async function listMembers(weddingId) {
  return (await q('SELECT tg_id, role, name, created_at FROM wedding_members WHERE wedding_id = $1 ORDER BY id', [weddingId])).rows;
}

async function createCohostInvite(weddingId, byTgId) {
  const token = rand(9);
  await q(`INSERT INTO cohost_invites (token, wedding_id, created_by, expires_at) VALUES ($1,$2,$3,$4)`,
    [token, weddingId, byTgId, new Date(Date.now() + 7 * 24 * 3600 * 1000)]);
  return token;
}
async function getCohostInvite(token) {
  const r = await q(
    `SELECT i.*, w.groom, w.bride FROM cohost_invites i JOIN weddings w ON w.id = i.wedding_id WHERE i.token = $1`, [token]);
  return r.rows[0] || null;
}
// Qabul qilish: { ok } yoki { error: 'invalid'|'used'|'expired'|'already_member' }
async function acceptCohost(token, user) {
  await db.ready;
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const inv = (await client.query('SELECT * FROM cohost_invites WHERE token = $1', [token])).rows[0];
    if (!inv) { await client.query('ROLLBACK'); return { error: 'invalid' }; }
    if (inv.used_at) { await client.query('ROLLBACK'); return { error: 'used' }; }
    if (new Date(inv.expires_at).getTime() < Date.now()) { await client.query('ROLLBACK'); return { error: 'expired' }; }
    const existing = (await client.query('SELECT 1 FROM wedding_members WHERE tg_id = $1', [user.id])).rows[0];
    if (existing) { await client.query('ROLLBACK'); return { error: 'already_member' }; }
    const name = [user.first_name, user.last_name].filter(Boolean).join(' ') || null;
    await client.query(`INSERT INTO wedding_members (wedding_id, tg_id, role, name) VALUES ($1,$2,'cohost',$3)`, [inv.wedding_id, user.id, name]);
    await client.query('UPDATE cohost_invites SET used_by = $1, used_at = NOW() WHERE token = $2', [user.id, token]);
    await client.query('COMMIT');
    return { ok: true, weddingId: inv.wedding_id };
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) { /* */ }
    if (err && err.code === '23505') return { error: 'already_member' };
    throw err;
  } finally { client.release(); }
}
async function removeCohost(weddingId, tgId) {
  const r = await q(`DELETE FROM wedding_members WHERE wedding_id = $1 AND tg_id = $2 AND role = 'cohost' RETURNING tg_id`, [weddingId, tgId]);
  return r.rows.length > 0;
}

// ---------- media ----------
const MEDIA_QUOTA = 60 * 1024 * 1024; // bitta to'y uchun jami 60 MB
async function mediaUsage(weddingId) {
  const r = await q('SELECT COALESCE(SUM(size), 0) AS s, COUNT(*) AS c FROM media WHERE wedding_id = $1', [weddingId]);
  return { bytes: Number(r.rows[0].s), count: Number(r.rows[0].c) };
}
async function saveMedia({ weddingId, kind, mime, data, thumb }) {
  const id = crypto.randomBytes(12).toString('hex');
  await q('INSERT INTO media (id, wedding_id, kind, mime, size, data, thumb) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, weddingId, kind, mime, data.length + (thumb ? thumb.length : 0), data, thumb || null]);
  return id;
}
async function getMedia(id) {
  const r = await q('SELECT id, wedding_id, kind, mime, size, data, thumb, created_at FROM media WHERE id = $1', [id]);
  return r.rows[0] || null;
}
// Faqat shu to'yga tegishli id'lar (boshqa to'y mediasini ulab qo'yishning oldini oladi)
async function ownedMediaIds(weddingId, ids) {
  if (!ids.length) return new Set();
  const r = await q('SELECT id FROM media WHERE wedding_id = $1 AND id = ANY($2)', [weddingId, ids]);
  return new Set(r.rows.map((x) => x.id));
}
async function listMedia(weddingId) {
  return (await q('SELECT id, kind, mime, size, created_at FROM media WHERE wedding_id = $1 ORDER BY created_at', [weddingId])).rows;
}
async function deleteMedia(weddingId, id) {
  return (await q('DELETE FROM media WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId])).rows.length > 0;
}

// ---------- guruhlar va mehmonlar ----------
async function listGroups(weddingId) {
  return (await q('SELECT id, name, emoji FROM guest_groups WHERE wedding_id = $1 ORDER BY id', [weddingId])).rows;
}
async function saveGroup(weddingId, { id, name, emoji }) {
  if (id) {
    const r = await q('UPDATE guest_groups SET name=$1, emoji=$2 WHERE id=$3 AND wedding_id=$4 RETURNING id, name, emoji', [name, emoji || null, id, weddingId]);
    return r.rows[0] || null;
  }
  const r = await q(
    `INSERT INTO guest_groups (wedding_id, name, emoji) VALUES ($1,$2,$3)
     ON CONFLICT (wedding_id, name) DO UPDATE SET emoji = EXCLUDED.emoji RETURNING id, name, emoji`,
    [weddingId, name, emoji || null]);
  return r.rows[0];
}
async function deleteGroup(weddingId, id) {
  await q('UPDATE guests SET group_id = NULL WHERE wedding_id = $1 AND group_id = $2', [weddingId, id]);
  return (await q('DELETE FROM guest_groups WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId])).rows.length > 0;
}

async function groupBelongs(weddingId, groupId) {
  if (!groupId) return true;
  return (await q('SELECT 1 FROM guest_groups WHERE id = $1 AND wedding_id = $2', [groupId, weddingId])).rows.length > 0;
}

// Mehmonlar + har birining oxirgi javobi
async function listGuests(weddingId) {
  const guests = (await q('SELECT * FROM guests WHERE wedding_id = $1 ORDER BY id', [weddingId])).rows;
  const rs = (await q(
    `SELECT id, guest_id, guest_name, status, guest_count, comment, created_at FROM rsvp_responses
      WHERE wedding_id = $1 AND guest_id IS NOT NULL ORDER BY id`, [weddingId])).rows;
  const last = new Map();
  rs.forEach((r) => last.set(r.guest_id, r)); // oxirgisi g'olib
  return guests.map((g) => {
    const r = last.get(g.id);
    return {
      id: g.id, name: g.name, groupId: g.group_id, token: g.token, maxParty: g.max_party, phone: g.phone, note: g.note,
      opened: g.open_count > 0, openCount: g.open_count, firstOpenedAt: g.first_opened_at, lastOpenedAt: g.last_opened_at,
      rsvp: r ? { status: r.status, count: r.guest_count, comment: r.comment, at: r.created_at } : null,
    };
  });
}

async function createGuest(weddingId, g) {
  const r = await q(
    `INSERT INTO guests (wedding_id, group_id, name, token, max_party, phone, note) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [weddingId, g.groupId || null, g.name, rand(9), g.maxParty || 1, g.phone || null, g.note || null]);
  return r.rows[0].id;
}
async function updateGuest(weddingId, id, g) {
  const r = await q(
    `UPDATE guests SET name=$1, group_id=$2, max_party=$3, phone=$4, note=$5 WHERE id=$6 AND wedding_id=$7 RETURNING id`,
    [g.name, g.groupId || null, g.maxParty || 1, g.phone || null, g.note || null, id, weddingId]);
  return r.rows.length > 0;
}
async function deleteGuest(weddingId, id) {
  return (await q('DELETE FROM guests WHERE id = $1 AND wedding_id = $2 RETURNING id', [id, weddingId])).rows.length > 0;
}
async function getGuestByToken(token) {
  const r = await q(
    `SELECT g.*, w.code AS wedding_code FROM guests g JOIN weddings w ON w.id = g.wedding_id WHERE g.token = $1`, [token]);
  return r.rows[0] || null;
}
async function guestCount(weddingId) {
  return Number((await q('SELECT COUNT(*) AS c FROM guests WHERE wedding_id = $1', [weddingId])).rows[0].c);
}
// Havola ochilganda: ochilishlar soni, birinchi marta ochgan Telegram ID. Qaytaradi { first } — birinchi ochilishmi.
async function touchGuestOpen(guestId, tgId, lang = null) {
  const r = await q(
    `UPDATE guests SET open_count = open_count + 1, last_opened_at = NOW(),
        first_opened_at = COALESCE(first_opened_at, NOW()), tg_id = COALESCE(tg_id, $2), lang = COALESCE($3, lang)
      WHERE id = $1 RETURNING open_count`, [guestId, tgId || null, lang]);
  return { first: r.rows[0] && r.rows[0].open_count === 1 };
}

// ---------- hodisalar / analitika ----------
async function logEvent({ weddingId, guestId = null, type, tgId = null, meta = null }) {
  try {
    await q('INSERT INTO events (wedding_id, guest_id, type, tg_id, meta) VALUES ($1,$2,$3,$4,$5)',
      [weddingId, guestId, type, tgId, meta ? JSON.stringify(meta) : null]);
  } catch (err) { console.error('[events] yozib bo\'lmadi:', err.message); } // analitika asosiy oqimni hech qachon buzmasin
}

async function activity(weddingId, sinceId = 0, limit = 40) {
  const r = await q(
    `SELECT id, type, guest_id, tg_id, meta, created_at FROM events
      WHERE wedding_id = $1 AND id > $2 ORDER BY id DESC LIMIT $3`, [weddingId, sinceId, limit]);
  return r.rows.map((e) => ({ id: Number(e.id), type: e.type, guestId: e.guest_id, tgId: e.tg_id, meta: parse(e.meta, {}), at: e.created_at }));
}

// Analitika: JS'da jamlanadi (portativ SQL, hodisalar soni kichik/o'rtacha)
async function analytics(weddingId, days = 14) {
  const since = new Date(Date.now() - days * 24 * 3600 * 1000);
  const ev = (await q(
    `SELECT type, tg_id, guest_id, created_at FROM events WHERE wedding_id = $1 AND created_at >= $2 ORDER BY created_at LIMIT 20000`,
    [weddingId, since])).rows;

  const total = { link_start: 0, open: 0, rsvp: 0 };
  const uniq = { link_start: new Set(), open: new Set(), rsvp: new Set() };
  const perDay = {};
  for (let i = days - 1; i >= 0; i--) perDay[new Date(Date.now() - i * 24 * 3600 * 1000).toISOString().slice(0, 10)] = { link_start: 0, open: 0, rsvp: 0 };
  ev.forEach((e) => {
    if (!(e.type in total)) return;
    total[e.type]++;
    uniq[e.type].add(e.tg_id ? `t${e.tg_id}` : e.guest_id ? `g${e.guest_id}` : `e${Math.random()}`);
    const d = new Date(e.created_at).toISOString().slice(0, 10);
    if (perDay[d]) perDay[d][e.type]++;
  });

  const guests = await listGuests(weddingId);
  const groups = await listGroups(weddingId);
  const rs = (await q(
    `SELECT status, guest_count, guest_id FROM rsvp_responses WHERE wedding_id = $1 ORDER BY id`, [weddingId])).rows;
  // Har mehmon (yoki tg foydalanuvchi) bo'yicha oxirgi javob; shaxsiy havolasiz javoblar alohida sanaladi
  const yes = rs.filter((r) => r.status === 'yes');
  return {
    days,
    totals: { linkStarts: total.link_start, opens: total.open, rsvps: total.rsvp },
    unique: { linkStarts: uniq.link_start.size, opens: uniq.open.size, rsvps: uniq.rsvp.size },
    perDay: Object.entries(perDay).map(([date, v]) => ({ date, ...v })),
    funnel: { starts: uniq.link_start.size, opens: uniq.open.size, answered: uniq.rsvp.size },
    rsvp: { yes: yes.length, no: rs.length - yes.length, people: yes.reduce((s, r) => s + (r.guest_count || 1), 0) },
    guests: {
      total: guests.length,
      opened: guests.filter((g) => g.opened).length,
      answered: guests.filter((g) => g.rsvp).length,
      yes: guests.filter((g) => g.rsvp && g.rsvp.status === 'yes').length,
      no: guests.filter((g) => g.rsvp && g.rsvp.status === 'no').length,
      pending: guests.filter((g) => !g.rsvp).length,
      people: guests.filter((g) => g.rsvp && g.rsvp.status === 'yes').reduce((s, g) => s + (g.rsvp.count || 1), 0),
    },
    byGroup: [...groups, { id: null, name: null, emoji: null }].map((gr) => {
      const gs = guests.filter((g) => (g.groupId || null) === gr.id);
      return {
        id: gr.id, name: gr.name, emoji: gr.emoji, total: gs.length, opened: gs.filter((g) => g.opened).length,
        yes: gs.filter((g) => g.rsvp && g.rsvp.status === 'yes').length, no: gs.filter((g) => g.rsvp && g.rsvp.status === 'no').length,
      };
    }).filter((g) => g.total > 0),
  };
}

// ---------- AI limiti ----------
// Bugungi so'rovlar sonini atomik oshiradi va yangi qiymatni qaytaradi
async function bumpAiUsage(tgId) {
  const day = new Date().toISOString().slice(0, 10);
  const r = await q(
    `INSERT INTO ai_usage (tg_id, day, count) VALUES ($1,$2,1)
     ON CONFLICT (tg_id, day) DO UPDATE SET count = ai_usage.count + 1 RETURNING count`, [tgId, day]);
  return r.rows[0].count;
}

module.exports = {
  hydrate, getWeddingRow, getWeddingByCodeRow, getMembership, createWedding, updateWedding, setPublished,
  listMembers, createCohostInvite, getCohostInvite, acceptCohost, removeCohost,
  MEDIA_QUOTA, mediaUsage, saveMedia, getMedia, ownedMediaIds, listMedia, deleteMedia,
  listGroups, saveGroup, deleteGroup, groupBelongs, listGuests, createGuest, updateGuest, deleteGuest, getGuestByToken, guestCount, touchGuestOpen,
  logEvent, activity, analytics, bumpAiUsage, rand,
};
