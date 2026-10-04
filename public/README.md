# To'y taklifnomasi — Telegram Mini App (bot platformasi)

Bitta bot (`@toygabot`) — ko'p to'y. Brauzer versiyasi (`../frontend`) o'zgarishsiz qoladi.

## Oqim

```
/start ─────────────► Mini App ► "To'y egasimisiz yoki mehmon?"
                                   ├─ Egasi  ► dizayn tanlash ► tahrirlash (ism, sana, joy, foto) ► SHAXSIY HAVOLA
                                   └─ Mehmon ► (havolasiz) "egasidan havola so'rang"

t.me/toygabot?start=w_<kod> ► bot "Taklifnomani ochish" tugmasi ► Mini App ?w=<kod>
   ► MEHMON sifatida avtomatik kiradi ► shu to'yning taklifnomasi va dizayni
   ► "Kelaman / Kela olmayman" + mehmonlar soni + izoh ► RSVP ► to'y EGASIGA botda xabar
```

- **Deep-link:** `https://t.me/<bot>?start=w_<kod>`. Bot `/start w_<kod>` ni o'qiydi va tugmaga `?w=<kod>` qo'shadi
  (inline `web_app` tugmasida `start_param` ishlamaydi). To'g'ridan-to'g'ri Mini App havolasi (`startapp=w_<kod>`) ham qo'llab-quvvatlanadi.
- **Xavfsizlik:** `kod` ochiq (sir emas). Shaxs har doim Telegram imzosi (`initData`, HMAC-SHA256 bot tokeni bilan) orqali **backendda**
  tekshiriladi: egasi ID'si so'rov tanasidan emas, imzolangan ma'lumotdan olinadi. Mehmon RSVP'i imzosiz qabul qilinmaydi.
  Egasi faqat o'z to'yini o'zgartira va o'z mehmonlarini ko'ra oladi.
- Bitta egasi — bitta to'y. Havola kodi tahrirlashda o'zgarmaydi.

## Struktura

```
backend/public/        (Mini App; backend uni /app/ manzilida o'zi tarqatadi)
├── index.html    — ko'rinishlar: rol / egasi kabineti / muharrir / taklifnoma (mehmon) / xabar
├── style.css     — glass/blur, safe-area, 3 ta tayyor dizayn (body[data-theme]: gold | rose | sage)
├── app.js        — marshrutlash (start parametri), egasi/mehmon oqimi, Telegram WebApp API
├── i18n.js       — uz / ru / ja
├── dev-mock.js   — faqat localhost'da ?mock bilan Telegram'ni taqlid qiladi
└── assets/       — music.mp3 (ixtiyoriy), hero.mp4 (ixtiyoriy video). Foto endi egasi tomonidan yuklanadi.
```

## Backend API (yangi)

| Endpoint | Kim | Nima |
|---|---|---|
| `GET /api/weddings/:code` | ochiq | taklifnoma ma'lumoti (mehmon ochadi) |
| `POST /api/weddings/me` | egasi (imzo) | o'z to'yi + shaxsiy havola |
| `POST /api/weddings` | egasi (imzo) | yaratish / yangilash |
| `POST /api/weddings/me/guests` | egasi (imzo) | mehmonlar javoblari |
| `POST /api/rsvp` + `weddingCode` | mehmon (imzo) | javob → egasiga xabar |
| `POST /api/rsvp` (kodsiz) | — | eski browser oqimi, `ADMIN_CHAT_ID`ga (o'zgarmagan) |

Jadvallar server ishga tushganda o'zi yaratiladi (`backend/src/db.js`, `IF NOT EXISTS`) — `schema.sql`ni qo'lda ishga tushirish shart emas.

## Lokal sinash (Telegram'siz)

```bash
python -m http.server 5174 --directory backend/public
```

- `http://localhost:5174/?mock` — rol tanlash (soxta imzo: backend egasi/mehmon amallarini rad etadi).
- To'liq oqim uchun lokal backend + `?mock&signer=...&api=http://localhost:PORT&mockuser=ID` (dev-mock.js ichida tavsif).
- Mehmon sifatida: `...?w=<kod>&mock...`

## Deploy va botni ulash

Mini App backend bilan **birga** deploy bo'ladi: `backend/public/` papkasi `https://<render-url>/app/` manzilida beriladi.
Alohida hosting (Vercel) va qo'shimcha o'zgaruvchilar kerak emas.

1. Backend'ni GitHub'ga push qiling — Render o'zi qayta deploy qiladi.
2. Server ishga tushganda: jadvallar yaratiladi, botga **menyu tugmasi** "Таклифнома 💌" o'rnatiladi
   (manzil `RENDER_EXTERNAL_URL` + `/app/` — Render o'zi beradi).
3. Telegram'da botga `/start` yozing → "Ochish" tugmasi → Mini App.

Ixtiyoriy o'zgaruvchilar (Render → Environment):
- `WEBAPP_URL` — Mini App'ni boshqa manzilda (masalan Vercel) joylasangiz.
- `BOT_USERNAME=toygabot` — bo'lmasa Telegram `getMe()` dan olinadi.
- `ADMIN_CHAT_ID` — faqat eski browser oqimi uchun.

> Egasi botdan xabar olishi uchun botni kamida bir marta ochgan bo'lishi kerak (Mini App'ga bot orqali kirgani yetarli).
