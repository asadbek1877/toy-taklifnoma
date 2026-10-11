/* owner.js — egasi/hammuallif kabineti: yadro (holat, avtosaqlash, UI-kit), yaratish ustasi, Bosh, Dizayn, Yana (nashr, maxfiylik,
   bildirishnoma, eslatma, hammuallif). Kontent muharriri — owner-content.js, mehmonlar/statistika — owner-guests.js. */
(function () {
  const { h, t, $, api, haptic, toast, safe, clear, formatDate, tg } = Core;
  const C = window.CATALOG;

  // ================= HOLAT =================
  const S = {
    root: null, me: null, draft: null, role: 'owner', version: 0, links: null, members: [], media: { items: [], usage: 0, quota: 0 },
    tab: 'home', dirty: false, saving: false, again: false, status: 'saved', saveTimer: null, retryTimer: null, an: null, onExit: null, polling: null, lastEvent: 0,
  };
  const ns = { S, screens: {}, ui: {}, refresh: {} };
  window.OwnerApp = ns;
  const tgId = () => (Core.tgUser && Core.tgUser.id) || 'x';
  const BKEY = () => `owner_draft_v2_${tgId()}`;

  // ---------- yo'l bo'yicha o'qish/yozish (draft.content.location.name) ----------
  const getp = (o, p) => p.split('.').reduce((a, k) => (a == null ? a : a[k]), o);
  function setp(o, p, v) { const ks = p.split('.'); const last = ks.pop(); const tgt = ks.reduce((a, k) => a[k], o); tgt[last] = v; }
  ns.getp = (p) => getp(S.draft, p);
  ns.setp = (p, v) => { setp(S.draft, p, v); touch(); };

  // ================= AVTOSAQLASH (tarmoq uzilsa ham yo'qolmaydi: lokal nusxa + qayta urinish) =================
  const statusEl = h('span', { class: 'o-status' });
  function setStatus(kind) {
    S.status = kind;
    const map = { saved: ['✓', 'o.saved'], saving: ['…', 'o.saving'], dirty: ['•', 'o.unsaved'], offline: ['⚠', 'o.offline'], error: ['⚠', 'o.saveError'] };
    const [ico, key] = map[kind] || map.saved;
    statusEl.className = 'o-status ' + kind;
    statusEl.textContent = `${ico} ${t(key)}`;
    Core.confirmClose(kind !== 'saved');
  }
  function persistLocal() { try { localStorage.setItem(BKEY(), JSON.stringify({ draft: S.draft, base: S.version, dirty: S.dirty, code: S.draft.code, at: Date.now() })); } catch (e) { /* */ } }
  function clearLocal() { try { localStorage.removeItem(BKEY()); } catch (e) { /* */ } }

  // Bo'lim kontenti bo'sh -> to'ldirilgan bo'lganda o'zi yoqiladi (egasi keyin qo'lda o'chirsa — hurmat qilinadi)
  const hasContent = (c) => ({
    story: c.story.length > 0, schedule: c.schedule.length > 0, menu: c.menu.length > 0, gallery: c.gallery.length > 0, video: !!c.video.mediaId,
    location: !!(c.location.name || c.location.address || c.location.mapQuery), dress: !!(c.dress.text || c.dress.colors.length || c.dress.dos || c.dress.donts),
  });
  function autoSections() {
    const c = S.draft.content, now = hasContent(c);
    const prev = S.prevHas || (S.prevHas = hasContent(c));
    for (const id of Object.keys(now)) {
      if (now[id] && prev[id] === false) { const sec = c.sections.find((x) => x.id === id); if (sec) sec.on = true; }
      prev[id] = now[id];
    }
  }
  function touch() {
    autoSections();
    S.dirty = true; persistLocal(); setStatus('dirty');
    clearTimeout(S.saveTimer); S.saveTimer = setTimeout(() => save(false), 1200);
    schedulePreview();
  }
  ns.touch = touch;

  async function save(force) {
    if (!S.draft || (!S.dirty && !force)) return;
    if (S.saving) { S.again = true; return; }
    S.saving = true; setStatus('saving'); clearTimeout(S.retryTimer);
    const snapshot = JSON.stringify(S.draft);
    try {
      const r = await api('/api/owner/save', { wedding: S.draft, base: S.version, force: !!force }, { timeout: 20000 });
      S.version = r.version; S.links = r.links;
      if (JSON.stringify(S.draft) === snapshot) { S.dirty = false; clearLocal(); setStatus('saved'); } else { S.again = true; }
    } catch (e) {
      if (e.status === 409 && e.data && e.data.wedding) conflict(e.data.wedding);
      else if (e.status === 400) { setStatus('error'); toast(e.message || t('o.saveError'), 'err'); }
      else if (e.status === 401) { setStatus('error'); toast(t('o.sessionExpired'), 'err'); } // Telegram imzosi eskirgan (24 soat) — o'zgarishlar lokal saqlangan, qayta ochilganda yuboriladi
      else { setStatus('offline'); S.retryTimer = setTimeout(() => save(false), 6000); } // tarmoq: ma'lumot lokal saqlangan, qayta uriniladi
    } finally {
      S.saving = false;
      if (S.again) { S.again = false; clearTimeout(S.saveTimer); S.saveTimer = setTimeout(() => save(false), 300); }
    }
  }
  ns.save = save;
  window.addEventListener('online', () => { if (S.dirty) save(false); });

  function conflict(latest) {
    setStatus('dirty');
    const body = h('div', { class: 'o-col' },
      h('p', { class: 'o-muted' }, t('o.conflictText')),
      ui.btn(t('o.useLatest'), () => { S.draft = latest; S.version = latest.version; S.dirty = false; clearLocal(); setStatus('saved'); sheetCtl.close(); renderTab(); }, 'ghost'),
      ui.btn(t('o.keepMine'), () => { sheetCtl.close(); save(true); }, 'primary'));
    const sheetCtl = ui.sheet(t('o.conflictTitle'), body);
  }

  // ================= UI-KIT =================
  const ui = ns.ui;
  ui.btn = (label, onClick, cls = 'primary', extra) => h('button', { type: 'button', class: `o-btn ${cls}`, onclick: (e) => { haptic('impact', 'light'); onClick(e); }, ...extra }, label);
  ui.card = (...kids) => h('div', { class: 'o-card' }, ...kids);
  ui.title = (txt, sub) => h('div', { class: 'o-title' }, h('h2', null, txt), sub && h('p', null, sub));
  ui.field = (label, control, hint) => h('label', { class: 'o-field' }, h('span', { class: 'o-label' }, label), control, hint && h('span', { class: 'o-hint' }, hint));
  ui.input = (path, opts = {}) => {
    const el = h('input', { type: opts.type || 'text', class: 'o-input', value: getp(S.draft, path) || '', placeholder: opts.placeholder || '', maxlength: opts.maxlength || 200, inputmode: opts.inputmode, autocomplete: 'off' });
    el.addEventListener('input', () => { setp(S.draft, path, el.value); touch(); });
    return el;
  };
  ui.text = (path, opts = {}) => {
    const el = h('textarea', { class: 'o-input', rows: opts.rows || 3, placeholder: opts.placeholder || '', maxlength: opts.maxlength || 1500 }, getp(S.draft, path) || '');
    el.addEventListener('input', () => { setp(S.draft, path, el.value); touch(); });
    return el;
  };
  // Obyekt/massiv elementiga bog'langan (yo'l emas, to'g'ridan-to'g'ri qiymat)
  ui.bound = (obj, key, opts = {}) => {
    const area = opts.area;
    const el = h(area ? 'textarea' : 'input', { class: 'o-input', ...(area ? { rows: opts.rows || 3 } : { type: opts.type || 'text' }), placeholder: opts.placeholder || '', maxlength: opts.maxlength || 200 });
    if (area) el.textContent = obj[key] || ''; else el.value = obj[key] || '';
    el.addEventListener('input', () => { obj[key] = el.value; touch(); });
    return el;
  };
  ui.toggle = (label, get, set, desc) => {
    const sw = h('button', { type: 'button', class: 'o-switch' + (get() ? ' on' : ''), role: 'switch', 'aria-checked': String(!!get()) }, h('i', null));
    const row = h('div', { class: 'o-toggle', onclick: () => { const v = !get(); set(v); sw.classList.toggle('on', v); sw.setAttribute('aria-checked', String(v)); haptic('impact', 'light'); } },
      h('div', null, h('b', null, label), desc && h('small', null, desc)), sw);
    return row;
  };
  ui.chips = (items, get, set, cls = '') => {
    const wrap = h('div', { class: 'o-chips ' + cls });
    const paint = () => [...wrap.children].forEach((c, i) => c.classList.toggle('on', items[i].id === get()));
    items.forEach((it) => wrap.append(h('button', { type: 'button', class: 'o-chip', onclick: () => { set(it.id); paint(); haptic('impact', 'light'); } }, it.label)));
    paint();
    return wrap;
  };
  ui.spinner = () => h('div', { class: 'o-spin' }, h('i'));
  ui.empty = (ico, txt) => h('div', { class: 'o-empty' }, h('div', null, ico), h('p', null, txt));

  // Pastki varaq (bottom sheet) — BackButton bilan yopiladi
  let leafletP = null;
  ns.loadLeaflet = () => leafletP || (leafletP = new Promise((res, rej) => {
    if (window.L && window.L.map) return res();
    document.head.append(h('link', { rel: 'stylesheet', href: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css' }));
    const s = h('script', { src: 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js' }); s.onload = res; s.onerror = () => { leafletP = null; rej(new Error('leaflet')); }; document.head.append(s);
  }));
  // Sana tanlagich: tizim oynasi o'rniga o'zimizning shisha taqvim
  ui.dateInput = (get, set, title) => {
    const val = h('span', null);
    const paint = () => { val.textContent = get() ? Core.formatDate(get()) : '—'; btn.classList.toggle('empty', !get()); };
    const btn = h('button', { type: 'button', class: 'o-input o-time', onclick: () => open() }, val,
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', ns: true })));
    const iso = (y, m, d) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    function open() {
      haptic('impact', 'light');
      const cur = get() ? new Date(`${get()}T12:00:00`) : new Date();
      let Y = cur.getFullYear(), M = cur.getMonth();
      const todayD = new Date(), todayIso = iso(todayD.getFullYear(), todayD.getMonth(), todayD.getDate());
      const title2 = h('div', { class: 'cal-title' }), grid = h('div', { class: 'cal-grid' });
      const ru = Core.getLang() === 'ru';
      const MONTHS = ru ? ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь'] : ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentyabr', 'Oktyabr', 'Noyabr', 'Dekabr'];
      const wd = ru ? ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] : ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya'];
      let ctl;
      const draw = (dir) => {
        title2.textContent = `${MONTHS[M]} ${Y}`;
        clear(grid);
        wd.forEach((w) => grid.append(h('span', { class: 'cal-wd' }, w)));
        const first = (new Date(Y, M, 1).getDay() + 6) % 7, days = new Date(Y, M + 1, 0).getDate();
        for (let i = 0; i < first; i++) grid.append(h('span'));
        for (let d = 1; d <= days; d++) {
          const v = iso(Y, M, d);
          grid.append(h('button', { type: 'button', class: 'cal-d' + (v === get() ? ' on' : '') + (v === todayIso ? ' today' : ''), onclick: () => { set(v); paint(); haptic('notify', 'success'); setTimeout(() => ctl.close(), 160); } }, String(d)));
        }
        grid.classList.remove('l', 'r'); void grid.offsetWidth; if (dir) grid.classList.add(dir > 0 ? 'r' : 'l');
      };
      const nav = (d) => { M += d; if (M < 0) { M = 11; Y--; } if (M > 11) { M = 0; Y++; } haptic('impact', 'light'); draw(d); };
      const arrow = (d, path) => h('button', { type: 'button', class: 'cal-nav', 'aria-label': d < 0 ? 'Prev' : 'Next', onclick: () => nav(d) }, h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: path, ns: true })));
      draw(0);
      ctl = ui.sheet(title || t('o.date'), h('div', { class: 'o-col' },
        h('div', { class: 'cal-head' }, arrow(-1, 'M15 5l-7 7 7 7'), title2, arrow(1, 'M9 5l7 7-7 7')), grid,
        h('div', { class: 'o-row2' }, ui.btn(t('o.cancel'), () => ctl.close(), 'ghost'), ui.btn(t('o.todayBtn'), () => { Y = todayD.getFullYear(); M = todayD.getMonth(); set(todayIso); paint(); haptic('notify', 'success'); setTimeout(() => ctl.close(), 160); }, 'primary'))));
    }
    paint(); return btn;
  };
  ui.timeInput = (get, set, title) => {
    const val = h('span', null);
    const paint = () => { val.textContent = get() || '--:--'; btn.classList.toggle('empty', !get()); };
    const btn = h('button', { type: 'button', class: 'o-input o-time', onclick: () => open() }, val,
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0z', ns: true })));
    function open() {
      haptic('impact', 'light');
      const [hh, mm] = (get() || '14:00').split(':').map(Number);
      let H = hh, M = mm;
      const col = (n, step, cur, onPick) => {
        const items = []; for (let i = 0; i < n; i += step) items.push(i);
        const el = h('div', { class: 'tw-col' }, h('div', { class: 'tw-pad' }), ...items.map((i) => h('div', { class: 'tw-it', dataset: { v: i } }, String(i).padStart(2, '0'))), h('div', { class: 'tw-pad' }));
        let last = -1, timer = null;
        const pick = () => { const idx = Math.round(el.scrollTop / 44); const v = items[Math.max(0, Math.min(items.length - 1, idx))]; [...el.querySelectorAll('.tw-it')].forEach((x) => x.classList.toggle('on', Number(x.dataset.v) === v)); if (v !== last) { if (last !== -1) haptic('impact', 'light'); last = v; onPick(v); } };
        el.addEventListener('scroll', () => { clearTimeout(timer); timer = setTimeout(pick, 60); requestAnimationFrame(pick); }, { passive: true });
        requestAnimationFrame(() => { const i = Math.max(0, items.indexOf(items.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a)))); el.scrollTop = i * 44; pick(); });
        return el;
      };
      const wheel = h('div', { class: 'tw' }, col(24, 1, H, (v) => { H = v; }), h('span', { class: 'tw-sep' }, ':'), col(60, 5, M, (v) => { M = v; }), h('i', { class: 'tw-band' }));
      const ctl = ui.sheet(title || t('o.time'), h('div', { class: 'o-col' }, wheel,
        h('div', { class: 'o-row2' }, ui.btn(t('o.remove'), () => { set(null); paint(); ctl.close(); }, 'ghost'), ui.btn(t('o.ok'), () => { set(`${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}`); paint(); haptic('notify', 'success'); ctl.close(); }, 'primary'))));
    }
    paint(); return btn;
  };
  ui.sheet = (title, content, opts = {}) => {
    const ov = h('div', { class: 'o-sheet-ov' });
    const closeBtn = h('button', { type: 'button', class: 'o-sheet-x', 'aria-label': 'Close' }, '✕');
    const body = h('div', { class: 'o-sheet-body' }, content);
    const sh = h('div', { class: 'o-sheet' + (opts.tall ? ' tall' : '') }, h('div', { class: 'o-sheet-grab' }), h('div', { class: 'o-sheet-head' }, h('h3', null, title), closeBtn), body);
    ov.append(sh);
    let closed = false;
    const ctl = {
      close() { if (closed) return; closed = true; Core.back.pop(ctl.close); ov.classList.add('out'); setTimeout(() => ov.remove(), 260); if (opts.onClose) opts.onClose(); },
      body,
    };
    closeBtn.onclick = ctl.close;
    ov.addEventListener('click', (e) => { if (e.target === ov) ctl.close(); });
    S.root.append(ov); Core.back.push(ctl.close);
    requestAnimationFrame(() => ov.classList.add('in'));
    return ctl;
  };
  ui.confirm = (text, okLabel, danger) => new Promise((resolve) => {
    let done = false;
    const fin = (v) => { if (done) return; done = true; ctl.close(); resolve(v); };
    const ctl = ui.sheet(text, h('div', { class: 'o-col' }, ui.btn(okLabel || t('o.ok'), () => fin(true), danger ? 'danger' : 'primary'), ui.btn(t('o.cancel'), () => fin(false), 'ghost')), { onClose: () => { if (!done) { done = true; resolve(false); } } });
  });

  // Nusxalash / Telegram'da ulashish
  ui.copy = async (text) => {
    try { await navigator.clipboard.writeText(text); } catch (e) {
      const ta = h('textarea', null, text); document.body.append(ta); ta.select(); safe(() => document.execCommand('copy')); ta.remove();
    }
    haptic('notify', 'success'); toast(t('o.copied'));
  };
  ui.share = (url, text) => {
    haptic('impact', 'medium');
    const link = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text || '')}`;
    if (tg && tg.openTelegramLink) safe(() => tg.openTelegramLink(link)); else window.open(link, '_blank', 'noopener');
  };
  ui.err = (e) => toast(e && e.status === 0 ? t('o.network') : t('o.error'), 'err');

  // ================= JONLI PREVIEW =================
  function previewInvite() {
    const d = S.draft, media = {};
    S.media.items.forEach((m) => { media[m.id] = { kind: m.kind, url: m.url, thumb: m.thumb }; });
    return { code: d.code, template: d.template, theme: d.theme, font: d.font, groom: d.groom || '—', bride: d.bride || '—', date: d.date, startsAt: d.startsAt,
      ceremonyTime: d.ceremonyTime, banquetTime: d.banquetTime, message: d.message, content: d.content, media, legacyPhotoUrl: null, private: d.visibility === 'private', guest: null };
  }
  const previewSlots = new Set(); // ekrandagi mini-preview konteynerlari
  let prevTimer = null;
  function schedulePreview() { clearTimeout(prevTimer); prevTimer = setTimeout(() => previewSlots.forEach((fn) => safe(fn)), 220); }
  ns.schedulePreview = schedulePreview;

  // Telefon ramkasidagi kichraytirilgan jonli taklifnoma
  ui.phone = (scale = 0.5) => {
    const W = 375, Hh = 700;
    const screen = h('div', { class: 'o-phone-screen', style: { width: W + 'px', height: Hh + 'px', transform: `scale(${scale})` } });
    const frame = h('div', { class: 'o-phone', style: { width: W * scale + 'px', height: Hh * scale + 'px' } }, screen);
    let ctrl = null, lastScroll = 0, first = true;
    const paint = () => {
      // Birinchi chizish DOM'ga qo'shilishidan oldin bo'ladi; keyingilarida ekrandan ketgan bo'lsa to'xtatamiz
      if (!first && !frame.isConnected) { previewSlots.delete(paint); return; }
      first = false;
      if (ctrl) lastScroll = ctrl.scroll.scrollTop;
      ctrl = Invite.render(screen, previewInvite(), { preview: true });
      ctrl.scroll.style.scrollBehavior = 'auto'; ctrl.scroll.scrollTop = lastScroll;
    };
    previewSlots.add(paint); paint();
    return frame;
  };

  // To'liq ekran preview (+ kirish animatsiyasini ko'rish)
  ui.fullPreview = (opts = {}) => {
    const holder = h('div', { class: 'o-fullpre-in' });
    const ov = h('div', { class: 'o-fullpre' }, holder,
      h('button', { class: 'o-fullpre-x', type: 'button', onclick: () => close() }, '✕'),
      h('button', { class: 'o-fullpre-intro', type: 'button', onclick: () => { draw(true); } }, '▶ ' + t('o.replayIntro')));
    let ctrl = null;
    const draw = (demo) => { if (ctrl) ctrl.destroy(); ctrl = Invite.render(holder, previewInvite(), { preview: true, demoIntro: !!demo }); };
    const close = () => { if (ctrl) ctrl.destroy(); Core.back.pop(close); ov.remove(); document.body.dataset.invdark = '0'; };
    S.root.append(ov); draw(!!opts.demo); Core.back.push(close);
  };

  // ================= RASM TAYYORLASH / YUKLASH =================
  ns.resizeJpeg = (file, max, quality, limitBytes) => new Promise((resolve, reject) => {
    const img = new Image(); const url = URL.createObjectURL(file);
    img.onload = () => {
      const sc = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas'); c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      let q = quality, out;
      do { out = c.toDataURL('image/jpeg', q); q -= 0.08; } while (out.length * 0.75 > limitBytes && q > 0.3);
      URL.revokeObjectURL(url); resolve(out.split(',')[1]);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('img')); };
    img.src = url;
  });
  // Bitta rasmni yuklaydi (to'liq + thumb); media ro'yxatiga qo'shadi va id qaytaradi
  ns.uploadImage = async (file) => {
    const [data, thumb] = [await ns.resizeJpeg(file, 1280, 0.85, 600 * 1024), await ns.resizeJpeg(file, 420, 0.8, 90 * 1024)];
    const r = await api('/api/owner/media/image', { data, thumb }, { timeout: 40000 });
    S.media.items.push({ id: r.id, kind: 'image', size: r.size, url: `/api/media/${r.id}`, thumb: `/api/media/${r.id}?thumb=1` });
    S.media.usage += r.size;
    return r.id;
  };
  ns.pickFiles = (accept, multiple) => new Promise((resolve) => {
    const inp = h('input', { type: 'file', accept, multiple: !!multiple, style: { display: 'none' } });
    inp.onchange = () => { resolve([...inp.files]); inp.remove(); };
    document.body.append(inp); inp.click();
  });
  ns.deleteMedia = async (id) => { await api('/api/owner/media/delete', { id }).catch(() => {}); const i = S.media.items.findIndex((m) => m.id === id); if (i >= 0) { S.media.usage -= S.media.items[i].size; S.media.items.splice(i, 1); } };
  ns.mediaThumb = (id) => { const m = S.media.items.find((x) => x.id === id); return m ? Core.BACKEND_URL + (m.thumb || m.url) : null; };

  // ================= MA'LUMOTNI YUKLASH =================
  async function loadMe() {
    // Oldindan so'ralgan javob (kirish ekrani paytida) bo'lsa — kutmasdan ishlatamiz
    const pre = window.__ownerMe; window.__ownerMe = null;
    let me = pre && Date.now() - pre.at < 90000 ? await pre.p : null;
    if (!me) me = await api('/api/owner/me', {});
    S.me = me;
    if (!me.wedding) return;
    S.role = me.role; S.draft = me.wedding; S.prevHas = hasContent(me.wedding.content); S.version = me.wedding.version; S.links = me.links; S.members = me.members || []; S.media = { items: me.media.items, usage: me.media.usage, quota: me.media.quota };
    // Oldingi sessiyada saqlanmay qolgan o'zgarishlar bo'lsa — tiklaymiz va yuboramiz (konflikt bo'lsa foydalanuvchi hal qiladi)
    try {
      const b = JSON.parse(localStorage.getItem(BKEY()) || 'null');
      if (b && b.dirty && b.code === me.wedding.code && JSON.stringify(b.draft) !== JSON.stringify(me.wedding)) { S.draft = b.draft; S.version = b.base; S.dirty = true; setTimeout(() => save(false), 600); }
    } catch (e) { /* */ }
  }

  // ================= YARATISH USTASI =================
  function wizard(replace) {
    const f = { groom: '', bride: '', date: '', ceremonyTime: '14:00', banquetTime: '18:00', template: 't01' };
    let step = 1;
    const box = h('div', { class: 'o-wiz' });
    function draw() {
      clear(box);
      if (step === 1) {
        const g = h('input', { class: 'o-input', value: f.groom, maxlength: 60, placeholder: t('o.groomPh'), oninput: (e) => { f.groom = e.target.value; } });
        const b = h('input', { class: 'o-input', value: f.bride, maxlength: 60, placeholder: t('o.bridePh'), oninput: (e) => { f.bride = e.target.value; } });
        const d = ui.dateInput(() => f.date, (v) => { f.date = v || ''; }, t('o.date'));
        const c = ui.timeInput(() => f.ceremonyTime, (v) => { f.ceremonyTime = v || ''; }, t('o.nikoh'));
        const q = ui.timeInput(() => f.banquetTime, (v) => { f.banquetTime = v || ''; }, t('o.banquet'));
        const err = h('p', { class: 'o-err', hidden: true }, t('o.wizRequired'));
        box.append(h('div', { class: 'o-wiz-hero' }, h('div', null, '💍'), h('h1', null, t('o.wizTitle')), h('p', null, t('o.wizSub'))), ui.card(
          ui.field(t('o.groom'), g), ui.field(t('o.bride'), b), ui.field(t('o.date'), d), h('div', { class: 'o-row2' }, ui.field(t('o.nikoh'), c), ui.field(t('o.banquet'), q)), err),
          ui.btn(t('o.next'), () => { if (!f.groom.trim() || !f.bride.trim() || !f.date) { err.hidden = false; haptic('notify', 'error'); return; } step = 2; draw(); }, 'primary'),
          ui.btn(t('o.exit'), () => (replace ? ns.askResume() : S.onExit && S.onExit()), 'ghost'));
      } else {
        box.append(h('div', { class: 'o-wiz-hero' }, h('h1', null, t('o.pickTemplate')), h('p', null, t('o.pickTemplateSub'))), ns.templateGrid(() => f.template, (id) => { f.template = id; draw(); }),
          h('div', { class: 'o-sticky-actions' }, ui.btn(t('o.back'), () => { step = 1; draw(); }, 'ghost'), ui.btn(t('o.create'), create, 'primary', { id: 'wiz-create' })));
      }
    }
    async function create() {
      const btn = $('wiz-create'); btn.disabled = true; btn.textContent = t('o.creating');
      const tpl = C.getTemplate(f.template), pal = C.getPalette(tpl.palette);
      const startsAt = (() => { const d = new Date(`${f.date}T${f.ceremonyTime || '12:00'}:00`); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })();
      try {
        const r = await api('/api/owner/save', { wedding: { groom: f.groom.trim(), bride: f.bride.trim(), date: f.date, startsAt, ceremonyTime: f.ceremonyTime || null, banquetTime: f.banquetTime || null, template: tpl.id, font: tpl.font, theme: { id: pal.id }, content: { intro: { style: tpl.intro } }, ...(replace ? { visibility: S.draft.visibility, settings: S.draft.settings } : {}) }, ...(replace ? { base: S.version, force: true } : {}) });
        haptic('notify', 'success');
        S.draft = r.wedding; S.prevHas = hasContent(r.wedding.content); S.version = r.version; S.links = r.links; S.role = 'owner'; if (!replace) { S.members = [{ tgId: String(tgId()), role: 'owner', name: '' }]; S.media = { items: [], usage: 0, quota: 60 * 1024 * 1024 }; } S.me = { wedding: r.wedding };
        mainShell(); go('home');
        setTimeout(() => toast(t('o.created')), 400);
      } catch (e) { btn.disabled = false; btn.textContent = t('o.create'); ui.err(e); }
    }
    draw();
    return box;
  }

  // Shablonlar to'ri: mini maket + palitra (hech qanday og'ir rasm yo'q)
  ns.templateGrid = (get, set) => {
    const grid = h('div', { class: 'o-tpl-grid' });
    C.TEMPLATES.forEach((tp) => {
      const pal = C.getPalette(tp.palette);
      const mini = h('div', { class: `o-mini m-${tp.layout}`, style: { '--b': pal.bg, '--s': pal.surface, '--i': pal.ink, '--a': pal.accent, '--a2': pal.accent2 } },
        h('i', { class: 'm-photo' }), h('b', { class: 'm-n' }), h('b', { class: 'm-n m-n2' }), h('em', { class: 'm-line' }), h('u', { class: 'm-box' }));
      const card = h('button', { type: 'button', class: 'o-tpl' + (get() === tp.id ? ' on' : ''), onclick: () => { haptic('impact', 'light'); set(tp.id); } }, mini, h('span', null, tp.name));
      grid.append(card);
    });
    return grid;
  };

  // ================= KARKAS: sarlavha + tab-bar =================
  const TABS = [
    { id: 'home', ico: 'M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z', k: 'o.tabHome' },
    { id: 'design', ico: 'M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4-4-8-9-8zM7.5 11a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm3-4a1 1 0 1 0 0-2 1 1 0 0 0 0 2zm4 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2z', k: 'o.tabDesign' },
    { id: 'more', ico: 'M21 4h-7M10 4H3M21 12h-9M8 12H3M21 20h-5M12 20H3M14 2v4M8 10v4M16 18v4', k: 'o.tabMore' },
  ];
  let mainEl = null, tabbarEl = null, headEl = null;

  function mainShell() {
    clear(S.root);
    S.root.className = 'view owner-root is-active';
    const backBtn = h('button', { type: 'button', class: 'o-back', 'aria-label': t('o.back'), onclick: () => { haptic('impact', 'light'); go('home'); } },
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: 'M15 5l-7 7 7 7', ns: true })));
    headEl = h('header', { class: 'o-head' }, backBtn, h('div', { class: 'o-head-t' }, h('b', { id: 'o-names' }, `${S.draft.groom} & ${S.draft.bride}`), h('small', null, S.role === 'cohost' ? t('o.roleCohost') : t('o.roleOwner'))), statusEl);
    mainEl = h('main', { class: 'o-main', id: 'o-main' });
    tabbarEl = h('nav', { class: 'o-tabbar' }, TABS.map((tb) => h('button', { type: 'button', class: 'o-tab', dataset: { id: tb.id }, onclick: () => { haptic('impact', 'light'); go(tb.id); } },
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: tb.ico, ns: true })), h('span', { 'data-i18n': tb.k }, t(tb.k)))));
    S.root.append(headEl, mainEl);
    setStatus(S.dirty ? 'dirty' : 'saved');
  }

  function go(id) {
    S.tab = id;
    stopPolling(); clearInterval(S.cdTimer);
    S.root.classList.toggle('home-mode', id === 'home');
    // Telegram'ning o'z "orqaga" tugmasi ham bosh ekranga qaytaradi
    if (id !== 'home' && !S.backHome) S.backHome = Core.back.push(() => { S.backHome = null; go('home'); });
    if (id === 'home' && S.backHome) { Core.back.pop(S.backHome); S.backHome = null; }
    renderTab();
  }
  ns.go = go;
  function renderTab() {
    previewSlots.clear();
    clear(mainEl); mainEl.scrollTop = 0;
    const fn = ns.screens[S.tab];
    mainEl.append(fn ? fn() : ui.empty('🚧', S.tab));
    Core.applyDom(S.root);
  }
  ns.renderTab = renderTab;
  const names = () => { const n = $('o-names'); if (n) n.textContent = `${S.draft.groom} & ${S.draft.bride}`; };
  ns.names = names;

  // ================= BOSH =================
  function startPolling(fn, ms) { stopPolling(); S.polling = setInterval(() => { if (!document.hidden) safe(fn); }, ms); }
  function stopPolling() { clearInterval(S.polling); S.polling = null; }
  ns.startPolling = startPolling; ns.stopPolling = stopPolling;

  const daysLeft = () => { const tgt = S.draft.startsAt ? new Date(S.draft.startsAt) : new Date(`${S.draft.date}T12:00:00`); return Math.ceil((tgt.getTime() - Date.now()) / 86400000); };
  ns.timeAgo = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return t('o.justNow'); if (s < 3600) return t('o.minAgo', { n: Math.floor(s / 60) }); if (s < 86400) return t('o.hrAgo', { n: Math.floor(s / 3600) });
    return t('o.dayAgo', { n: Math.floor(s / 86400) });
  };
  const eventText = (e) => {
    const m = e.meta || {}, who = m.name || t('o.someone');
    if (e.type === 'rsvp') return { ico: m.status === 'yes' ? '💚' : '💔', txt: t(m.status === 'yes' ? 'o.evYes' : 'o.evNo', { name: who, n: m.count || 1 }) };
    if (e.type === 'open') return { ico: '👀', txt: t('o.evOpen', { name: who }) };
    if (e.type === 'link_start') return { ico: '🔗', txt: t('o.evStart', { name: who }) };
    if (e.type === 'cohost') return { ico: '💑', txt: t('o.evCohost', { name: who }) };
    if (e.type === 'gift') return { ico: '🎁', txt: t('o.evGift', { name: who, sum: Number(m.amount || 0).toLocaleString('ru-RU').replace(/,/g, ' ') }) };
    return { ico: '•', txt: e.type };
  };
  const pad2 = (n) => String(n).padStart(2, '0');
  ns.fmtStamp = (iso) => { const d = new Date(iso); return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const personKey = (e) => (e.guestId ? 'g' + e.guestId : e.tgId ? 't' + e.tgId : 'n' + ((e.meta && e.meta.name) || ''));
  ns.evCache = [];
  // Hodisa qatori: aniq sana/vaqt ko'rinadi, bosilsa shu odamning barcha kirishlari ochiladi
  ns.eventRow = (e) => {
    const x = eventText(e);
    return h('button', { type: 'button', class: 'o-ev', onclick: () => ns.openPersonLog(e) }, h('span', { class: 'o-ev-i' }, x.ico),
      h('div', null, h('div', null, x.txt), h('small', null, `${ns.fmtStamp(e.at)} · ${ns.timeAgo(e.at)}`)));
  };
  ns.openPersonLog = (e) => {
    const key = personKey(e), who = (e.meta && e.meta.name) || t('o.someone');
    const list = ns.evCache.filter((x) => personKey(x) === key);
    const opens = list.filter((x) => x.type === 'open'), first = opens[opens.length - 1], last = opens[0];
    const rows = list.map((x) => { const y = eventText(x); return h('div', { class: 'o-ev o-ev-log' }, h('span', { class: 'o-ev-i' }, y.ico), h('div', null, h('div', null, y.txt), h('small', null, ns.fmtStamp(x.at)))); });
    ui.sheet(who, h('div', { class: 'o-col' },
      h('div', { class: 'o-log-sum' }, h('div', null, h('small', null, t('o.firstOpen')), h('b', null, first ? ns.fmtStamp(first.at) : '—')), h('div', null, h('small', null, t('o.lastOpen')), h('b', null, last ? ns.fmtStamp(last.at) : '—')), h('div', null, h('small', null, t('o.openCount')), h('b', null, String(opens.length)))),
      h('h3', { class: 'o-h3' }, t('o.history')), h('div', { class: 'o-feed' }, rows)));
  };

  // Lucide (ISC) — SF Symbols'ga eng yaqin ochiq ikonkalar to'plami
  const LUCIDE = {
    "settings": "<path d=\"M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z\"/><circle cx=\"12\" cy=\"12\" r=\"3\"/>",
    "pen-line": "<path d=\"M12 20h9\" /> <path d=\"M16.376 3.622a1 1 0 0 1 3.002 3.002L7.368 18.635a2 2 0 0 1-.855.506l-2.872.838a.5.5 0 0 1-.62-.62l.838-2.872a2 2 0 0 1 .506-.854z\" />",
    "chevron-right": "<path d=\"m9 18 6-6-6-6\" />",
    "chevron-down": "<path d=\"m6 9 6 6 6-6\" />",
    "search": "<circle cx=\"11\" cy=\"11\" r=\"8\" /> <path d=\"m21 21-4.3-4.3\" />",
    "bell": "<path d=\"M10.268 21a2 2 0 0 0 3.464 0\" /> <path d=\"M3.262 15.326A1 1 0 0 0 4 17h16a1 1 0 0 0 .74-1.673C19.41 13.956 18 12.499 18 8A6 6 0 0 0 6 8c0 4.499-1.411 5.956-2.738 7.326\" />",
    "menu": "<line x1=\"4\" x2=\"20\" y1=\"12\" y2=\"12\" /> <line x1=\"4\" x2=\"20\" y1=\"6\" y2=\"6\" /> <line x1=\"4\" x2=\"20\" y1=\"18\" y2=\"18\" />",
    "rocket": "<path d=\"M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z\" /> <path d=\"m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z\" /> <path d=\"M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0\" /> <path d=\"M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5\" />",
    "users": "<path d=\"M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2\" /> <circle cx=\"9\" cy=\"7\" r=\"4\" /> <path d=\"M22 21v-2a4 4 0 0 0-3-3.87\" /> <path d=\"M16 3.13a4 4 0 0 1 0 7.75\" />",
    "camera": "<path d=\"M14.5 4h-5L7 7H4a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2h-3l-2.5-3z\" /> <circle cx=\"12\" cy=\"13\" r=\"3\" />",
    "chart-column": "<path d=\"M3 3v16a2 2 0 0 0 2 2h16\" /> <path d=\"M18 17V9\" /> <path d=\"M13 17V5\" /> <path d=\"M8 17v-3\" />",
    "check": "<path d=\"M20 6 9 17l-5-5\" />",
    "eye": "<path d=\"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0\" /> <circle cx=\"12\" cy=\"12\" r=\"3\" />",
    "share-2": "<circle cx=\"18\" cy=\"5\" r=\"3\" /> <circle cx=\"6\" cy=\"12\" r=\"3\" /> <circle cx=\"18\" cy=\"19\" r=\"3\" /> <line x1=\"8.59\" x2=\"15.42\" y1=\"13.51\" y2=\"17.49\" /> <line x1=\"15.41\" x2=\"8.59\" y1=\"6.51\" y2=\"10.49\" />"
  };
  const lic = (name, size = 20, sw = 1.8) => { const e = document.createElement('span'); e.className = 'hm-ico'; e.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`; return e; };
  // Soat tiqillashi (Web Audio, fayl yo'q): juda past ovoz, sozlamalardan o'chiriladi
  let actx = null;
  ns.tickOn = () => { try { return localStorage.getItem('toy_tick') !== 'off'; } catch (e) { return true; } };
  let tickNoise = null, tickFlip = false;
  ns.tickSound = () => {
    if (!ns.tickOn() || document.hidden) return;
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      actx = actx || new AC(); if (actx.state === 'suspended') actx.resume().catch(() => {});
      if (!tickNoise) { // qisqa oq shovqin — mexanizm "tishi" urilishi
        tickNoise = actx.createBuffer(1, Math.floor(actx.sampleRate * 0.03), actx.sampleRate);
        const d = tickNoise.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6);
      }
      const now = actx.currentTime + 0.005; tickFlip = !tickFlip;
      const out = actx.createGain(); out.gain.value = 0.22; out.connect(actx.destination);
      // 1. o'tkir "chik": shovqin -> tor polosali rezonans (metall)
      const src = actx.createBufferSource(); src.buffer = tickNoise;
      const bp = actx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = tickFlip ? 3600 : 2900; bp.Q.value = 9;
      const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 1400;
      const g1 = actx.createGain(); g1.gain.setValueAtTime(0.9, now); g1.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
      src.connect(hp).connect(bp).connect(g1).connect(out); src.start(now);
      // 2. korpusning yog'och "taq"i: past, juda qisqa
      const o = actx.createOscillator(), g2 = actx.createGain();
      o.type = 'sine'; o.frequency.setValueAtTime(tickFlip ? 900 : 760, now); o.frequency.exponentialRampToValueAtTime(tickFlip ? 420 : 360, now + 0.02);
      g2.gain.setValueAtTime(0.0001, now); g2.gain.exponentialRampToValueAtTime(0.35, now + 0.002); g2.gain.exponentialRampToValueAtTime(0.0001, now + 0.028);
      o.connect(g2).connect(out); o.start(now); o.stop(now + 0.04);
    } catch (e) { /* ovoz muhim emas */ }
  };
  const seenKey = 'toy_seen_ev';
  const getSeen = () => { try { return Number(localStorage.getItem(seenKey)) || 0; } catch (e) { return 0; } };
  const setSeen = (n) => { try { localStorage.setItem(seenKey, String(n)); } catch (e) { /* ixtiyoriy */ } };

  ns.screens.home = () => {
    Core.loadFont({ id: 'hm-playfair', gf: 'Playfair+Display:ital,wght@0,500;1,500' });
    const d = S.draft;
    const wrap = h('div', { class: 'o-screen hm' });
    const target = () => (d.startsAt ? new Date(d.startsAt) : new Date(`${d.date}T${d.ceremonyTime || '12:00'}:00`)).getTime();
    const feed = h('div', { class: 'o-feed' }, ui.spinner());
    let latestId = 0, an = null;

    // --- yuqori qator: logotip + qidiruv / bildirishnoma / menyu ---
    const dot = h('i', { class: 'hm-dot', hidden: true });
    const bell = h('button', { type: 'button', class: 'hm-ib', 'aria-label': t('o.liveFeed'), onclick: () => openFeed() }, lic('bell', 20), dot);
    const hero = h('div', { class: 'hm-hero' });
    hero.append(h('div', { class: 'hm-top' },
      h('span', { class: 'hm-logo' }, t('o.hmBrand')),
      h('div', { class: 'hm-icons' },
        h('button', { type: 'button', class: 'hm-ib', 'aria-label': t('o.search'), onclick: () => { haptic('impact', 'light'); ns.focusSearch = true; go('guests'); } }, lic('search', 20)),
        bell,
        h('button', { type: 'button', class: 'hm-ib', 'aria-label': t('o.moreTitle'), onclick: () => { haptic('impact', 'light'); go('more'); } }, lic('settings', 20)))), h('div', { class: 'hm-spacer' }));

    // --- ismlar + sana ---
    hero.append(h('button', { type: 'button', class: 'hm-names', onclick: () => ns.openBasics && ns.openBasics() }, h('h1', null, d.groom, ' & ', h('br'), d.bride), h('p', null, formatDate(d.date) + (d.ceremonyTime ? ` · ${d.ceremonyTime}` : ''))));

    // --- teskari sanoq (har soniya) ---
    const cd = { d: h('b'), h: h('b'), m: h('b'), s: h('b') };
    const cell = (k, label) => h('div', { class: 'hm-cd-c' }, cd[k], h('small', null, label));
    const cdTitle = h('div', { class: 'hm-cd-t' });
    hero.append(h('div', { class: 'hm-card hm-cd' }, cdTitle, h('div', { class: 'hm-cd-row' }, cell('d', t('o.cdDays')), h('span', null, ':'), cell('h', t('o.cdHours')), h('span', null, ':'), cell('m', t('o.cdMin')), h('span', null, ':'), cell('s', t('o.cdSec')))));
    const tick = () => {
      let diff = Math.max(0, target() - Date.now());
      cdTitle.textContent = target() > Date.now() ? t('o.cdTitle') : t('o.passed');
      const days = Math.floor(diff / 86400000); diff -= days * 86400000;
      const hrs = Math.floor(diff / 3600000); diff -= hrs * 3600000;
      const mins = Math.floor(diff / 60000); diff -= mins * 60000;
      const put = (el, v) => { if (el.textContent === v) return; el.textContent = v; el.classList.remove('flip'); void el.offsetWidth; el.classList.add('flip'); };
      put(cd.d, pad2(days)); put(cd.h, pad2(hrs)); put(cd.m, pad2(mins)); put(cd.s, pad2(Math.floor(diff / 1000)));
      ns.tickSound();
    };
    hero.append(h('button', { type: 'button', class: 'hm-edit', onclick: () => { haptic('impact', 'light'); go('content'); } }, h('span', null, lic('pen-line', 20, 1.8), t('o.hmEdit')), lic('chevron-right', 20, 2)),
      h('button', { type: 'button', class: 'hm-more', 'aria-label': 'More', onclick: () => wrap.querySelector('.hm-grid').scrollIntoView({ behavior: 'smooth', block: 'center' }) }, lic('chevron-down', 22, 2)));
    wrap.append(hero);
    tick();
    clearInterval(S.cdTimer); S.cdTimer = setInterval(() => { if (!document.body.contains(wrap)) { clearInterval(S.cdTimer); return; } tick(); }, 1000);

    // --- 2x2 kartalar ---
    const ring = h('span', { class: 'hm-ring' });
    const tiles = {
      ready: h('b', null, '0 / 8'), guests: h('b', null, '0'), content: h('b', null, '0'), stats: h('b', null, '0'),
    };
    const cc = d.content;
    const items = () => [
      [!!cc.hero.mediaId, 'o.chPhoto', () => go('content')], [!!d.message, 'o.chMessage', () => go('content')], [cc.story.length > 0, 'o.chStory', () => go('content')],
      [cc.schedule.length > 0, 'o.chSchedule', () => go('content')], [!!(cc.location.name || cc.location.address), 'o.chLocation', () => go('content')],
      [cc.gallery.length > 0, 'o.chGallery', () => go('content')], [(an ? an.guests.total : 0) > 0, 'o.chGuests', () => go('guests')], [d.published, 'o.chPublished', () => ns.togglePublish(true)],
    ];
    const paintReady = () => {
      const it = items(), done = it.filter((i) => i[0]).length, p = done / it.length;
      tiles.ready.textContent = `${done} / ${it.length}`;
      ring.style.setProperty('--p', String(Math.round(p * 360)) + 'deg');
      ring.innerHTML = `<svg viewBox="0 0 36 36" width="34" height="34"><circle cx="18" cy="18" r="15" fill="none" stroke="rgba(176,132,62,.22)" stroke-width="3"/><circle cx="18" cy="18" r="15" fill="none" stroke="#b98a3e" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(p * 94.25).toFixed(1)} 94.25" transform="rotate(-90 18 18)"/></svg>`;
    };
    const openChecklist = () => {
      const it = items();
      const ctl = ui.sheet(t('o.readiness'), h('div', { class: 'o-check' }, h('div', { class: 'o-prog' }, h('i', { style: { width: Math.round((it.filter((i) => i[0]).length / it.length) * 100) + '%' } })),
        h('div', { class: 'o-check-list' }, it.map(([ok, k, fn]) => h('button', { type: 'button', class: 'o-ck' + (ok ? ' ok' : ''), onclick: ok ? null : () => { ctl.close(); fn(); } }, h('i', null, ok ? '✓' : ''), h('span', null, t(k)))))));
    };
    const tile = (icon, valueEl, label, fn) => h('button', { type: 'button', class: 'hm-card hm-tile', onclick: () => { haptic('impact', 'light'); fn(); } }, icon, h('div', { class: 'hm-tile-t' }, h('span', null, label), valueEl));
    const statLabel = h('span', null, t('o.hmOpens'));
    const statTile = tile(lic('chart-column', 26, 1.6), h('div', { class: 'hm-val' }, tiles.stats, statLabel), t('o.tabStats'), () => go('stats'));
    wrap.append(h('div', { class: 'hm-grid' },
      tile(lic('users', 26, 1.6), tiles.guests, t('o.tabGuests'), () => go('guests')),
      tile(lic('camera', 26, 1.6), tiles.content, t('o.tabContent'), () => go('content')),
      statTile));
    paintReady();
    tiles.content.textContent = String((cc.hero.mediaId ? 1 : 0) + cc.gallery.length);

    // --- asosiy tugma ---
    const main = d.published
      ? h('button', { type: 'button', class: 'hm-cta', onclick: () => ui.share(S.links.general, t('o.shareText')) }, lic('share-2', 22, 1.8), t('o.shareLink'))
      : h('button', { type: 'button', class: 'hm-cta', onclick: () => ns.togglePublish(true) }, lic('rocket', 22, 1.8), t('o.publishNow'));
    wrap.append(main, h('button', { type: 'button', class: 'hm-link', onclick: () => ui.fullPreview() }, lic('eye', 16, 1.8), t('o.preview')));

    // --- jonli lenta: qo'ng'iroqcha varag'ida ---
    function openFeed() {
      haptic('impact', 'light'); setSeen(latestId); dot.hidden = true;
      ui.sheet(t('o.liveFeed'), h('div', { class: 'o-col' }, feed), { tall: true });
    }
    const loadFeed = async () => {
      try {
        const r = await api('/api/owner/activity', { since: 0 });
        ns.evCache = r.events;
        clear(feed);
        if (!r.events.length) feed.append(ui.empty('📭', t('o.noActivity')));
        r.events.slice(0, 30).forEach((e) => feed.append(ns.eventRow(e)));
        latestId = r.events[0] ? r.events[0].id : 0; S.lastEvent = latestId;
        dot.hidden = !(latestId > getSeen());
      } catch (e) { if (!feed.firstChild || feed.querySelector('.o-spin')) { clear(feed); feed.append(ui.empty('📡', t('o.network'))); } }
    };
    const paintAn = (a) => {
      an = a; tiles.guests.textContent = String(a.guests.total); tiles.stats.textContent = String((a.unique && a.unique.opens) || 0);
      paintReady();
    };
    api('/api/owner/analytics', { days: 14 }).then((a) => { S.an = a; paintAn(a); }).catch(() => { paintAn({ guests: { total: 0, opened: 0, pending: 0 }, rsvp: { people: 0 }, unique: { opens: 0 } }); });
    loadFeed();
    startPolling(loadFeed, 12000); // real-time lenta
    return wrap;
  };

  // ================= NASHR =================
  ns.togglePublish = async (publish) => {
    if (S.dirty) await save(false);
    if (publish) { const ok = await ui.confirm(t('o.publishConfirm'), t('o.publish')); if (!ok) return; } else { const ok = await ui.confirm(t('o.unpublishConfirm'), t('o.unpublish'), true); if (!ok) return; }
    try {
      const r = await api('/api/owner/publish', { published: !!publish });
      S.draft.published = r.published; S.version = r.version; S.links = r.links;
      haptic('notify', 'success'); toast(t(publish ? 'o.publishedOk' : 'o.unpublishedOk'));
      renderTab();
    } catch (e) { ui.err(e); }
  };

  // ================= DIZAYN =================
  ns.screens.design = () => {
    const d = S.draft;
    const wrap = h('div', { class: 'o-screen' });
    const rerenderGrids = () => { redrawTemplates(); redrawPalettes(); redrawFonts(); };

    wrap.append(ui.title(t('o.designTitle'), t('o.designSub')), h('div', { class: 'o-phone-wrap' }, ui.phone(0.56)));

    // --- shablonlar ---
    const tplBox = h('div'); const redrawTemplates = () => { clear(tplBox); tplBox.append(ns.templateGrid(() => d.template, (id) => applyTemplate(id))); };
    function applyTemplate(id) {
      const tp = C.getTemplate(id), p = C.getPalette(tp.palette);
      d.template = id; d.font = tp.font; d.theme = { id: p.id, bg: p.bg, surface: p.surface, ink: p.ink, soft: p.soft, accent: p.accent, accent2: p.accent2 };
      d.content.intro.style = tp.intro; touch(); rerenderGrids(); redrawIntro();
    }
    wrap.append(ui.card(h('h3', { class: 'o-h3' }, t('o.templates') + ` · ${C.TEMPLATES.length}`), tplBox));

    // --- ranglar ---
    const palBox = h('div', { class: 'o-pal' });
    const redrawPalettes = () => {
      clear(palBox);
      C.PALETTES.forEach((p) => palBox.append(h('button', { type: 'button', class: 'o-pal-i' + (d.theme.id === p.id ? ' on' : ''), title: p.name, onclick: () => { d.theme = { id: p.id, bg: p.bg, surface: p.surface, ink: p.ink, soft: p.soft, accent: p.accent, accent2: p.accent2 }; touch(); redrawPalettes(); redrawCustom(); haptic('impact', 'light'); } },
        h('i', { style: { background: p.bg } }), h('i', { style: { background: p.accent } }), h('i', { style: { background: p.ink } }))));
    };
    const customBox = h('div', { class: 'o-custom' });
    const redrawCustom = () => {
      clear(customBox);
      [['accent', 'o.cAccent'], ['bg', 'o.cBg'], ['ink', 'o.cInk']].forEach(([k, label]) => {
        const inp = h('input', { type: 'color', value: d.theme[k], 'aria-label': t(label) });
        inp.addEventListener('input', () => { d.theme[k] = inp.value; d.theme.id = null; if (k === 'accent') d.theme.accent2 = inp.value; if (k === 'bg') d.theme.surface = inp.value; touch(); });
        inp.addEventListener('change', () => redrawPalettes());
        customBox.append(h('label', { class: 'o-color' }, inp, h('span', null, t(label))));
      });
    };
    wrap.append(ui.card(h('h3', { class: 'o-h3' }, t('o.colors')), palBox, h('p', { class: 'o-hint' }, t('o.customColors')), customBox));

    // --- shriftlar ---
    const fontBox = h('div', { class: 'o-fonts' });
    C.FONTS.forEach((f) => Core.loadFont(f)); // ro'yxat namunalari uchun bir martalik yuklash
    const redrawFonts = () => {
      clear(fontBox);
      C.FONTS.forEach((f) => fontBox.append(h('button', { type: 'button', class: 'o-font' + (d.font === f.id ? ' on' : ''), onclick: () => { d.font = f.id; touch(); redrawFonts(); haptic('impact', 'light'); } },
        h('b', { style: { fontFamily: f.heading } }, `${d.groom || 'Aziz'} & ${d.bride || 'Malika'}`), h('small', { style: { fontFamily: f.body } }, f.name))));
    };
    wrap.append(ui.card(h('h3', { class: 'o-h3' }, t('o.fonts')), fontBox));

    // --- kirish uslubi ---
    const introBox = h('div'); const redrawIntro = () => { clear(introBox); introBox.append(ui.chips(C.INTROS.map((i) => ({ id: i, label: t('o.intro_' + i) })), () => d.content.intro.style || C.getTemplate(d.template).intro, (v) => { d.content.intro.style = v; touch(); })); };
    wrap.append(ui.card(h('h3', { class: 'o-h3' }, t('o.introStyle')), h('p', { class: 'o-hint' }, t('o.introHint')), introBox, ui.btn('▶ ' + t('o.replayIntro'), () => ui.fullPreview({ demo: true }), 'ghost')));

    rerenderGrids(); redrawCustom(); redrawIntro();
    return wrap;
  };

  // ================= YANA (nashr, maxfiylik, bildirishnoma, eslatma, hammuallif, til) =================
  ns.screens.more = () => {
    const d = S.draft, owner = S.role === 'owner';
    const wrap = h('div', { class: 'o-screen' });
    wrap.append(ui.title(t('o.moreTitle')));
    const link = (path, label, id) => h('button', { type: 'button', class: 'o-link-row', onclick: () => { haptic('impact', 'light'); go(id); } },
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: path, ns: true })), h('b', null, label),
      h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico o-chev' }, h('path', { d: 'M9 5l7 7-7 7', ns: true })));
    wrap.append(ui.card(
      link('M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7zM2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6 6 0 0 1 3.5 5.5', t('o.tabGuests'), 'guests'),
      link('M5 20V10M12 20V4M19 20v-7', t('o.tabStats'), 'stats'),
      h('button', { type: 'button', class: 'o-link-row', onclick: () => { haptic('impact', 'light'); ns.openBasics(); } },
        h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico' }, h('path', { d: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z', ns: true })), h('b', null, t('o.basicsTitle')),
        h('svg', { viewBox: '0 0 24 24', ns: true, class: 'o-ico o-chev' }, h('path', { d: 'M9 5l7 7-7 7', ns: true }))),
      link('M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4', t('o.tabContent'), 'content'),
      link('M12 3a9 9 0 1 0 0 18c1.2 0 2-.8 2-1.8 0-.5-.2-.9-.5-1.2-.3-.3-.5-.7-.5-1.2 0-1 .8-1.8 1.8-1.8H17a4 4 0 0 0 4-4c0-4-4-8-9-8z', t('o.tabDesign'), 'design')));

    // Nashr + maxfiylik
    const pubCard = ui.card(h('h3', { class: 'o-h3' }, t('o.publishing')));
    pubCard.append(h('div', { class: 'o-row-between' }, h('div', null, h('b', null, t(d.published ? 'o.stLive' : 'o.stDraft')), h('p', { class: 'o-hint' }, t(d.published ? 'o.liveHint' : 'o.draftHint'))),
      owner ? ui.btn(t(d.published ? 'o.unpublish' : 'o.publish'), () => ns.togglePublish(!d.published), d.published ? 'ghost small' : 'primary small') : null));
    if (d.published) pubCard.append(h('div', { class: 'o-linkbox' }, S.links.general), h('div', { class: 'o-row2' }, ui.btn(t('o.copy'), () => ui.copy(S.links.general), 'ghost small'), ui.btn(t('o.shareLink'), () => ui.share(S.links.general, t('o.shareText')), 'primary small')));
    wrap.append(pubCard);

    if (owner) {
      const vis = (id, ico, k) => h('button', { type: 'button', class: 'o-vis' + (d.visibility === id ? ' on' : ''), onclick: () => { d.visibility = id; touch(); renderTab(); } }, h('i', null, ico), h('b', null, t(k)), h('small', null, t(k + 'Hint')));
      wrap.append(ui.card(h('h3', { class: 'o-h3' }, '🔒 ' + t('o.privacy')), h('div', { class: 'o-vis-row' }, vis('public', '🌍', 'o.visPublic'), vis('private', '🔐', 'o.visPrivate')),
        d.visibility === 'private' && h('p', { class: 'o-hint warn' }, t('o.privateWarn'))));

      wrap.append(ui.card(h('h3', { class: 'o-h3' }, '🔔 ' + t('o.notifTitle')),
        ui.toggle(t('o.nRsvp'), () => d.settings.notify.rsvp, (v) => { d.settings.notify.rsvp = v; touch(); }, t('o.nRsvpD')),
        ui.toggle(t('o.nOpened'), () => d.settings.notify.opened, (v) => { d.settings.notify.opened = v; touch(); }, t('o.nOpenedD'))));

      const R = d.settings.reminders;
      if (!Number.isFinite(R.guestDays)) R.guestDays = 1;
      if (!Number.isFinite(R.pendingDays)) R.pendingDays = 7;
      const dayPick = (key, label) => {
        const opts = [0, 1, 2, 3, 7, 14].map((n) => ({ id: n, label: n ? t('o.remDays', { n }) : t('o.remOff') }));
        const custom = h('input', { class: 'o-input o-days', type: 'number', min: 0, max: 60, inputmode: 'numeric', value: R[key], oninput: (e) => { const n = Math.min(60, Math.max(0, parseInt(e.target.value, 10) || 0)); R[key] = n; touch(); chips.querySelectorAll('.o-chip').forEach((c, i) => c.classList.toggle('on', opts[i].id === n)); } });
        const chips = ui.chips(opts, () => R[key], (v) => { R[key] = v; custom.value = v; touch(); });
        return h('div', { class: 'o-rem' }, h('b', null, label), chips, h('div', { class: 'o-inline' }, h('small', { class: 'o-hint' }, t('o.remCustom')), custom, h('small', { class: 'o-hint' }, t('o.remDaysWord'))));
      };
      wrap.append(ui.card(h('h3', { class: 'o-h3' }, '⏰ ' + t('o.remTitle')), h('p', { class: 'o-hint' }, t('o.remSub2')),
        dayPick('guestDays', t('o.remGuest')), dayPick('pendingDays', t('o.remPending'))));
    }

    // Hammuallif
    const coh = ui.card(h('h3', { class: 'o-h3' }, '💑 ' + t('o.cohost')), h('p', { class: 'o-hint' }, t('o.cohostSub')));
    S.members.forEach((m) => coh.append(h('div', { class: 'o-member' }, h('div', null, h('b', null, m.name || (m.role === 'owner' ? t('o.roleOwner') : t('o.roleCohost'))), h('small', null, t(m.role === 'owner' ? 'o.roleOwner' : 'o.roleCohost'))),
      owner && m.role === 'cohost' ? ui.btn(t('o.remove'), async () => { if (!(await ui.confirm(t('o.removeCohost'), t('o.remove'), true))) return; await api('/api/owner/cohost/remove', { tgId: m.tgId }).catch(ui.err); S.members = S.members.filter((x) => x.tgId !== m.tgId); renderTab(); }, 'ghost small') : null)));
    if (owner) coh.append(ui.btn('➕ ' + t('o.inviteCohost'), async () => {
      try { const r = await api('/api/owner/cohost/invite', {}); const c = ui.sheet(t('o.inviteCohost'), h('div', { class: 'o-col' }, h('p', { class: 'o-muted' }, t('o.inviteCohostText')), h('div', { class: 'o-linkbox' }, r.link),
        ui.btn(t('o.shareLink'), () => ui.share(r.link, t('o.cohostShareText', { names: `${d.groom} & ${d.bride}` })), 'primary'), ui.btn(t('o.copy'), () => ui.copy(r.link), 'ghost'))); } catch (e) { ui.err(e); }
    }, 'ghost'));
    wrap.append(coh);

    wrap.append(ui.card(window.ToyMusic && ui.toggle(t('o.music'), () => window.ToyMusic.get(), (v) => window.ToyMusic.set(v)),
      ui.toggle(t('o.tick'), () => ns.tickOn(), (v) => { try { localStorage.setItem('toy_tick', v ? 'on' : 'off'); } catch (e) { /* */ } }, t('o.tickD'))));
    // Til + xotira + chiqish
    const langRow = ui.chips(Core.LANGS.filter((l) => l !== 'ja').map((l) => ({ id: l, label: l.toUpperCase() })), () => Core.getLang(), (l) => { Core.setLang(l, true); });
    const pct = S.media.quota ? Math.min(100, Math.round((S.media.usage / S.media.quota) * 100)) : 0;
    wrap.append(ui.card(h('h3', { class: 'o-h3' }, '🌐 ' + t('o.language')), langRow, h('div', { class: 'o-sep' }), h('h3', { class: 'o-h3' }, '💾 ' + t('o.storage')),
      h('div', { class: 'o-prog' }, h('i', { style: { width: pct + '%' } })), h('small', { class: 'o-hint' }, `${(S.media.usage / 1048576).toFixed(1)} / ${(S.media.quota / 1048576).toFixed(0)} MB`)));
    wrap.append(ui.btn(t('o.switchRole'), () => { stopPolling(); Core.back.clear(); S.onExit && S.onExit(); }, 'ghost'));
    wrap.append(h('p', { class: 'o-foot' }, 'Toyga · v2'));
    return wrap;
  };

  // ================= START =================
  ns.start = async ({ root, onExit }) => {
    S.root = root; S.onExit = onExit;
    Core.back.clear();
    Core.onLang(() => { if (S.draft && S.root.classList.contains('is-active') && mainEl && mainEl.isConnected) { setStatus(S.status); renderTab(); } });
    clear(root); root.append(h('div', { class: 'loader' }, h('i')));
    await loadMe();
    document.body.dataset.invdark = '0';
    Core.setChrome('#fbf8f2');
    if (!S.draft) { clear(root); root.className = 'view owner-root is-active'; root.append(h('div', { class: 'o-main wiz' }, wizard())); return; }
    // Har safar kirganda: eski holatda davom etish yoki yangidan to'ldirish
    if (S.role === 'owner') { ns.askResume(); return; }
    mainShell(); go('home');
  };

  ns.askResume = () => {
    const root = S.root;
    clear(root); root.className = 'view owner-root is-active';
    const svg = (html, cls) => { const e = h('span', { class: cls }); e.innerHTML = html; return e; };
    const card = (icon, title, desc, fn) => h('button', { type: 'button', class: 'role-card glass', onclick: fn }, svg(icon, 'ico'), h('span', { class: 'txt' }, h('b', null, title), h('span', { class: 'd' }, desc)), svg("<svg viewBox=\"0 0 24 24\" width=\"14\" height=\"14\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2.6\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M9 5l7 7-7 7\"/></svg>", 'chev'));
    root.append(h('div', { class: 'resume-screen' }, h('div', { class: 'role-wrap' },
      h('div', { class: 'role-brand' }, svg("<svg viewBox=\"0 0 64 56\" width=\"46\" height=\"40\" fill=\"none\" stroke=\"#b9833a\" stroke-width=\"2.4\"><circle cx=\"24\" cy=\"36\" r=\"14\"/><circle cx=\"40\" cy=\"36\" r=\"14\"/><path d=\"M32 12c-2.2-3.4-7.6-2-7.6 2 0 3 4.6 5.6 7.6 8 3-2.4 7.6-5 7.6-8 0-4-5.4-5.4-7.6-2z\" fill=\"#e9a3a8\" stroke=\"#c76a74\" stroke-width=\"1.6\"/></svg>"), h('span', null, t('brand'))),
      h('h1', { class: 'role-title' }, t('o.resumeTitle')),
      h('div', { class: 'role-sep' }, h('i'), svg("<svg viewBox=\"0 0 24 24\" width=\"16\" height=\"16\" fill=\"#e08a95\"><path d=\"M12 21s-7.5-4.6-9.5-9.2C1.2 8.6 3 5.5 6 5.5c2 0 3.3 1.2 4 2.4.7-1.2 2-2.4 4-2.4 3 0 4.8 3.1 3.5 6.3C19.5 16.4 12 21 12 21z\"/></svg>"), h('i')),
      card("<svg viewBox=\"0 0 48 48\" width=\"34\" height=\"34\" aria-hidden=\"true\"><defs><linearGradient id=\"rg1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f6dc9a\"/><stop offset=\".5\" stop-color=\"#c9953f\"/><stop offset=\"1\" stop-color=\"#8f6420\"/></linearGradient><linearGradient id=\"rg2\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#ffffff\"/><stop offset=\".55\" stop-color=\"#bfe3ff\"/><stop offset=\"1\" stop-color=\"#7fb4e6\"/></linearGradient></defs><circle cx=\"24\" cy=\"29\" r=\"12.5\" fill=\"none\" stroke=\"url(#rg1)\" stroke-width=\"4.4\"/><path d=\"M18.5 9.5h11l4 5-9.5 10.5L14.5 14.5z\" fill=\"url(#rg2)\" stroke=\"#6f9fd0\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M14.5 14.5h19M20.5 9.5l3.5 5 3.5-5M24 25l-3.5-10.5M24 25l3.5-10.5\" fill=\"none\" stroke=\"#fff\" stroke-opacity=\".85\" stroke-width=\".9\" stroke-linejoin=\"round\"/></svg>", t('o.resumeKeep'), t('o.resumeKeepD'), () => { haptic('impact', 'light'); mainShell(); go('home'); }),
      card("<svg viewBox=\"0 0 48 48\" width=\"34\" height=\"34\" aria-hidden=\"true\"><defs><linearGradient id=\"sg1\" x1=\"0\" y1=\"0\" x2=\"1\" y2=\"1\"><stop offset=\"0\" stop-color=\"#f6dc9a\"/><stop offset=\".55\" stop-color=\"#d9a64b\"/><stop offset=\"1\" stop-color=\"#a8742a\"/></linearGradient></defs><path d=\"M22 6l3.600 11.400L37 21l-11.400 3.600L22 36l-3.600-11.400L7 21l11.400-3.600z\" fill=\"url(#sg1)\" stroke=\"#b88a3e\" stroke-width=\"1\" stroke-linejoin=\"round\"/><path d=\"M36 28l1.600 4.400L42 34l-4.400 1.600L36 40l-1.600-4.400L30 34l4.400-1.600z\" fill=\"#f2d28a\" stroke=\"#c9953f\" stroke-width=\".8\" stroke-linejoin=\"round\"/></svg>", t('o.resumeNew'), t('o.resumeNewD'), async () => {
        haptic('impact', 'light');
        if (!(await ui.confirm(t('o.resumeNewConfirm'), t('o.resumeNew'), true))) return;
        clear(root); root.append(h('div', { class: 'o-main wiz' }, wizard(true)));
      }),
      h('button', { type: 'button', class: 'resume-exit', onclick: () => S.onExit && S.onExit() }, t('o.exit')))));
  };
})();
