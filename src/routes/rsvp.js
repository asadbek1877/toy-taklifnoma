// RSVP so'rovini qabul qiladi.
//  • weddingCode (umumiy havola) yoki guestToken (shaxsiy havola) bilan — Mini App oqimi: javob to'yning BARCHA a'zolariga
//    (egasi + hammuallif) ketadi; mehmon Telegram imzosi bilan tekshiriladi.
//  • ikkalasisiz — eski (browser) oqim: ADMIN_CHAT_ID'ga.

const express = require('express');
const router = express.Router();
const { saveRsvpDurable } = require('../db');
const store = require('../store');
const notify = require('../notify');
const { renderRsvpMessage } = require('../messages');
const outbox = require('../outbox');
const { verifyTelegramInitData } = require('../telegramAuth');
const { cleanContent } = require('../validate');

// POST /api/rsvp
// { guestName, status, guestCount, comment, language, weddingCode | guestToken, clientId, tgInitData }
//
// Ishonchlilik: javob va xabarlar bir tranzaksiyada saqlanadi (db.saveRsvpDurable), yetkazishni outbox worker bajaradi.
// clientId — idempotentlik kaliti: qayta yuborilsa ikkinchi yozuv/xabar yaratilmaydi (duplicate: true).
router.post('/', async (req, res) => {
  const { guestName, status, guestCount, comment, language, weddingCode, guestToken, clientId } = req.body;

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

  const tgUser = verifyTelegramInitData(req.body.tgInitData, process.env.TELEGRAM_BOT_TOKEN);

  try {
    let wedding = null, guest = null;
    if (guestToken || weddingCode) {
      if (!tgUser) return res.status(401).json({ error: 'Telegram orqali kiring' });

      if (guestToken) {
        guest = await store.getGuestByToken(String(guestToken));
        wedding = guest && (await store.getWeddingRow(guest.wedding_id));
      } else {
        wedding = await store.getWeddingByCodeRow(String(weddingCode));
        if (wedding && wedding.visibility === 'private') return res.status(403).json({ error: 'private' });
      }
      if (!wedding || !wedding.published) return res.status(404).json({ error: "To'y topilmadi" });

      // Takroriy yuborishni (clientId bo'yicha) avval aniqlaymiz: muddati o'tgan bo'lsa ham oldingi javob qaytariladi
      const content = cleanContent(store.hydrate(wedding).content).content;
      const deadline = content.rsvp.deadline;
      const closed = deadline && new Date().toISOString().slice(0, 10) > deadline;
      if (closed && !(clientId && (await require('../db').pool.query('SELECT 1 FROM rsvp_responses WHERE client_id = $1', [clientId])).rows.length)) {
        return res.status(409).json({ error: 'closed', deadline });
      }

      // Tarkib chegarasi: shaxsiy havolada — mehmonga ajratilgan joy; umumiyda — to'y sozlamasi
      rsvp.guestCount = status === 'no' ? 1 : Math.min(rsvp.guestCount, guest ? guest.max_party : content.rsvp.maxParty);
      rsvp.weddingId = wedding.id;
      rsvp.guestTgId = tgUser.id;
      rsvp.guestUsername = tgUser.username || null;
      rsvp.guestId = guest ? guest.id : null;
    }

    const title = wedding ? `${wedding.groom} & ${wedding.bride}` : null;
    const adminChat = process.env.ADMIN_CHAT_ID;

    // Kimga: to'yning barcha a'zolariga (sozlama o'chirmagan bo'lsa); eski oqimda — admin'ga
    let recipients = [];
    if (wedding) recipients = notify.wants(wedding, 'rsvp') ? (await store.listMembers(wedding.id)).map((m) => String(m.tg_id)) : [];
    else if (adminChat) recipients = [adminChat];

    const { row, duplicate } = await saveRsvpDurable(rsvp, (saved) =>
      recipients.map((chatId) => ({
        type: 'rsvp', chatId, parseMode: 'HTML',
        dedupeKey: wedding ? `rsvp:${saved.id}:${chatId}` : `rsvp:${saved.id}`,
        text: renderRsvpMessage(rsvp, tgUser, title, saved.id),
      }))
    );

    if (!duplicate) {
      outbox.kick();
      if (wedding) {
        await store.logEvent({ weddingId: wedding.id, guestId: rsvp.guestId, type: 'rsvp', tgId: tgUser.id, meta: { name: rsvp.guestName, status, count: rsvp.guestCount } });
      }
    }
    res.status(duplicate ? 200 : 201).json({ success: true, duplicate, data: row });
  } catch (err) {
    console.error('RSVP saqlashda xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

module.exports = router;
