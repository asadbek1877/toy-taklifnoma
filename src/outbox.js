// Ishonchli yetkazish tizimi (transactional outbox).
//
// G'oya: xabar to'g'ridan-to'g'ri Telegram'ga yuborilmaydi. Avval u bazadagi `outbox` jadvaliga
// YOZILADI — biznes ma'lumot (masalan RSVP) bilan BIR TRANZAKSIYADA. Keyin alohida ishchi (worker)
// uni Telegram'ga yetkazadi: xato bo'lsa qayta urinadi, server o'chib yonsa qolgan joyidan davom etadi.
//
// Holatlar:
//   pending  — yetkazilishi kutilmoqda (yangi yoki qayta urinish vaqtini kutmoqda)
//   sending  — hozir yuborilmoqda (worker band qilgan; qotib qolsa staleMs'dan keyin qaytariladi)
//   sent     — yetkazildi
//   failed   — doimiy xato (masalan egasi botni bloklagan) yoki urinishlar tugadi. O'CHIRILMAYDI,
//              /retry bilan qayta navbatga qo'yiladi.
//
// Kafolat: AT-LEAST-ONCE — xabar yo'qolmaydi. Bitta istisno: Telegram xabarni qabul qilib, javob
// qaytarishdan oldin uzilsa, xabar ikki marta kelishi mumkin (har qanday tarmoq tizimida shunday;
// aniq-bir-marta (exactly-once) Telegram API'da mumkin emas). Buni kamaytirish uchun har xabarda
// raqam (№) bor, qayta urinishlar kam va qotib qolgan 'sending' faqat staleMs'dan keyin qaytariladi.
//
// Ko'p nusxa (scale): "band qilish" compare-and-set UPDATE bilan — bir nechta server/worker bir vaqtda
// ishlasa ham bitta qatorni faqat bittasi oladi.

const num = (v, d) => (Number.isFinite(Number(v)) && v !== undefined && v !== '' ? Number(v) : d);

const CFG = {
  intervalMs: num(process.env.OUTBOX_INTERVAL_MS, 5000),          // worker qanchalik tez-tez tekshiradi
  batch: num(process.env.OUTBOX_BATCH, 10),                        // bir tickda nechta xabar
  concurrency: num(process.env.OUTBOX_CONCURRENCY, 5),             // bir vaqtda nechta yuborish
  staleMs: num(process.env.OUTBOX_STALE_MS, 90 * 1000),            // 'sending' qotib qolgan deb hisoblash
  maxAttempts: num(process.env.OUTBOX_MAX_ATTEMPTS, 30),           // vaqtincha xatolar bilan urinishlar chegarasi
  backoffBaseMs: num(process.env.OUTBOX_BACKOFF_BASE_MS, 5000),    // 5s, 10s, 20s, ... 1 soatgacha
  backoffCapMs: num(process.env.OUTBOX_BACKOFF_CAP_MS, 60 * 60 * 1000),
  sendTimeoutMs: num(process.env.OUTBOX_SEND_TIMEOUT_MS, 20 * 1000),
  keepSentDays: num(process.env.OUTBOX_KEEP_SENT_DAYS, 90),        // yetkazilganlar shuncha kundan keyin tozalanadi
};

// ---------- yozish ----------
// `db` — pool YOKI tranzaksiya ichidagi client (shunda biznes ma'lumot bilan birga atomik yoziladi).
// Bir xil dedupeKey ikkinchi marta yozilmaydi (dubl yo'q). Yangi qator id'sini yoki null (dubl) qaytaradi.
// document: { filename, contentBase64 } berilsa — matn sarlavha (caption) bo'lib, fayl sifatida yuboriladi.
async function enqueue(db, { type, chatId, text, parseMode = 'HTML', dedupeKey, document = null, replyMarkup = null }) {
  if (!dedupeKey) throw new Error('outbox.enqueue: dedupeKey majburiy');
  const payload = JSON.stringify({ text, parseMode, document, replyMarkup });
  const r = await db.query(
    `INSERT INTO outbox (type, chat_id, payload, dedupe_key)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING id`,
    [type, chatId, payload, dedupeKey]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

// ---------- xatoni tasniflash ----------
// retry     — vaqtincha (tarmoq, 5xx, 429, noto'g'ri token): qayta uriniladi
// permanent — hech qachon o'zi to'g'rilanmaydi (chat topilmadi, bot bloklangan): failed, qo'lda /retry
function classify(err) {
  const body = err && err.response && err.response.body;
  const code = body && body.error_code;
  const description = (body && body.description) || (err && err.message) || String(err);
  if (code === 429) {
    const retryAfter = body && body.parameters && body.parameters.retry_after;
    return { kind: 'retry', delayMs: (Number(retryAfter) || 5) * 1000 + 500, description };
  }
  if (code === 400 || code === 403 || code === 404) return { kind: 'permanent', description };
  // 401 (token noto'g'ri/almashtirilmoqda), 5xx, tarmoq, timeout — hammasi vaqtincha: xabar saqlanadi
  return { kind: 'retry', description };
}

function backoffMs(attempts) {
  const exp = Math.min(CFG.backoffBaseMs * 2 ** Math.max(0, attempts - 1), CFG.backoffCapMs);
  return Math.round(exp * (0.75 + Math.random() * 0.5)); // jitter: ko'p xabar bir vaqtda urinmasin
}

function withTimeout(promise, ms) {
  let t;
  const timeout = new Promise((_, rej) => { t = setTimeout(() => rej(new Error(`yuborish ${ms}ms ichida tugamadi`)), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(t));
}

// ---------- worker ----------
let pool = null;
let send = null;       // async (chatId, text, { parse_mode }) => ...
let sendDoc = null;    // async (chatId, Buffer, options, fileOptions) => ...
let timer = null;
let cleanupTimer = null;
let ticking = false;
let again = false;     // tick davomida kick bo'lsa — tugagach yana bir marta
let inFlight = 0;
let stopped = false;

async function claimDue(now) {
  const stale = new Date(now.getTime() - CFG.staleMs);
  const cand = await pool.query(
    `SELECT id FROM outbox
      WHERE (status = 'pending' AND next_attempt_at <= $1) OR (status = 'sending' AND locked_at <= $2)
      ORDER BY next_attempt_at, id LIMIT $3`,
    [now, stale, CFG.batch]
  );
  const claimed = [];
  for (const { id } of cand.rows) {
    // Compare-and-set: shu qatorni boshqa worker olmagan bo'lsagina band qilamiz
    const r = await pool.query(
      `UPDATE outbox SET status = 'sending', locked_at = $1, attempts = attempts + 1
        WHERE id = $2 AND ((status = 'pending' AND next_attempt_at <= $1) OR (status = 'sending' AND locked_at <= $3))
        RETURNING *`,
      [now, id, stale]
    );
    if (r.rows[0]) claimed.push(r.rows[0]);
  }
  return claimed;
}

async function deliver(row) {
  const { text, parseMode, document, replyMarkup } = JSON.parse(row.payload);
  try {
    const opts = parseMode ? { parse_mode: parseMode } : {};
    if (replyMarkup) opts.reply_markup = replyMarkup;
    const call = document && sendDoc
      ? sendDoc(row.chat_id, Buffer.from(document.contentBase64, 'base64'), { ...opts, caption: text }, { filename: document.filename, contentType: 'text/csv' })
      : send(row.chat_id, text, opts);
    await withTimeout(call, document ? CFG.sendTimeoutMs * 2 : CFG.sendTimeoutMs);
  } catch (err) {
    const c = classify(err);
    const exhausted = c.kind === 'retry' && row.attempts >= CFG.maxAttempts;
    if (c.kind === 'permanent' || exhausted) {
      await pool.query(`UPDATE outbox SET status = 'failed', last_error = $2, locked_at = NULL WHERE id = $1`, [row.id, c.description]);
      console.error(`[outbox] #${row.id} FAILED (${c.kind}${exhausted ? ', urinishlar tugadi' : ''}): ${c.description}`);
    } else {
      const delay = c.delayMs || backoffMs(row.attempts);
      await pool.query(
        `UPDATE outbox SET status = 'pending', next_attempt_at = $2, last_error = $3, locked_at = NULL WHERE id = $1`,
        [row.id, new Date(Date.now() + delay), c.description]
      );
      console.warn(`[outbox] #${row.id} qayta uriniladi (${row.attempts}-urinish, ${Math.round(delay / 1000)}s dan keyin): ${c.description}`);
    }
    return;
  }
  // Yetkazildi. Agar shu yerda baza yiqilsa — qator 'sending' qoladi va staleMs'dan keyin qayta yuboriladi
  // (xabar yo'qolmaydi; kamdan-kam hollarda dubl bo'lishi mumkin, № bilan tanish oson).
  await pool.query(`UPDATE outbox SET status = 'sent', sent_at = $2, last_error = NULL, locked_at = NULL WHERE id = $1`, [row.id, new Date()]);
}

async function tick() {
  if (stopped) return;
  if (ticking) { again = true; return; }
  ticking = true;
  try {
    // Navbat bo'sh bo'lguncha (lekin cheksiz emas) ketma-ket partiyalar
    for (let round = 0; round < 20 && !stopped; round++) {
      const rows = await claimDue(new Date());
      if (!rows.length) break;
      for (let i = 0; i < rows.length; i += CFG.concurrency) {
        const slice = rows.slice(i, i + CFG.concurrency);
        inFlight += slice.length;
        await Promise.all(slice.map((r) => deliver(r).catch((e) => console.error(`[outbox] #${r.id} holatni yozib bo'lmadi:`, e.message))))
          .finally(() => { inFlight -= slice.length; });
      }
    }
  } catch (err) {
    console.error('[outbox] tick xatolik (keyingi tickda davom etadi):', err.message);
  } finally {
    ticking = false;
    if (again && !stopped) { again = false; setImmediate(tick); }
  }
}

// Yangi xabar yozilgach darhol yetkazishni boshlaydi (keyingi intervalni kutmasdan)
function kick() {
  if (pool && !stopped) setImmediate(tick);
}

async function cleanup() {
  try {
    const before = new Date(Date.now() - CFG.keepSentDays * 24 * 3600 * 1000);
    await pool.query(`DELETE FROM outbox WHERE status = 'sent' AND sent_at < $1`, [before]);
  } catch (err) {
    console.error('[outbox] tozalashda xatolik:', err.message);
  }
}

// pool — pg Pool; ready — migratsiya Promise'i; sender — Telegram'ga yuboruvchi funksiya
function startWorker({ pool: p, ready, sender, documentSender = null }) {
  pool = p; send = sender; sendDoc = documentSender; stopped = false;
  Promise.resolve(ready).then(() => {
    tick(); // qayta ishga tushganda oldingi pending/qotib qolganlarni darhol davom ettiradi
    timer = setInterval(tick, CFG.intervalMs);
    cleanupTimer = setInterval(cleanup, 60 * 60 * 1000);
    if (timer.unref) { timer.unref(); cleanupTimer.unref(); }
  });
}

// Deploy/to'xtatishda: yangi ish olmaydi, ketayotganini kutadi (maks. waitMs)
async function stopWorker(waitMs = 8000) {
  stopped = true;
  clearInterval(timer); clearInterval(cleanupTimer);
  const t0 = Date.now();
  while ((ticking || inFlight > 0) && Date.now() - t0 < waitMs) await new Promise((r) => setTimeout(r, 100));
}

// ---------- nazorat ----------
async function stats() {
  const byStatus = { pending: 0, sending: 0, sent: 0, failed: 0 };
  const rows = await pool.query('SELECT status, COUNT(*) AS c FROM outbox GROUP BY status');
  rows.rows.forEach((r) => { byStatus[r.status] = Number(r.c); });
  const oldest = await pool.query(`SELECT MIN(created_at) AS t FROM outbox WHERE status IN ('pending', 'sending')`);
  const t = oldest.rows[0] && oldest.rows[0].t;
  const failed = await pool.query(
    `SELECT id, type, chat_id, attempts, last_error, created_at FROM outbox WHERE status = 'failed' ORDER BY id DESC LIMIT 10`
  );
  return {
    ...byStatus,
    oldestUndeliveredSeconds: t ? Math.max(0, Math.round((Date.now() - new Date(t).getTime()) / 1000)) : 0,
    recentFailed: failed.rows,
  };
}

// 'failed' xabarlarni qayta navbatga qo'yadi (masalan egasi botni qayta ochgach). Nechta qaytganini qaytaradi.
async function requeueFailed() {
  const r = await pool.query(
    `UPDATE outbox SET status = 'pending', attempts = 0, next_attempt_at = $1, last_error = NULL, locked_at = NULL
      WHERE status = 'failed' RETURNING id`,
    [new Date()]
  );
  kick();
  return r.rows.length;
}

module.exports = { CFG, enqueue, startWorker, stopWorker, kick, stats, requeueFailed, classify, backoffMs };
