// Bu fayl RSVP so'rovini qabul qiladi.
//  • weddingCode bilan (Mini App): javob shu to'yning EGASIGA ketadi, mehmon Telegram imzosi bilan tekshiriladi.
//  • weddingCode'siz (eski browser sayti): avvalgidek ADMIN_CHAT_ID'ga ketadi.

const express = require('express');
const router = express.Router();
const { saveRsvpDurable, getWeddingByCode } = require('../db');
const { renderRsvpMessage } = require('../messages');
const outbox = require('../outbox');
const { verifyTelegramInitData } = require('../telegramAuth');

// POST /api/rsvp
// { "guestName": "Aziz Karimov", "status": "yes", "guestCount": 2, "comment": "...",
//   "weddingCode": "abc123", "clientId": "<uuid>", "tgInitData": "..." }
//
// Ishonchlilik: javob va egasiga xabar bir tranzaksiyada saqlanadi (db.saveRsvpDurable), xabarni keyin
// outbox worker yetkazadi (xato bo'lsa qayta urinadi). clientId — idempotentlik kaliti: ilova javobni
// qayta yuborsa ham ikkinchi yozuv/xabar yaratilmaydi (javobda duplicate: true).
router.post('/', async (req, res) => {
  const { guestName, status, guestCount, comment, language, weddingCode, clientId } = req.body;

  // Oddiy validatsiya — noto'g'ri ma'lumot bilan bazaga yozmaslik uchun
  if (!guestName || typeof guestName !== 'string' || guestName.trim().length === 0) {
    return res.status(400).json({ error: 'guestName majburiy' });
  }
  if (status !== 'yes' && status !== 'no') {
    return res.status(400).json({ error: "status faqat 'yes' yoki 'no' bo'lishi kerak" });
  }
  if (clientId !== undefined && clientId !== null && !(typeof clientId === 'string' && /^[\w-]{8,64}$/.test(clientId))) {
    return res.status(400).json({ error: "clientId noto'g'ri" });
  }

  const rsvp = {
    guestName: guestName.trim().slice(0, 100),
    status,
    guestCount: Math.min(Math.max(Number(guestCount) || 1, 1), 50),
    comment: comment ? String(comment).trim().slice(0, 1000) : null,
    language: language || 'uz',
    clientId: clientId || null,
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

    // Kimga yuboriladi: to'y egasiga; eski (browser) oqimda — ADMIN_CHAT_ID'ga
    const chatId = wedding ? wedding.owner_id : process.env.ADMIN_CHAT_ID;
    const title = wedding ? `${wedding.groom} & ${wedding.bride}` : null;

    const { row, duplicate } = await saveRsvpDurable(rsvp, (saved) =>
      chatId
        ? { type: 'rsvp', chatId, parseMode: 'HTML', text: renderRsvpMessage(rsvp, tgUser, title, saved.id) }
        : null
    );

    if (!duplicate) outbox.kick(); // yetkazishni darhol boshlaymiz (javobni kutdirmasdan)
    res.status(duplicate ? 200 : 201).json({ success: true, duplicate, data: row });
  } catch (err) {
    console.error('RSVP saqlashda xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

module.exports = router;
