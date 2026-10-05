/* app.js — marshrutlash. Kirish: Bot -> Mini App.
     ?g=<token> / start=g_  -> MEHMON, shaxsiy havola (private to'yda ham)
     ?w=<kod>  / start=w_   -> MEHMON, umumiy havola (private bo'lsa — rad etiladi)
     ?c=<token> / start=c_  -> hammuallif taklifini qabul qilish
     havolasiz              -> "to'y egasimisiz yoki mehmon?"                                   */
(function () {
  const { t, $, h, api, haptic, safe } = Core;
  const VIEWS = ['loading', 'message', 'role', 'cohost', 'invite', 'owner'];
  let invite = null; // joriy taklifnoma (til o'zgarsa qayta chizish uchun)

  function show(name) {
    VIEWS.forEach((v) => $('v-' + v).classList.toggle('is-active', v === name));
    document.body.classList.toggle('hide-lang', name === 'owner');
    if (name !== 'invite') delete document.body.dataset.invdark;
  }

  function message(ico, titleKey, textKey, btn) {
    $('msg-ico').textContent = ico;
    $('msg-title').dataset.i18n = titleKey; $('msg-text').dataset.i18n = textKey;
    $('msg-title').textContent = t(titleKey); $('msg-text').textContent = t(textKey);
    const b = $('msg-btn');
    b.hidden = !btn;
    if (btn) { b.textContent = t(btn.key); b.onclick = btn.onClick; }
    Core.setChrome('#fbf8f2');
    show('message');
  }

  // ---------- til almashtirgich ----------
  const langBtns = [...document.querySelectorAll('#lang-switch button')];
  const paintLang = () => langBtns.forEach((b) => b.classList.toggle('on', b.dataset.lang === Core.getLang()));
  langBtns.forEach((b) => b.addEventListener('click', () => { haptic('impact', 'light'); Core.setLang(b.dataset.lang, true); }));
  Core.onLang(() => { paintLang(); document.title = t('app.title'); if (invite && $('v-invite').classList.contains('is-active')) renderGuest(invite.inv, invite.opts, true); });

  // ---------- MEHMON ----------
  function renderGuest(inv, opts, rerender) {
    const ctrl = Invite.render($('v-invite'), inv, opts);
    if (rerender) ctrl.root.classList.add('opened'); // til almashganda kirish animatsiyasini takrorlamaymiz
    if (rerender && ctrl.root.querySelector('.intro')) ctrl.root.querySelector('.intro').remove();
    document.body.dataset.invdark = Core.isDark(inv.theme.bg) ? '1' : '0';
    Core.setChrome(inv.theme.bg);
    show('invite');
    return ctrl;
  }

  async function openInvite(kind, key) {
    let res = null;
    const pre = window.__prefetch && window.__prefetch.kind === kind && window.__prefetch.key === key ? await window.__prefetch.promise.catch(() => null) : null;
    if (pre) res = pre;
    else {
      try { res = { ok: true, data: await api(`/api/invite/${kind}/${encodeURIComponent(key)}`) }; }
      catch (e) { res = { ok: false, status: e.status || 0, data: e.data }; }
    }
    if (!res.ok || !res.data || !res.data.invite) {
      if (res.status === 403) return message('🔒', 'msg.private.title', 'msg.private.text', { key: 'msg.back', onClick: showRole });
      if (res.status === 404) return message('💌', 'msg.notfound.title', 'msg.notfound.text');
      return message('📡', 'msg.error.title', 'msg.error.text', { key: 'msg.retry', onClick: () => location.reload() });
    }
    const inv = res.data.invite;
    const opts = { guestToken: kind === 'g' ? key : null };
    invite = { inv, opts };
    document.title = `${inv.groom} & ${inv.bride}`;
    renderGuest(inv, opts, false);
    // Analitika: ochilish (faqat imzolangan foydalanuvchi hisobga olinadi)
    if (Core.inTelegram) api('/api/invite/view', kind === 'g' ? { token: key } : { code: key }).catch(() => {});
  }

  // ---------- ROL TANLASH ----------
  function showRole() {
    show('role');
    Core.setChrome('#fbf8f2');
    Core.back.clear();
  }
  $('role-guest').addEventListener('click', () => { haptic('impact', 'light'); message('🥂', 'role.hint.title', 'role.hint.text', { key: 'msg.back', onClick: showRole }); });
  $('role-owner').addEventListener('click', () => { haptic('impact', 'medium'); startOwner(); });

  // ---------- EGASI ----------
  let ownerLoading = null;
  function loadScript(src) { return new Promise((res, rej) => { const s = h('script', { src }); s.onload = res; s.onerror = () => rej(new Error('load ' + src)); document.head.append(s); }); }
  function loadCss(href) { return new Promise((res) => { const l = h('link', { rel: 'stylesheet', href }); l.onload = res; l.onerror = res; document.head.append(l); }); }

  async function startOwner() {
    show('loading');
    try {
      // Muharrir faqat egasiga yuklanadi (mehmonga og'ir kod yuborilmaydi)
      // Tartib muhim: yadro (owner.js) birinchi, keyin unga qo'shiladigan modullar
      ownerLoading = ownerLoading || (async () => {
        await Promise.all([loadCss('owner.css?v=__V__'), loadScript('i18n-owner.js?v=__V__'), loadScript('owner.js?v=__V__')]);
        await Promise.all([loadScript('owner-content.js?v=__V__'), loadScript('owner-guests.js?v=__V__')]);
      })();
      await ownerLoading;
      show('owner');
      await window.OwnerApp.start({ root: $('v-owner'), onExit: showRole });
    } catch (err) {
      console.error('Owner start xatolik:', err);
      ownerLoading = null;
      message('📡', 'msg.error.title', 'msg.error.text', { key: 'msg.retry', onClick: startOwner });
    }
  }

  // ---------- HAMMUALLIF TAKLIFI ----------
  async function openCohost(token) {
    try {
      const info = await api('/api/cohost/info', { token });
      $('cohost-text').textContent = t('cohost.text', { names: `${info.groom} & ${info.bride}` });
      $('cohost-accept').onclick = async () => {
        $('cohost-err').hidden = true;
        try { await api('/api/cohost/accept', { token }); haptic('notify', 'success'); startOwner(); }
        catch (e) { $('cohost-err').textContent = t(e.status === 409 ? 'cohost.already' : 'cohost.fail'); $('cohost-err').hidden = false; haptic('notify', 'error'); }
      };
      Core.setChrome('#fbf8f2');
      show('cohost');
    } catch (e) {
      if (e.status === 401) return message('🔐', 'msg.tg.title', 'msg.tg.text');
      message('💌', 'msg.notfound.title', 'cohost.invalid');
    }
  }

  // ---------- BOSHLASH ----------
  function boot() {
    Core.setLang(Core.getLang(), false);
    paintLang();
    document.title = t('app.title');
    const e = window.__entry || {};
    if (e.kind === 'w' || e.kind === 'g') return openInvite(e.kind, e.key);
    if (e.kind === 'c') return openCohost(e.key);
    showRole();
  }
  boot();
  Core.rsvpQueue.flush(); // oldingi sessiyada yuborilmay qolgan javoblar bo'lsa — darhol yuboramiz
})();
