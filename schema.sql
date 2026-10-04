-- Toyga: ma'lumotlar bazasi sxemasi (HUJJAT).
-- Haqiqat manbai: src/db.js -> migrate(). Server har ishga tushganda shu buyruqlarni o'zi bajaradi (IF NOT EXISTS,
-- takroran xavfsiz), shuning uchun bu faylni qo'lda ishga tushirish SHART EMAS. Fayl db.js'dan avtomatik yaratilgan.

CREATE TABLE IF NOT EXISTS rsvp_responses (
    id SERIAL PRIMARY KEY,
    guest_name TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('yes', 'no')),
    guest_count INTEGER NOT NULL DEFAULT 1,
    comment TEXT,
    language TEXT DEFAULT 'uz',
    created_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

CREATE TABLE IF NOT EXISTS weddings (
    id SERIAL PRIMARY KEY,
    code TEXT UNIQUE NOT NULL,
    owner_id BIGINT UNIQUE NOT NULL,
    owner_name TEXT,
    design TEXT NOT NULL DEFAULT 'gold',
    groom TEXT NOT NULL,
    bride TEXT NOT NULL,
    wedding_date TEXT NOT NULL,
    ceremony_time TEXT,
    banquet_time TEXT,
    starts_at TEXT,
    venue_name TEXT,
    venue_address TEXT,
    map_query TEXT,
    message TEXT,
    photo TEXT,
    created_at TIMESTAMP NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMP NOT NULL DEFAULT NOW()
  );

ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS wedding_id INTEGER;

ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_tg_id BIGINT;

ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_username TEXT;

CREATE INDEX IF NOT EXISTS idx_rsvp_wedding ON rsvp_responses (wedding_id);

ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS client_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS ux_rsvp_client ON rsvp_responses (client_id);

CREATE TABLE IF NOT EXISTS outbox (
    id BIGSERIAL PRIMARY KEY,
    type TEXT NOT NULL,
    chat_id BIGINT NOT NULL,
    payload TEXT NOT NULL,
    dedupe_key TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'sent', 'failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    locked_at TIMESTAMPTZ,
    last_error TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    sent_at TIMESTAMPTZ
  );

CREATE INDEX IF NOT EXISTS idx_outbox_due ON outbox (status, next_attempt_at);

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS template TEXT NOT NULL DEFAULT 't01';

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS theme TEXT;

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS font TEXT NOT NULL DEFAULT 'classic';

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS content TEXT;

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS visibility TEXT NOT NULL DEFAULT 'public';

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS published BOOLEAN;

ALTER TABLE weddings ADD COLUMN IF NOT EXISTS settings TEXT;

UPDATE weddings SET published = TRUE WHERE published IS NULL;

CREATE TABLE IF NOT EXISTS wedding_members (
    id SERIAL PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    tg_id BIGINT NOT NULL UNIQUE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'cohost')),
    name TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE INDEX IF NOT EXISTS idx_members_wedding ON wedding_members (wedding_id);

INSERT INTO wedding_members (wedding_id, tg_id, role, name)
  SELECT w.id, w.owner_id, 'owner', w.owner_name FROM weddings w
   WHERE NOT EXISTS (SELECT 1 FROM wedding_members m WHERE m.tg_id = w.owner_id);

CREATE TABLE IF NOT EXISTS cohost_invites (
    token TEXT PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    created_by BIGINT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    used_by BIGINT,
    used_at TIMESTAMPTZ
  );

CREATE TABLE IF NOT EXISTS media (
    id TEXT PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('image', 'video', 'audio')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL,
    data BYTEA NOT NULL,
    thumb BYTEA,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE INDEX IF NOT EXISTS idx_media_wedding ON media (wedding_id);

CREATE TABLE IF NOT EXISTS guest_groups (
    id SERIAL PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    emoji TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (wedding_id, name)
  );

CREATE TABLE IF NOT EXISTS guests (
    id SERIAL PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    group_id INTEGER,
    name TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    max_party INTEGER NOT NULL DEFAULT 1,
    phone TEXT,
    note TEXT,
    tg_id BIGINT,
    open_count INTEGER NOT NULL DEFAULT 0,
    first_opened_at TIMESTAMPTZ,
    last_opened_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE INDEX IF NOT EXISTS idx_guests_wedding ON guests (wedding_id);

ALTER TABLE guests ADD COLUMN IF NOT EXISTS lang TEXT;

ALTER TABLE rsvp_responses ADD COLUMN IF NOT EXISTS guest_id INTEGER;

CREATE INDEX IF NOT EXISTS idx_rsvp_guest ON rsvp_responses (guest_id);

CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY,
    wedding_id INTEGER NOT NULL,
    guest_id INTEGER,
    type TEXT NOT NULL,
    tg_id BIGINT,
    meta TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  );

CREATE INDEX IF NOT EXISTS idx_events_wedding ON events (wedding_id, created_at);

CREATE TABLE IF NOT EXISTS ai_usage (
    tg_id BIGINT NOT NULL,
    day TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (tg_id, day)
  );
