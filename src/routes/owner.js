// Egasi / hammuallif API. Hamma so'rov POST, imzolangan initData bilan. Ruxsat: requireMember (bazadagi a'zolik).
//   /me /save /publish          — to'y, nashr
//   /guests/* /groups/*         — mehmonlar boshqaruvi, import, eksport
//   /analytics /activity        — statistika va real-time lenta
//   /cohost/*                   — hammuallif taklifi

const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const cohost = express.Router();
const CATALOG = require('../../public/templates.js');
const store = require('../store');
const outbox = require('../outbox');
const db = require('../db');
const notify = require('../notify');
const { startLink } = require('../bot');
const { cleanWedding, cleanContent, cleanSettings, clip } = require('../validate');
const { requireUser, requireMember, wrap } = require('../auth');

const MAX_GUESTS = 500;

// ---------- yordamchilar ----------
const version = (row) => new Date(row.updated_at).getTime();

// Muharrir uchun to'liq, normallashtirilgan to'y
function editorWedding(row) {
  const h = store.hydrate(row);
  const { content } = cleanContent(h.content);
  if (!content.location.name && !content.location.address && !content.location.mapQuery) {
    content.location = { ...content.location, name: row.venue_name || '', address: row.venue_address || '', mapQuery: row.map_query || '' };
  }
  const pal = CATALOG.getPalette(CATALOG.getTemplate(h.template).palette);
  return {
    code: h.code, groom: h.groom, bride: h.bride, date: h.date, startsAt: h.startsAt,
    ceremonyTime: h.ceremonyTime, banquetTime: h.banquetTime, message: h.message || '',
    template: h.template, font: h.font,
    theme: h.theme || { id: pal.id, bg: pal.bg, surface: pal.surface, ink: pal.ink, soft: pal.soft, accent: pal.accent, accent2: pal.accent2 },
    content, settings: cleanSettings(h.settings),
    visibility: h.visibility, published: h.published, version: version(row),
  };
}

async function links(row) {
  return { general: await startLink('w', row.code) };
}

async function mediaInfo(weddingId) {
  const list = await store.listMedia(weddingId);
  const usage = await store.mediaUsage(weddingId);
  return { items: list.map((m) => ({ id: m.id, kind: m.kind, size: m.size, url: `/api/media/${m.id}`, thumb: m.kind === 'image' ? `/api/media/${m.id}?thumb=1` : null })), usage: usage.bytes, quota: store.MEDIA_QUOTA };
}

// ---------- /me ----------
router.post('/me', wrap(async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const m = await store.getMembership(user.id);
  if (!m) return res.json({ wedding: null });
  const members = (await store.listMembers(m.wedding.id)).map((x) => ({ tgId: String(x.tg_id), role: x.role, name: x.name }));
  res.json({
    role: m.role, wedding: editorWedding(m.wedding), links: await links(m.wedding), members,
    media: await mediaInfo(m.wedding.id),
    catalog: { templates: CATALOG.TEMPLATES.length },
  });
}));

// ---------- /save: yaratish yoki yangilash (avtosaqlash shu orqali) ----------
router.post('/save', wrap(async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const parsed = cleanWedding(req.body.wedding);
  if (parsed.error) return res.status(400).json({ error: 'invalid', message: parsed.error });
  const { value, mediaIds } = parsed;

  let m = await store.getMembership(user.id);
  if (!m) {
    // Birinchi marta: to'y yaratiladi (media hali yo'q — begona media ulanmasin)
    value.content = cleanContent({ ...value.content, hero: {}, story: value.content.story.map((s) => ({ ...s, mediaId: null })), custom: value.content.custom.map((c) => ({ ...c, mediaId: null })), gallery: [], video: {}, music: {} }).content;
    let row;
    try { row = await store.createWedding(user, value); }
    catch (err) { if (err && err.code === '23505') return res.status(409).json({ error: 'already_member' }); throw err; }
    return res.status(201).json({ wedding: editorWedding(row), links: await links(row), role: 'owner', version: version(row) });
  }

  // Hozirgi versiya bilan to'qnashuv (egasi va hammuallif bir vaqtda tahrirlasa): force bo'lmasa 409
  const base = Number(req.body.base);
  if (!req.body.force && base && base !== version(m.wedding)) {
    return res.status(409).json({ error: 'conflict', wedding: editorWedding(m.wedding) });
  }

  // Faqat shu to'yga tegishli media qoladi
  const owned = await store.ownedMediaIds(m.wedding.id, mediaIds);
  const strip = (id) => (id && owned.has(id) ? id : null);
  const c = value.content;
  c.hero.mediaId = strip(c.hero.mediaId);
  c.story.forEach((s) => { s.mediaId = strip(s.mediaId); });
  c.custom.forEach((x) => { x.mediaId = strip(x.mediaId); });
  c.gallery = c.gallery.filter((id) => owned.has(id));
  c.video.mediaId = strip(c.video.mediaId);
  c.music.mediaId = strip(c.music.mediaId);

  // Hammuallif maxfiylik/sozlamalarni o'zgartira olmaydi (faqat egasi) — mavjudini saqlaymiz
  if (m.role !== 'owner') {
    const cur = editorWedding(m.wedding);
    value.visibility = cur.visibility;
    value.settings = cur.settings;
  }
  const row = await store.updateWedding(m.wedding.id, value);
  res.json({ wedding: editorWedding(row), links: await links(row), role: m.role, version: version(row) });
}));

// ---------- /publish ----------
router.post('/publish', wrap(async (req, res) => {
  const m = await requireMember(req, res, { owner: true });
  if (!m) return;
  const row = await store.setPublished(m.wedding.id, req.body.published === true);
  res.json({ published: row.published === true, version: version(row), links: await links(row) });
}));

// ---------- mehmonlar ----------
const guestInput = async (m, b) => {
  const name = clip(b.name, 80);
  if (!name) return { error: 'name_required' };
  const groupId = b.groupId ? Number(b.groupId) : null;
  if (groupId && !(await store.groupBelongs(m.wedding.id, groupId))) return { error: 'bad_group' };
  return { value: { name, groupId, maxParty: Math.min(Math.max(parseInt(b.maxParty, 10) || 1, 1), 20), phone: clip(b.phone, 30), note: clip(b.note, 200) } };
};

async function guestsPayload(weddingId) {
  const [guests, groups] = await Promise.all([store.listGuests(weddingId), store.listGroups(weddingId)]);
  const yes = guests.filter((g) => g.rsvp && g.rsvp.status === 'yes');
  return {
    guests, groups,
    stats: {
      total: guests.length, opened: guests.filter((g) => g.opened).length, answered: guests.filter((g) => g.rsvp).length,
      yes: yes.length, no: guests.filter((g) => g.rsvp && g.rsvp.status === 'no').length,
      pending: guests.filter((g) => !g.rsvp).length, people: yes.reduce((s, g) => s + (g.rsvp.count || 1), 0),
      invitedPeople: guests.reduce((s, g) => s + g.maxParty, 0),
    },
  };
}

router.post('/guests/list', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  const p = await guestsPayload(m.wedding.id);
  // Har mehmon uchun to'liq shaxsiy havola (nusxalash/yuborish uchun)
  const base = (await startLink('g', 'X')).slice(0, -1);
  p.guests.forEach((g) => { g.link = base + g.token; });
  res.json(p);
}));

router.post('/guests/save', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  const { value, error } = await guestInput(m, req.body);
  if (error) return res.status(400).json({ error });
  if (req.body.id) {
    const ok = await store.updateGuest(m.wedding.id, Number(req.body.id), value);
    return ok ? res.json({ ok: true }) : res.status(404).json({ error: 'not_found' });
  }
  if ((await store.guestCount(m.wedding.id)) >= MAX_GUESTS) return res.status(409).json({ error: 'limit' });
  res.status(201).json({ id: await store.createGuest(m.wedding.id, value) });
}));

router.post('/guests/delete', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  res.json({ ok: await store.deleteGuest(m.wedding.id, Number(req.body.id)) });
}));

// Ommaviy import: har qatorda "Ism; Guruh; Kishi soni" (ajratgich: ; , yoki tab). Guruhlar avtomatik yaratiladi.
router.post('/guests/import', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  const lines = clip(req.body.text, 40000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean).slice(0, 300);
  let count = await store.guestCount(m.wedding.id);
  const groups = new Map((await store.listGroups(m.wedding.id)).map((g) => [g.name.toLowerCase(), g.id]));
  let created = 0, skipped = 0;
  for (const line of lines) {
    if (count >= MAX_GUESTS) { skipped++; continue; }
    const [name, group, party] = line.split(/[;\t,]/).map((x) => x.trim());
    if (!name) { skipped++; continue; }
    let groupId = null;
    if (group) {
      const key = clip(group, 40).toLowerCase();
      if (!groups.has(key)) groups.set(key, (await store.saveGroup(m.wedding.id, { name: clip(group, 40) })).id);
      groupId = groups.get(key);
    }
    await store.createGuest(m.wedding.id, { name: clip(name, 80), groupId, maxParty: Math.min(Math.max(parseInt(party, 10) || 1, 1), 20) });
    created++; count++;
  }
  res.json({ created, skipped });
}));

router.post('/groups/save', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  const name = clip(req.body.name, 40);
  if (!name) return res.status(400).json({ error: 'name_required' });
  const g = await store.saveGroup(m.wedding.id, { id: req.body.id ? Number(req.body.id) : null, name, emoji: clip(req.body.emoji, 8) });
  g ? res.json({ group: g }) : res.status(404).json({ error: 'not_found' });
}));

router.post('/groups/delete', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  res.json({ ok: await store.deleteGroup(m.wedding.id, Number(req.body.id)) });
}));

// CSV eksport: fayl so'rovchining Telegram chatiga botdan yuboriladi (mobil WebView'da yuklab olishdan ishonchliroq)
const csvCell = (v) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // CSV/Excel formula injection'dan himoya
  return /[",;\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
router.post('/guests/export', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  const { guests, groups } = await guestsPayload(m.wedding.id);
  const gname = new Map(groups.map((g) => [g.id, g.name]));
  const base = (await startLink('g', 'X')).slice(0, -1);
  const head = ['Name', 'Group', 'Status', 'People', 'Max party', 'Comment', 'Phone', 'Opened', 'Personal link'];
  const rows = guests.map((g) => [
    g.name, gname.get(g.groupId) || '', g.rsvp ? (g.rsvp.status === 'yes' ? 'coming' : 'declined') : 'no answer',
    g.rsvp && g.rsvp.status === 'yes' ? g.rsvp.count : '', g.maxParty, g.rsvp ? g.rsvp.comment || '' : '', g.phone || '', g.opened ? 'yes' : 'no', base + g.token,
  ]);
  const csv = '﻿' + [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
  const id = await outbox.enqueue(db.pool, {
    type: 'export', chatId: m.user.id, dedupeKey: `export:${crypto.randomUUID()}`,
    text: `📥 ${m.wedding.groom} & ${m.wedding.bride} — mehmonlar (${guests.length})`,
    document: { filename: `guests-${m.wedding.code}.csv`, contentBase64: Buffer.from(csv, 'utf8').toString('base64') },
  });
  outbox.kick();
  res.json({ queued: !!id, rows: guests.length });
}));

// ---------- analitika va lenta ----------
router.post('/analytics', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  res.json(await store.analytics(m.wedding.id, Math.min(Math.max(parseInt(req.body.days, 10) || 14, 7), 60)));
}));

router.post('/activity', wrap(async (req, res) => {
  const m = await requireMember(req, res);
  if (!m) return;
  res.json({ events: await store.activity(m.wedding.id, Number(req.body.since) || 0, 40) });
}));

// ---------- hammuallif ----------
router.post('/cohost/invite', wrap(async (req, res) => {
  const m = await requireMember(req, res, { owner: true });
  if (!m) return;
  const token = await store.createCohostInvite(m.wedding.id, m.user.id);
  res.json({ link: await startLink('c', token) });
}));

router.post('/cohost/remove', wrap(async (req, res) => {
  const m = await requireMember(req, res, { owner: true });
  if (!m) return;
  res.json({ ok: await store.removeCohost(m.wedding.id, Number(req.body.tgId)) });
}));

// Taklifni ko'rish va qabul qilish (har qanday imzolangan foydalanuvchi)
cohost.post('/info', wrap(async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const inv = typeof req.body.token === 'string' && (await store.getCohostInvite(req.body.token));
  if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) return res.status(404).json({ error: 'invalid' });
  res.json({ groom: inv.groom, bride: inv.bride });
}));

cohost.post('/accept', wrap(async (req, res) => {
  const user = requireUser(req, res);
  if (!user) return;
  const r = await store.acceptCohost(String(req.body.token || ''), user);
  if (r.error) return res.status(r.error === 'already_member' ? 409 : 404).json({ error: r.error });
  const row = await store.getWeddingRow(r.weddingId);
  await store.logEvent({ weddingId: row.id, type: 'cohost', tgId: user.id, meta: { name: [user.first_name, user.last_name].filter(Boolean).join(' ') } });
  await notify.toMembers(row, {
    type: 'cohost', dedupeBase: `cohost:${user.id}`,
    text: `💑 <b>${require('../messages').esc([user.first_name, user.last_name].filter(Boolean).join(' ') || 'Foydalanuvchi')}</b> hammuallif sifatida qo'shildi\n💒 ${notify.title(row)}`,
  });
  res.json({ ok: true });
}));

module.exports = { router, cohost, editorWedding };
