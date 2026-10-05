/* owner-guests.js — mehmonlar boshqaruvi (guruhlar, shaxsiy havolalar, import/eksport) va statistika (voronka, grafik, lenta). */
(function () {
  const ns = window.OwnerApp, { S, ui } = ns;
  const { h, t, api, haptic, toast, clear } = Core;

  // ================= MEHMONLAR =================
  const G = { data: null, filter: 'all', group: 'all', q: '' };
  const initials = (n) => (n || '?').trim().split(/\s+/).slice(0, 2).map((x) => x[0]).join('').toUpperCase();
  const names = () => `${S.draft.groom} & ${S.draft.bride}`;
  const groupOf = (id) => (G.data.groups.find((g) => g.id === id) || null);

  function status(g) {
    if (g.rsvp) return g.rsvp.status === 'yes' ? { c: 'yes', txt: `✓ ${t('o.gYes')}${g.rsvp.count > 1 ? ' ×' + g.rsvp.count : ''}` } : { c: 'no', txt: `✕ ${t('o.gNo')}` };
    return g.opened ? { c: 'seen', txt: '👁 ' + t('o.gOpened') } : { c: 'new', txt: t('o.gNotOpened') };
  }
  const matches = (g) => {
    if (G.filter === 'pending' && g.rsvp) return false;
    if (G.filter === 'yes' && !(g.rsvp && g.rsvp.status === 'yes')) return false;
    if (G.filter === 'no' && !(g.rsvp && g.rsvp.status === 'no')) return false;
    if (G.filter === 'unopened' && g.opened) return false;
    if (G.group !== 'all' && (G.group === 'none' ? g.groupId : g.groupId !== G.group)) return false;
    if (G.q && !g.name.toLowerCase().includes(G.q)) return false;
    return true;
  };
  const shareGuest = (g) => ui.share(g.link, t('o.guestShareText', { name: g.name, names: names() }));

  function guestSheet(g) {
    const link = h('div', { class: 'o-linkbox' }, g.link);
    const st = status(g);
    const body = h('div', { class: 'o-col' },
      h('div', { class: 'o-g-head' }, h('div', { class: 'o-av big' }, initials(g.name)), h('div', null, h('b', null, g.name), h('small', null, [groupOf(g.groupId) && `${groupOf(g.groupId).emoji || ''} ${groupOf(g.groupId).name}`, `${t('o.maxParty')}: ${g.maxParty}`].filter(Boolean).join(' · ')))),
      h('span', { class: 'o-badge ' + st.c }, st.txt), g.rsvp && g.rsvp.comment && h('p', { class: 'o-quote' }, `«${g.rsvp.comment}»`), link,
      ui.btn('📤 ' + t('o.sendLink'), () => shareGuest(g), 'primary'), h('div', { class: 'o-row2' }, ui.btn('📋 ' + t('o.copy'), () => ui.copy(g.link), 'ghost'), ui.btn('✏️ ' + t('o.edit'), () => { ctl.close(); guestForm(g); }, 'ghost')),
      ui.btn('🗑 ' + t('o.delete'), async () => { if (!(await ui.confirm(t('o.deleteGuest', { name: g.name }), t('o.delete'), true))) return; try { await api('/api/owner/guests/delete', { id: g.id }); ctl.close(); haptic('notify', 'success'); await load(); } catch (e) { ui.err(e); } }, 'ghost danger'));
    const ctl = ui.sheet(g.name, body);
  }

  function guestForm(g) {
    const f = g ? { name: g.name, groupId: g.groupId, maxParty: g.maxParty, phone: g.phone || '', note: g.note || '' } : { name: '', groupId: null, maxParty: 1, phone: '', note: '' };
    const name = h('input', { class: 'o-input', value: f.name, maxlength: 80, placeholder: t('o.guestNamePh'), oninput: (e) => { f.name = e.target.value; } });
    const party = h('input', { class: 'o-input', type: 'number', min: 1, max: 20, value: f.maxParty, inputmode: 'numeric', oninput: (e) => { f.maxParty = Math.min(20, Math.max(1, parseInt(e.target.value, 10) || 1)); } });
    const gchips = ui.chips([{ id: 0, label: t('o.noGroup') }, ...G.data.groups.map((x) => ({ id: x.id, label: `${x.emoji || ''} ${x.name}`.trim() }))], () => f.groupId || 0, (v) => { f.groupId = v || null; });
    const err = h('p', { class: 'o-err', hidden: true }, t('o.nameRequired'));
    const save = ui.btn(t('o.save'), async () => {
      if (!f.name.trim()) { err.hidden = false; return; }
      save.disabled = true;
      try { const r = await api('/api/owner/guests/save', { id: g && g.id, ...f }); haptic('notify', 'success'); ctl.close(); await load(); if (!g) { const ng = G.data.guests.find((x) => x.id === r.id); if (ng) guestSheet(ng); } }
      catch (e) { save.disabled = false; toast(e.data && e.data.error === 'limit' ? t('o.guestLimit') : t('o.error'), 'err'); }
    }, 'primary');
    const ctl = ui.sheet(g ? t('o.editGuest') : t('o.addGuest'), h('div', { class: 'o-col' }, ui.field(t('o.guestName'), name), err, ui.field(t('o.group'), gchips), ui.field(t('o.maxParty'), party, t('o.partyHint')),
      ui.field(t('o.phone'), h('input', { class: 'o-input', type: 'tel', value: f.phone, maxlength: 30, oninput: (e) => { f.phone = e.target.value; } })), ui.field(t('o.note'), h('input', { class: 'o-input', value: f.note, maxlength: 200, oninput: (e) => { f.note = e.target.value; } })), save));
  }

  function importSheet() {
    const ta = h('textarea', { class: 'o-input', rows: 9, placeholder: t('o.importPh') });
    const go = ui.btn(t('o.import'), async () => {
      if (!ta.value.trim()) return; go.disabled = true;
      try { const r = await api('/api/owner/guests/import', { text: ta.value }); haptic('notify', 'success'); toast(t('o.importDone', { n: r.created, s: r.skipped })); ctl.close(); await load(); }
      catch (e) { go.disabled = false; ui.err(e); }
    }, 'primary');
    const ctl = ui.sheet(t('o.importTitle'), h('div', { class: 'o-col' }, h('p', { class: 'o-muted' }, t('o.importSub')), ta, go), { tall: true });
  }

  function groupsSheet() {
    const list = h('div', { class: 'o-col' });
    const ctl = ui.sheet(t('o.groups'), list, { onClose: () => load() });
    const draw = () => {
      clear(list);
      G.data.groups.forEach((gr) => {
        const nm = h('input', { class: 'o-input', value: gr.name, maxlength: 40 }), em = h('input', { class: 'o-input emoji', value: gr.emoji || '', maxlength: 8, placeholder: '🙂' });
        const upd = async () => { if (!nm.value.trim()) return; try { await api('/api/owner/groups/save', { id: gr.id, name: nm.value, emoji: em.value }); gr.name = nm.value.trim(); gr.emoji = em.value; } catch (e) { ui.err(e); } };
        nm.addEventListener('change', upd); em.addEventListener('change', upd);
        list.append(h('div', { class: 'o-grp' }, em, nm, ui.btn('✕', async () => { if (!(await ui.confirm(t('o.deleteGroup', { name: gr.name }), t('o.delete'), true))) return; await api('/api/owner/groups/delete', { id: gr.id }).catch(ui.err); G.data.groups = G.data.groups.filter((x) => x.id !== gr.id); G.data.guests.forEach((x) => { if (x.groupId === gr.id) x.groupId = null; }); draw(); }, 'ghost small icon danger')));
      });
      const nn = h('input', { class: 'o-input', maxlength: 40, placeholder: t('o.newGroup') }), ne = h('input', { class: 'o-input emoji', maxlength: 8, placeholder: '👨‍👩‍👧' });
      list.append(h('div', { class: 'o-grp new' }, ne, nn, ui.btn('➕', async () => {
        if (!nn.value.trim()) return;
        try { const r = await api('/api/owner/groups/save', { name: nn.value, emoji: ne.value }); G.data.groups.push(r.group); draw(); haptic('notify', 'success'); } catch (e) { ui.err(e); }
      }, 'primary small icon')));
    };
    draw();
  }

  let paint = null;
  async function load() {
    try { G.data = await api('/api/owner/guests/list', {}); } catch (e) { if (paint) paint(true); return ui.err(e); }
    if (paint) paint(false);
  }

  ns.screens.guests = () => {
    const wrap = h('div', { class: 'o-screen' });
    const head = h('div'), list = h('div', { class: 'o-glist' }), filters = h('div');
    wrap.append(ui.title(t('o.guestsTitle')), head, filters, list);
    paint = (failed) => {
      if (!wrap.isConnected && wrap.parentNode === null && !document.contains(wrap)) { /* ekran almashgan bo'lishi mumkin — baribir chizamiz */ }
      clear(head); clear(filters); clear(list);
      if (failed || !G.data) { list.append(ui.empty('📡', t('o.network')), ui.btn(t('o.retry'), load, 'ghost')); return; }
      const st = G.data.stats;
      const k = (n, l) => h('div', { class: 'o-kpi' }, h('b', null, String(n)), h('small', null, l));
      head.append(h('div', { class: 'o-kpis' }, k(st.total, t('o.kInvited')), k(st.opened, t('o.kOpened')), k(st.people, t('o.kComing')), k(st.pending, t('o.kPending'))),
        h('div', { class: 'o-actions' }, ui.btn('➕ ' + t('o.add'), () => guestForm(null), 'primary small'), ui.btn('📥 ' + t('o.import'), importSheet, 'ghost small'), ui.btn('🏷 ' + t('o.groups'), groupsSheet, 'ghost small'),
          ui.btn('📤 CSV', async () => { if (!(await ui.confirm(t('o.exportConfirm'), t('o.send')))) return; try { await api('/api/owner/guests/export', {}); haptic('notify', 'success'); toast(t('o.exportQueued')); } catch (e) { ui.err(e); } }, 'ghost small')));
      const search = h('input', { class: 'o-input search', value: G.q, placeholder: '🔍 ' + t('o.search'), oninput: (e) => { G.q = e.target.value.trim().toLowerCase(); drawList(); } });
      filters.append(search, ui.chips([['all', 'o.fAll'], ['pending', 'o.fPending'], ['yes', 'o.fYes'], ['no', 'o.fNo'], ['unopened', 'o.fUnopened']].map(([id, k]) => ({ id, label: t(k) })), () => G.filter, (v) => { G.filter = v; drawList(); }, 'scroll'),
        G.data.groups.length ? ui.chips([{ id: 'all', label: t('o.allGroups') }, ...G.data.groups.map((x) => ({ id: x.id, label: `${x.emoji || ''} ${x.name}`.trim() })), { id: 'none', label: t('o.noGroup') }], () => G.group, (v) => { G.group = v; drawList(); }, 'scroll') : null);
      drawList();
    };
    const drawList = () => {
      clear(list);
      const rows = G.data.guests.filter(matches);
      if (!G.data.guests.length) return list.append(ui.empty('👥', t('o.noGuests')), ui.btn('➕ ' + t('o.addGuest'), () => guestForm(null), 'primary'), ui.btn('📥 ' + t('o.import'), importSheet, 'ghost'));
      if (!rows.length) return list.append(ui.empty('🔍', t('o.nothingFound')));
      rows.forEach((g) => {
        const gr = groupOf(g.groupId), s = status(g);
        list.append(h('button', { type: 'button', class: 'o-g', onclick: () => guestSheet(g) }, h('div', { class: 'o-av' }, initials(g.name)),
          h('div', { class: 'o-g-main' }, h('b', null, g.name), h('small', null, gr ? `${gr.emoji || ''} ${gr.name}` : t('o.noGroup'))), h('span', { class: 'o-badge ' + s.c }, s.txt)));
      });
    };
    if (G.data) paint(false); else list.append(ui.spinner());
    load();
    return wrap;
  };

  // ================= STATISTIKA =================
  ns.screens.stats = () => {
    const wrap = h('div', { class: 'o-screen' });
    const body = h('div', { class: 'o-col' }, ui.spinner());
    wrap.append(ui.title(t('o.statsTitle'), t('o.statsSub')), body);
    const feed = h('div', { class: 'o-feed' });

    const bar = (label, val, max, cls = '') => h('div', { class: 'o-bar-row' }, h('span', null, label), h('div', { class: 'o-bar ' + cls }, h('i', { style: { width: max ? Math.round((val / max) * 100) + '%' : '0%' } })), h('b', null, String(val)));
    const draw = (an) => {
      clear(body);
      const k = (n, l, sub) => h('div', { class: 'o-kpi' }, h('b', null, String(n)), h('small', null, l), sub && h('em', null, sub));
      const conv = an.unique.opens ? Math.round((an.unique.rsvps / an.unique.opens) * 100) : 0;
      body.append(h('div', { class: 'o-kpis two' }, k(an.unique.linkStarts, t('o.sStarts'), t('o.sStartsD')), k(an.unique.opens, t('o.sOpens'), `${an.totals.opens} ${t('o.sTotal')}`), k(an.unique.rsvps, t('o.sRsvps')), k(conv + '%', t('o.sConv'))));

      const mx = Math.max(an.funnel.starts, an.funnel.opens, an.funnel.answered, 1);
      body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.funnel')), bar(t('o.fStart'), an.funnel.starts, mx), bar(t('o.fOpen'), an.funnel.opens, mx, 'b2'), bar(t('o.fAnswer'), an.funnel.answered, mx, 'b3')));

      const dmax = Math.max(1, ...an.perDay.map((d) => Math.max(d.open, d.rsvp, d.link_start)));
      body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.last14')), h('div', { class: 'o-spark' }, an.perDay.map((d) => h('div', { class: 'o-spark-c', title: d.date },
        h('i', { class: 'o', style: { height: Math.round((d.open / dmax) * 100) + '%' } }), h('i', { class: 'r', style: { height: Math.round((d.rsvp / dmax) * 100) + '%' } })))),
        h('div', { class: 'o-legend' }, h('span', null, h('i', { class: 'o' }), t('o.sOpens')), h('span', null, h('i', { class: 'r' }), t('o.sRsvps')))));

      const g = an.guests, gmax = Math.max(g.total, 1);
      body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.guestStats')), bar(t('o.gYes'), g.yes, gmax, 'yes'), bar(t('o.gNo'), g.no, gmax, 'no'), bar(t('o.fPending'), g.pending, gmax, 'pend'),
        h('p', { class: 'o-hint' }, t('o.peopleComing', { n: an.rsvp.people })), an.rsvp.yes + an.rsvp.no > g.answered && h('p', { class: 'o-hint' }, t('o.publicAnswers', { n: an.rsvp.yes + an.rsvp.no - g.answered }))));

      if (an.byGroup.length) body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.byGroup')), an.byGroup.map((x) => h('div', { class: 'o-grp-stat' }, h('b', null, `${x.emoji || ''} ${x.name || t('o.noGroup')}`),
        bar(t('o.kInvited'), x.total, x.total), bar(t('o.kOpened'), x.opened, x.total, 'b2'), bar(t('o.gYes'), x.yes, x.total, 'yes')))));

      // Hali ochmaganlar — tezkor eslatma
      api('/api/owner/guests/list', {}).then((gl) => {
        const un = gl.guests.filter((x) => !x.opened).slice(0, 8); if (!un.length) return;
        body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.neverOpened')), h('p', { class: 'o-hint' }, t('o.neverOpenedD')),
          un.map((x) => h('div', { class: 'o-row-between o-nudge' }, h('span', null, x.name), ui.btn(t('o.sendLink'), () => ui.share(x.link, t('o.guestShareText', { name: x.name, names: names() })), 'ghost small')))));
      }).catch(() => {});
      body.append(ui.card(h('h3', { class: 'o-h3' }, t('o.liveFeed'), h('i', { class: 'o-live' })), feed));
    };
    const loadFeed = async () => {
      try { const r = await api('/api/owner/activity', { since: 0 }); clear(feed); ns.evCache = r.events; if (!r.events.length) feed.append(ui.empty('📭', t('o.noActivity'))); r.events.forEach((e) => feed.append(ns.eventRow(e))); } catch (e) { /* keyingi poll */ }
    };
    api('/api/owner/analytics', { days: 14 }).then((an) => { draw(an); loadFeed(); }).catch((e) => { clear(body); body.append(ui.empty('📡', t('o.network')), ui.btn(t('o.retry'), () => ns.renderTab(), 'ghost')); });
    ns.startPolling(loadFeed, 12000);
    return wrap;
  };
})();
