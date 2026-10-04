// Bu — loyihaning "bosh" fayli. Server shu yerdan ishga tushadi.
// Ishga tushirish: npm start

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rsvpRoute = require('./routes/rsvp');

// Botni shu yerda import qilamiz — bu uni ishga tushiradi (polling boshlanadi)
const { sendToChat, sendDocToChat } = require('./bot');
const db = require('./db');
const outbox = require('./outbox');

const app = express();

// Faqat o'zimizning saytimizdan so'rov kelishiga ruxsat berish
// ALLOWED_ORIGIN bir nechta domen bo'lishi mumkin (vergul bilan): brauzer sayti + Mini App
const allowedOrigins = (process.env.ALLOWED_ORIGIN || '*')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);
app.use(
  cors({
    origin: allowedOrigins.includes('*') ? '*' : allowedOrigins,
  })
);

// Media (foto/video/musiqa yuklash va berish): o'z hajm limitlari bor, shuning uchun global JSON parser'dan OLDIN
const media = require('./routes/media');
app.use('/api/owner/media', media.owner);
app.use('/api/media', media.pub);

// JSON so'rovlarni tushunish uchun (qolgan hamma API 1 MB'dan oshmaydi)
app.use(express.json({ limit: '1mb' }));

// Telegram Mini App (public/) shu serverning o'zidan beriladi: https://<server>/app/
// Alohida hosting (Vercel) shart emas va Mini App backend bilan bir origin'da bo'ladi.
const publicDir = path.join(__dirname, '..', 'public');

// Tezlik uchun: /app/ ga BITTA fayl beramiz — mehmon yo'li uchun kerakli CSS/JS HTML ichiga joylanadi
// (HTML -> css/js ketma-ket so'rovlari yo'q). Egasi muharriri (owner.js/owner.css) og'ir, shuning uchun faqat egasi
// rolini tanlaganda alohida yuklanadi — mehmonlarga hech qachon yuborilmaydi.
// Fayllar o'zgarmaydi (lokal sinashda python http.server bilan alohida fayllar ishlayveradi).
const INLINE_CSS = ['base.css', 'invite.css'];
const INLINE_JS = ['i18n.js', 'templates.js', 'core.js', 'invite.js', 'app.js'];
let appHtml = null;
function buildAppHtml() {
  const read = (f) => fs.readFileSync(path.join(publicDir, f), 'utf8');
  let html = read('index.html');
  INLINE_CSS.forEach((f) => { html = html.replace(`<link rel="stylesheet" href="${f}" />`, () => `<style>${read(f)}</style>`); });
  INLINE_JS.forEach((f) => { html = html.replace(`<script src="${f}"></script>`, () => `<script>${read(f)}</script>`); });
  // Kesh buzish: owner fayllari o'zgarganda versiya o'zgaradi
  const ver = ['owner.js', 'owner-content.js', 'owner-guests.js', 'i18n-owner.js', 'owner.css'].map((f) => { try { return fs.statSync(path.join(publicDir, f)).mtimeMs; } catch (e) { return 0; } }).join('-');
  html = html.split('__V__').join(require('crypto').createHash('md5').update(ver).digest('hex').slice(0, 8));
  // dev-mock faqat lokal sinash uchun — productionda (Render) kerak emas
  if (process.env.RENDER) html = html.replace('<script src="dev-mock.js"></script>', '');
  return html;
}
app.get(['/app', '/app/', '/app/index.html'], (req, res) => {
  if (!appHtml || !process.env.RENDER) appHtml = buildAppHtml(); // lokal ishlab chiqishda har safar qayta yig'iladi
  res.set('Cache-Control', 'no-cache').type('html').send(appHtml); // ETag avtomatik — o'zgarmasa 304
});
app.use('/app', express.static(publicDir, { maxAge: process.env.RENDER ? '5m' : 0 }));

// Server ishlayotganini tekshirish uchun oddiy yo'l
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: "To'y backend ishlayapti" });
});

// Engil "uyg'otish" yo'li — sayt ochilishi bilan shu yerga so'rov yuboradi
app.get('/health', (req, res) => res.status(200).send('ok'));

// RSVP bilan bog'liq barcha so'rovlar shu yerga boradi
app.use('/api/rsvp', rsvpRoute);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/invite', require('./routes/invite').router);
const ownerRoutes = require('./routes/owner');
app.use('/api/owner', ownerRoutes.router);
app.use('/api/cohost', ownerRoutes.cohost);

// Ishonchli yetkazish: bazadagi navbatni (outbox) Telegram'ga yetkazuvchi worker.
// Server qayta ishga tushsa ham, oldingi pending xabarlar avtomatik davom ettiriladi.
outbox.startWorker({ pool: db.pool, ready: db.ready, sender: sendToChat, documentSender: sendDocToChat });

// Avtomatik eslatmalar (to'ygacha 14/7/1 kun, 3 soat): outbox orqali, dublsiz
const reminders = require('./reminders');
db.ready.then(() => reminders.start());

const PORT = process.env.PORT || 3001;
const server = app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

// Deploy (SIGTERM): yangi ish olmaymiz, ketayotgan yuborishlarni kutamiz — xabar yarim yo'lda qolmasin
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`${signal}: to'xtatilmoqda...`);
  server.close();
  reminders.stop();
  await outbox.stopWorker(8000);
  process.exit(0);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Render bepul tarifida server 15 daqiqa jim tursa "uxlab qoladi" va birinchi
// so'rov 30-50 soniya kutadi. O'z-o'zimizga har 10 daqiqada so'rov yuborib uxlatmaymiz.
// RENDER_EXTERNAL_URL ni Render o'zi avtomatik qo'yadi. O'chirish: KEEP_ALIVE=false
const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl && process.env.KEEP_ALIVE !== 'false') {
  setInterval(() => {
    fetch(`${selfUrl}/health`).catch(() => {});
  }, 10 * 60 * 1000);
}
