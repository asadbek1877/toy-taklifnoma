// Egasi yuborgan to'y ma'lumotlarini tekshiradi va tozalaydi (whitelist + uzunlik chegaralari).
// Hech qachon ishonmaymiz: mijozdan kelgan hamma narsa shu yerdan o'tadi. Natija — bazaga yoziladigan toza obyekt.

const CATALOG = require('../public/templates.js');

const HEX = /^#[0-9a-fA-F]{6}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const MEDIA_ID = /^[a-f0-9]{16,32}$/;
const CUSTOM_ID = /^[a-z0-9]{4,12}$/;

const clip = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
const mediaId = (v) => (typeof v === 'string' && MEDIA_ID.test(v) ? v : null);
const hex = (v, fallback) => (typeof v === 'string' && HEX.test(v) ? v.toLowerCase() : fallback);
const bool = (v, d) => (typeof v === 'boolean' ? v : d);

function defaultSections(customIds = []) {
  return [
    ...['countdown', 'story', 'schedule', 'location', 'dress', 'menu', 'gallery', 'video'].map((id) => ({ id, on: id === 'countdown' || id === 'schedule' || id === 'location' })),
    ...customIds.map((id) => ({ id: `custom:${id}`, on: true })),
  ];
}

function defaultSettings() {
  return {
    notify: { rsvp: true, opened: true },
    reminders: { guestD7: true, guestD1: true, guestH3: true, pendingD14: true, pendingD7: true },
  };
}

// content: bo'limlar. Qaytaradi { content, mediaIds } — mediaIds route'da egasiga tegishliligi tekshiriladi.
function cleanContent(input) {
  const c = input && typeof input === 'object' ? input : {};
  const mediaIds = new Set();
  const useMedia = (v) => { const id = mediaId(v); if (id) mediaIds.add(id); return id; };

  const custom = arr(c.custom, 8).map((x) => ({
    id: typeof x.id === 'string' && CUSTOM_ID.test(x.id) ? x.id : Math.random().toString(36).slice(2, 8),
    title: clip(x.title, 80),
    text: clip(x.text, 1500),
    emoji: clip(x.emoji, 8),
    mediaId: useMedia(x.mediaId),
  })).filter((x) => x.title || x.text);
  const customIds = new Set(custom.map((x) => x.id));

  // Bo'limlar tartibi: faqat ma'lum id'lar, takrorsiz; yo'q bo'lganlari oxiriga o'chirilgan holda qo'shiladi
  const known = new Set([...CATALOG.SECTION_IDS, ...custom.map((x) => `custom:${x.id}`)]);
  const seen = new Set();
  const rawSections = Array.isArray(c.sections) ? c.sections : defaultSections(custom.map((x) => x.id));
  let sections = arr(rawSections, 40)
    .filter((s) => s && typeof s.id === 'string' && known.has(s.id) && !seen.has(s.id) && seen.add(s.id))
    .map((s) => ({ id: s.id, on: s.on !== false }));
  for (const id of known) if (!seen.has(id)) sections.push({ id, on: id.startsWith('custom:') });

  const loc = c.location && typeof c.location === 'object' ? c.location : {};
  const dress = c.dress && typeof c.dress === 'object' ? c.dress : {};
  const rsvp = c.rsvp && typeof c.rsvp === 'object' ? c.rsvp : {};
  const video = c.video && typeof c.video === 'object' ? c.video : {};
  const music = c.music && typeof c.music === 'object' ? c.music : {};
  const hero = c.hero && typeof c.hero === 'object' ? c.hero : {};
  const intro = c.intro && typeof c.intro === 'object' ? c.intro : {};

  const deadline = clip(rsvp.deadline, 10);
  const content = {
    intro: { style: CATALOG.INTROS.includes(intro.style) ? intro.style : null },
    hero: { mediaId: useMedia(hero.mediaId), tagline: clip(hero.tagline, 120) },
    sections,
    story: arr(c.story, 12).map((x) => ({ date: clip(x.date, 40), title: clip(x.title, 100), text: clip(x.text, 800), mediaId: useMedia(x.mediaId) })).filter((x) => x.title || x.text),
    schedule: arr(c.schedule, 20).map((x) => ({
      time: TIME.test(x.time) ? x.time : '', title: clip(x.title, 100), text: clip(x.text, 300),
      icon: CATALOG.SCHEDULE_ICONS.includes(x.icon) ? x.icon : '✨',
    })).filter((x) => x.title),
    location: { name: clip(loc.name, 120), address: clip(loc.address, 200), mapQuery: clip(loc.mapQuery, 200), notes: clip(loc.notes, 400) },
    dress: {
      text: clip(dress.text, 500),
      colors: arr(dress.colors, 6).filter((h) => typeof h === 'string' && HEX.test(h)).map((h) => h.toLowerCase()),
      dos: clip(dress.dos, 300), donts: clip(dress.donts, 300),
    },
    menu: arr(c.menu, 10).map((x) => ({ title: clip(x.title, 80), items: arr(x.items, 15).map((i) => clip(i, 120)).filter(Boolean) })).filter((x) => x.title || x.items.length),
    custom,
    gallery: arr(c.gallery, 12).map(useMedia).filter(Boolean),
    video: { mediaId: useMedia(video.mediaId), inIntro: bool(video.inIntro, false) },
    music: { mediaId: useMedia(music.mediaId), autoplay: bool(music.autoplay, true) },
    rsvp: {
      deadline: /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '',
      maxParty: Math.min(Math.max(parseInt(rsvp.maxParty, 10) || 5, 1), 20),
      askComment: bool(rsvp.askComment, true),
    },
  };
  // Tartibda o'chirilgan custom bo'limlar mavjud bo'lmasin
  content.sections = content.sections.filter((s) => !s.id.startsWith('custom:') || customIds.has(s.id.slice(7)));
  return { content, mediaIds: [...mediaIds] };
}

function cleanSettings(input) {
  const d = defaultSettings();
  const s = input && typeof input === 'object' ? input : {};
  const n = s.notify && typeof s.notify === 'object' ? s.notify : {};
  const r = s.reminders && typeof s.reminders === 'object' ? s.reminders : {};
  return {
    notify: { rsvp: bool(n.rsvp, d.notify.rsvp), opened: bool(n.opened, d.notify.opened) },
    reminders: Object.fromEntries(Object.keys(d.reminders).map((k) => [k, bool(r[k], d.reminders[k])])),
  };
}

// To'liq to'y: { value, mediaIds } yoki { error }
function cleanWedding(input) {
  if (!input || typeof input !== 'object') return { error: "Ma'lumot yo'q" };

  const groom = clip(input.groom, 60);
  const bride = clip(input.bride, 60);
  if (!groom || !bride) return { error: 'Kuyov va kelin ismlari majburiy' };

  const date = clip(input.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return { error: "Sana noto'g'ri" };

  let startsAt = null;
  if (input.startsAt) {
    const d = new Date(input.startsAt);
    if (Number.isNaN(d.getTime())) return { error: "Boshlanish vaqti noto'g'ri" };
    startsAt = d.toISOString();
  }

  const tpl = CATALOG.TEMPLATES.find((t) => t.id === input.template) || CATALOG.TEMPLATES[0];
  const pal = CATALOG.getPalette((input.theme && input.theme.id) || tpl.palette);
  const th = input.theme && typeof input.theme === 'object' ? input.theme : {};
  const theme = {
    // Palitra ID: berilgan to'g'ri ID, yoki hech qanday rang berilmasa — shablon palitrasi; maxsus ranglar bo'lsa null
    id: CATALOG.PALETTES.some((p) => p.id === th.id) ? th.id
      : ['bg', 'surface', 'ink', 'soft', 'accent', 'accent2'].some((k) => typeof th[k] === 'string' && HEX.test(th[k])) ? null : pal.id,
    bg: hex(th.bg, pal.bg), surface: hex(th.surface, pal.surface), ink: hex(th.ink, pal.ink),
    soft: hex(th.soft, pal.soft), accent: hex(th.accent, pal.accent), accent2: hex(th.accent2, pal.accent2),
  };
  const font = CATALOG.FONTS.some((f) => f.id === input.font) ? input.font : tpl.font;

  const { content, mediaIds } = cleanContent(input.content);
  const ceremony = TIME.test(input.ceremonyTime) ? input.ceremonyTime : null;
  const banquet = TIME.test(input.banquetTime) ? input.banquetTime : null;

  return {
    value: {
      groom, bride, date, startsAt, ceremonyTime: ceremony, banquetTime: banquet,
      message: clip(input.message, 600) || null,
      template: tpl.id, theme, font, content,
      visibility: input.visibility === 'private' ? 'private' : 'public',
      settings: cleanSettings(input.settings),
    },
    mediaIds,
  };
}

module.exports = { cleanWedding, cleanContent, cleanSettings, defaultSections, defaultSettings, clip, MEDIA_ID };
