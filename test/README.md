# Testlar

| Fayl | Nimani tekshiradi | Server kerakmi |
|---|---|---|
| `static-check.js` | public/*.js sintaksisi, i18n to'liqligi (uz/ru/ja), shablonlar katalogi, `index.html` ↔ server inline ro'yxati, sahifa hajmi | yo'q |
| `product-test.js` | auth/egalik, nashr/private, media, mehmonlar, shaxsiy havolalar, RSVP, hammuallif, analitika, AI, eslatmalar (130 ta) | ha |
| `reliability-test.js` | ishonchli yetkazish: Telegram nosozligi, dublikat, 429, 403, server yiqilishi, rollback, 100 parallel RSVP (43 ta) | ha |

```bash
node test/static-check.js                      # tez, serversiz

# Integratsion testlar: HAQIQIY backend + haqiqiy PostgreSQL (embedded) + soxta Telegram + soxta Anthropic
npm install --no-save pg-mem embedded-postgres # faqat testlar uchun (package.json'ga qo'shilmaydi)
USE_REAL_PG=1 node test/e2e-server.js          # 1-terminal (3 daqiqagacha birinchi marta: PostgreSQL yuklab olinadi)
node test/product-test.js                      # 2-terminal
```

Har integratsion prognoz **toza** stendda bo'lishi kerak (`e2e-server.js`ni qayta ishga tushiring): testlar bo'sh bazaga tayanadi.
`reliability-test.js` uchun ham xuddi shunday (alohida prognoz).

> `pg-mem` (USE_REAL_PG'siz) tezroq, lekin tranzaksiya rollback'ini aniq taqlid qilmaydi — `reliability-test` I2 tekshiruvi faqat
> haqiqiy PostgreSQL'da to'liq ishonchli. Deploydan oldin doim `USE_REAL_PG=1` bilan yuriting.

Stend: Telegram o'rniga soxta bot (`/__fail?mode=network|429|403|500|hang`), Anthropic o'rniga soxta server (`/__ai?mode=...`),
vaqtni boshqarish (`/__remind?now=ISO`), imzolangan `initData` generatori (`/__sign`).
