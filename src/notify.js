// Bildirishnomalar: to'yning barcha a'zolariga (egasi + hammuallif) ishonchli yetkazish.
// Hamma narsa outbox orqali: dedupe (dublsiz), qayta urinish, saqlanish. Matnlar — mavjud RSVP xabari uslubida.

const db = require('./db');
const outbox = require('./outbox');
const store = require('./store');
const { esc } = require('./messages');

const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

// Sozlama o'chirilmagan bo'lsa true (standart: yoqilgan)
function wants(weddingRow, key) {
  const n = (parse(weddingRow.settings, {}).notify) || {};
  return n[key] !== false;
}

// Barcha a'zolarga bitta xabarni navbatga qo'yadi. dedupeBase bir xil bo'lsa takror yozilmaydi.
async function toMembers(weddingRow, { type, text, dedupeBase, parseMode = 'HTML' }) {
  const members = await store.listMembers(weddingRow.id);
  let queued = 0;
  for (const m of members) {
    const id = await outbox.enqueue(db.pool, { type, chatId: m.tg_id, text, parseMode, dedupeKey: `${dedupeBase}:${m.tg_id}` });
    if (id) queued++;
  }
  if (queued) outbox.kick();
  return queued;
}

const title = (w) => `${esc(w.groom)} &amp; ${esc(w.bride)}`;

// Mehmon shaxsiy havolani birinchi marta ochdi
async function guestOpened(weddingRow, guest, tgUser) {
  if (!wants(weddingRow, 'opened')) return 0;
  const who = tgUser && tgUser.username ? ` (@${esc(tgUser.username)})` : '';
  return toMembers(weddingRow, {
    type: 'opened', dedupeBase: `open:${guest.id}`,
    text: `👀 <b>${esc(guest.name)}</b>${who} таклифномани очди`,
  });
}

module.exports = { toMembers, wants, guestOpened, title };
