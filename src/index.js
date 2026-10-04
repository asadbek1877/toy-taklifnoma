// Bu — loyihaning "bosh" fayli. Server shu yerdan ishga tushadi.
// Ishga tushirish: npm start

require('dotenv').config();

const fs = require('fs');
const path = require('path');
const express = require('express');
const cors = require('cors');
const rsvpRoute = require('./routes/rsvp');

// Botni shu yerda import qilamiz — bu uni ishga tushiradi (polling boshlanadi)
require('./bot');

const app = express();

// JSON so'rovlarni tushunish uchun (limit 1 MB — to'y fotosi base64 bo'lib keladi)
app.use(express.json({ limit: '1mb' }));

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

// Telegram Mini App (public/) shu serverning o'zidan beriladi: https://<server>/app/
// Alohida hosting (Vercel) shart emas va Mini App backend bilan bir origin'da bo'ladi.
const publicDir = path.join(__dirname, '..', 'public');

// Tezlik uchun: /app/ ga BITTA fayl beramiz — style.css, i18n.js, app.js HTML ichiga joylanadi.
// Shunda ilova HTML -> (css, js) ketma-ket 2 ta so'rov o'rniga 1 ta so'rovda ochiladi.
// Fayllar o'zgarmaydi (lokal sinashda python http.server bilan alohida fayllar ishlayveradi).
let appHtml = null;
function buildAppHtml() {
  const read = (f) => fs.readFileSync(path.join(publicDir, f), 'utf8');
  let html = read('index.html');
  html = html.replace('<link rel="stylesheet" href="style.css" />', () => `<style>${read('style.css')}</style>`);
  html = html.replace('<script src="i18n.js"></script>', () => `<script>${read('i18n.js')}</script>`);
  html = html.replace('<script src="app.js"></script>', () => `<script>${read('app.js')}</script>`);
  // dev-mock faqat lokal sinash uchun — productionda (Render) kerak emas, bitta so'rov tejaladi
  if (process.env.RENDER) html = html.replace('<script src="dev-mock.js"></script>', '');
  return html;
}
app.get(['/app', '/app/', '/app/index.html'], (req, res) => {
  if (!appHtml) appHtml = buildAppHtml();
  res.set('Cache-Control', 'no-cache').type('html').send(appHtml); // ETag avtomatik — o'zgarmasa 304
});
app.use('/app', express.static(publicDir, { maxAge: '5m' }));

// Server ishlayotganini tekshirish uchun oddiy yo'l
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: "To'y backend ishlayapti" });
});

// Engil "uyg'otish" yo'li — sayt ochilishi bilan shu yerga so'rov yuboradi
app.get('/health', (req, res) => res.status(200).send('ok'));

// RSVP bilan bog'liq barcha so'rovlar shu yerga boradi
app.use('/api/rsvp', rsvpRoute);
app.use('/api/admin', require('./routes/admin'));
app.use('/api/weddings', require('./routes/weddings'));

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});

// Render bepul tarifida server 15 daqiqa jim tursa "uxlab qoladi" va birinchi
// so'rov 30-50 soniya kutadi. O'z-o'zimizga har 10 daqiqada so'rov yuborib uxlatmaymiz.
// RENDER_EXTERNAL_URL ni Render o'zi avtomatik qo'yadi. O'chirish: KEEP_ALIVE=false
const selfUrl = process.env.RENDER_EXTERNAL_URL;
if (selfUrl && process.env.KEEP_ALIVE !== 'false') {
  setInterval(() => {
    fetch(`${selfUrl}/health`).catch(() => {});
  }, 10 * 60 * 1000);
}
