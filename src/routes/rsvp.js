// Bu fayl saytdan kelgan RSVP so'rovini qabul qiladi.

const express = require('express');
const router = express.Router();
const { saveRsvp } = require('../db');
const { notifyAdmin } = require('../bot');

// POST /api/rsvp
// Sayt shu manzilga JSON yuboradi:
// { "guestName": "Aziz Karimov", "status": "yes", "guestCount": 2, "comment": "..." }
router.post('/', async (req, res) => {
  const { guestName, status, guestCount, comment, language } = req.body;

  // Oddiy validatsiya — noto'g'ri ma'lumot bilan bazaga yozmaslik uchun
  if (!guestName || typeof guestName !== 'string' || guestName.trim().length === 0) {
    return res.status(400).json({ error: 'guestName majburiy' });
  }
  if (status !== 'yes' && status !== 'no') {
    return res.status(400).json({ error: "status faqat 'yes' yoki 'no' bo'lishi kerak" });
  }

  try {
    const saved = await saveRsvp({
      guestName: guestName.trim(),
      status,
      guestCount: Number(guestCount) || 1,
      comment: comment ? String(comment).trim() : null,
      language: language || 'uz',
    });

    // Botga xabar yuborish — xato bo'lsa ham RSVP saqlangani muhim,
    // shuning uchun try/catch bilan alohida o'raymiz
    try {
      notifyAdmin(saved);
    } catch (botErr) {
      console.error('Botga xabar yuborishda xatolik:', botErr);
    }

    res.status(201).json({ success: true, data: saved });
  } catch (err) {
    console.error('RSVP saqlashda xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

module.exports = router;
