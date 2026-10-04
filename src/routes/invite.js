// Mehmon uchun ochiq API: taklifnoma ma'lumoti va "ochildi" hodisasi.
//   GET  /api/invite/w/:code   — umumiy havola (private to'yda 403)
//   GET  /api/invite/g/:token  — shaxsiy havola (private to'yda ham ishlaydi)
//   POST /api/invite/view      — ochilishni qayd etish (imzolangan foydalanuvchi bo'lsa)
// Javobda egasiga oid maxfiy narsa YO'Q: owner id, mehmonlar ro'yxati, sozlamalar chiqmaydi.

const express = require('express');
const router = express.Router();
const CATALOG = require('../../public/templates.js');
const store = require('../store');
const notify = require('../notify');
const { cleanContent } = require('../validate');
const { userOf, wrap } = require('../auth');

// Taklifnoma ko'rinish modeli (hozir hammasi bitta joyda — frontend faqat shuni chizadi)
async function buildInvite(w, guest) {
  const h = store.hydrate(w);
  const { content } = cleanContent(h.content); // eski/bo'sh kontentga standart qiymatlar
  if (!content.location.name && !content.location.address && !content.location.mapQuery) {
    content.location = { ...content.location, name: w.venue_name || '', address: w.venue_address || '', mapQuery: w.map_query || '' };
  }
  const tpl = CATALOG.getTemplate(h.template);
  const pal = CATALOG.getPalette(tpl.palette);
  const theme = h.theme || { id: pal.id, bg: pal.bg, surface: pal.surface, ink: pal.ink, soft: pal.soft, accent: pal.accent, accent2: pal.accent2 };

  // Faqat ishlatilgan media: id -> { kind, url, thumb }
  const used = new Set([
    content.hero.mediaId, content.video.mediaId, content.music.mediaId,
    ...content.gallery, ...content.story.map((s) => s.mediaId), ...content.custom.map((c) => c.mediaId),
  ].filter(Boolean));
  const media = {};
  (await store.listMedia(w.id)).forEach((m) => {
    if (used.has(m.id)) media[m.id] = { kind: m.kind, url: `/api/media/${m.id}`, thumb: m.kind === 'image' ? `/api/media/${m.id}?thumb=1` : null };
  });

  return {
    code: w.code, template: tpl.id, theme, font: h.font,
    groom: h.groom, bride: h.bride, date: h.date, startsAt: h.startsAt,
    ceremonyTime: h.ceremonyTime, banquetTime: h.banquetTime, message: h.message,
    content, media,
    legacyPhotoUrl: h.legacyPhoto ? `/api/invite/photo/${w.code}?v=${new Date(w.updated_at).getTime()}` : null,
    private: h.visibility === 'private',
    guest: guest ? { name: guest.name, maxParty: guest.max_party } : null,
  };
}

router.get('/w/:code', wrap(async (req, res) => {
  const w = await store.getWeddingByCodeRow(req.params.code);
  if (!w || !w.published) return res.status(404).json({ error: 'not_found' });
  if (w.visibility === 'private') return res.status(403).json({ error: 'private' });
  res.set('Cache-Control', 'no-cache').json({ invite: await buildInvite(w, null) });
}));

router.get('/g/:token', wrap(async (req, res) => {
  const g = await store.getGuestByToken(req.params.token);
  if (!g) return res.status(404).json({ error: 'not_found' });
  const w = await store.getWeddingRow(g.wedding_id);
  if (!w || !w.published) return res.status(404).json({ error: 'not_found' });
  res.set('Cache-Control', 'no-cache').json({ invite: await buildInvite(w, g) });
}));

// v1'da base64 saqlangan eski foto (faqat avval yaratilgan to'ylar uchun)
router.get('/photo/:code', wrap(async (req, res) => {
  const w = await store.getWeddingByCodeRow(req.params.code);
  const m = w && w.published && w.photo && /^data:image\/jpeg;base64,(.+)$/.exec(w.photo);
  if (!m) return res.status(404).end();
  res.set({ 'Content-Type': 'image/jpeg', 'Cache-Control': 'public, max-age=31536000, immutable' });
  res.send(Buffer.from(m[1], 'base64'));
}));

// Ochilishni qayd etish. Faqat imzolangan Telegram foydalanuvchisi hisobga olinadi (analitikani soxtalashtirib bo'lmaydi).
router.post('/view', wrap(async (req, res) => {
  const user = userOf(req);
  if (!user) return res.status(204).end();
  const { code, token } = req.body || {};

  let w = null, guest = null;
  if (typeof token === 'string') {
    guest = await store.getGuestByToken(token);
    w = guest && (await store.getWeddingRow(guest.wedding_id));
  } else if (typeof code === 'string') {
    w = await store.getWeddingByCodeRow(code);
    if (w && w.visibility === 'private') w = null; // private to'yga umumiy kod bilan kirib bo'lmaydi
  }
  if (!w || !w.published) return res.status(204).end();

  const name = guest ? guest.name : [user.first_name, user.last_name].filter(Boolean).join(' ');
  await store.logEvent({ weddingId: w.id, guestId: guest ? guest.id : null, type: 'open', tgId: user.id, meta: { name, username: user.username || null } });
  if (guest) {
    const lc = String(user.language_code || '').slice(0, 2);
    const { first } = await store.touchGuestOpen(guest.id, user.id, ['uz', 'ru', 'ja'].includes(lc) ? lc : 'uz');
    if (first) await notify.guestOpened(w, guest, user);
  }
  res.status(204).end();
}));

module.exports = { router, buildInvite };
