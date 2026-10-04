// Bu fayl RSVP so'rovini qabul qiladi.
//  • weddingCode bilan (Mini App): javob shu to'yning EGASIGA ketadi, mehmon Telegram imzosi bilan tekshiriladi.
//  • weddingCode'siz (eski browser sayti): avvalgidek ADMIN_CHAT_ID'ga ketadi.

const express = require('express');
const router = express.Router();
const { saveRsvp, getWeddingByCode } = require('../db');
const { notifyAdmin, notifyOwner } = require('../bot');
const { verifyTelegramInitData } = require('../telegramAuth');

// POST /api/rsvp
// { "guestName": "Aziz Karimov", "status": "yes", "guestCount": 2, "comment": "...",
//   "weddingCode": "abc123", "tgInitData": "..." }
router.post('/', async (req, res) => {
  const { guestName, status, guestCount, comment, language, weddingCode } = req.body;

  // Oddiy validatsiya — noto'g'ri ma'lumot bilan bazaga yozmaslik uchun
  if (!guestName || typeof guestName !== 'string' || guestName.trim().length === 0) {
    return res.status(400).json({ error: 'guestName majburiy' });
  }
  if (status !== 'yes' && status !== 'no') {
    return res.status(400).json({ error: "status faqat 'yes' yoki 'no' bo'lishi kerak" });
  }

  const rsvp = {
    guestName: guestName.trim().slice(0, 100),
    status,
    guestCount: Math.min(Math.max(Number(guestCount) || 1, 1), 50),
    comment: comment ? String(comment).trim().slice(0, 1000) : null,
    language: language || 'uz',
  };

  // Sayt Telegram ichida ochilgan bo'lsa — yuboruvchining nikini imzodan tekshirib olamiz
  const tgUser = verifyTelegramInitData(req.body.tgInitData, process.env.TELEGRAM_BOT_TOKEN);

  try {
    let wedding = null;
    if (weddingCode) {
      // Mini App oqimi: to'y bo'lishi va mehmon Telegram orqali kirgan bo'lishi shart
      if (!tgUser) return res.status(401).json({ error: 'Telegram orqali kiring' });
      wedding = await getWeddingByCode(String(weddingCode));
      if (!wedding) return res.status(404).json({ error: "To'y topilmadi" });
      rsvp.weddingId = wedding.id;
      rsvp.guestTgId = tgUser.id;
      rsvp.guestUsername = tgUser.username || null;
    }

    // Egasiga xabarni DARHOL yuboramiz — bazaga yozilishini kutmaymiz (parallel).
    if (wedding) notifyOwner(wedding.owner_id, rsvp, tgUser, `${wedding.groom} & ${wedding.bride}`);
    else notifyAdmin(rsvp, tgUser);

    const saved = await saveRsvp(rsvp);
    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('RSVP saqlashda xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

module.exports = router;
