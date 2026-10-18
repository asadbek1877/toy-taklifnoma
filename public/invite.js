/* invite.js — taklifnoma "tajribasi": shablon + tema + shrift bo'yicha chiziladi.
   Bitta kod: mehmon ko'radigan taklifnoma ham, egasi muharriridagi jonli preview ham shu.
   Invite.render(container, inv, opts) -> { root, destroy() }
     opts.preview   — preview rejimi (kirish animatsiyasiz, RSVP yuborilmaydi)
     opts.guestToken — shaxsiy havola tokeni (RSVP shu mehmonga bog'lanadi)               */
(function () {
  const { h, t, formatDate, applyTheme, confetti, rsvpQueue, haptic, tgUser, tg, safe } = Core;
  const C = window.CATALOG;

  // ---------- bezaklar (SVG) ----------
  const P = (d, extra) => h('path', { d, ns: true, fill: 'none', stroke: 'currentColor', 'stroke-width': '1.2', 'stroke-linecap': 'round', ...extra });
  function ornament(kind) {
    const svg = (vb, ...kids) => h('svg', { class: 'orn', viewBox: vb, 'aria-hidden': 'true' }, ...kids);
    switch (kind) {
      case 'floral': return svg('0 0 220 28', P('M10 14h72M138 14h72'), P('M110 14c-6-10-18-10-22-2 8 0 14 2 22 2zM110 14c6-10 18-10 22-2-8 0-14 2-22 2z', { fill: 'currentColor', 'fill-opacity': '.25' }), P('M110 14c-4 8-12 10-18 8 8-2 12-4 18-8zM110 14c4 8 12 10 18 8-8-2-12-4-18-8z'), h('circle', { cx: 110, cy: 14, r: 2.4, fill: 'currentColor', ns: true }));
      case 'dots': return svg('0 0 120 12', ...[40, 60, 80].map((x, i) => h('circle', { cx: x, cy: 6, r: i === 1 ? 3.2 : 2, fill: 'currentColor', ns: true })));
      case 'diamond': return svg('0 0 220 20', P('M10 10h84M126 10h84'), P('M110 2l8 8-8 8-8-8z', { fill: 'currentColor', 'fill-opacity': '.2' }), P('M96 10h4M120 10h4'));
      case 'wave': return svg('0 0 220 16', P('M0 8c11 0 11-6 22-6s11 6 22 6 11-6 22-6 11 6 22 6 11-6 22-6 11 6 22 6 11-6 22-6 11 6 22 6 11-6 22-6'));
      default: return svg('0 0 200 12', P('M10 6h74M116 6h74'), h('circle', { cx: 100, cy: 6, r: 3, fill: 'currentColor', ns: true }));
    }
  }

  const initials = (inv) => `${(inv.groom || '?')[0]}♥${(inv.bride || '?')[0]}`.toUpperCase();
  const abs = (u) => (u && u.startsWith('/') ? Core.BACKEND_URL + u : u);
  const openLink = (url) => { if (tg && tg.openLink) safe(() => tg.openLink(url)); else window.open(url, '_blank', 'noopener'); };

  function render(container, inv, opts = {}) {
    const c = inv.content;
    const tpl = C.getTemplate(inv.template);
    const cleanups = [];
    const media = (id) => (id && inv.media && inv.media[id]) || null;
    const heroM = media(c.hero.mediaId);
    const photoUrl = heroM ? abs(heroM.url) : inv.legacyPhotoUrl ? abs(inv.legacyPhotoUrl) : null;
    // preview: kirish animatsiyasi o'tkazib yuboriladi; demoIntro bo'lsa — egasi uni ko'rib chiqishi uchun ko'rsatiladi
    const introStyle = opts.preview && !opts.demoIntro ? 'none' : c.intro.style || tpl.intro;

    const root = h('div', { class: `inv tpl-${tpl.layout} orn-${tpl.ornament}${opts.preview ? ' is-preview' : ''}${introStyle === 'none' ? ' opened' : ''}` });
    applyTheme(root, inv.theme, inv.font);
    const scroll = h('div', { class: 'inv-scroll' });
    root.append(scroll);

    // ---------- HERO ----------
    const heroBg = h('div', { class: 'hero-bg' }, photoUrl ? h('img', { class: 'hero-img', src: abs(photoUrl), alt: '', decoding: 'async', fetchpriority: 'high' }) : h('div', { class: 'hero-art' }));
    const venueName = c.location.name;
    const heroBody = h('div', { class: 'hero-body' },
      h('p', { class: 'eyebrow rv-h' }, inv.guest ? t('inv.dear', { name: inv.guest.name }) : t('inv.eyebrow')),
      h('div', { class: 'hero-photo rv-h' }, photoUrl ? h('img', { src: abs(photoUrl), alt: '', decoding: 'async' }) : h('span', { class: 'mono' }, initials(inv))),
      h('p', { class: 'lead rv-h' }, c.hero.tagline || t('inv.invite')),
      h('h1', { class: 'names rv-h' }, h('span', { class: 'n1' }, inv.groom), h('i', { class: 'amp' }, t('inv.and')), h('span', { class: 'n2' }, inv.bride)),
      h('div', { class: 'orn-wrap rv-h' }, ornament(tpl.ornament)),
      h('p', { class: 'when rv-h' }, formatDate(inv.date) + (inv.ceremonyTime ? ` · ${inv.ceremonyTime}` : '')),
      venueName && h('p', { class: 'where rv-h' }, '📍 ' + venueName),
      inv.message && h('p', { class: 'msg rv-h' }, inv.message),
      h('div', { class: 'cue rv-h', 'aria-hidden': 'true' }, h('span', null), t('inv.scroll')));
    scroll.append(h('section', { class: 'hero' }, heroBg, h('div', { class: 'hero-veil' }), heroBody));

    // ---------- bo'lim yordamchilari ----------
    const sec = (cls, title, ...body) => h('section', { class: `sec ${cls} rv` }, h('h2', { class: 'sec-title' }, title), h('div', { class: 'orn-wrap' }, ornament(tpl.ornament)), ...body);
    const imgEl = (m, cls, thumb) => m && m.kind === 'image' ? h('img', { class: cls, src: abs(thumb && m.thumb ? m.thumb : m.url), alt: '', loading: 'lazy', decoding: 'async' }) : null;

    // Kutish (countdown) — jonli
    function countdown() {
      const target = inv.startsAt ? new Date(inv.startsAt) : new Date(`${inv.date}T${inv.ceremonyTime || '12:00'}:00`);
      const cell = (label) => { const n = h('b', null, '00'); return { el: h('div', { class: 'cd-cell' }, n, h('small', null, t(label))), n }; };
      const cells = { d: cell('cd.days'), h: cell('cd.hours'), m: cell('cd.minutes'), s: cell('cd.seconds') };
      const wrap = h('div', { class: 'cd' }, cells.d.el, cells.h.el, cells.m.el, cells.s.el);
      const over = h('p', { class: 'cd-over', hidden: true }, t('cd.today'));
      let fired = false, timer = null;
      const set = (cell, v) => { const txt = String(v).padStart(2, '0'); if (cell.n.textContent !== txt) { cell.n.textContent = txt; cell.n.classList.remove('tick'); void cell.n.offsetWidth; cell.n.classList.add('tick'); } };
      function tick() {
        const diff = target.getTime() - Date.now();
        if (diff <= 0) {
          wrap.hidden = true; over.hidden = false; clearInterval(timer);
          if (!fired && !opts.preview && root.classList.contains('opened')) { fired = true; confetti(root); }
          return;
        }
        const s = Math.floor(diff / 1000);
        set(cells.d, Math.floor(s / 86400)); set(cells.h, Math.floor((s % 86400) / 3600)); set(cells.m, Math.floor((s % 3600) / 60)); set(cells.s, s % 60);
      }
      tick(); timer = setInterval(() => { if (!document.hidden) tick(); }, 1000);
      cleanups.push(() => clearInterval(timer));
      return sec('countdown', t('cd.title'), wrap, over);
    }

    function story() {
      return sec('story', t('sec.story'), h('ol', { class: 'timeline' }, c.story.map((s) => {
        const m = media(s.mediaId);
        return h('li', { class: 'tl-item rv' }, h('span', { class: 'tl-dot' }), s.date && h('span', { class: 'tl-date' }, s.date), h('h3', null, s.title), s.text && h('p', null, s.text), imgEl(m, 'tl-img', true));
      })));
    }

    function schedule() {
      return sec('schedule', t('sec.schedule'), h('div', { class: 'sched' }, c.schedule.map((e) =>
        h('div', { class: 'sched-row rv' }, h('div', { class: 'sched-time' }, e.time || '—'), h('div', { class: 'sched-ico' }, e.icon), h('div', { class: 'sched-txt' }, h('h3', null, e.title), e.text && h('p', null, e.text))))));
    }

    function location() {
      const L = c.location, has = L.lat != null && L.lng != null, q = has ? `${L.lat},${L.lng}` : encodeURIComponent(L.mapQuery || L.address || L.name || '');
      const holder = h('div', { class: 'map-holder' });
      if (q) {
        // Xarita iframe'i faqat ko'rinishga kelganda (mobil tezlik)
        const io = new IntersectionObserver((es) => es.forEach((e) => {
          if (e.isIntersecting) { holder.append(h('iframe', { src: `https://www.google.com/maps?q=${q}&z=16&output=embed`, loading: 'lazy', referrerpolicy: 'no-referrer-when-downgrade', title: 'Map' })); io.disconnect(); }
        }), { root: scroll, rootMargin: '200px' });
        io.observe(holder); cleanups.push(() => io.disconnect());
      }
      return sec('location', t('sec.location'),
        L.name && h('p', { class: 'loc-name' }, L.name), L.address && h('p', { class: 'loc-addr' }, L.address), L.notes && h('p', { class: 'loc-notes' }, L.notes),
        q && holder,
        q && h('div', { class: 'btn-row' },
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openLink(has ? `https://www.google.com/maps/search/?api=1&query=${q}` : `https://www.google.com/maps?q=${q}`) }, t('loc.google')),
          h('button', { class: 'btn ghost', type: 'button', onclick: () => openLink(has ? `https://yandex.uz/maps/?pt=${L.lng},${L.lat}&z=17&l=map` : `https://yandex.uz/maps/?text=${q}`) }, t('loc.yandex'))));
    }

    function dress() {
      const d = c.dress;
      return sec('dress', t('sec.dress'), d.text && h('p', { class: 'dress-text' }, d.text),
        d.colors.length > 0 && h('div', { class: 'swatches' }, d.colors.map((col) => h('span', { class: 'swatch', style: { background: col }, title: col }))),
        (d.dos || d.donts) && h('div', { class: 'dd' }, d.dos && h('div', { class: 'dd-card yes' }, h('b', null, '✓ ' + t('dress.do')), h('p', null, d.dos)), d.donts && h('div', { class: 'dd-card no' }, h('b', null, '✕ ' + t('dress.dont')), h('p', null, d.donts))));
    }

    function menu() {
      return sec('menu', t('sec.menu'), h('div', { class: 'menu' }, c.menu.map((m) => h('div', { class: 'menu-card rv' }, m.title && h('h3', null, m.title), h('ul', null, m.items.map((i) => h('li', null, i)))))));
    }

    function gallery() {
      const items = c.gallery.map(media).filter((m) => m && m.kind === 'image');
      if (!items.length) return null;
      const grid = h('div', { class: 'gal' }, items.map((m, i) => h('button', { class: 'gal-item', type: 'button', 'aria-label': String(i + 1), onclick: () => lightbox(items, i) }, imgEl(m, '', true))));
      return sec('gallery', t('sec.gallery'), grid);
    }

    // Lightbox: svayp, yopish, hisoblagich
    function lightbox(items, start) {
      let i = start, x0 = null;
      const img = h('img', { alt: '', decoding: 'async' });
      const count = h('span', { class: 'lb-count' });
      const show = (n) => { i = (n + items.length) % items.length; img.src = abs(items[i].url); count.textContent = `${i + 1} / ${items.length}`; };
      const close = () => { lb.classList.add('out'); setTimeout(() => lb.remove(), 220); Core.back.pop(close); };
      const lb = h('div', { class: 'lightbox', onclick: (e) => { if (e.target === lb || e.target === img) close(); } },
        h('button', { class: 'lb-x', type: 'button', onclick: close, 'aria-label': 'Close' }, '✕'), img, count,
        items.length > 1 && h('button', { class: 'lb-nav prev', type: 'button', onclick: () => show(i - 1), 'aria-label': 'prev' }, '‹'),
        items.length > 1 && h('button', { class: 'lb-nav next', type: 'button', onclick: () => show(i + 1), 'aria-label': 'next' }, '›'));
      lb.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
      lb.addEventListener('touchend', (e) => { if (x0 == null) return; const dx = e.changedTouches[0].clientX - x0; if (Math.abs(dx) > 50) show(i + (dx < 0 ? 1 : -1)); x0 = null; }, { passive: true });
      root.append(lb); show(start); Core.back.push(close);
    }

    function video() {
      const m = media(c.video.mediaId);
      if (!m || m.kind !== 'video') return null;
      const v = h('video', { src: abs(m.url), controls: true, playsinline: true, preload: 'none' });
      const play = h('button', { class: 'vid-play', type: 'button', 'aria-label': 'Play', onclick: () => { v.preload = 'auto'; play.remove(); v.play().catch(() => {}); } }, h('span', null, '▶'));
      return sec('video', t('sec.video'), h('div', { class: 'vid' }, v, play));
    }

    function custom(id) {
      const x = c.custom.find((y) => y.id === id);
      if (!x) return null;
      return sec('custom', x.title, x.emoji && h('div', { class: 'cust-emoji' }, x.emoji), x.text && h('p', { class: 'cust-text' }, x.text), imgEl(media(x.mediaId), 'cust-img', false));
    }

    const builders = { countdown, story, schedule, location, dress, menu, gallery, video };
    const hasData = {
      story: c.story.length, schedule: c.schedule.length, menu: c.menu.length,
      location: c.location.name || c.location.address || c.location.mapQuery || c.location.lat, dress: c.dress.text || c.dress.colors.length || c.dress.dos || c.dress.donts,
      gallery: c.gallery.length, video: c.video.mediaId, countdown: true,
    };
    // Qat'iy tartib: hisoblagich, manzil, menyu, galereya, video, keyin maxsus bo'limlar (hikoya/dastur/dress-code olib tashlangan)
    ['countdown', 'location', 'gallery', 'video'].forEach((id) => { const el = hasData[id] ? builders[id]() : null; if (el) scroll.append(el); });

    // ---------- RSVP ----------
    const rs = c.rsvp;
    const key = opts.guestToken || inv.code;
    const maxParty = inv.guest ? inv.guest.maxParty : rs.maxParty;
    const closedLocal = rs.deadline && new Date().toISOString().slice(0, 10) > rs.deadline;
    const nameIn = h('input', { type: 'text', maxlength: 100, autocomplete: 'name', value: inv.guest ? inv.guest.name : tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') : '', placeholder: t('rsvp.namePh') });
    const countIn = h('input', { type: 'number', min: 1, max: maxParty, value: 1, inputmode: 'numeric' });
    const commentIn = h('textarea', { rows: 3, maxlength: 1000, placeholder: t('rsvp.commentPh') });
    const msgEl = h('p', { class: 'form-msg', hidden: true, role: 'status' });
    let status = '';
    const segBtns = ['yes', 'no'].map((s) => h('button', { type: 'button', class: 'seg-btn', dataset: { s }, onclick: () => { status = s; segBtns.forEach((b) => b.classList.toggle('on', b.dataset.s === s)); countRow.hidden = s === 'no' || maxParty < 2; haptic('impact', 'light'); } }, t(s === 'yes' ? 'rsvp.yes' : 'rsvp.no')));
    const step = (d) => { countIn.value = Math.min(maxParty, Math.max(1, (parseInt(countIn.value, 10) || 1) + d)); haptic('impact', 'light'); };
    const countRow = h('div', { class: 'field', hidden: maxParty < 2 }, h('label', null, t('rsvp.count')),
      h('div', { class: 'stepper' }, h('button', { type: 'button', onclick: () => step(-1), 'aria-label': '-' }, '−'), countIn, h('button', { type: 'button', onclick: () => step(1), 'aria-label': '+' }, '+')));
    const deliver = h('p', { class: 'delivery', role: 'status' });
    const okTitle = h('p', { class: 'ok-title' });
    const okCard = h('div', { class: 'rsvp-ok', hidden: true }, h('div', { class: 'ok-ico' }, '💛'), okTitle, deliver,
      h('button', { class: 'btn ghost', type: 'button', onclick: () => { okCard.hidden = true; form.hidden = false; status = ''; segBtns.forEach((b) => b.classList.remove('on')); commentIn.value = ''; } }, t('rsvp.another')));
    let currentId = null;
    const paintDelivery = () => {
      if (!currentId) return;
      const st = rsvpQueue.status(currentId), why = rsvpQueue.reason(currentId);
      deliver.className = 'delivery ' + (st === 'sent' ? 'is-ok' : st === 'rejected' ? 'is-warn' : 'is-wait');
      deliver.textContent = st === 'sent' ? t('delivery.sent') : st === 'rejected' ? (why === 'closed' ? t('rsvp.closed') : t('delivery.rejected')) : t('delivery.pending');
    };
    if (!opts.preview) rsvpQueue.onChange(paintDelivery);
    function showOk(st) { okTitle.textContent = t(st === 'yes' ? 'rsvp.okYes' : 'rsvp.okNo'); okCard.hidden = false; form.hidden = true; paintDelivery(); }
    function submit(e) {
      e.preventDefault(); msgEl.hidden = true;
      if (opts.preview) { msgEl.textContent = t('rsvp.preview'); msgEl.hidden = false; return; }
      const name = nameIn.value.trim();
      const fail = (k) => { msgEl.textContent = t(k); msgEl.hidden = false; haptic('notify', 'error'); };
      if (!name) return fail('rsvp.errName');
      if (!status) return fail('rsvp.errStatus');
      currentId = rsvpQueue.submit({
        guestName: name, status, guestCount: status === 'no' ? 1 : Math.min(maxParty, parseInt(countIn.value, 10) || 1),
        comment: commentIn.value.trim() || null, language: Core.getLang(), ...(opts.guestToken ? { guestToken: opts.guestToken } : { weddingCode: inv.code }),
      });
      haptic('notify', 'success');
      showOk(status);
      if (status === 'yes') confetti(root, { y: 0.6 });
    }
    const form = h('form', { class: 'rsvp-form', novalidate: true, onsubmit: submit },
      h('div', { class: 'field' }, h('label', null, t('rsvp.name')), nameIn),
      h('div', { class: 'seg' }, segBtns), countRow,
      rs.askComment && h('div', { class: 'field' }, h('label', null, t('rsvp.comment')), commentIn),
      h('button', { class: 'btn primary', type: 'submit' }, t('rsvp.submit')), msgEl);
    const rsvpSec = h('section', { class: 'sec rsvp rv', id: 'rsvp' }, h('h2', { class: 'sec-title' }, t('sec.rsvp')), h('div', { class: 'orn-wrap' }, ornament(tpl.ornament)),
      rs.deadline && h('p', { class: 'deadline' }, t('rsvp.deadline', { date: formatDate(rs.deadline) })),
      closedLocal ? h('p', { class: 'closed' }, t('rsvp.closed')) : [form, okCard]);
    scroll.append(rsvpSec);
    const giftSec = giftSection();
    if (giftSec) scroll.append(giftSec);
    scroll.append(h('footer', { class: 'inv-foot' }, h('div', { class: 'orn-wrap' }, ornament(tpl.ornament)), h('p', { class: 'foot-names' }, `${inv.groom} & ${inv.bride}`), h('p', { class: 'foot-date' }, formatDate(inv.date)), h('p', { class: 'foot-thanks' }, t('inv.footer'))));

    // To'yona: karta raqami + bir bosishda nusxa + bank ilovalari
    function giftSection() {
      const g = c.gift;
      if (!g || !g.on || !g.cards || !g.cards.length) return null;
      const fmt = (n) => n.replace(/(\d{4})(?=\d)/g, '$1 ');
      const brand = (n) => (n.startsWith('8600') || n.startsWith('5614') ? 'UZCARD' : n.startsWith('9860') ? 'HUMO' : n.startsWith('4') ? 'VISA' : n.startsWith('5') ? 'MASTERCARD' : '');
      const copy = async (text) => {
        try { await navigator.clipboard.writeText(text); return true; } catch (e) {
          try { const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }); ta.value = text; document.body.append(ta); ta.select(); const ok = document.execCommand('copy'); ta.remove(); return ok; } catch (e2) { return false; }
        }
      };
      const hint = h('p', { class: 'gift-hint', role: 'status' });
      let chosen = g.cards[0].number;
      const say = (k) => { hint.textContent = t(k); hint.classList.remove('flash'); void hint.offsetWidth; hint.classList.add('flash'); };
      const cards = g.cards.map((x) => {
        const cardEl = h('button', { type: 'button', class: 'gift-card', onclick: async () => { chosen = x.number; haptic('notify', 'success'); if (await copy(x.number)) say('gift.copied'); } },
          h('div', { class: 'gift-card-top' }, h('span', { class: 'gift-chip' }), h('span', { class: 'gift-brand' }, x.bank || brand(x.number))),
          h('div', { class: 'gift-num' }, fmt(x.number)),
          h('div', { class: 'gift-card-bot' }, h('span', null, x.holder || `${inv.groom} & ${inv.bride}`), h('span', { class: 'gift-copy' }, t('gift.copy'))));
        return cardEl;
      });
      const APPS = [
        { id: 'click', name: 'Click', url: 'https://my.click.uz/', scheme: 'click://' },
        { id: 'payme', name: 'Payme', url: 'https://payme.uz/', scheme: 'payme://' },
        { id: 'uzum', name: 'Uzum Bank', url: 'https://uzumbank.uz/', scheme: 'uzumbank://' },
        { id: 'tbc', name: 'TBC Bank', url: 'https://tbcbank.uz/', scheme: 'tbcuz://' },
      ];
      const direct = (g.links || {});
      const openApp = async (a) => {
        haptic('impact', 'medium');
        const url = direct[a.id] || a.url; // egasining to'lov havolasi bo'lsa — to'g'ridan-to'g'ri o'tkazmaga
        await copy(chosen); say(direct[a.id] ? 'gift.direct' : 'gift.copiedOpen');
        const web = () => { const tgw = window.Telegram && window.Telegram.WebApp; if (tgw && tgw.openLink) tgw.openLink(url); else window.open(url, '_blank', 'noopener'); };
        // ilova sxemasi bilan to'g'ridan-to'g'ri ochishga urinish; ilova ochilmasa (sahifa yashirinmasa) — veb-havolaga qaytamiz
        setTimeout(() => {
          if (direct[a.id] || !a.scheme) return web();
          let left = false;
          const onHide = () => { if (document.hidden) left = true; };
          document.addEventListener('visibilitychange', onHide);
          try { window.location.href = a.scheme; } catch (e) { /* fallback below */ }
          setTimeout(() => { document.removeEventListener('visibilitychange', onHide); if (!left && !document.hidden) web(); }, 1300);
        }, 450);
      };
      return h('section', { class: 'sec gift rv', id: 'gift' }, h('h2', { class: 'sec-title' }, t('sec.gift')), h('div', { class: 'orn-wrap' }, ornament(tpl.ornament)),
        h('p', { class: 'gift-note' }, g.note || t('gift.note')),
        h('div', { class: 'gift-cards' }, cards),
        h('p', { class: 'gift-label' }, t('gift.via')),
        h('div', { class: 'gift-apps' }, APPS.map((a) => h('button', { type: 'button', class: 'gift-app gift-' + a.id, onclick: () => openApp(a) }, h('i'), h('span', null, a.name)))),
        hint, sentBlock());
    }

    // O'tkazmadan keyin: summani kiritib tasdiqlash -> egalariga darhol xabar
    function sentBlock() {
      const amt = h('input', { class: 'gift-amt', inputmode: 'numeric', placeholder: t('gift.amountPh'), autocomplete: 'off',
        oninput: (e) => { const d = e.target.value.replace(/\D/g, '').slice(0, 11); e.target.value = d ? Number(d).toLocaleString('ru-RU').replace(/,/g, ' ') : ''; } });
      const note = h('input', { class: 'gift-amt gift-note-in', maxlength: 300, placeholder: t('gift.commentPh') });
      const msg = h('p', { class: 'gift-msg', role: 'status' });
      const send = h('button', { type: 'button', class: 'btn primary' }, t('gift.confirm'));
      const form = h('div', { class: 'gift-form', hidden: true }, h('label', null, t('gift.amount')), amt, note, send, msg);
      const open = h('button', { type: 'button', class: 'btn ghost gift-sent-btn', onclick: () => { haptic('impact', 'medium'); open.hidden = true; form.hidden = false; setTimeout(() => amt.focus(), 80); } }, '✅ ' + t('gift.sent'));
      const done = h('div', { class: 'gift-done', hidden: true }, h('div', { class: 'ok-ico' }, '💛'), h('p', null, t('gift.thanks')));
      send.onclick = async () => {
        if (opts.preview) { msg.textContent = t('rsvp.preview'); return; }
        const amount = Number(amt.value.replace(/\D/g, ''));
        if (!amount || amount < 1000) { msg.textContent = t('gift.errAmount'); haptic('notify', 'error'); return; }
        send.disabled = true; msg.textContent = '';
        try {
          await Core.api('/api/invite/gift', { amount, comment: note.value.trim(), ...(opts.guestToken ? { token: opts.guestToken } : { code: inv.code }) });
          haptic('notify', 'success'); form.hidden = true; done.hidden = false; confetti(root, { y: 0.7 });
        } catch (e) { msg.textContent = t(e && e.status === 429 ? 'gift.errSlow' : 'gift.errSend'); haptic('notify', 'error'); }
        finally { send.disabled = false; }
      };
      return h('div', { class: 'gift-sent' }, open, form, done);
    }

    // Qurilmada yuborilmay qolgan javob bo'lsa — qayta ko'rsatamiz
    if (!opts.preview) {
      const pend = rsvpQueue.pendingFor(key);
      if (pend) { currentId = pend.clientId; showOk(pend.payload.status); }
    }

    // ---------- suzuvchi "Javob berish" tugmasi (konversiya) ----------
    const fab = h('button', { class: 'fab', type: 'button', onclick: () => rsvpSec.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, t('inv.fab'));
    root.append(fab);

    // ---------- parallaks + paydo bo'lish ----------
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let ticking = false;
    const onScroll = () => {
      if (ticking) return; ticking = true;
      requestAnimationFrame(() => {
        const y = scroll.scrollTop, vh = scroll.clientHeight || 1;
        if (!reduce) {
          heroBg.style.transform = `translate3d(0, ${y * 0.32}px, 0) scale(1.08)`;
          heroBody.style.transform = `translate3d(0, ${y * -0.12}px, 0)`;
          heroBody.style.opacity = String(Math.max(0, 1 - y / (vh * 0.8)));
        }
        fab.classList.toggle('show', y > vh * 0.6 && y + vh < rsvpSec.offsetTop + 80);
        ticking = false;
      });
    };
    scroll.addEventListener('scroll', onScroll, { passive: true });
    // har bir blok chap/o'ngdan navbat bilan paydo bo'ladi, o'qib bo'lingach tepaga ketganda so'nadi
    const io = new IntersectionObserver((es) => es.forEach((e) => {
      const el = e.target;
      if (e.isIntersecting) { el.classList.remove('gone'); el.classList.add('in'); return; }
      el.classList.remove('in');
      el.classList.toggle('gone', !!e.rootBounds && e.boundingClientRect.top < e.rootBounds.top);
    }), { root: scroll, threshold: 0.1, rootMargin: '-4% 0px -4% 0px' });
    scroll.querySelectorAll('.rv').forEach((sec) => {
      sec.classList.add('in');
      [...sec.children].forEach((el, i) => {
        el.classList.add('rv-i');
        el.style.setProperty('--rx', i % 2 ? '44px' : '-44px');
        el.style.setProperty('--d', Math.min(i * 0.12, 0.5) + 's');
        io.observe(el);
      });
    });
    cleanups.push(() => { io.disconnect(); scroll.removeEventListener('scroll', onScroll); });

    // ---------- musiqa ----------
    const mu = media(c.music.mediaId);
    let audio = null;
    if (mu && mu.kind === 'audio') {
      audio = h('audio', { src: abs(mu.url), loop: true, preload: 'none' });
      const btn = h('button', { class: 'inv-music', type: 'button', 'aria-label': 'Music', onclick: async () => {
        haptic('impact', 'light');
        try { if (audio.paused) { await audio.play(); btn.classList.add('on'); } else { audio.pause(); btn.classList.remove('on'); } } catch (e) { btn.classList.remove('on'); }
      } }, h('span', null, '♪'));
      root.append(audio, btn);
      const onVis = () => { if (document.hidden && !audio.paused) { audio.pause(); btn.classList.remove('on'); } };
      document.addEventListener('visibilitychange', onVis);
      cleanups.push(() => { audio.pause(); document.removeEventListener('visibilitychange', onVis); });
      root._musicBtn = btn;
    }

    // ---------- kirish animatsiyasi ----------
    function openApp(fromGesture) {
      if (root.classList.contains('opened')) return;
      root.classList.add('opened');
      haptic('notify', 'success');
      if (fromGesture && audio && c.music.autoplay) audio.play().then(() => root._musicBtn.classList.add('on')).catch(() => {});
      if (fromGesture) confetti(root, { count: 70, y: 0.3 });
    }
    if (introStyle === 'envelope') scroll.after(envelopeIntro());
    else if (introStyle === 'cinematic') scroll.after(cinematicIntro());
    else openApp(false);

    function envelopeIntro() {
      // Haqiqiy konvert: qog'oz tekstura, 3D qopqoq, sinadigan mum muhr, chiqib keladigan xat
      const seal = h('button', { class: 'seal', type: 'button', 'aria-label': t('inv.tapOpen') }, h('i', { class: 'seal-half l' }), h('i', { class: 'seal-half r' }), h('span', null, initials(inv)));
      const flap = h('div', { class: 'env-flap' }, h('i', { class: 'flap-front' }), h('i', { class: 'flap-back' }));
      const letter = h('div', { class: 'env-letter' }, h('p', null, inv.guest ? t('inv.dear', { name: inv.guest.name }) : t('inv.eyebrow')), h('b', null, inv.groom), h('em', null, '&'), h('b', null, inv.bride), h('small', null, formatDate(inv.date)));
      const wrap = h('div', { class: 'env' }, h('div', { class: 'env-back' }), letter, h('div', { class: 'env-body' }), flap, seal);
      const sparks = Array.from({ length: 10 }, (_, i) => h('i', { class: 'env-spark', style: { left: `${8 + ((i * 37) % 84)}%`, top: `${10 + ((i * 53) % 78)}%`, animationDelay: `${(i * 0.37) % 3}s` } }));
      const ov = h('div', { class: 'intro intro-env' }, photoUrl && h('div', { class: 'intro-photo', style: { backgroundImage: `url(${abs(photoUrl)})` } }), h('div', { class: 'env-glow' }), ...sparks,
        h('div', { class: 'intro-inner' }, wrap, h('p', { class: 'intro-hint' }, t('inv.tapOpen'))));
      let done = false;
      const go = () => {
        if (done) return; done = true; haptic('impact', 'medium'); rustle();
        const fast = reduce ? 0.2 : 1;
        wrap.classList.add('opening');                                   // muhr sinadi, qopqoq ochiladi
        setTimeout(() => wrap.classList.add('lift'), 850 * fast);        // xat chiqadi
        setTimeout(() => { wrap.classList.add('zoom'); ov.classList.add('reveal'); haptic('impact', 'light'); }, 1900 * fast); // xat yaqinlashadi
        setTimeout(() => { ov.classList.add('gone'); openApp(true); setTimeout(() => ov.remove(), 1000); }, 2600 * fast);
      };
      ov.addEventListener('click', go); // butun ekran bosiladi (faqat konvertga tegish shart emas)
      return ov;
    }

    function cinematicIntro() {
      const vm = c.video.inIntro ? media(c.video.mediaId) : null;
      const bg = vm && vm.kind === 'video'
        ? h('video', { class: 'cine-bg', src: abs(vm.url), muted: true, loop: true, autoplay: true, playsinline: true, preload: 'auto' })
        : photoUrl ? h('div', { class: 'cine-bg kb', style: { backgroundImage: `url(${abs(photoUrl)})` } }) : h('div', { class: 'cine-bg cine-art' });
      if (vm) safe(() => { bg.muted = true; });
      const ov = h('div', { class: 'intro intro-cine' }, bg, h('div', { class: 'cine-veil' }),
        h('div', { class: 'cine-text' },
          h('p', { class: 'c1' }, inv.guest ? t('inv.dear', { name: inv.guest.name }) : t('inv.eyebrow')),
          h('h2', { class: 'c2' }, inv.groom), h('i', { class: 'c3' }, t('inv.and')), h('h2', { class: 'c4' }, inv.bride),
          h('p', { class: 'c5' }, formatDate(inv.date)), h('p', { class: 'c6' }, t('inv.cineTap'))),
        h('i', { class: 'curtain l' }), h('i', { class: 'curtain r' }));
      let done = false;
      ov.addEventListener('click', () => {
        if (done) return; done = true; haptic('impact', 'medium'); ov.classList.add('opening');
        setTimeout(() => { openApp(true); }, 450);
        setTimeout(() => ov.remove(), 1300);
      });
      return ov;
    }

    // Qog'oz shitirlashi (Web Audio, tashqi fayl yo'q)
    function rustle() {
      if (reduce) return;
      try {
        const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
        const ctx = new AC(), dur = 0.7, buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate), d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
        const src = ctx.createBufferSource(); src.buffer = buf;
        const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = 2600; f.Q.value = 0.8;
        const g = ctx.createGain(), n = ctx.currentTime;
        g.gain.setValueAtTime(0.0001, n); g.gain.exponentialRampToValueAtTime(0.2, n + 0.08); g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
        src.connect(f).connect(g).connect(ctx.destination); src.start(n); src.stop(n + dur); src.onended = () => ctx.close();
      } catch (e) { /* ovoz muhim emas */ }
    }

    container.replaceChildren(root);
    return { root, scroll, destroy() { cleanups.forEach((fn) => safe(fn)); root.remove(); } };
  }

  window.Invite = { render, ornament };
})();
