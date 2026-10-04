// Autentifikatsiya va ruxsat: har so'rovda Telegram imzosi (initData) tekshiriladi, a'zolik bazadan olinadi.
// Egasi ID'si HECH QACHON so'rov tanasidan olinmaydi — faqat imzolangan initData'dan. Shu sababli
// boshqa to'y/foydalanuvchi ma'lumotiga yetib bo'lmaydi.

const { verifyTelegramInitData } = require('./telegramAuth');
const store = require('./store');

function initDataOf(req) {
  return (req.body && req.body.tgInitData) || req.get('x-tg-init-data') || null;
}

// Telegram foydalanuvchisi (imzo to'g'ri bo'lsa) yoki null
function userOf(req) {
  return verifyTelegramInitData(initDataOf(req), process.env.TELEGRAM_BOT_TOKEN);
}

function requireUser(req, res) {
  const user = userOf(req);
  if (!user) { res.status(401).json({ error: 'unauthorized' }); return null; }
  return user;
}

// A'zo bo'lishni talab qiladi. opts.owner = true bo'lsa — faqat egasi (hammuallif emas).
// Qaytaradi { user, wedding (DB qatori), role } yoki null (javob allaqachon yuborilgan).
async function requireMember(req, res, opts = {}) {
  const user = requireUser(req, res);
  if (!user) return null;
  const m = await store.getMembership(user.id);
  if (!m) { res.status(404).json({ error: 'no_wedding' }); return null; }
  if (opts.owner && m.role !== 'owner') { res.status(403).json({ error: 'owner_only' }); return null; }
  return { user, wedding: m.wedding, role: m.role };
}

// async route'larni xavfsiz o'rash: kutilmagan xato 500 qaytaradi, jarayonni yiqitmaydi
const wrap = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((err) => {
    console.error(`[api] ${req.method} ${req.originalUrl} xatolik:`, err);
    if (!res.headersSent) res.status(500).json({ error: 'server_error' });
  });

module.exports = { initDataOf, userOf, requireUser, requireMember, wrap };
