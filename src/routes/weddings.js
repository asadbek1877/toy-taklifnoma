// To'y (wedding) API — Mini App uchun.
//   GET  /api/weddings/:code        — ochiq: taklifnoma ma'lumoti (mehmon ochadi)
//   POST /api/weddings/me           — egasining to'yi (+ shaxsiy havola)
//   POST /api/weddings              — to'yni yaratish / yangilash (faqat egasi)
//   POST /api/weddings/me/guests    — egasining mehmonlari javoblari
// Barcha POST'larda foydalanuvchi Telegram imzosi (tgInitData) bilan tekshiriladi:
// egasi ID'si so'rov tanasidan EMAS, imzolangan initData'dan olinadi — soxtalashtirib bo'lmaydi.

const express = require('express');
const router = express.Router();
const { getWeddingByCode, getWeddingByOwner, upsertWedding, getRsvpsByWedding } = require('../db');
const { verifyTelegramInitData } = require('../telegramAuth');
const { weddingLink } = require('../bot');

const DESIGNS = ['gold', 'rose', 'sage'];
const MAX_PHOTO = 600 * 1024; // base64 matn uzunligi chegarasi (~450 KB rasm)

function authUser(req, res) {
  const user = verifyTelegramInitData(req.body && req.body.tgInitData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user) res.status(401).json({ error: 'Telegram orqali kiring' });
  return user;
}

// Ochiq javobga faqat egasi uchun maxfiy bo'lmagan maydonlar chiqadi (owner_id yo'q)
function toPublic(w) {
  return {
    code: w.code,
    design: w.design,
    groom: w.groom,
    bride: w.bride,
    date: w.wedding_date,
    ceremonyTime: w.ceremony_time,
    banquetTime: w.banquet_time,
    startsAt: w.starts_at,
    venueName: w.venue_name,
    venueAddress: w.venue_address,
    mapQuery: w.map_query,
    message: w.message,
    photo: w.photo,
  };
}

// Kiruvchi ma'lumotni tekshiradi va tozalaydi. { value } yoki { error } qaytaradi.
function clean(input) {
  if (!input || typeof input !== 'object') return { error: "Ma'lumot yo'q" };
  const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  const groom = str(input.groom, 60);
  const bride = str(input.bride, 60);
  if (!groom || !bride) return { error: 'Kuyov va kelin ismlari majburiy' };

  const date = str(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: "Sana noto'g'ri" };

  const time = (v) => (typeof v === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : null);

  let startsAt = null;
  if (input.startsAt) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) return { error: "Boshlanish vaqti noto'g'ri" };
    startsAt = d.toISOString();
  }

  let photo = null;
  if (input.photo) {
    if (typeof input.photo !== 'string' || !/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(input.photo)) {
      return { error: 'Rasm JPEG bo\'lishi kerak' };
    }
    if (input.photo.length > MAX_PHOTO) return { error: 'Rasm juda katta' };
    photo = input.photo;
  }

  return {
    value: {
      design: DESIGNS.includes(input.design) ? input.design : 'gold',
      groom,
      bride,
      date,
      ceremonyTime: time(input.ceremonyTime),
      banquetTime: time(input.banquetTime),
      startsAt,
      venueName: str(input.venueName, 120) || null,
      venueAddress: str(input.venueAddress, 200) || null,
      mapQuery: str(input.mapQuery, 200) || null,
      message: str(input.message, 400) || null,
      photo,
    },
  };
}

const wrap = (fn) => (req, res) =>
  fn(req, res).catch((err) => {
    console.error('Weddings API xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  });

// Mehmon uchun: taklifnoma
router.get('/:code', wrap(async (req, res) => {
  const w = await getWeddingByCode(req.params.code);
  if (!w) return res.status(404).json({ error: "To'y topilmadi" });
  res.json({ wedding: toPublic(w) });
}));

// Egasi: o'z to'yi (yo'q bo'lsa wedding: null)
router.post('/me', wrap(async (req, res) => {
  const user = authUser(req, res);
  if (!user) return;
  const w = await getWeddingByOwner(user.id);
  if (!w) return res.json({ wedding: null });
  res.json({ wedding: toPublic(w), link: await weddingLink(w.code) });
}));

// Egasi: yaratish / yangilash
router.post('/', wrap(async (req, res) => {
  const user = authUser(req, res);
  if (!user) return;
  const { value, error } = clean(req.body.wedding);
  if (error) return res.status(400).json({ error });

  const ownerName = [user.first_name, user.last_name].filter(Boolean).join(' ');
  const w = await upsertWedding(user.id, ownerName, value);
  res.status(200).json({ wedding: toPublic(w), link: await weddingLink(w.code) });
}));

// Egasi: mehmonlar javoblari
router.post('/me/guests', wrap(async (req, res) => {
  const user = authUser(req, res);
  if (!user) return;
  const w = await getWeddingByOwner(user.id);
  if (!w) return res.json({ guests: [] });
  res.json({ guests: await getRsvpsByWedding(w.id) });
}));

module.exports = router;
