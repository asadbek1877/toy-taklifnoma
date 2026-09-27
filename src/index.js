// Bu — loyihaning "bosh" fayli. Server shu yerdan ishga tushadi.
// Ishga tushirish: npm start

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const rsvpRoute = require('./routes/rsvp');

// Botni shu yerda import qilamiz — bu uni ishga tushiradi (polling boshlanadi)
require('./bot');

const app = express();

// JSON so'rovlarni tushunish uchun
app.use(express.json());

// Faqat o'zimizning saytimizdan so'rov kelishiga ruxsat berish
app.use(
  cors({
    origin: process.env.ALLOWED_ORIGIN || '*',
  })
);

// Server ishlayotganini tekshirish uchun oddiy yo'l
app.get('/', (req, res) => {
  res.json({ status: 'ok', message: "To'y backend ishlayapti" });
});

// RSVP bilan bog'liq barcha so'rovlar shu yerga boradi
app.use('/api/rsvp', rsvpRoute);

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server ${PORT}-portda ishga tushdi`);
});
