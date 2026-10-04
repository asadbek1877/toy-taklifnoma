/* core.js — umumiy yadro: Telegram, API, til, DOM yordamchilari, ishonchli RSVP navbati, konfetti.
   Hamma narsa window.Core ostida. Mehmon va egasi ilovasi shu yadroga tayanadi. */
(function () {
  const BACKEND_URL = window.BACKEND_URL || 'https://toy-taklifnoma.onrender.com';

  // ---------- Telegram ----------
  const tg = window.Telegram && window.Telegram.WebApp;
  const tgInitData = tg && tg.initData ? tg.initData : null;
  const tgUser = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
  const inTelegram = !!tgInitData;
  const safe = (fn) => { try { return fn(); } catch (e) { /* eski klientda yo'q */ } };
  const haptic = (kind, style) => {
    if (!tg || !tg.HapticFeedback) return;
    safe(() => (kind === 'notify' ? tg.HapticFeedback.notificationOccurred(style) : tg.HapticFeedback.impactOccurred(style || 'light')));
  };
  if (tg) {
    safe(() => tg.ready());
    safe(() => tg.expand());
    safe(() => tg.disableVerticalSwipes && tg.disableVerticalSwipes());
  }
  if (inTelegram) document.body.classList.add('in-telegram');

  // ---------- BackButton (bitta joyda boshqariladi: ichma-ich ekran/varaqlar uchun stek) ----------
  const backStack = [];
  function syncBack() {
    if (!tg) return;
    safe(() => (backStack.length ? tg.BackButton.show() : tg.BackButton.hide()));
  }
  if (tg) safe(() => tg.BackButton.onClick(() => { haptic('impact', 'light'); const fn = backStack[backStack.length - 1]; if (fn) fn(); }));
  const back = {
    push(fn) { backStack.push(fn); syncBack(); return fn; },
    pop(fn) { const i = backStack.lastIndexOf(fn); if (i >= 0) backStack.splice(i, 1); syncBack(); },
    clear() { backStack.length = 0; syncBack(); },
  };

  // ---------- MainButton ----------
  let mainFn = null;
  if (tg) safe(() => tg.MainButton.onClick(() => mainFn && mainFn()));
  const main = {
    set(text, fn, color) {
      mainFn = fn;
      if (!tg) return;
      safe(() => tg.MainButton.setParams({ text, color: color || getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#b89443', text_color: '#ffffff' }));
      safe(() => tg.MainButton.show());
    },
    loading(on) { if (tg) safe(() => (on ? tg.MainButton.showProgress() : tg.MainButton.hideProgress())); },
    hide() { mainFn = null; if (tg) safe(() => tg.MainButton.hide()); },
  };

  let closing = false;
  function confirmClose(on) {
    if (on === closing) return;
    closing = on;
    if (tg) safe(() => (on ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation()));
  }

  function setChrome(bg) {
    safe(() => { tg.setHeaderColor(bg); tg.setBackgroundColor(bg); tg.setBottomBarColor && tg.setBottomBarColor(bg); });
  }

  // ---------- API ----------
  async function api(path, body, opts = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), opts.timeout || 15000);
    let res;
    try {
      res = await fetch(BACKEND_URL + path, body === undefined ? { signal: ctrl.signal } : {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Tg-Init-Data': tgInitData || '' }, body: JSON.stringify({ tgInitData, ...body }), signal: ctrl.signal, // sarlavha: yuklash route'lari tanani o'qishdan oldin tekshiradi
      });
    } finally { clearTimeout(timer); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* bo'sh javob */ }
    if (!res.ok) { const err = new Error((data && (data.message || data.error)) || 'HTTP ' + res.status); err.status = res.status; err.data = data; throw err; }
    return data;
  }

  // Xom yuklash (video/audio) — XHR: yuklash progressi uchun
  function upload(path, blob, onProgress) {
    return new Promise((resolve, reject) => {
      const x = new XMLHttpRequest();
      x.open('POST', BACKEND_URL + path);
      x.setRequestHeader('X-Tg-Init-Data', tgInitData || '');
      x.setRequestHeader('Content-Type', 'application/octet-stream');
      x.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      x.onload = () => {
        let data = null; try { data = JSON.parse(x.responseText); } catch (e) { /* */ }
        if (x.status >= 200 && x.status < 300) resolve(data);
        else { const err = new Error((data && data.error) || 'HTTP ' + x.status); err.status = x.status; err.data = data; reject(err); }
      };
      x.onerror = () => reject(new Error('network'));
      x.ontimeout = () => reject(new Error('timeout'));
      x.timeout = 120000;
      x.send(blob);
    });
  }

  // ---------- Til ----------
  const LANGS = ['uz', 'ru', 'ja'];
  const LOCALE = { uz: 'uz-UZ', ru: 'ru-RU', ja: 'ja-JP' };
  function initialLang() {
    let saved = null;
    try { saved = localStorage.getItem('wedding_lang'); } catch (e) { /* */ }
    if (LANGS.includes(saved)) return saved;
    const code = tgUser && tgUser.language_code ? tgUser.language_code.slice(0, 2).toLowerCase() : '';
    return LANGS.includes(code) ? code : 'uz';
  }
  let lang = initialLang();
  const langListeners = [];
  // Zanjir: tanlangan til -> ru -> uz -> kalit (egasi interfeysi uz/ru da to'liq; yaponcha mehmon matnlari to'liq)
  function t(key, vars) {
    const D = window.I18N || {};
    let s = (D[lang] && D[lang][key]) || (D.ru && D.ru[key]) || (D.uz && D.uz[key]) || key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] != null ? vars[k] : m));
    return s;
  }
  function setLang(l, persist) {
    if (!LANGS.includes(l)) return;
    lang = l;
    document.documentElement.lang = l;
    if (persist) { try { localStorage.setItem('wedding_lang', l); } catch (e) { /* */ } }
    applyDom(document);
    langListeners.forEach((fn) => safe(() => fn(l)));
  }
  // data-i18n / data-i18n-placeholder / data-i18n-title / data-i18n-aria
  function applyDom(root) {
    root.querySelectorAll('[data-i18n]').forEach((e) => { e.textContent = t(e.dataset.i18n); });
    root.querySelectorAll('[data-i18n-placeholder]').forEach((e) => e.setAttribute('placeholder', t(e.dataset.i18nPlaceholder)));
    root.querySelectorAll('[data-i18n-title]').forEach((e) => e.setAttribute('title', t(e.dataset.i18nTitle)));
  }

  // Sanani formatlash: o'zbekcha oy nomlari ko'p WebView'larda yo'q — o'zimiz yozamiz
  const UZ_MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avgust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
  function formatDate(date, l) {
    if (!date) return '';
    const [y, m, d] = date.split('-').map(Number);
    const L = l || lang;
    if (L === 'uz') return `${d}-${UZ_MONTHS[m - 1]}, ${y}`;
    try { return new Intl.DateTimeFormat(LOCALE[L], { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${date}T12:00:00Z`)); }
    catch (e) { return date; }
  }

  // ---------- DOM yordamchilari ----------
  // h('div', {class:'a', onclick:fn, dataset:{x:1}}, 'matn', child...) — hamma matn textContent orqali (XSS yo'q)
  function h(tag, attrs, ...children) {
    const e = tag === 'svg' || (attrs && attrs.ns) ? document.createElementNS('http://www.w3.org/2000/svg', tag) : document.createElement(tag);
    if (attrs) for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false || k === 'ns') continue;
      if (k === 'class') e.setAttribute('class', v);
      else if (k === 'style' && typeof v === 'object') { for (const [sk, sv] of Object.entries(v)) { if (sk.startsWith('--')) e.style.setProperty(sk, sv); else e.style[sk] = sv; } } // --var uchun setProperty shart
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'html') throw new Error('html atributi taqiqlangan');
      else e.setAttribute(k, v === true ? '' : v);
    }
    const add = (c) => {
      if (c == null || c === false) return;
      if (Array.isArray(c)) return c.forEach(add);
      e.append(c instanceof Node ? c : document.createTextNode(String(c)));
    };
    children.forEach(add);
    return e;
  }
  const $ = (id) => document.getElementById(id);
  const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

  function toast(msg, kind) {
    let box = $('toasts');
    if (!box) { box = h('div', { id: 'toasts', 'aria-live': 'polite' }); document.body.append(box); }
    const el = h('div', { class: 'toast' + (kind ? ' ' + kind : '') }, msg);
    box.append(el);
    setTimeout(() => el.classList.add('out'), 2600);
    setTimeout(() => el.remove(), 3100);
  }

  // Shrift: bitta Google Fonts so'rovi, faqat tanlanganlar (tezlik)
  const loadedFonts = new Set();
  function loadFont(font) {
    if (!font || loadedFonts.has(font.id)) return;
    loadedFonts.add(font.id);
    document.head.append(h('link', { rel: 'stylesheet', href: `https://fonts.googleapis.com/css2?family=${font.gf}&display=swap` }));
  }

  // Tema + shriftni elementga CSS o'zgaruvchi sifatida qo'llash (preview va to'liq taklifnoma birga yashasin)
  function applyTheme(el, theme, fontId) {
    const C = window.CATALOG;
    const f = C.getFont(fontId);
    loadFont(f);
    const set = (k, v) => el.style.setProperty(k, v);
    set('--bg', theme.bg); set('--surface', theme.surface); set('--ink', theme.ink); set('--soft', theme.soft);
    set('--accent', theme.accent); set('--accent2', theme.accent2);
    set('--font-h', f.heading); set('--font-b', f.body);
    const hex = (c) => { const n = parseInt(c.slice(1), 16); return `${n >> 16}, ${(n >> 8) & 255}, ${n & 255}`; };
    set('--accent-rgb', hex(theme.accent)); set('--bg-rgb', hex(theme.bg)); set('--ink-rgb', hex(theme.ink)); set('--surface-rgb', hex(theme.surface));
    set('--grad', `linear-gradient(135deg, ${theme.accent} 0%, ${theme.accent2} 100%)`);
    el.dataset.dark = isDark(theme.bg) ? '1' : '0';
  }
  function isDark(c) { const n = parseInt(c.slice(1), 16); return ((n >> 16) * 299 + ((n >> 8) & 255) * 587 + (n & 255) * 114) / 1000 < 128; }

  // ---------- Konfetti (kutubxonasiz, yengil canvas) ----------
  function confetti(root, opts = {}) {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cv = h('canvas', { class: 'confetti' });
    (root || document.body).append(cv);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const W = (cv.width = cv.clientWidth * dpr), H = (cv.height = cv.clientHeight * dpr);
    const ctx = cv.getContext('2d');
    const colors = opts.colors || ['#f4c95d', '#e07a9f', '#7bd3c1', '#8ab4ff', '#ffffff', '#c9a95c'];
    const n = opts.count || 110;
    const ps = Array.from({ length: n }, () => ({
      x: (opts.x != null ? opts.x : 0.5) * W + (Math.random() - 0.5) * W * 0.3, y: (opts.y != null ? opts.y : 0.35) * H,
      vx: (Math.random() - 0.5) * 14 * dpr, vy: (-Math.random() * 13 - 4) * dpr, g: (0.32 + Math.random() * 0.2) * dpr,
      r: (4 + Math.random() * 6) * dpr, rot: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0], shape: Math.random() < 0.5 ? 0 : 1,
    }));
    let frames = 0;
    (function tick() {
      ctx.clearRect(0, 0, W, H);
      ps.forEach((p) => {
        p.vy += p.g; p.x += p.vx; p.y += p.vy; p.vx *= 0.99; p.rot += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c;
        ctx.globalAlpha = Math.max(0, 1 - frames / 150);
        if (p.shape) ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2); else { ctx.beginPath(); ctx.arc(0, 0, p.r / 2, 0, 6.28); ctx.fill(); }
        ctx.restore();
      });
      if (++frames < 150) requestAnimationFrame(tick); else cv.remove();
    })();
  }

  // ---------- RSVP: ishonchli navbat (qurilmada saqlanadi, serverdan tasdiq kelguncha qayta yuboriladi) ----------
  const QKEY = 'rsvp_queue_v2';
  const loadQ = () => { try { const q = JSON.parse(localStorage.getItem(QKEY) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } };
  let queue = loadQ();
  const persistQ = () => { try { localStorage.setItem(QKEY, JSON.stringify(queue)); } catch (e) { /* xotirada davom */ } };
  const newId = () => (window.crypto && crypto.randomUUID ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12));
  const qListeners = [];
  let flushing = false, retryTimer = null;

  async function flushQueue() {
    if (flushing) return;
    flushing = true; clearTimeout(retryTimer);
    let retry = false;
    try {
      for (const item of queue.filter((i) => i.state === 'pending')) {
        try {
          await api('/api/rsvp', { ...item.payload, clientId: item.clientId });
          queue = queue.filter((i) => i !== item); persistQ(); // faqat server tasdig'idan keyin
        } catch (err) {
          item.tries = (item.tries || 0) + 1; item.lastError = String(err && err.message).slice(0, 120);
          if (err && [400, 403, 404, 409].includes(err.status)) { item.state = 'rejected'; item.reason = err.data && err.data.error; } else retry = true;
          persistQ();
        }
      }
    } finally { flushing = false; qListeners.forEach((fn) => safe(fn)); }
    if (retry) {
      const worst = Math.max(...queue.filter((i) => i.state === 'pending').map((i) => i.tries || 1));
      retryTimer = setTimeout(flushQueue, Math.min(2000 * 2 ** Math.min(worst - 1, 5), 60000));
    }
  }
  window.addEventListener('online', flushQueue);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) flushQueue(); });
  const rsvpQueue = {
    submit(payload) { const item = { clientId: newId(), createdAt: Date.now(), state: 'pending', tries: 0, payload }; queue.push(item); persistQ(); flushQueue(); return item.clientId; },
    // 'sent' | 'pending' | 'rejected'
    status(id) { const i = queue.find((x) => x.clientId === id); return !i ? 'sent' : i.state; },
    reason(id) { const i = queue.find((x) => x.clientId === id); return i && i.reason; },
    pendingFor(key) { return queue.find((i) => i.state === 'pending' && (i.payload.guestToken === key || i.payload.weddingCode === key)); },
    onChange(fn) { qListeners.push(fn); },
    flush: flushQueue,
  };

  window.Core = {
    BACKEND_URL, tg, tgInitData, tgUser, inTelegram, safe, haptic, back, main, confirmClose, setChrome,
    api, upload, LANGS, t, setLang, getLang: () => lang, onLang: (fn) => langListeners.push(fn), applyDom, formatDate,
    h, $, clear, toast, loadFont, applyTheme, isDark, confetti, rsvpQueue,
  };
})();
