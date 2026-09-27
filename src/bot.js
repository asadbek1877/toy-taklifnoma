// Bu fayl Telegram bot bilan bog'liq hamma narsani boshqaradi.

const TelegramBot = require('node-telegram-bot-api');
const { getAllRsvps } = require('./db');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// polling: true — bot doim Telegram'dan yangi xabar bor-yo'qligini so'rab turadi.
// Bu eng oddiy usul, kichik loyihalar uchun yetarli.
const bot = new TelegramBot(token, { polling: true });

// /start buyrug'i — kimdir botga yozsa shu javob qaytadi
bot.onText(/\/start/, (msg) => {
  bot.sendMessage(
    msg.chat.id,
    "Salom! Bu to'y taklifnomasi botining xizmat kanali. Mehmonlar javobi shu yerga tushadi."
  );
});

// /ro'yxat buyrug'i — FAQAT admin (siz) uchun, barcha javoblarni ro'yxat qilib chiqaradi
bot.onText(/\/ro'yxat/, async (msg) => {
  // Faqat admin chat_id'dan kelgan so'rovga javob beramiz — boshqalar ko'rmasin
  if (String(msg.chat.id) !== String(adminChatId)) {
    return bot.sendMessage(msg.chat.id, "Bu buyruq faqat administrator uchun.");
  }

  try {
    const rows = await getAllRsvps();

    if (rows.length === 0) {
      return bot.sendMessage(msg.chat.id, "Hozircha hech qanday javob yo'q.");
    }

    const kelayotganlar = rows.filter((r) => r.status === 'yes');
    const kelmaydiganlar = rows.filter((r) => r.status === 'no');
    const jamiMehmon = kelayotganlar.reduce((sum, r) => sum + r.guest_count, 0);

    let text = `📋 *RSVP ro'yxati*\n\n`;
    text += `✅ Keladi: ${kelayotganlar.length} ta javob (${jamiMehmon} kishi)\n`;
    text += `❌ Kelmaydi: ${kelmaydiganlar.length} ta javob\n\n`;

    kelayotganlar.forEach((r) => {
      text += `• ${r.guest_name} — ${r.guest_count} kishi${r.comment ? ` (${r.comment})` : ''}\n`;
    });

    bot.sendMessage(msg.chat.id, text, { parse_mode: 'Markdown' });
  } catch (err) {
    console.error('Ro\'yxatni olishda xatolik:', err);
    bot.sendMessage(msg.chat.id, "Ro'yxatni olishda xatolik yuz berdi.");
  }
});

// Yangi RSVP kelganda adminga xabar yuborish uchun funksiya.
// Buni src/routes/rsvp.js chaqiradi.
function notifyAdmin({ guestName, status, guestCount, comment }) {
  const holat = status === 'yes' ? '✅ Keladi' : '❌ Kelmaydi';
  let text = `🎉 Yangi RSVP javobi!\n\n`;
  text += `Ism: ${guestName}\n`;
  text += `Holat: ${holat}\n`;
  if (status === 'yes') text += `Mehmonlar soni: ${guestCount}\n`;
  if (comment) text += `Izoh: ${comment}\n`;

  bot.sendMessage(adminChatId, text);
}

module.exports = { bot, notifyAdmin };
