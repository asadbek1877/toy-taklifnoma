const API = 'http://localhost:3999', CTL = 'http://localhost:3998';
let pass = 0, fail = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };
const j = (r) => r.json().catch(() => null);
const sign = async (id, name, username) => (await j(await fetch(`${CTL}/__sign?id=${id}&name=${name}&username=${username || ''}`))).initData;
const post = async (path, body) => { const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { s: r.status, b: await j(r) }; };
const sent = async () => j(await fetch(CTL + '/__sent'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const owner = await sign(100, 'Aziz', 'aziz_owner');
  const other = await sign(101, 'Boris', 'boris');
  const guest = await sign(200, 'Guldasta', 'gul');
  const forged = guest.replace(/hash=[0-9a-f]{4}/, 'hash=0000');
  const W = { design: 'rose', groom: 'Aziz', bride: 'Malika', date: '2026-11-15', startsAt: '2026-11-15T09:00:00.000Z',
    ceremonyTime: '14:00', banquetTime: '18:00', venueName: 'Grand Palace', venueAddress: 'Tashkent', mapQuery: 'Grand Palace', message: 'Hi', photo: null };

  // --- авторизация ---
  ok('me без initData -> 401', (await post('/api/weddings/me', {})).s === 401);
  ok('me с подделкой -> 401', (await post('/api/weddings/me', { tgInitData: forged })).s === 401);
  ok('создание без initData -> 401', (await post('/api/weddings', { wedding: W })).s === 401);
  let r = await post('/api/weddings/me', { tgInitData: owner });
  ok('новый владелец: wedding=null', r.s === 200 && r.b.wedding === null, r);

  // --- валидация ---
  ok('нет имён -> 400', (await post('/api/weddings', { tgInitData: owner, wedding: { ...W, groom: '' } })).s === 400);
  ok('плохая дата -> 400', (await post('/api/weddings', { tgInitData: owner, wedding: { ...W, date: '15/11/2026' } })).s === 400);
  ok('фото не JPEG -> 400', (await post('/api/weddings', { tgInitData: owner, wedding: { ...W, photo: 'data:image/svg+xml;base64,AAAA' } })).s === 400);
  ok('фото слишком большое -> 400', (await post('/api/weddings', { tgInitData: owner, wedding: { ...W, photo: 'data:image/jpeg;base64,' + 'A'.repeat(700 * 1024) } })).s === 400);
  ok('неизвестный дизайн -> gold', (await post('/api/weddings', { tgInitData: other, wedding: { ...W, design: 'evil<script>' } })).b.wedding.design === 'gold');

  // --- создание / ссылка ---
  r = await post('/api/weddings', { tgInitData: owner, wedding: W });
  const code = r.b && r.b.wedding && r.b.wedding.code;
  ok('создание -> 200 + код', r.s === 200 && /^[\w-]{6,}$/.test(code), r);
  ok('ссылка = t.me/toygabot?start=w_<код>', r.b.link === `https://t.me/toygabot?start=w_${code}`, r.b.link);
  ok('дизайн сохранён', r.b.wedding.design === 'rose');
  ok('owner_id не утекает в ответ', !JSON.stringify(r.b).includes('owner'), r.b);

  const pub = await j(await fetch(`${API}/api/weddings/${code}`));
  ok('публичный GET по коду работает', pub && pub.wedding && pub.wedding.groom === 'Aziz');
  ok('публичный GET без owner_id', !JSON.stringify(pub).includes('owner'));
  ok('неизвестный код -> 404', (await fetch(`${API}/api/weddings/zzzzzzzz`)).status === 404);

  // --- обновление: код тот же, чужой не может править ---
  r = await post('/api/weddings', { tgInitData: owner, wedding: { ...W, bride: 'Malika-2' } });
  ok('обновление сохраняет код', r.b.wedding.code === code && r.b.wedding.bride === 'Malika-2', r.b);
  const otherMe = await post('/api/weddings/me', { tgInitData: other });
  ok('у другого владельца своя свадьба (другой код)', otherMe.b.wedding && otherMe.b.wedding.code !== code);
  const ownerAgain = await j(await fetch(`${API}/api/weddings/${code}`));
  ok('чужой пользователь не изменил свадьбу владельца', ownerAgain.wedding.bride === 'Malika-2' && ownerAgain.wedding.design === 'rose');

  // --- RSVP гостя ---
  const rs = { guestName: 'Гульдаста', status: 'yes', guestCount: 3, comment: 'Кайфият билан 😎', language: 'ru', weddingCode: code };
  ok('RSVP без initData -> 401', (await post('/api/rsvp', rs)).s === 401);
  ok('RSVP с подделкой -> 401', (await post('/api/rsvp', { ...rs, tgInitData: forged })).s === 401);
  ok('RSVP на несуществующий код -> 404', (await post('/api/rsvp', { ...rs, weddingCode: 'nopenope', tgInitData: guest })).s === 404);
  const before = (await sent()).length;
  r = await post('/api/rsvp', { ...rs, tgInitData: guest });
  ok('RSVP гостя -> 201', r.s === 201 && r.b.success, r);
  ok('в БД: wedding_id и данные гостя', r.b.data.wedding_id && String(r.b.data.guest_tg_id) === '200' && r.b.data.guest_username === 'gul', r.b.data);

  await sleep(700); // доставка асинхронная (outbox worker)
  const msgs = (await sent()).slice(before);
  const toOwner = msgs.filter((m) => m.chatId === '100'), toAdmin = msgs.filter((m) => m.chatId === '999');
  ok('уведомление ушло ВЛАДЕЛЬЦУ (chat 100)', toOwner.length === 1, msgs);
  ok('админу (999) НЕ ушло', toAdmin.length === 0, msgs);
  const txt = toOwner[0] && toOwner[0].text || '';
  ok('в сообщении ник гостя, имя, +2, комментарий, название свадьбы',
    txt.includes('@gul') && txt.includes('Гульдаста') && txt.includes('+2') && txt.includes('Кайфият билан') && txt.includes('Aziz &amp; Malika-2'), txt);
  console.log('\n--- сообщение владельцу ---\n' + txt + '\n---------------------------\n');

  // --- список гостей владельца ---
  await post('/api/rsvp', { guestName: 'Дилноза', status: 'no', language: 'uz', weddingCode: code, tgInitData: await sign(201, 'Dilnoza') });
  r = await post('/api/weddings/me/guests', { tgInitData: owner });
  ok('владелец видит 2 ответа', r.s === 200 && r.b.guests.length === 2, r.b);
  ok('чужой владелец не видит чужих гостей', (await post('/api/weddings/me/guests', { tgInitData: other })).b.guests.length === 0);
  ok('список гостей без initData -> 401', (await post('/api/weddings/me/guests', {})).s === 401);

  // --- старый (browser) поток не сломан ---
  const b2 = (await sent()).length;
  r = await post('/api/rsvp', { guestName: 'Browser Guest', status: 'no', language: 'uz' });
  ok('legacy RSVP без weddingCode -> 201', r.s === 201 && r.b.data.wedding_id === null, r);
  await sleep(700);
  const legacy = (await sent()).slice(b2).filter((m) => m.chatId);
  ok('legacy уведомление -> ADMIN_CHAT_ID (999)', legacy.length === 1 && legacy[0].chatId === '999', legacy);

  // --- /start ---
  const start = async (payload, chat = 300) => j(await fetch(`${CTL}/__start?chat=${chat}${payload ? '&payload=' + encodeURIComponent(payload) : ''}`));
  let m = await start(null);
  ok('/start без параметра -> кнопка Mini App (выбор роли)', m.length === 1 && m[0].opts.reply_markup.inline_keyboard[0][0].web_app.url === 'https://toy-test.onrender.com/app/', m);
  m = await start('w_' + code);
  const url = m[0] && m[0].opts && m[0].opts.reply_markup && m[0].opts.reply_markup.inline_keyboard[0][0].web_app.url;
  ok('/start w_<код> -> кнопка с ?w=<код>', url === `https://toy-test.onrender.com/app/?w=${code}`, m);
  ok('в тексте имена свадьбы', m[0].text.includes('Aziz & Malika-2'), m[0].text);
  m = await start('w_unknown123');
  ok('/start с неизвестным кодом -> сообщение об ошибке без кнопки', m.length === 1 && !m[0].opts, m);
  m = await start('w_<script>');
  ok('/start с мусорным параметром -> обычное приветствие', m.length === 1 && m[0].opts && m[0].opts.reply_markup, m);

  // --- скорость: фото отдельным файлом, одностраничная выдача ---
  const JPG = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/';
  const pw = await post('/api/weddings', { tgInitData: owner, wedding: { ...W, photo: JPG } });
  ok('владелец получает фото data-URL (для редактирования)', pw.b.wedding.photo === JPG && pw.b.wedding.photoUrl, pw.b.wedding && Object.keys(pw.b.wedding));
  const gp = await j(await fetch(`${API}/api/weddings/${code}`));
  ok('гость: фото НЕ внутри JSON (лёгкий ответ)', gp.wedding.photo === undefined && /\/photo\?v=\d+$/.test(gp.wedding.photoUrl), gp.wedding);
  const ph = await fetch(API + gp.wedding.photoUrl);
  ok('фото отдаётся файлом image/jpeg с долгим кэшем', ph.status === 200 && ph.headers.get('content-type') === 'image/jpeg' && /immutable/.test(ph.headers.get('cache-control')), [ph.status, ph.headers.get('content-type'), ph.headers.get('cache-control')]);
  ok('размер фото-файла = исходные байты', (await ph.arrayBuffer()).byteLength === Buffer.from(JPG.split(',')[1], 'base64').length);
  ok('нет фото -> 404 на /photo', (await fetch(`${API}/api/weddings/${otherMe.b.wedding.code}/photo`)).status === 404);
  await post('/api/weddings', { tgInitData: owner, wedding: { ...W, photo: JPG + 'AAAA' } });
  const gp2 = await j(await fetch(`${API}/api/weddings/${code}`));
  ok('v= меняется при новом фото (кэш не залипает)', gp2.wedding.photoUrl !== gp.wedding.photoUrl, [gp.wedding.photoUrl, gp2.wedding.photoUrl]);
  const html = await (await fetch(`${API}/app/`)).text();
  ok('/app/ — одна страница: стили и скрипты вшиты', html.includes('<style>') && !html.includes('href="style.css"') && !html.includes('src="app.js"') && !html.includes('src="i18n.js"') && html.includes('const I18N') && html.includes('async function boot'), html.length);
  ok('/app/ — ранний prefetch на месте', html.includes('window.__prefetch'));
  console.log('размер /app/ без сжатия:', html.length, 'байт');

  // --- настройка бота при старте ---
  const all = await j(await fetch(CTL + '/__all'));
  const mb = all.find((m) => m.method === 'setChatMenuButton');
  let parsed = null; try { parsed = typeof mb.p.menu_button === 'string' && JSON.parse(mb.p.menu_button); } catch (e) {}
  ok('menu_button передан JSON-СТРОКОЙ (иначе Telegram вернёт 400)', parsed && parsed.type === 'web_app' && parsed.web_app.url === 'https://toy-test.onrender.com/app/', mb);
  ok('команда /start зарегистрирована', all.some((m) => m.method === 'setMyCommands'));
  ok('описание бота задано (3 языка)', all.filter((m) => m.method === 'setMyDescription').length === 3);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('CRASH', e); process.exit(2); });
