// Bu fayl Telegram bot bilan bog'liq hamma narsani boshqaradi.

const fs = require('fs');
const path = require('path');
const TelegramBot = require('node-telegram-bot-api');
const { getAllRsvps } = require('./db');
const store = require('./store');
const outbox = require('./outbox');

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

// ---- Nazorat (faqat admin): /status — yetkazish navbati holati, /retry — 'failed'larni qayta navbatga ----
const isAdmin = (msg) => String(msg.chat.id) === String(adminChatId);

bot.onText(/^\/status(?:@\w+)?$/, async (msg) => {
  if (!isAdmin(msg)) return;
  try {
    const st = await outbox.stats();
    let text = `📊 Yetkazish navbati\n\n⏳ Kutilmoqda: ${st.pending}\n📤 Yuborilmoqda: ${st.sending}\n✅ Yetkazilgan: ${st.sent}\n❌ Xato (qo'lda): ${st.failed}`;
    if (st.oldestUndeliveredSeconds > 0) text += `\n\n🕐 Eng eski yetkazilmagan: ${st.oldestUndeliveredSeconds} s`;
    st.recentFailed.forEach((f) => { text += `\n#${f.id} → ${f.chat_id}: ${String(f.last_error).slice(0, 80)}`; });
    if (st.failed) text += `\n\n/retry — xatolarni qayta yuborish`;
    await bot.sendMessage(msg.chat.id, text);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Holatni olib bo'lmadi: ${err.message}`).catch(() => {});
  }
});

bot.onText(/^\/retry(?:@\w+)?$/, async (msg) => {
  if (!isAdmin(msg)) return;
  try {
    const n = await outbox.requeueFailed();
    await bot.sendMessage(msg.chat.id, `🔁 Qayta navbatga qo'yildi: ${n} ta`);
  } catch (err) {
    bot.sendMessage(msg.chat.id, `Xatolik: ${err.message}`).catch(() => {});
  }
});

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

// Havolalar: t.me/<bot>?start=<prefiks>_<kod>
//   w_<kod>   — umumiy taklifnoma havolasi
//   g_<token> — mehmonning shaxsiy havolasi (private to'yda ham ishlaydi)
//   c_<token> — hammuallifga taklif
async function startLink(prefix, code) {
  return `https://t.me/${await getBotUsername()}?start=${prefix}_${code}`;
}
const weddingLink = (code) => startLink('w', code); // eski nom (moslik uchun)

// Bot matnlari foydalanuvchi tiliga qarab (Telegram language_code)
const TEXT = {
  uz: {
    welcome: "Ассалому алайкум! 💍 Бу — тўй таклифномалари боти. Таклифнома яратиш ёки очиш учун тугмани босинг 👇",
    open: 'Очиш 💌',
    inviteCap: '💌 Сизни тўйга таклиф қилишади!',
    invite: (title) => `💌 ${title}\n\nТаклифномани очиш учун тугмани босинг 👇`,
    openInvite: 'Таклифномани очиш 💌',
    notFound: 'Бу ҳавола ишламайди. Тўй эгасидан янги ҳавола сўранг.',
    private: 'Бу таклифнома махфий. Тўй эгасидан ўзингизга аталган шахсий ҳаволани сўранг.',
    draft: 'Таклифнома ҳали эълон қилинмаган. Бироз кейинроқ уриниб кўринг.',
    cohost: (title) => `💑 Сизни ${title} тўйининг ҳаммуаллифи бўлишга таклиф қилишди.\n\nҚабул қилиш учун тугмани босинг 👇`,
    openCohost: 'Қабул қилиш 💑',
  },
  ru: {
    welcome: 'Здравствуйте! 💍 Это бот свадебных приглашений. Нажмите кнопку, чтобы создать или открыть приглашение 👇',
    open: 'Открыть 💌',
    inviteCap: '💌 Вас приглашают на свадьбу!',
    invite: (title) => `💌 ${title}\n\nНажмите кнопку, чтобы открыть приглашение 👇`,
    openInvite: 'Открыть приглашение 💌',
    notFound: 'Эта ссылка не работает. Попросите у владельца свадьбы новую ссылку.',
    private: 'Это приватное приглашение. Попросите у владельца свадьбы вашу персональную ссылку.',
    draft: 'Приглашение ещё не опубликовано. Попробуйте чуть позже.',
    cohost: (title) => `💑 Вас приглашают стать соведущим свадьбы ${title}.\n\nНажмите кнопку, чтобы принять 👇`,
    openCohost: 'Принять 💑',
  },
  ja: {
    welcome: 'ようこそ！💍 結婚式の招待状ボットです。ボタンを押して招待状を作成・開封してください 👇',
    open: '開く 💌',
    inviteCap: '💌 結婚式にご招待します！',
    invite: (title) => `💌 ${title}\n\nボタンを押して招待状を開いてください 👇`,
    openInvite: '招待状を開く 💌',
    notFound: 'このリンクは無効です。新郎新婦に新しいリンクをお願いしてください。',
    private: 'このご招待は非公開です。新郎新婦からあなた専用のリンクを受け取ってください。',
    draft: '招待状はまだ公開されていません。しばらくしてからお試しください。',
    cohost: (title) => `💑 ${title} の結婚式の共同ホストに招待されました。\n\nボタンを押して承諾してください 👇`,
    openCohost: '承諾する 💑',
  },
};
const tr = (msg) => TEXT[(msg.from && msg.from.language_code || '').slice(0, 2)] || TEXT.uz;

function webAppButton(text, url) {
  return { reply_markup: { inline_keyboard: [[{ text, web_app: { url } }]] } };
}
// Salomlashuv: ovozsiz video (animatsiya) + qisqa matn + tugma + to'liq ekranli effekt (konfetti).
// Video bir marta yuklanadi, keyin Telegram file_id bilan yuboriladi. Har qanday xatoda — oddiy matn (eski xulq).
const GREETING_VIDEO = path.join(__dirname, '..', 'public', 'welcome.mp4');
const GREETING_EFFECT = process.env.GREETING_EFFECT === 'off' ? null : (process.env.GREETING_EFFECT || '5046509860389126442'); // 🎉
let greetingFileId = null;
async function sendGreeting(chatId, caption, markup) {
  if (process.env.GREETING_VIDEO === 'off' || !fs.existsSync(GREETING_VIDEO)) return bot.sendMessage(chatId, caption, markup);
  const base = { caption, ...markup };
  const media = greetingFileId || fs.createReadStream(GREETING_VIDEO);
  const send = (opts) => bot.sendAnimation(chatId, media, opts, greetingFileId ? {} : { filename: 'welcome.mp4', contentType: 'video/mp4' });
  try {
    let msg;
    try { msg = await send(GREETING_EFFECT ? { ...base, message_effect_id: GREETING_EFFECT } : base); }
    catch (err) {
      if (!/effect/i.test(String(err && err.message))) throw err;
      msg = await bot.sendAnimation(chatId, greetingFileId || fs.createReadStream(GREETING_VIDEO), base, { filename: 'welcome.mp4', contentType: 'video/mp4' });
    }
    const a = msg && (msg.animation || msg.video);
    if (a && a.file_id) greetingFileId = a.file_id;
    return msg;
  } catch (err) {
    console.error('[greeting] video yuborilmadi, matn:', err.message);
    greetingFileId = null;
    return bot.sendMessage(chatId, caption, markup);
  }
}
const appUrl = (query) => `${webAppUrl.replace(/\/$/, '')}/?${query}`;

// /start [w_<kod> | g_<token> | c_<token>]
// Kod URL'ga ?w= / ?g= / ?c= bo'lib qo'shiladi — inline web_app tugmasida start_param ishlamaydi.
// Parametrsiz /start — Mini App'ning o'zi ("to'y egasimisiz yoki mehmon?").
bot.onText(/^\/start(?:@\w+)?(?:\s+(\S+))?/, async (msg, match) => {
  const chatId = msg.chat.id;
  const t = tr(msg);
  if (!webAppUrl) {
    return bot.sendMessage(chatId, "Mini App manzili (WEBAPP_URL) sozlanmagan.");
  }

  const m = match && match[1] && /^([wgc])_([\w-]{4,40})$/.exec(match[1]);
  if (!m) return sendGreeting(chatId, t.welcome, webAppButton(t.open, webAppUrl));
  const [, kind, key] = m;
  const from = msg.from || {};

  try {
    if (kind === 'c') {
      const inv = await store.getCohostInvite(key);
      if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) return bot.sendMessage(chatId, t.notFound);
      return bot.sendMessage(chatId, t.cohost(`${inv.groom} & ${inv.bride}`), webAppButton(t.openCohost, appUrl(`c=${encodeURIComponent(key)}`)));
    }

    let wedding = null, guest = null;
    if (kind === 'g') {
      guest = await store.getGuestByToken(key);
      wedding = guest && (await store.getWeddingRow(guest.wedding_id));
    } else {
      wedding = await store.getWeddingByCodeRow(key);
      if (wedding && wedding.visibility === 'private') return bot.sendMessage(chatId, t.private); // umumiy kod private to'yni ochmaydi
    }
    if (!wedding) return bot.sendMessage(chatId, t.notFound);
    if (!wedding.published) return bot.sendMessage(chatId, t.draft);

    // Havola analitikasi: bot orqali kim qaysi havola bilan kirdi
    await store.logEvent({ weddingId: wedding.id, guestId: guest ? guest.id : null, type: 'link_start', tgId: from.id, meta: { name: [from.first_name, from.last_name].filter(Boolean).join(' '), username: from.username || null, link: kind } });

    const query = kind === 'g' ? `g=${encodeURIComponent(key)}` : `w=${encodeURIComponent(key)}`;
    sendGreeting(chatId, t.inviteCap, webAppButton(t.openInvite, appUrl(query)));
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

// Outbox worker shu orqali yuboradi (src/index.js ulaydi). Xatoni yutmaydi — worker o'zi tasniflaydi va qayta uriniladi.
function sendToChat(chatId, text, options) {
  return bot.sendMessage(chatId, text, options);
}
// Fayl (masalan CSV eksport) yuborish — outbox ham shu orqali yetkazadi
function sendDocToChat(chatId, buffer, options, fileOptions) {
  return bot.sendDocument(chatId, buffer, options, fileOptions);
}

// Polling xatolari (masalan 409 Conflict) serverni yiqitmasin, logda ko'rinsin
bot.on('polling_error', (err) => {
  console.error('Telegram polling xatosi:', err.code, err.message);
});

module.exports = { bot, sendToChat, sendDocToChat, weddingLink, startLink, appUrl: (query) => (webAppUrl ? appUrl(query) : null) };
