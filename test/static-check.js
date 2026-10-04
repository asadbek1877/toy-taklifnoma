// Statik tekshiruv (server va brauzer kerak emas): node test/static-check.js
//  • public/*.js sintaksisi         • i18n to'liqligi (mehmon: uz+ru+ja, egasi: uz+ru)
//  • shablonlar/palitra/shrift butunligi  • index.html havolalari va serverdagi inline ro'yxati mos
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUB = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUB, f), 'utf8');
let fail = 0, pass = 0;
const ok = (name, cond, extra) => { cond ? pass++ : fail++; console.log((cond ? 'PASS ' : 'FAIL ') + name + (cond ? '' : '  -> ' + JSON.stringify(extra))); };

// 1) sintaksis
for (const f of fs.readdirSync(PUB).filter((x) => x.endsWith('.js'))) {
  let err = null;
  try { new vm.Script(read(f), { filename: f }); } catch (e) { err = e.message; }
  ok(`sintaksis: ${f}`, !err, err);
}

// 2) i18n
function loadDict(files) {
  const sandbox = { window: {}, self: {} };
  sandbox.window = sandbox; // window.I18N
  vm.createContext(sandbox);
  files.forEach((f) => vm.runInContext(read(f), sandbox, { filename: f }));
  return sandbox.I18N;
}
const guest = loadDict(['i18n.js']);
const both = loadDict(['i18n.js', 'i18n-owner.js']);
const usedKeys = (files, re) => [...new Set(files.flatMap((f) => [...read(f).matchAll(re)].map((m) => m[1])))];

const guestUsed = usedKeys(['invite.js', 'app.js', 'core.js'], /\bt\(\s*['"]([a-z][A-Za-z0-9_.]+)['"]/g).filter((k) => !k.startsWith('o.'));
// dinamik: t(s === 'yes' ? 'rsvp.yes' : 'rsvp.no'), t(st === 'yes' ? 'rsvp.okYes' : 'rsvp.okNo'), t(label) -> cd.* va data-i18n atributlari
const extra = [...read('invite.js').matchAll(/'((?:rsvp|cd|sec|inv|loc|dress|delivery)\.[A-Za-z]+)'/g)].map((m) => m[1]);
const htmlKeys = [...read('index.html').matchAll(/data-i18n(?:-placeholder|-title)?="([^"]+)"/g)].map((m) => m[1]);
const guestKeys = [...new Set([...guestUsed, ...extra, ...htmlKeys])];
for (const lang of ['uz', 'ru', 'ja']) {
  const missing = guestKeys.filter((k) => !(guest[lang] && guest[lang][k]));
  ok(`i18n mehmon (${lang}): ${guestKeys.length} kalit to'liq`, missing.length === 0, missing);
}
const ownerFiles = ['owner.js', 'owner-content.js', 'owner-guests.js'];
const ownerKeys = new Set(usedKeys(ownerFiles, /['"](o\.[A-Za-z0-9_]+)['"]/g).filter((k) => !k.endsWith('_')));
// dinamik prefikslar: 'o.sub_' + id, 'o.sec_' + id, 'o.intro_' + i, 'o.tone_' + x, k + 'Hint', titleKey + 'Hint'
['basics', 'story', 'schedule', 'location', 'dress', 'menu', 'extra', 'media', 'rsvp', 'sections'].forEach((x) => ownerKeys.add('o.sub_' + x));
['countdown', 'story', 'schedule', 'location', 'dress', 'menu', 'gallery', 'video'].forEach((x) => ownerKeys.add('o.sec_' + x));
['envelope', 'cinematic', 'none'].forEach((x) => ownerKeys.add('o.intro_' + x));
['warm', 'formal', 'playful', 'poetic', 'short'].forEach((x) => ownerKeys.add('o.tone_' + x));
['o.visPublicHint', 'o.visPrivateHint', 'o.videoHint', 'o.musicHint'].forEach((x) => ownerKeys.add(x));
for (const lang of ['uz', 'ru']) {
  const missing = [...ownerKeys].filter((k) => !both[lang][k]);
  ok(`i18n egasi (${lang}): ${ownerKeys.size} kalit to'liq`, missing.length === 0, missing);
}
// {placeholder}'lar uz va ru'da bir xil bo'lsin
const ph = (s) => (String(s).match(/\{\w+\}/g) || []).sort().join();
const badPh = Object.keys(both.uz).filter((k) => both.ru[k] && ph(both.uz[k]) !== ph(both.ru[k]));
ok('i18n: uz va ru\'da {placeholder}\'lar mos', badPh.length === 0, badPh);

// 3) katalog
const C = require(path.join(PUB, 'templates.js'));
ok('shablonlar >= 20', C.TEMPLATES.length >= 20, C.TEMPLATES.length);
ok('shablon id\'lari noyob', new Set(C.TEMPLATES.map((t) => t.id)).size === C.TEMPLATES.length);
ok('har shablon: palitra, shrift, maket, bezak, kirish mavjud', C.TEMPLATES.every((t) => C.PALETTES.some((p) => p.id === t.palette) && C.FONTS.some((f) => f.id === t.font) && C.LAYOUTS.includes(t.layout) && C.ORNAMENTS.includes(t.ornament) && C.INTROS.includes(t.intro)), C.TEMPLATES.filter((t) => !C.PALETTES.some((p) => p.id === t.palette)));
ok('palitralar: to\'g\'ri #RRGGBB', C.PALETTES.every((p) => ['bg', 'surface', 'ink', 'soft', 'accent', 'accent2'].every((k) => /^#[0-9a-f]{6}$/i.test(p[k]))));
ok('shriftlar >= 10, Google Fonts qatori bor', C.FONTS.length >= 10 && C.FONTS.every((f) => f.gf && f.heading && f.body));
ok('har maket kamida bitta shablonda ishlatilgan', C.LAYOUTS.every((l) => C.TEMPLATES.some((t) => t.layout === l)));
const cssText = read('invite.css');
ok('invite.css: har maket uchun qoida bor', C.LAYOUTS.every((l) => cssText.includes(`.tpl-${l}`)), C.LAYOUTS.filter((l) => !cssText.includes(`.tpl-${l}`)));

// 4) index.html va server
const html = read('index.html');
const refs = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]).filter((u) => !u.startsWith('http'));
ok('index.html: havola qilingan fayllar mavjud', refs.every((r) => fs.existsSync(path.join(PUB, r))), refs.filter((r) => !fs.existsSync(path.join(PUB, r))));
const idx = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.js'), 'utf8');
const inlineJs = JSON.parse(idx.match(/INLINE_JS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
const inlineCss = JSON.parse(idx.match(/INLINE_CSS = (\[[^\]]*\])/)[1].replace(/'/g, '"'));
ok('server inline JS ro\'yxati index.html bilan mos (tartib ham)', JSON.stringify(inlineJs) === JSON.stringify(refs.filter((r) => r.endsWith('.js') && r !== 'dev-mock.js')), { inlineJs, refs });
ok('server inline CSS ro\'yxati index.html bilan mos', JSON.stringify(inlineCss) === JSON.stringify(refs.filter((r) => r.endsWith('.css'))), { inlineCss, refs });
const appJs = read('app.js');
ok('app.js: owner fayllari mavjud', ['owner.css', 'i18n-owner.js', 'owner.js', 'owner-content.js', 'owner-guests.js'].every((f) => appJs.includes(f) && fs.existsSync(path.join(PUB, f))));
const ver = idx.match(/\['owner\.js'[^\]]*\]/)[0];
ok('keshni yangilash ro\'yxati barcha owner fayllarini qamraydi', ['owner.js', 'owner-content.js', 'owner-guests.js', 'i18n-owner.js', 'owner.css'].every((f) => ver.includes(f)), ver);

// 5) hajm (mehmon yo'li): bitta sahifa gzip'dan keyin
const zlib = require('zlib');
const bundle = [...inlineCss, ...inlineJs, 'index.html'].map(read).join('\n');
const gz = zlib.gzipSync(bundle).length;
console.log(`   mehmon sahifasi: ${(bundle.length / 1024).toFixed(0)} KB xom, ${(gz / 1024).toFixed(0)} KB gzip`);
ok('mehmon sahifasi gzip bilan < 90 KB', gz < 90 * 1024, gz);
const ownerGz = zlib.gzipSync(['owner.js', 'owner-content.js', 'owner-guests.js', 'i18n-owner.js', 'owner.css'].map(read).join('\n')).length;
console.log(`   egasi paketi (faqat egasiga): ${(ownerGz / 1024).toFixed(0)} KB gzip`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
