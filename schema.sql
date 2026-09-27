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
