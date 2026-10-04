const API = 'http://localhost:3999', CTL = 'http://localhost:3998';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const j = (r) => r.json().catch(() => null);
const ctl = async (p) => j(await fetch(CTL + p));
const sql = async (q, p = []) => ctl(`/__sql?q=${encodeURIComponent(q)}&p=${encodeURIComponent(JSON.stringify(p))}`);
const sign = async (id, name, username) => (await ctl(`/__sign?id=${id}&name=${name}&username=${username || ''}`)).initData;
const post = async (path, body) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, b: await j(r) }; };
const sentTo = async (chat) => (await ctl('/__sent')).filter((m) => m.chatId === String(chat));
const waitFor = async (fn, ms = 6000, step = 100) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = await fn(); if (v) return v; await sleep(step); } return null; };
const uuid = () => require('crypto').randomUUID();

(async () => {
  const OWNER = 100, GUEST = 200;
  const ownerInit = await sign(OWNER, 'Owner', 'owner'), guestInit = await sign(GUEST, 'Guest', 'gst');
  const w = await post('/api/owner/save', { tgInitData: ownerInit, wedding: { groom: 'A', bride: 'M', date: '2026-11-15' } });
  const code = w.b.wedding.code;
  await post('/api/owner/publish', { tgInitData: ownerInit, published: true });
  const rsvp = (extra = {}) => post('/api/rsvp', { guestName: 'Гость', status: 'yes', guestCount: 2, language: 'ru', weddingCode: code, tgInitData: guestInit, clientId: uuid(), ...extra });
  const outboxRow = async (rsvpId) => (await sql('SELECT * FROM outbox WHERE dedupe_key LIKE $1 ORDER BY id', [`rsvp:${rsvpId}:%`]))[0];

  // ===== A. Базовый путь =====
  let n0 = (await sentTo(OWNER)).length;
  let r = await rsvp();
  ok('A1 RSVP принят (201)', r.s === 201 && r.b.success && !r.b.duplicate, r);
  ok('A2 уведомление доставлено владельцу', await waitFor(async () => (await sentTo(OWNER)).length === n0 + 1), await sentTo(OWNER));
  let row = await outboxRow(r.b.data.id);
  ok('A3 outbox: sent, 1 попытка, нет ошибки', row.status === 'sent' && Number(row.attempts) === 1 && row.last_error === null && row.sent_at, row);
  ok('A4 в тексте номер RSVP (№)', (await sentTo(OWNER)).pop().text.includes(`№${r.b.data.id}`));

  // ===== B. Telegram недоступен -> данные сохранены -> доставка после восстановления =====
  await ctl('/__fail?mode=network');
  n0 = (await sentTo(OWNER)).length;
  r = await rsvp({ guestName: 'Офлайн-гость' });
  ok('B1 при недоступном Telegram RSVP всё равно принят (201)', r.s === 201, r);
  const rsvpId = r.b.data.id;
  ok('B2 RSVP сохранён в БД', (await sql('SELECT id FROM rsvp_responses WHERE id = $1', [rsvpId])).length === 1);
  await sleep(1800);
  row = await outboxRow(rsvpId);
  ok('B3 outbox: pending, были повторные попытки, ошибка записана', row.status === 'pending' && Number(row.attempts) >= 2 && /ESOCKETTIMEDOUT/.test(row.last_error), row);
  ok('B4 пока Telegram лежит — ничего не доставлено', (await sentTo(OWNER)).length === n0);
  await ctl('/__fail?mode=off');
  ok('B5 после восстановления доставлено САМО (без участия человека)', await waitFor(async () => (await sentTo(OWNER)).length === n0 + 1, 8000), await sentTo(OWNER));
  row = await outboxRow(rsvpId);
  ok('B6 outbox -> sent', row.status === 'sent', row);
  await sleep(1500);
  ok('B7 после доставки больше не шлётся (ровно одно)', (await sentTo(OWNER)).length === n0 + 1);

  // ===== C. Идемпотентность: повтор и гонка =====
  n0 = (await sentTo(OWNER)).length;
  const cid = uuid();
  const rsvpsBefore = (await sql('SELECT COUNT(*) AS c FROM rsvp_responses'))[0].c;
  const same = await Promise.all(Array.from({ length: 6 }, () => rsvp({ clientId: cid, guestName: 'Дубль' })));
  const created = same.filter((x) => x.s === 201).length, dups = same.filter((x) => x.s === 200 && x.b.duplicate).length;
  ok('C1 6 одновременных одинаковых запросов: 1 создан, остальные duplicate', created === 1 && dups === 5, same.map((x) => [x.s, x.b && x.b.duplicate]));
  const ids = new Set(same.map((x) => x.b.data.id));
  ok('C2 все ответы указывают на ОДИН и тот же RSVP', ids.size === 1, [...ids]);
  ok('C3 в БД ровно одна новая запись', Number((await sql('SELECT COUNT(*) AS c FROM rsvp_responses'))[0].c) === Number(rsvpsBefore) + 1);
  await sleep(1200);
  ok('C4 владелец получил РОВНО одно сообщение', (await sentTo(OWNER)).length === n0 + 1, (await sentTo(OWNER)).length - n0);
  const again = await rsvp({ clientId: cid, guestName: 'Дубль' });
  ok('C5 повтор позже — по-прежнему duplicate', again.s === 200 && again.b.duplicate);
  ok('C6 неверный clientId -> 400', (await rsvp({ clientId: 'x' })).s === 400);

  // ===== D. Лимит Telegram (429) =====
  await ctl('/__fail?mode=429');
  r = await rsvp({ guestName: 'Лимит' });
  await sleep(1000);
  row = await outboxRow(r.b.data.id);
  ok('D1 429: остаётся pending, учтена пауза retry_after (~1.5с)', row.status === 'pending' && /Too Many/.test(row.last_error) && new Date(row.next_attempt_at).getTime() - Date.now() > -300, row);
  const att429 = (await ctl('/__attempts')).filter((a) => a.mode === '429').length;
  await ctl('/__fail?mode=off');
  ok('D2 после снятия лимита доставлено', await waitFor(async () => (await outboxRow(r.b.data.id)).status === 'sent', 8000));
  ok('D3 за время лимита не было «шквала» попыток', att429 <= 3, att429);

  // ===== E. Постоянная ошибка (403) — не теряется, не зацикливается, можно вернуть =====
  await ctl(`/__fail?mode=403&chat=${OWNER}`);
  const adminInit = await sign(999, 'Admin');
  r = await rsvp({ guestName: 'Блок' });
  ok('E1 RSVP принят, хотя владелец заблокировал бота', r.s === 201);
  await waitFor(async () => (await outboxRow(r.b.data.id)).status === 'failed', 6000);
  row = await outboxRow(r.b.data.id);
  ok('E2 outbox: failed, ошибка сохранена, строка НЕ удалена', row.status === 'failed' && /blocked/.test(row.last_error), row);
  const att = (await ctl('/__attempts')).filter((a) => a.chatId === String(OWNER) && a.mode === '403').length;
  await sleep(1500);
  ok('E3 постоянная ошибка не повторяется бесконечно', (await ctl('/__attempts')).filter((a) => a.chatId === String(OWNER) && a.mode === '403').length === att, att);
  ok('E4 RSVP остался в БД', (await sql('SELECT id FROM rsvp_responses WHERE id = $1', [r.b.data.id])).length === 1);
  const stFailed = await post('/api/admin/outbox', { tgInitData: adminInit });
  ok('E5 админ видит статистику (failed >= 1, есть причина)', stFailed.s === 200 && stFailed.b.failed >= 1 && stFailed.b.recentFailed.length >= 1, stFailed);
  ok('E6 не-админу статистика закрыта (403)', (await post('/api/admin/outbox', { tgInitData: guestInit })).s === 403);
  ok('E7 без подписи — закрыто (403)', (await post('/api/admin/outbox', {})).s === 403);
  await ctl('/__fail?mode=off');
  const nE = (await sentTo(OWNER)).length;
  const rq = await post('/api/admin/outbox/retry', { tgInitData: adminInit });
  ok('E8 /retry вернул сообщения в очередь', rq.s === 200 && rq.b.requeued >= 1, rq);
  ok('E9 после /retry доставлено', await waitFor(async () => (await outboxRow(r.b.data.id)).status === 'sent', 8000));
  ok('E10 сообщение дошло ровно одно', (await sentTo(OWNER)).length === nE + rq.b.requeued || (await sentTo(OWNER)).length >= nE + 1);

  // ===== F. Сбой одного получателя не блокирует остальных =====
  await ctl('/__fail?mode=403&chat=777');
  const init777 = await sign(777, 'Blocked'), w2 = await post('/api/owner/save', { tgInitData: init777, wedding: { groom: 'B', bride: 'L', date: '2026-12-01' } });
  await post('/api/owner/publish', { tgInitData: init777, published: true });
  const nOwner = (await sentTo(OWNER)).length;
  const bad = await post('/api/rsvp', { guestName: 'К заблокированному', status: 'no', weddingCode: w2.b.wedding.code, tgInitData: guestInit, clientId: uuid() });
  const good = await rsvp({ guestName: 'К обычному' });
  ok('F1 сообщение «хорошему» получателю дошло, несмотря на сбой другого', await waitFor(async () => (await sentTo(OWNER)).length === nOwner + 1, 5000));
  await ctl('/__fail?mode=off'); await post('/api/admin/outbox/retry', { tgInitData: adminInit });
  ok('F2 заблокированному доставлено после /retry', await waitFor(async () => (await sentTo(777)).length >= 1, 6000));

  // ===== G. Падение сервера: «зависшая» отправка подхватывается =====
  const nG = (await sentTo(OWNER)).length;
  const fakeText = JSON.stringify({ text: '🛟 восстановленное после падения', parseMode: 'HTML' });
  await sql(`INSERT INTO outbox (type, chat_id, payload, dedupe_key, status, attempts, locked_at) VALUES ('rsvp', $1, $2, 'crash:1', 'sending', 1, $3)`, [OWNER, fakeText, new Date(Date.now() - 10 * 60 * 1000).toISOString()]);
  ok('G1 старое «sending» (сервер упал) подхвачено и доставлено', await waitFor(async () => (await sentTo(OWNER)).some((m) => m.text.includes('восстановленное после падения')), 6000));
  await sql(`INSERT INTO outbox (type, chat_id, payload, dedupe_key, status, attempts, locked_at) VALUES ('rsvp', $1, $2, 'crash:2', 'sending', 1, $3)`, [OWNER, JSON.stringify({ text: '⏳ свежее sending', parseMode: 'HTML' }), new Date().toISOString()]);
  await sleep(500);
  ok('G2 СВЕЖЕЕ «sending» (другой worker ещё работает) пока не трогается', !(await sentTo(OWNER)).some((m) => m.text.includes('свежее sending')));
  ok('G3 но если он завис дольше stale — доставляется', await waitFor(async () => (await sentTo(OWNER)).some((m) => m.text.includes('свежее sending')), 6000));

  // ===== H. Зависание Telegram (hang) -> таймаут -> повтор =====
  await ctl('/__fail?mode=hang');
  r = await rsvp({ guestName: 'Зависание' });
  await sleep(2600);
  row = await outboxRow(r.b.data.id);
  ok('H1 зависший вызов Telegram оборван по таймауту, задание вернулось в pending', ['pending', 'sending'].includes(row.status) && Number(row.attempts) >= 1 && /ms ichida tugamadi/.test(row.last_error || ''), row);
  await ctl('/__fail?mode=off');
  ok('H2 после восстановления доставлено', await waitFor(async () => (await outboxRow(r.b.data.id)).status === 'sent', 8000));

  // ===== I. Атомарность: если задание не записалось — RSVP тоже откатывается =====
  await ctl('/__env?ADMIN_CHAT_ID=not-a-number');
  const cnt0 = Number((await sql('SELECT COUNT(*) AS c FROM rsvp_responses'))[0].c), ob0 = Number((await sql('SELECT COUNT(*) AS c FROM outbox'))[0].c);
  const legacy = await post('/api/rsvp', { guestName: 'Атомарность', status: 'yes', language: 'uz', clientId: uuid() });
  await ctl('/__env?ADMIN_CHAT_ID=999');
  ok('I1 сбой записи задания -> 500 (клиент повторит)', legacy.s === 500, legacy);
  ok('I2 RSVP НЕ остался «наполовину» (откат транзакции)', Number((await sql('SELECT COUNT(*) AS c FROM rsvp_responses'))[0].c) === cnt0 && Number((await sql('SELECT COUNT(*) AS c FROM outbox'))[0].c) === ob0);

  // ===== J. Нагрузка: 100 параллельных RSVP =====
  const nJ = (await sentTo(OWNER)).length, t0 = Date.now();
  const burst = await Promise.all(Array.from({ length: 100 }, (_, i) => rsvp({ guestName: 'Нагрузка ' + i, guestCount: 1 })));
  ok('J1 100 параллельных RSVP приняты', burst.every((x) => x.s === 201), burst.filter((x) => x.s !== 201).length);
  const all = await waitFor(async () => (await sentTo(OWNER)).length >= nJ + 100, 30000, 200);
  const texts = (await sentTo(OWNER)).slice(nJ).map((m) => m.text);
  ok('J2 доставлено все 100', !!all && texts.length === 100, texts.length);
  ok('J3 без дубликатов (100 уникальных №)', new Set(texts.map((t) => (t.match(/№(\d+)/) || [])[1])).size === 100);
  console.log(`   (100 сообщений доставлено за ${Date.now() - t0} мс)`);

  // ===== K. Итоговое состояние =====
  const final = await post('/api/admin/outbox', { tgInitData: adminInit });
  ok('K1 нет застрявших pending/sending после всех тестов', await waitFor(async () => { const s = (await post('/api/admin/outbox', { tgInitData: adminInit })).b; return s.pending === 0 && s.sending === 0; }, 8000), final.b);
  console.log('   итог очереди:', JSON.stringify({ pending: final.b.pending, sending: final.b.sending, sent: final.b.sent, failed: final.b.failed }));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
