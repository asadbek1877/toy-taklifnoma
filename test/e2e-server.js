// Запуск:  node test/e2e-server.js            (pg-mem, быстро)
//           USE_REAL_PG=1 node test/e2e-server.js   (настоящий PostgreSQL — рекомендуется перед деплоем)
// Тестовый стенд: РЕАЛЬНЫЙ backend (src/index.js) + pg-mem вместо PostgreSQL + поддельный Telegram-бот
// с управляемыми сбоями (обрыв сети, 429, 403, зависание).
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const ROOT = path.join(__dirname, '..') + '/'; // backend/
const TOKEN = '123456:TESTTOKEN';

process.env.TELEGRAM_BOT_TOKEN = TOKEN;
process.env.ADMIN_CHAT_ID = '999';
delete process.env.WEBAPP_URL;
process.env.RENDER_EXTERNAL_URL = 'https://toy-test.onrender.com';
process.env.KEEP_ALIVE = 'false';
process.env.BOT_USERNAME = 'toygabot';
process.env.PORT = '3999';
delete process.env.ALLOWED_ORIGIN;
// Быстрые тайминги worker'а для тестов
process.env.OUTBOX_INTERVAL_MS = '300';
process.env.OUTBOX_BACKOFF_BASE_MS = '200';
process.env.OUTBOX_BACKOFF_CAP_MS = '800';
process.env.OUTBOX_STALE_MS = '1500';
process.env.OUTBOX_SEND_TIMEOUT_MS = '1000';

const REAL = process.env.USE_REAL_PG === '1'; // 1 = настоящий PostgreSQL (embedded), иначе pg-mem
async function main() {
  if (REAL) {
    const EmbeddedPostgres = (await import(require('url').pathToFileURL(path.join(ROOT, 'node_modules/embedded-postgres/dist/index.js')).href)).default;
    const dir = path.join(require('os').tmpdir(), 'toy-test-pg-' + Date.now());
    const epg = new EmbeddedPostgres({ databaseDir: dir, user: 'postgres', password: 'pw', port: 5439, persistent: false, initdbFlags: ['--encoding=UTF8', '--locale=C'] });
    await epg.initialise(); await epg.start(); await epg.createDatabase('test');
    process.env.DATABASE_URL = 'postgresql://postgres:pw@localhost:5439/test';
    process.on('exit', () => { try { epg.stop(); } catch (e) {} });
    process.on('SIGTERM', async () => { try { await epg.stop(); } catch (e) {} process.exit(0); });
    console.log('REAL PostgreSQL started');
  }
// --- pg -> pg-mem ---
if (!REAL) {
  const { newDb } = require('pg-mem');
  const db = newDb();
  const { Pool } = db.adapters.createPg();
  require.cache[require.resolve(ROOT + 'node_modules/pg')] = { exports: { Pool }, loaded: true, id: 'pg' };
}

// --- Telegram bot: запись сообщений + управляемые сбои ---
const sent = [];        // реально доставленные
const attemptsLog = []; // все попытки отправки (включая неудачные)
const handlers = [];
let failMode = 'off';   // off | network | 429 | 403 | 500 | hang
let failChat = null;    // если задан — сбой только для этого chat
function tgError(code, description, extra) {
  const e = new Error(`ETELEGRAM: ${code} ${description}`);
  e.code = 'ETELEGRAM';
  e.response = { body: { ok: false, error_code: code, description, ...(extra ? { parameters: extra } : {}) } };
  return e;
}
class FakeBot {
  constructor() {}
  onText(re, fn) { handlers.push([re, fn]); }
  on() {}
  setChatMenuButton(p) { sent.push({ method: 'setChatMenuButton', p }); return Promise.resolve(true); }
  setMyCommands(c) { sent.push({ method: 'setMyCommands', c }); return Promise.resolve(true); }
  setMyDescription(f) { sent.push({ method: 'setMyDescription', f }); return Promise.resolve(true); }
  getMe() { return Promise.resolve({ username: 'toygabot' }); }
  sendMessage(chatId, text, opts) {
    attemptsLog.push({ chatId: String(chatId), t: Date.now(), mode: failMode });
    const applies = failMode !== 'off' && (!failChat || String(chatId) === String(failChat));
    if (applies) {
      if (failMode === 'network') { const e = new Error('ESOCKETTIMEDOUT'); e.code = 'EFATAL'; return Promise.reject(e); }
      if (failMode === '429') return Promise.reject(tgError(429, 'Too Many Requests: retry after 1', { retry_after: 1 }));
      if (failMode === '403') return Promise.reject(tgError(403, 'Forbidden: bot was blocked by the user'));
      if (failMode === '500') return Promise.reject(tgError(502, 'Bad Gateway'));
      if (failMode === 'hang') return new Promise(() => {});
    }
    sent.push({ chatId: String(chatId), text, opts });
    return Promise.resolve({});
  }
}
require.cache[require.resolve(ROOT + 'node_modules/node-telegram-bot-api')] = { exports: FakeBot, loaded: true, id: 'tgbot' };

process.chdir(require('os').tmpdir()); // чтобы dotenv не подхватил боевой .env
require(ROOT + 'src/index.js');
const realDb = require(ROOT + 'src/db.js');

// --- управляющий сервер для тестов ---
function sign(user, ageSec = 0) {
  const p = new URLSearchParams({ user: JSON.stringify(user), auth_date: String(Math.floor(Date.now() / 1000) - ageSec) });
  const dcs = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  p.set('hash', crypto.createHmac('sha256', secret).update(dcs).digest('hex'));
  return p.toString();
}
http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  try {
    if (u.pathname === '/__sign') {
      const user = { id: Number(u.searchParams.get('id')), first_name: u.searchParams.get('name') || 'Test', language_code: u.searchParams.get('lang') || 'ru' };
      if (u.searchParams.get('username')) user.username = u.searchParams.get('username');
      return res.end(JSON.stringify({ initData: sign(user), user }));
    }
    if (u.pathname === '/__all') return res.end(JSON.stringify(sent));
    if (u.pathname === '/__sent') return res.end(JSON.stringify(sent.filter((m) => m.chatId)));
    if (u.pathname === '/__attempts') return res.end(JSON.stringify(attemptsLog));
    if (u.pathname === '/__fail') { failMode = u.searchParams.get('mode') || 'off'; failChat = u.searchParams.get('chat') || null; return res.end(JSON.stringify({ failMode, failChat })); }
    if (u.pathname === '/__env') { u.searchParams.forEach((v, k) => { process.env[k] = v; }); return res.end('{}'); }
    if (u.pathname === '/__sql') { // для проверки состояния и подготовки тестов
      const r = await realDb.pool.query(u.searchParams.get('q'), JSON.parse(u.searchParams.get('p') || '[]'));
      return res.end(JSON.stringify(r.rows));
    }
    if (u.pathname === '/__start') {
      const before = sent.length;
      const text = '/start' + (u.searchParams.get('payload') ? ' ' + u.searchParams.get('payload') : '');
      const msg = { chat: { id: Number(u.searchParams.get('chat')) }, from: { language_code: u.searchParams.get('lang') || 'ru' }, text };
      handlers.forEach(([re, fn]) => { const m = text.match(re); if (m) fn(msg, m); });
      return setTimeout(() => res.end(JSON.stringify(sent.slice(before).filter((m) => m.chatId))), 150);
    }
    res.statusCode = 404; res.end('{}');
  } catch (e) { res.statusCode = 500; res.end(JSON.stringify({ error: e.message })); }
}).listen(3998, () => console.log('control :3998, backend :3999 ready'));

}
main().catch((e) => { console.error('BOOT FAIL', e); process.exit(1); });
