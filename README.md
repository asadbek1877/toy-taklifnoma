# Toy Backend — RSVP + Telegram bot

## Fayllar nima uchun kerak?

- `package.json` — qaysi kutubxonalar kerakligi ro'yxati
- `schema.sql` — bazada jadval yaratish buyrug'i
- `.env.example` — qanday maxfiy sozlamalar kerakligi (namuna)
- `src/db.js` — baza bilan ishlash
- `src/bot.js` — Telegram bot
- `src/routes/rsvp.js` — saytdan kelgan RSVP so'rovini qabul qiladi
- `src/index.js` — hammasini ishga tushiradigan asosiy fayl

## 1-qadam: Yangi Telegram bot yaratish

1. Telegram'da @BotFather'ga yozing
2. `/newbot` buyrug'ini yuboring, botga nom bering
3. Sizga TOKEN beradi (masalan `123456789:ABCdefGHI...`) — shuni saqlab qo'ying

## 2-qadam: O'zingizning chat_id'ingizni topish

1. Telegram'da @userinfobot'ga yozing (yoki botingizga birinchi xabar yuboring)
2. U sizga raqamli ID beradi (masalan `123456789`) — shuni saqlab qo'ying

## 3-qadam: Kompyuterda sozlash

```bash
cd toy-backend
npm install
cp .env.example .env
```

Endi `.env` faylini oching va quyidagilarni to'ldiring:
- `TELEGRAM_BOT_TOKEN` — 1-qadamda olgan token
- `ADMIN_CHAT_ID` — 2-qadamda olgan ID
- `DATABASE_URL` — hozircha bo'sh qoldirsa ham bo'ladi (keyingi qadamda to'ldiramiz)

## 4-qadam: Bazani sozlash

Eng oson yo'l — [Render.com](https://render.com) yoki [Neon.tech](https://neon.tech)'da bepul PostgreSQL yaratish:
1. Ro'yxatdan o'tib, "New PostgreSQL" tugmasini bosing
2. Sizga `DATABASE_URL` beradi — shuni `.env`'ga qo'ying
3. `schema.sql` faylidagi buyruqni shu bazada bir marta ishga tushiring (Render/Neon konsolida "Query" bo'limi orqali, yoki `psql` bilan)

## 5-qadam: Lokal sinash

```bash
npm run dev
```

Brauzerda `http://localhost:3001` ochib ko'ring — `{"status":"ok",...}` chiqsa, ishlayapti.

Sinov uchun terminalda:
```bash
curl -X POST http://localhost:3001/api/rsvp \
  -H "Content-Type: application/json" \
  -d '{"guestName":"Test Odam","status":"yes","guestCount":2}'
```

Telegram botingizga xabar kelishi kerak. Botga `/ro'yxat` yozib ko'ring.

## 6-qadam: Render'ga joylashtirish

1. Kodni GitHub'ga yuklaysiz
2. Render.com'da "New Web Service" → GitHub repo'ni tanlaysiz
3. Build command: `npm install`, Start command: `npm start`
4. "Environment" bo'limida `.env`'dagi barcha qiymatlarni qo'shasiz
5. Deploy tugmasini bosasiz — bir necha daqiqada tayyor bo'ladi, sizga URL beradi (masalan `https://toy-backend.onrender.com`)

Shu URL'ni keyinroq frontend sayt bilan ulaymiz.
