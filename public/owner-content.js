/* owner-content.js — kontent muharriri: asosiy, hikoya, dastur, joy, dress-code, menyu, maxsus bo'limlar, media (galereya/video/musiqa), RSVP, tartib. */
(function () {
  const ns = window.OwnerApp, { S, ui } = ns;
  const { h, t, api, haptic, toast, clear } = Core;
  const C = window.CATALOG;
  const D = () => S.draft;
  const rid = () => Math.random().toString(36).slice(2, 8);

  const SUBS = ['basics', 'story', 'schedule', 'location', 'dress', 'menu', 'extra', 'media', 'rsvp', 'sections'];
  let sub = 'basics';

  const move = (arr, i, dir) => { const j = i + dir; if (j < 0 || j >= arr.length) return false; [arr[i], arr[j]] = [arr[j], arr[i]]; return true; };
  const controls = (arr, i, redraw, onRemove) => h('div', { class: 'o-ctl' },
    ui.btn('↑', () => { if (move(arr, i, -1)) { ns.touch(); redraw(); } }, 'ghost small icon'), ui.btn('↓', () => { if (move(arr, i, 1)) { ns.touch(); redraw(); } }, 'ghost small icon'),
    ui.btn('✕', () => { if (onRemove) onRemove(); arr.splice(i, 1); ns.touch(); redraw(); }, 'ghost small icon danger'));
  const fieldAi = (label, control) => h('div', { class: 'o-field' }, h('span', { class: 'o-label' }, label), control);

  // Rasm tanlash tugmasi: ko'rsatkich + tanlash/olib tashlash
  function photoPicker(get, set, label) {
    const box = h('div', { class: 'o-photo' });
    const draw = () => {
      clear(box);
      const url = get() && ns.mediaThumb(get());
      box.append(h('div', { class: 'o-photo-th', style: url ? { backgroundImage: `url(${url})` } : null }, url ? null : '📷'),
        h('div', { class: 'o-col tight' }, ui.btn(url ? t('o.replace') : label || t('o.choosePhoto'), async () => {
          const [file] = await ns.pickFiles('image/*', false); if (!file) return;
          box.classList.add('busy');
          try { const id = await ns.uploadImage(file); const old = get(); set(id); ns.touch(); if (old) ns.deleteMedia(old); draw(); haptic('notify', 'success'); }
          catch (e) { ui.err(e); } finally { box.classList.remove('busy'); }
        }, 'ghost small'), url && ui.btn(t('o.remove'), () => { const old = get(); set(null); ns.touch(); if (old) ns.deleteMedia(old); draw(); }, 'ghost small danger')));
    };
    draw(); return box;
  }

  // startsAt: sana + nikoh vaqti (egasining mahalliy vaqti)
  function recalcStarts() {
    const d = D(); const dt = new Date(`${d.date}T${d.ceremonyTime || '12:00'}:00`);
    d.startsAt = Number.isNaN(dt.getTime()) ? null : dt.toISOString();
  }

  // ---------- bo'limlar ----------
  const views = {
    basics() {
      const d = D(), c = d.content;
      const g = ui.input('groom', { maxlength: 60 }), b = ui.input('bride', { maxlength: 60 });
      g.addEventListener('input', ns.names); b.addEventListener('input', ns.names);
      const date = h('input', { class: 'o-input', type: 'date', value: d.date, oninput: (e) => { if (e.target.value) { d.date = e.target.value; recalcStarts(); ns.touch(); } } });
      const nik = h('input', { class: 'o-input', type: 'time', value: d.ceremonyTime || '', oninput: (e) => { d.ceremonyTime = e.target.value || null; recalcStarts(); ns.touch(); } });
      const ban = h('input', { class: 'o-input', type: 'time', value: d.banquetTime || '', oninput: (e) => { d.banquetTime = e.target.value || null; ns.touch(); } });
      return h('div', { class: 'o-col' },
        ui.card(h('h3', { class: 'o-h3' }, t('o.heroPhoto')), photoPicker(() => c.hero.mediaId, (v) => { c.hero.mediaId = v; }, t('o.choosePhoto')), h('p', { class: 'o-hint' }, t('o.heroPhotoHint'))),
        ui.card(ui.field(t('o.groom'), g), ui.field(t('o.bride'), b), ui.field(t('o.date'), date), h('div', { class: 'o-row2' }, ui.field(t('o.nikoh'), nik), ui.field(t('o.banquet'), ban))),
        ui.card(fieldAi(t('o.message'), ui.text('message', { rows: 4, maxlength: 600, placeholder: t('o.messagePh') }), 'message', () => d.message, (v) => { d.message = v; }),
          ui.field(t('o.tagline'), ui.input('content.hero.tagline', { maxlength: 120, placeholder: t('o.taglinePh') }))));
    },

    story() {
      const list = D().content.story, box = h('div', { class: 'o-col' });
      const draw = () => {
        clear(box);
        if (!list.length) box.append(ui.empty('📖', t('o.storyEmpty')));
        list.forEach((s, i) => box.append(ui.card(
          h('div', { class: 'o-row-between' }, h('b', null, `#${i + 1}`), controls(list, i, draw, () => { if (s.mediaId) ns.deleteMedia(s.mediaId); })),
          ui.field(t('o.storyDate'), ui.bound(s, 'date', { maxlength: 40, placeholder: '2019' })), ui.field(t('o.storyTitle'), ui.bound(s, 'title', { maxlength: 100 })),
          fieldAi(t('o.storyText'), ui.bound(s, 'text', { area: true, rows: 3, maxlength: 800 }), 'story', () => s.text, (v) => { s.text = v; }),
          photoPicker(() => s.mediaId, (v) => { s.mediaId = v; }))));
        if (list.length < 12) box.append(ui.btn('➕ ' + t('o.addStory'), () => { list.push({ date: '', title: '', text: '', mediaId: null }); ns.touch(); draw(); }, 'ghost'));
      };
      draw(); return box;
    },

    schedule() {
      const d = D(), list = d.content.schedule, box = h('div', { class: 'o-col' });
      const draw = () => {
        clear(box);
        if (!list.length) box.append(ui.empty('📅', t('o.scheduleEmpty')), ui.btn(t('o.fillFromTimes'), () => {
          if (d.ceremonyTime) list.push({ time: d.ceremonyTime, title: t('o.defNikoh'), text: '', icon: '💍' });
          if (d.banquetTime) list.push({ time: d.banquetTime, title: t('o.defBanquet'), text: '', icon: '🥂' });
          ns.touch(); draw();
        }, 'ghost'));
        list.forEach((e, i) => {
          const icons = ui.chips(C.SCHEDULE_ICONS.map((x) => ({ id: x, label: x })), () => e.icon, (v) => { e.icon = v; ns.touch(); }, 'icons');
          box.append(ui.card(h('div', { class: 'o-row-between' }, h('b', null, `#${i + 1}`), controls(list, i, draw)),
            h('div', { class: 'o-row2' }, ui.field(t('o.time'), h('input', { class: 'o-input', type: 'time', value: e.time || '', oninput: (ev) => { e.time = ev.target.value; ns.touch(); } })), ui.field(t('o.eventTitle'), ui.bound(e, 'title', { maxlength: 100 }))),
            ui.field(t('o.eventText'), ui.bound(e, 'text', { maxlength: 300 })), icons));
        });
        if (list.length < 20) box.append(ui.btn('➕ ' + t('o.addEvent'), () => { list.push({ time: '', title: '', text: '', icon: '✨' }); ns.touch(); draw(); }, 'ghost'));
      };
      draw(); return box;
    },

    location() {
      const L = D().content.location;
      const test = () => { const q = encodeURIComponent(L.mapQuery || L.address || L.name || ''); if (!q) return toast(t('o.fillLocation'), 'err'); const url = `https://www.google.com/maps?q=${q}`; if (Core.tg && Core.tg.openLink) Core.safe(() => Core.tg.openLink(url)); else window.open(url, '_blank'); };
      return h('div', { class: 'o-col' }, ui.card(ui.field(t('o.venueName'), ui.input('content.location.name', { maxlength: 120 })), ui.field(t('o.address'), ui.input('content.location.address', { maxlength: 200 })),
        ui.field(t('o.mapQuery'), ui.input('content.location.mapQuery', { maxlength: 200, placeholder: t('o.mapQueryPh') }), t('o.mapQueryHint')), ui.btn('🗺 ' + t('o.testMap'), test, 'ghost'),
        ui.field(t('o.locNotes'), ui.text('content.location.notes', { rows: 3, maxlength: 400, placeholder: t('o.locNotesPh') }))));
    },

    dress() {
      const dr = D().content.dress, box = h('div', { class: 'o-col' });
      const sw = h('div', { class: 'o-swatches' });
      const drawSw = () => {
        clear(sw);
        dr.colors.forEach((col, i) => sw.append(h('button', { type: 'button', class: 'o-sw', style: { background: col }, title: t('o.remove'), onclick: () => { dr.colors.splice(i, 1); ns.touch(); drawSw(); } }, '✕')));
        if (dr.colors.length < 6) sw.append(h('label', { class: 'o-sw add' }, '+', h('input', { type: 'color', value: '#c9a95c', onchange: (e) => { dr.colors.push(e.target.value); ns.touch(); drawSw(); } })));
      };
      drawSw();
      box.append(ui.card(fieldAi(t('o.dressText'), ui.text('content.dress.text', { rows: 3, maxlength: 500, placeholder: t('o.dressTextPh') }), 'dress', () => dr.text, (v) => { dr.text = v; }),
        ui.field(t('o.dressColors'), sw, t('o.dressColorsHint')), ui.field(t('o.dressDo'), ui.text('content.dress.dos', { rows: 2, maxlength: 300 })), ui.field(t('o.dressDont'), ui.text('content.dress.donts', { rows: 2, maxlength: 300 }))));
      return box;
    },

    menu() {
      const list = D().content.menu, box = h('div', { class: 'o-col' });
      const draw = () => {
        clear(box);
        if (!list.length) box.append(ui.empty('🍽', t('o.menuEmpty')));
        list.forEach((m, i) => {
          const items = h('textarea', { class: 'o-input', rows: 4, maxlength: 1800, placeholder: t('o.menuItemsPh') }, m.items.join('\n'));
          items.addEventListener('input', () => { m.items = items.value.split('\n').map((x) => x.trim()).filter(Boolean).slice(0, 15); ns.touch(); });
          box.append(ui.card(h('div', { class: 'o-row-between' }, h('b', null, `#${i + 1}`), controls(list, i, draw)), ui.field(t('o.course'), ui.bound(m, 'title', { maxlength: 80 })), ui.field(t('o.courseItems'), items, t('o.courseItemsHint'))));
        });
        if (list.length < 10) box.append(ui.btn('➕ ' + t('o.addCourse'), () => { list.push({ title: '', items: [] }); ns.touch(); draw(); }, 'ghost'));
      };
      draw(); return box;
    },

    extra() {
      const c = D().content, list = c.custom, box = h('div', { class: 'o-col' });
      const draw = () => {
        clear(box);
        box.append(h('p', { class: 'o-muted' }, t('o.extraSub')));
        list.forEach((x, i) => box.append(ui.card(
          h('div', { class: 'o-row-between' }, h('b', null, `#${i + 1}`), controls(list, i, draw, () => { c.sections = c.sections.filter((s) => s.id !== `custom:${x.id}`); if (x.mediaId) ns.deleteMedia(x.mediaId); })),
          h('div', { class: 'o-row2 emoji' }, ui.field(t('o.emoji'), ui.bound(x, 'emoji', { maxlength: 8, placeholder: '🎁' })), ui.field(t('o.extraTitle'), ui.bound(x, 'title', { maxlength: 80 }))),
          fieldAi(t('o.extraText'), ui.bound(x, 'text', { area: true, rows: 3, maxlength: 1500 }), 'custom', () => x.text, (v) => { x.text = v; }),
          photoPicker(() => x.mediaId, (v) => { x.mediaId = v; }))));
        if (list.length < 8) box.append(ui.btn('➕ ' + t('o.addExtra'), () => { const id = rid(); list.push({ id, title: '', text: '', emoji: '🎁', mediaId: null }); c.sections.push({ id: `custom:${id}`, on: true }); ns.touch(); draw(); }, 'ghost'));
      };
      draw(); return box;
    },

    media() {
      const c = D().content, box = h('div', { class: 'o-col' });
      const draw = () => {
        clear(box);
        // Galereya
        const grid = h('div', { class: 'o-gal' });
        c.gallery.forEach((id, i) => grid.append(h('div', { class: 'o-gal-i', style: { backgroundImage: `url(${ns.mediaThumb(id)})` } },
          h('button', { type: 'button', class: 'o-gal-x', onclick: () => { c.gallery.splice(i, 1); ns.touch(); ns.deleteMedia(id); draw(); } }, '✕'),
          i > 0 && h('button', { type: 'button', class: 'o-gal-l', onclick: () => { move(c.gallery, i, -1); ns.touch(); draw(); } }, '‹'))));
        const addBtn = ui.btn('➕ ' + t('o.addPhotos', { n: 12 - c.gallery.length }), async () => {
          const files = (await ns.pickFiles('image/*', true)).slice(0, 12 - c.gallery.length); if (!files.length) return;
          addBtn.disabled = true;
          let n = 0;
          for (const f of files) { addBtn.textContent = t('o.uploading', { n: ++n, total: files.length }); try { c.gallery.push(await ns.uploadImage(f)); ns.touch(); } catch (e) { ui.err(e); break; } }
          haptic('notify', 'success'); draw();
        }, 'ghost');
        if (c.gallery.length >= 12) addBtn.disabled = true;
        box.append(ui.card(h('h3', { class: 'o-h3' }, '🖼 ' + t('o.gallery') + ` · ${c.gallery.length}/12`), c.gallery.length ? grid : ui.empty('🖼', t('o.galleryEmpty')), addBtn));

        // Video + musiqa: yuklash progressi bilan
        const mediaBlock = (kind, ico, titleKey, accept, maxMb, getId, setId, extra) => {
          const id = getId(), item = id && S.media.items.find((m) => m.id === id);
          const prog = h('div', { class: 'o-prog', hidden: true }, h('i', { style: { width: '0%' } }));
          const upBtn = ui.btn(item ? t('o.replace') : '⬆ ' + t('o.upload'), async () => {
            const [file] = await ns.pickFiles(accept, false); if (!file) return;
            if (file.size > maxMb * 1048576) return toast(t('o.tooBig', { mb: maxMb }), 'err');
            upBtn.disabled = true; prog.hidden = false;
            try {
              const r = await Core.upload(`/api/owner/media/${kind}`, file, (p) => { prog.firstChild.style.width = Math.round(p * 100) + '%'; });
              S.media.items.push({ id: r.id, kind, size: r.size, url: `/api/media/${r.id}`, thumb: null }); S.media.usage += r.size;
              const old = getId(); setId(r.id); ns.touch(); if (old) ns.deleteMedia(old);
              haptic('notify', 'success'); draw();
            } catch (e) { toast(e.status === 413 ? t('o.quota') : e.status === 415 ? t('o.badFormat') : t('o.error'), 'err'); upBtn.disabled = false; prog.hidden = true; }
          }, 'ghost');
          const card = ui.card(h('h3', { class: 'o-h3' }, `${ico} ${t(titleKey)}`), item ? h('div', { class: 'o-media-ok' }, `✓ ${(item.size / 1048576).toFixed(1)} MB`) : h('p', { class: 'o-hint' }, t(titleKey + 'Hint', { mb: maxMb })), prog, upBtn,
            item && ui.btn(t('o.remove'), () => { setId(null); ns.touch(); ns.deleteMedia(id); draw(); }, 'ghost danger'));
          if (item && kind === 'audio') card.append(h('audio', { src: Core.BACKEND_URL + item.url, controls: true, preload: 'none', class: 'o-audio' }));
          if (item && kind === 'video') card.append(h('video', { src: Core.BACKEND_URL + item.url, controls: true, preload: 'metadata', playsinline: true, class: 'o-video' }));
          if (item && extra) card.append(extra);
          return card;
        };
        box.append(mediaBlock('video', '🎬', 'o.video', 'video/mp4,video/webm,video/quicktime', 12, () => c.video.mediaId, (v) => { c.video.mediaId = v; },
          ui.toggle(t('o.videoInIntro'), () => c.video.inIntro, (v) => { c.video.inIntro = v; ns.touch(); }, t('o.videoInIntroD'))));
        box.append(mediaBlock('audio', '🎵', 'o.music', 'audio/*', 8, () => c.music.mediaId, (v) => { c.music.mediaId = v; },
          ui.toggle(t('o.musicAuto'), () => c.music.autoplay, (v) => { c.music.autoplay = v; ns.touch(); }, t('o.musicAutoD'))));
      };
      draw(); return box;
    },

    rsvp() {
      const r = D().content.rsvp;
      const ms = h('input', { class: 'o-input', type: 'number', min: 1, max: 20, value: r.maxParty, inputmode: 'numeric', oninput: (e) => { r.maxParty = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); ns.touch(); } });
      const dl = h('input', { class: 'o-input', type: 'date', value: r.deadline || '', oninput: (e) => { r.deadline = e.target.value || ''; ns.touch(); } });
      return h('div', { class: 'o-col' }, ui.card(ui.field(t('o.deadline'), dl, t('o.deadlineHint')), ui.btn(t('o.clearDeadline'), () => { r.deadline = ''; dl.value = ''; ns.touch(); }, 'ghost small'),
        ui.field(t('o.maxParty'), ms, t('o.maxPartyHint')), ui.toggle(t('o.askComment'), () => r.askComment, (v) => { r.askComment = v; ns.touch(); })));
    },

    sections() {
      const c = D().content, list = c.sections, box = h('div', { class: 'o-col' });
      const label = (id) => id.startsWith('custom:') ? ((c.custom.find((x) => x.id === id.slice(7)) || {}).title || t('o.extra')) : t('o.sec_' + id);
      const draw = () => {
        clear(box);
        box.append(h('p', { class: 'o-muted' }, t('o.sectionsSub')), h('div', { class: 'o-fixed' }, '🎬 ' + t('o.secHero')));
        list.forEach((s, i) => box.append(h('div', { class: 'o-sec-row' + (s.on ? '' : ' off') },
          h('button', { type: 'button', class: 'o-switch' + (s.on ? ' on' : ''), onclick: () => { s.on = !s.on; ns.touch(); draw(); } }, h('i')), h('span', null, label(s.id)),
          h('div', { class: 'o-ctl' }, ui.btn('↑', () => { if (move(list, i, -1)) { ns.touch(); draw(); } }, 'ghost small icon'), ui.btn('↓', () => { if (move(list, i, 1)) { ns.touch(); draw(); } }, 'ghost small icon')))));
        box.append(h('div', { class: 'o-fixed' }, '💌 ' + t('o.secRsvp')));
      };
      draw(); return box;
    },
  };

  ns.screens.content = () => {
    const wrap = h('div', { class: 'o-screen' });
    const body = h('div', { class: 'o-sub-body' });
    const chips = h('div', { class: 'o-subnav' });
    const drawChips = () => { clear(chips); SUBS.forEach((id) => chips.append(h('button', { type: 'button', class: 'o-chip' + (sub === id ? ' on' : ''), onclick: () => { sub = id; drawChips(); drawBody(); haptic('impact', 'light'); } }, t('o.sub_' + id)))); const on = chips.querySelector('.on'); if (on) setTimeout(() => on.scrollIntoView({ inline: 'center', block: 'nearest' }), 0); };
    const drawBody = () => { clear(body); body.append(views[sub]()); Core.applyDom(body); };
    drawChips(); drawBody();
    wrap.append(chips, body, h('button', { class: 'o-fab', type: 'button', onclick: () => ui.fullPreview(), 'aria-label': 'Preview' }, '👁'));
    return wrap;
  };
})();
