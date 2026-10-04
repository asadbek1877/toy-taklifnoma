// Bu fayl Telegram bot bilan bog'liq hamma narsani boshqaradi.

const TelegramBot = require('node-telegram-bot-api');
const { getAllRsvps, getWeddingByCode } = require('./db');

const token = process.env.TELEGRAM_BOT_TOKEN;
const adminChatId = process.env.ADMIN_CHAT_ID;

// polling: true — bot doim Telegram'dan yangi xabar bor-yo'qligini so'rab turadi.
// Bu eng oddiy usul, kichik loyihalar uchun yetarli.
const bot = new TelegramBot(token, { polling: true });

// Mini App manzili (faqat https). Tartib:
//  1) WEBAPP_URL — qo'lda berilgan (masalan alohida hosting)
//  2) Render o'zi beradigan RENDER_EXTERNAL_URL + /app/ — backend Mini App'ni o'zi tarqatadi (src/index.js)
const webAppUrl = [
  process.env.WEBAPP_URL,
  process.env.RENDER_EXTERNAL_URL && `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, '')}/app/`,
].find((u) => u && u.startsWith('https://'));

// Bot menyusidagi doimiy tugma — mehmon bosib saytni Telegram ichida ochadi,
// ismi/nik avtomatik ketadi.
if (webAppUrl) {
  // DIQQAT: kutubxona ichma-ich obyektni o'zi JSON'ga aylantirmaydi (setMyCommands'dan farqli) —
  // menu_button'ni o'zimiz stringify qilamiz, aks holda Telegram 400 qaytaradi.
  bot
    .setChatMenuButton({
      menu_button: JSON.stringify({ type: 'web_app', text: 'Таклифнома 💌', web_app: { url: webAppUrl } }),
    })
    .then(() => console.log('Menyu tugmasi o\'rnatildi:', webAppUrl))
    .catch((err) => console.error('Menyu tugmasini sozlashda xatolik:', err.message));

  bot
    .setMyCommands([{ command: 'start', description: 'Taklifnomani ochish 💌' }])
    .catch((err) => console.error('Buyruqlarni sozlashda xatolik:', err.message));

  // Yangi foydalanuvchi botni ochganda START tugmasi tepasida chiqadigan matn (tilga qarab)
  const descriptions = {
    '': "💍 To'y taklifnomalari boti. START ni bosing — o'z taklifnomangizni yarating yoki mehmon sifatida oching.",
    ru: '💍 Бот свадебных приглашений. Нажмите START — создайте своё приглашение или откройте как гость.',
    ja: '💍 結婚式の招待状ボット。START を押して、招待状を作成するかゲストとして開いてください。',
  };
  Object.entries(descriptions).forEach(([language_code, description]) => {
    bot
      .setMyDescription({ description, ...(language_code && { language_code }) })
      .catch((err) => console.error('Tavsifni sozlashda xatolik:', err.message));
  });
}

// Botning username'i (shaxsiy havola uchun): BOT_USERNAME env yoki Telegram getMe()
let usernamePromise = null;
function getBotUsername() {
  if (process.env.BOT_USERNAME) return Promise.resolve(process.env.BOT_USERNAME.replace(/^@/, ''));
  if (!usernamePromise) {
    usernamePromise = bot.getMe().then((me) => me.username).catch((err) => {
      usernamePromise = null; // keyingi safar qayta urinamiz
      throw err;
    });
  }
  return usernamePromise;
}

// Egasi mehmonlarga yuboradigan havola: t.me/<bot>?start=w_<kod>
async function weddingLink(code) {
  return `https://t.me/${await getBotUsername()}?start=w_${code}`;
}

// Bot matnlari foydalanuvchi tiliga qarab (Telegram language_code)
const TEXT = {
  uz: {
    welcome: "Ассалому алайкум! 💍 Бу — тўй таклифномалари боти. Таклифнома яратиш ёки очиш учун тугмани босинг 👇",
    open: 'Очиш 💌',
    invite: (title) => `💌 ${title}\n\nТаклифномани очиш учун тугмани босинг 👇`,
    openInvite: 'Таклифномани очиш 💌',
    notFound: 'Бу ҳавола ишламайди. Тўй эгасидан янги ҳавола сўранг.',
  },
  ru: {
    welcome: 'Здравствуйте! 💍 Это бот свадебных приглашений. Нажмите кнопку, чтобы создать или открыть приглашение 👇',
    open: 'Открыть 💌',
    invite: (title) => `💌 ${title}\n\nНажмите кнопку, чтобы открыть приглашение 👇`,
    openInvite: 'Открыть приглашение 💌',
    notFound: 'Эта ссылка не работает. Попросите у владельца свадьбы новую ссылку.',
  },
  ja: {
    welcome: 'ようこそ！💍 結婚式の招待状ボットです。ボタンを押して招待状を作成・開封してください 👇',
    open: '開く 💌',
    invite: (title) => `💌 ${title}\n\nボタンを押して招待状を開いてください 👇`,
    openInvite: '招待状を開く 💌',
    notFound: 'このリンクは無効です。新郎新婦に新しいリンクをお願いしてください。',
  },
};
const tr = (msg) => TEXT[(msg.from && msg.from.language_code || '').slice(0, 2)] || TEXT.uz;

function webAppButton(text, url) {
  return { reply_markup: { inline_keyboard: [[{ text, web_app: { url } }]] } };
}

// /start [w_<kod>]
//  • w_<kod> bor  → mehmon: shu to'yning taklifnomasi Mini App'da ochiladigan tugma
//  • w_<kod> yo'q → Mini App'ning o'zi (u yerda "to'y egasimisiz yoki mehmon?" tanlovi)
// Kod URL'ga ?w=<kod> bo'lib qo'shiladi — inline web_app tugmasida start_param ishlamaydi.
bot.onText(/^\/start(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const t = tr(msg);
  if (!webAppUrl) {
    return bot.sendMessage(chatId, "Mini App manzili (WEBAPP_URL) sozlanmagan.");
  }

  const param = match && match[1];
  const code = param && /^w_[\w-]{4,32}$/.test(param) ? param.slice(2) : null;

  if (!code) {
    return bot.sendMessage(chatId, t.welcome, webAppButton(t.open, webAppUrl));
  }

  try {
    const wedding = await getWeddingByCode(code);
    if (!wedding) return bot.sendMessage(chatId, t.notFound);
    const url = `${webAppUrl.replace(/\/$/, '')}/?w=${encodeURIComponent(code)}`;
    bot.sendMessage(chatId, t.invite(`${wedding.groom} & ${wedding.bride}`), webAppButton(t.openInvite, url));
  } catch (err) {
    console.error('/start (deep-link) xatolik:', err.message);
    bot.sendMessage(chatId, t.welcome, webAppButton(t.open, webAppUrl));
  }
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

// HTML parse_mode uchun maxsus belgilarni xavfsiz qilish (mehmon nima yozsa ham xabar buzilmasin)
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Xabarning eng tepasidagi "kimdan" qatori.
// Telegram orqali ochilgan bo'lsa — @username (yoki ism) va bosiladigan havola.
function senderLine(tgUser) {
  if (!tgUser) return '🌐 Sayt orqali (Telegramsiz)';
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  const link = `<a href="tg://user?id=${tgUser.id}">${esc(fullName || 'Telegram foydalanuvchi')}</a>`;
  return tgUser.username ? `📨 @${esc(tgUser.username)} · ${link}` : `📨 ${link}`;
}

// Yangi RSVP kelganda shu to'y egasiga (chatId) xabar yuboradi. src/routes/rsvp.js chaqiradi.
// tgUser — tekshirilgan Telegram foydalanuvchisi yoki null; title — "Aziz & Malika" (ixtiyoriy).
function notifyOwner(chatId, { guestName, status, guestCount, comment }, tgUser = null, title = null) {
  const extra = Math.max(0, (Number(guestCount) || 1) - 1);

  let text = `${senderLine(tgUser)}\n`;
  if (title) text += `💒 ${esc(title)}\n`;
  text += `\n`;

  if (status === 'yes') {
    text += `🎊 <b>МЕҲМОНДАН ХУШХАБАР!</b>\n\n`;
    text += `👤 ${esc(guestName)}\n`;
    text += `💚 Келаман деди\n`;
    if (extra > 0) text += `👥 +${extra} меҳмон\n`;
  } else {
    text += `💌 <b>МЕҲМОНДАН ЖАВОБ</b>\n\n`;
    text += `👤 ${esc(guestName)}\n`;
    text += `💔 Келолмайман деди\n`;
  }

  if (comment) text += `\n💬 «${esc(comment)}»\n`;

  text += status === 'yes' ? `\n🥂 Кўришгунча!` : `\n🤍 Барибир раҳмат!`;

  // Promise'ni kutmaymiz (javob tez qaytsin), lekin xatoni ushlaymiz —
  // aks holda unhandled rejection butun serverni yiqitishi mumkin.
  bot.sendMessage(chatId, text, { parse_mode: 'HTML' }).catch((err) => {
    console.error('Botga xabar yuborishda xatolik:', err.message);
  });
}

// Eski (browser) oqim: to'y egasi ko'rsatilmagan — ADMIN_CHAT_ID'ga yuboriladi
function notifyAdmin(rsvp, tgUser = null) {
  notifyOwner(adminChatId, rsvp, tgUser);
}

// Polling xatolari (masalan 409 Conflict) serverni yiqitmasin, logda ko'rinsin
bot.on('polling_error', (err) => {
  console.error('Telegram polling xatosi:', err.code, err.message);
});

module.exports = { bot, notifyAdmin, notifyOwner, weddingLink };
