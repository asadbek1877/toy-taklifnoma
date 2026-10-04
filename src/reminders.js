// Avtomatik eslatmalar. Har daqiqada tekshiradi; hammasi outbox orqali (dedupe bilan) — qayta ishga tushirish,
// ikki nusxa yoki kech qolish dublikat yoki yo'qolish keltirmaydi.
//
// Mehmonlarga (RSVP "keladi" degan, Telegram ID'si ma'lum):   7 kun / 1 kun / 3 soat qolganda — to'y haqida eslatma
// Javob bermaganlarga (shaxsiy havolasini ochgan):            14 / 7 kun qolganda — "iltimos javob bering"
// Egalarga (egasi + hammuallif):                              14 / 7 kun qolganda — nechta mehmon javob bermagani
// Har eslatma foydalanuvchi bo'yicha BIR MARTA yuboriladi (dedupe kaliti: rem:<to'y>:<slot>:<foydalanuvchi>).

const db = require('./db');
const outbox = require('./outbox');
const store = require('./store');
const notify = require('./notify');
const { esc } = require('./messages');

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const parse = (s, d) => { try { return s ? JSON.parse(s) : d; } catch (e) { return d; } };

// slot: qachon (to'ygacha qolgan vaqt <= at) va qancha vaqt oynasida yuboriladi (kech qolsak ham ma'nosi yo'qolmasin)
const SLOTS = {
  guestD7: { at: 7 * DAY, window: 36 * HOUR, kind: 'guest', key: 'd7' },
  guestD1: { at: 1 * DAY, window: 18 * HOUR, kind: 'guest', key: 'd1' },
  guestH3: { at: 3 * HOUR, window: 3 * HOUR, kind: 'guest', key: 'h3' },
  pendingD14: { at: 14 * DAY, window: 36 * HOUR, kind: 'pending', key: 'p14' },
  pendingD7: { at: 7 * DAY, window: 36 * HOUR, kind: 'pending', key: 'p7' },
};

const MONTHS = {
  uz: ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'],
  ru: ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'],
};
function fmtDate(date, lang) {
  const [y, m, d] = date.split('-').map(Number);
  if (lang === 'ja') return `${y}年${m}月${d}日`;
  if (lang === 'ru') return `${d} ${MONTHS.ru[m - 1]} ${y}`;
  return `${d}-${MONTHS.uz[m - 1]}, ${y}`;
}

// Mehmonga ko'rinadigan matnlar (uz — lotin, Mini App bilan bir xil)
const GUEST_TEXT = {
  uz: {
    d7: (n) => `⏳ <b>${n}</b> to'yiga 7 kun qoldi!`, d1: (n) => `🎉 <b>${n}</b> to'yi — ertaga!`, h3: (n) => `⏰ <b>${n}</b> to'yi 3 soatdan keyin boshlanadi!`,
    p: (n) => `💌 <b>${n}</b> to'yiga taklifnoma: iltimos, kelish-kelmasligingizni bildiring.`, open: 'Taklifnomani ochish 💌', when: 'Sana', where: 'Joy',
  },
  ru: {
    d7: (n) => `⏳ До свадьбы <b>${n}</b> осталось 7 дней!`, d1: (n) => `🎉 Свадьба <b>${n}</b> — уже завтра!`, h3: (n) => `⏰ Свадьба <b>${n}</b> начнётся через 3 часа!`,
    p: (n) => `💌 Приглашение на свадьбу <b>${n}</b>: пожалуйста, подтвердите, сможете ли прийти.`, open: 'Открыть приглашение 💌', when: 'Дата', where: 'Место',
  },
  ja: {
    d7: (n) => `⏳ <b>${n}</b> の結婚式まであと7日です！`, d1: (n) => `🎉 <b>${n}</b> の結婚式は明日です！`, h3: (n) => `⏰ <b>${n}</b> の結婚式は3時間後に始まります！`,
    p: (n) => `💌 <b>${n}</b> の結婚式の招待状：ご出欠をお知らせください。`, open: '招待状を開く 💌', when: '日付', where: '会場',
  },
};
const langOf = (l) => (['uz', 'ru', 'ja'].includes(l) ? l : 'uz');

function guestMessage(slot, w, lang, ctx) {
  const L = lang in GUEST_TEXT ? lang : 'uz';
  const t = GUEST_TEXT[L];
  const names = `${esc(w.groom)} &amp; ${esc(w.bride)}`;
  const head = slot.kind === 'pending' ? t.p(names) : slot.key === 'd7' ? t.d7(names) : slot.key === 'd1' ? t.d1(names) : t.h3(names);
  let text = `${head}\n\n📅 ${t.when}: ${esc(fmtDate(w.wedding_date, L))}${w.ceremony_time ? ` · ${w.ceremony_time}` : ''}`;
  if (ctx.venue) text += `\n📍 ${t.where}: ${esc(ctx.venue)}`;
  return { text, button: t.open };
}

// Bitta to'y uchun hozirgi vaqtga ko'ra yuborilishi kerak bo'lgan eslatmalarni navbatga qo'yadi. Navbatga qo'yilganlar sonini qaytaradi.
async function processWedding(w, now) {
  if (!w.starts_at) return 0;
  const until = new Date(w.starts_at).getTime() - now.getTime();
  if (until <= 0) return 0;
  const flags = (parse(w.settings, {}).reminders) || {};
  const on = (k) => flags[k] !== false; // standart: yoqilgan
  let queued = 0;
  const due = Object.entries(SLOTS).filter(([name, s]) => on(name) && until <= s.at && until > s.at - s.window);
  if (!due.length) return 0;

  const content = parse(w.content, {});
  const venue = (content.location && content.location.name) || w.venue_name || '';
  const guests = await store.listGuests(w.id);
  const rs = (await db.pool.query(
    `SELECT guest_tg_id, language, status, guest_id FROM rsvp_responses WHERE wedding_id = $1 ORDER BY id`, [w.id])).rows;
  const latestByTg = new Map();
  rs.forEach((r) => { if (r.guest_tg_id) latestByTg.set(String(r.guest_tg_id), r); });

  const mkButton = (label, query) => {
    const url = require('./bot').appUrl(query);
    return url ? { inline_keyboard: [[{ text: label, web_app: { url } }]] } : null;
  };
  const enq = async (chatId, slot, text, replyMarkup) => {
    const id = await outbox.enqueue(db.pool, { type: 'reminder', chatId, text, replyMarkup, dedupeKey: `rem:${w.id}:${slot.key}:${chatId}` });
    if (id) queued++;
  };

  for (const [, slot] of due) {
    if (slot.kind === 'guest') {
      // "Keladi" degan, Telegram ID'si ma'lum mehmonlar (har biriga bir marta)
      for (const [tg, r] of latestByTg) {
        if (r.status !== 'yes') continue;
        const g = r.guest_id ? guests.find((x) => x.id === r.guest_id) : null;
        const { text, button } = guestMessage(slot, w, langOf(r.language), { venue });
        await enq(tg, slot, text, mkButton(button, g ? `g=${g.token}` : `w=${w.code}`));
      }
    } else {
      // Javob bermaganlar: Telegram'i ma'lumlarga eslatma, egalarga hisobot
      const pending = guests.filter((g) => !g.rsvp);
      for (const g of pending) {
        const tgRow = (await db.pool.query('SELECT tg_id, lang FROM guests WHERE id = $1', [g.id])).rows[0];
        if (!tgRow || !tgRow.tg_id) continue;
        const { text, button } = guestMessage(slot, w, langOf(tgRow.lang), { venue });
        await enq(tgRow.tg_id, slot, text, mkButton(button, `g=${g.token}`));
      }
      if (pending.length && notify.wants(w, 'rsvp')) {
        const days = slot.key === 'p14' ? 14 : 7;
        const text = `📋 <b>${notify.title(w)}</b>\n\nТўйгача ${days} кун қолди. ${pending.length} та меҳмон ҳали жавоб бермаган.\n\nМеҳмонлар бўлимида ҳар бирининг шахсий ҳаволасини қайта юборишингиз мумкин.`;
        const members = await store.listMembers(w.id);
        for (const m of members) await enq(m.tg_id, slot, text, null);
      }
    }
  }
  if (queued) outbox.kick();
  return queued;
}

// Barcha e'lon qilingan to'ylar bo'yicha. now — sinov uchun almashtiriladi.
async function runOnce(now = new Date()) {
  await db.ready;
  const r = await db.pool.query('SELECT * FROM weddings WHERE published = TRUE AND starts_at IS NOT NULL');
  let total = 0;
  for (const w of r.rows) {
    try { total += await processWedding(w, now); }
    catch (err) { console.error(`[reminders] to'y #${w.id} xatolik:`, err.message); } // bitta to'y boshqalarni to'xtatmasin
  }
  return total;
}

let timer = null;
function start() {
  const every = Number(process.env.REMINDERS_INTERVAL_MS) || 60 * 1000;
  timer = setInterval(() => runOnce().catch((e) => console.error('[reminders] tick xatolik:', e.message)), every);
  if (timer.unref) timer.unref();
}
function stop() { clearInterval(timer); }

module.exports = { start, stop, runOnce, processWedding, SLOTS };
