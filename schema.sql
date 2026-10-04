-- Bu faylni PostgreSQL bazangizda BIR MARTA ishga tushirasiz (jadval yaratish uchun)

CREATE TABLE IF NOT EXISTS rsvp_responses (
  id SERIAL PRIMARY KEY,
  guest_name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('yes', 'no')),
  guest_count INTEGER NOT NULL DEFAULT 1,
  comment TEXT,
  language TEXT DEFAULT 'uz',
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ---- Mini App platformasi (ko'p to'y) ----
-- Diqqat: bu jadvallar server ishga tushganda src/db.js tomonidan avtomatik yaratiladi.
-- Quyidagi buyruqlar faqat hujjat sifatida / qo'lda ishga tushirish uchun.
CREATE TABLE IF NOT EXISTS weddings (
  id SERIAL PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,          -- shaxsiy havola kodi: t.me/<bot>?start=w_<code>
  owner_id BIGINT UNIQUE NOT NULL,    -- egasining Telegram ID'si (imzodan olinadi)
  owner_name TEXT,
  design TEXT NOT NULL DEFAULT 'gold',
  groom TEXT NOT NULL,
  bride TEXT NOT NULL,
  wedding_date TEXT NOT NULL,         -- YYYY-MM-DD
  ceremony_time TEXT,
  banquet_time TEXT,
  starts_at TEXT,                     -- ISO, countdown uchun
  venue_name TEXT,
  venue_address TEXT,
  map_query TEXT,
  message TEXT,
  photo TEXT,                         -- data:image/jpeg;base64,...
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);
ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS wedding_id INTEGER;
ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_tg_id BIGINT;
ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_username TEXT;
CREATE INDEX IF NOT EXISTS idx_rsvp_wedding ON rsvp_responses (wedding_id);
