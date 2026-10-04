// Mini App ichidagi "Mehmonlar" ekrani uchun — faqat administratorga ruxsat.
// Foydalanuvchi Telegram imzosi (initData) orqali tekshiriladi, ID esa ADMIN_CHAT_ID bilan solishtiriladi.

const express = require('express');
const router = express.Router();
const { getAllRsvps } = require('../db');
const { verifyTelegramInitData } = require('../telegramAuth');
const outbox = require('../outbox');

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

// Yetkazish navbati nazorati (faqat admin): holat va xatolarni qayta navbatga qo'yish
function adminOnly(req, res) {
  const user = verifyTelegramInitData(req.body && req.body.tgInitData, process.env.TELEGRAM_BOT_TOKEN);
  if (!user || String(user.id) !== String(process.env.ADMIN_CHAT_ID)) {
    res.status(403).json({ error: "Ruxsat yo'q" });
    return false;
  }
  return true;
}

// POST /api/admin/outbox        -> { pending, sending, sent, failed, oldestUndeliveredSeconds, recentFailed }
router.post('/outbox', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try { res.json(await outbox.stats()); }
  catch (err) { console.error('Outbox holatini olishda xatolik:', err); res.status(500).json({ error: 'Serverda xatolik yuz berdi' }); }
});

// POST /api/admin/outbox/retry  -> { requeued }
router.post('/outbox/retry', async (req, res) => {
  if (!adminOnly(req, res)) return;
  try { res.json({ requeued: await outbox.requeueFailed() }); }
  catch (err) { console.error('Outbox retry xatolik:', err); res.status(500).json({ error: 'Serverda xatolik yuz berdi' }); }
});

module.exports = router;
