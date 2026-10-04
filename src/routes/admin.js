// Mini App ichidagi "Mehmonlar" ekrani uchun — faqat administratorga ruxsat.
// Foydalanuvchi Telegram imzosi (initData) orqali tekshiriladi, ID esa ADMIN_CHAT_ID bilan solishtiriladi.

const express = require('express');
const router = express.Router();
const { getAllRsvps } = require('../db');
const { verifyTelegramInitData } = require('../telegramAuth');

// POST /api/admin/guests   body: { tgInitData }
router.post('/guests', async (req, res) => {
  const user = verifyTelegramInitData(req.body && req.body.tgInitData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user || String(user.id) !== String(process.env.ADMIN_CHAT_ID)) {
    return res.status(403).json({ error: 'Ruxsat yo\'q' });
  }

  try {
    const guests = await getAllRsvps();
    res.json({ guests });
  } catch (err) {
    console.error('Mehmonlar ro\'yxatini olishda xatolik:', err);
    res.status(500).json({ error: 'Serverda xatolik yuz berdi' });
  }
});

module.exports = router;
