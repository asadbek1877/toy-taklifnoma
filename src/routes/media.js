// Media: foto (galereya, hero, hikoya), video taklifnoma, musiqa. Bazada (BYTEA) saqlanadi.
//  • Yuklash — faqat a'zolar (egasi/hammuallif), imzo bilan; haqiqiy fayl formati sehrli baytlar (magic bytes) orqali tekshiriladi
//  • Berish — ochiq (ID taxmin qilib bo'lmaydi: 96 bit), Range qo'llab-quvvatlanadi (iOS video/audio uchun majburiy)
// DIQQAT: bu router index.js'da global express.json'dan OLDIN ulanadi (o'z limitlari bor).

const express = require('express');
const store = require('../store');
const { requireMember, wrap } = require('../auth');

const LIMITS = { image: 700 * 1024, thumb: 120 * 1024, video: 12 * 1024 * 1024, audio: 8 * 1024 * 1024 };
const FREE_COUNT = { image: 40 }; // bitta to'yda rasmlar soni chegarasi (hero, hikoya, galereya)

// Sehrli baytlar bo'yicha format aniqlash — mijoz aytgan Content-Type'ga ishonmaymiz
function sniff(buf, kind) {
  const b = buf;
  if (kind === 'image') {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
    return null; // klient doim JPEG'ga aylantiradi
  }
  if (kind === 'video') {
    if (b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp') return 'video/mp4';
    if (b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3) return 'video/webm';
    return null;
  }
  if (kind === 'audio') {
    if (b.slice(0, 3).toString('latin1') === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    if (b.length > 12 && b.slice(4, 8).toString('latin1') === 'ftyp') return 'audio/mp4';
    if (b.slice(0, 4).toString('latin1') === 'OggS') return 'audio/ogg';
    if (b.slice(0, 4).toString('latin1') === 'RIFF') return 'audio/wav';
    return null;
  }
  return null;
}

// MUHIM (xavfsizlik): imzo va a'zolik tanani o'qishdan OLDIN tekshiriladi — begona odam 12 MB yuborib xotirani to'ldira olmaydi.
// initData shu yerda faqat sarlavhadan (X-Tg-Init-Data) olinadi: tana hali o'qilmagan.
const gate = (req, res, next) => {
  requireMember(req, res)
    .then((m) => { if (m) { req.member = m; next(); } }) // m yo'q bo'lsa javob requireMember ichida yuborilgan
    .catch((err) => { console.error('[media] gate xatolik:', err); if (!res.headersSent) res.status(500).json({ error: 'server_error' }); });
};

const owner = express.Router(); // /api/owner/media
const pub = express.Router();   // /api/media

async function checkQuota(member, add, kind) {
  const u = await store.mediaUsage(member.wedding.id);
  if (u.bytes + add > store.MEDIA_QUOTA) return 'quota';
  if (kind === 'image' && u.count >= 60) return 'too_many';
  return null;
}

// Rasm: JSON { data: base64(JPEG), thumb: base64(JPEG) }
owner.post('/image', gate, express.json({ limit: '1.5mb' }), wrap(async (req, res) => {
  const m = req.member;
  const dec = (s) => (typeof s === 'string' && /^[A-Za-z0-9+/=]+$/.test(s) ? Buffer.from(s, 'base64') : null);
  const data = dec(req.body.data), thumb = dec(req.body.thumb);
  if (!data || data.length < 100 || data.length > LIMITS.image || sniff(data, 'image') !== 'image/jpeg') return res.status(400).json({ error: 'bad_image' });
  if (thumb && (thumb.length > LIMITS.thumb || sniff(thumb, 'image') !== 'image/jpeg')) return res.status(400).json({ error: 'bad_image' });
  const bad = await checkQuota(m, data.length + (thumb ? thumb.length : 0), 'image');
  if (bad) return res.status(413).json({ error: bad });
  const id = await store.saveMedia({ weddingId: m.wedding.id, kind: 'image', mime: 'image/jpeg', data, thumb });
  res.status(201).json({ id, kind: 'image', size: data.length });
}));

// Video / audio: xom (binary) tana, initData sarlavhada (X-Tg-Init-Data)
for (const kind of ['video', 'audio']) {
  owner.post(`/${kind}`, gate, express.raw({ type: () => true, limit: LIMITS[kind] }), wrap(async (req, res) => {
    const m = req.member;
    const data = req.body;
    if (!Buffer.isBuffer(data) || data.length < 100) return res.status(400).json({ error: `bad_${kind}` });
    const mime = sniff(data, kind);
    if (!mime) return res.status(415).json({ error: `bad_${kind}` });
    const bad = await checkQuota(m, data.length, kind);
    if (bad) return res.status(413).json({ error: bad });
    const id = await store.saveMedia({ weddingId: m.wedding.id, kind, mime, data });
    res.status(201).json({ id, kind, size: data.length });
  }));
}

owner.post('/delete', gate, express.json(), wrap(async (req, res) => {
  const m = req.member;
  const ok = typeof req.body.id === 'string' && (await store.deleteMedia(m.wedding.id, req.body.id));
  res.json({ ok });
}));

owner.post('/list', gate, express.json(), wrap(async (req, res) => {
  const m = req.member;
  const usage = await store.mediaUsage(m.wedding.id);
  res.json({ media: await store.listMedia(m.wedding.id), usage, quota: store.MEDIA_QUOTA });
}));

// Berish: GET /api/media/:id[?thumb=1] — Range bilan
pub.get('/:id', wrap(async (req, res) => {
  if (!/^[a-f0-9]{16,32}$/.test(req.params.id)) return res.status(404).end();
  const row = await store.getMedia(req.params.id);
  if (!row) return res.status(404).end();
  const useThumb = req.query.thumb === '1' && row.thumb;
  const buf = useThumb ? row.thumb : row.data;

  res.set({ 'Content-Type': row.mime, 'Cache-Control': 'public, max-age=31536000, immutable', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff' });
  const range = /^bytes=(\d*)-(\d*)$/.exec(req.get('range') || '');
  if (range && (range[1] || range[2])) {
    let start = range[1] ? parseInt(range[1], 10) : Math.max(0, buf.length - parseInt(range[2], 10));
    let end = range[1] && range[2] ? parseInt(range[2], 10) : buf.length - 1;
    end = Math.min(end, buf.length - 1);
    if (start > end || start >= buf.length) { res.set('Content-Range', `bytes */${buf.length}`); return res.status(416).end(); }
    res.status(206).set({ 'Content-Range': `bytes ${start}-${end}/${buf.length}`, 'Content-Length': String(end - start + 1) });
    return res.end(buf.subarray(start, end + 1));
  }
  res.set('Content-Length', String(buf.length));
  res.end(buf);
}));

module.exports = { owner, pub, sniff };
