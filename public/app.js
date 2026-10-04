/* ============================================================
   Mini App — to'y taklifnomasi platformasi (vanilla JS + Telegram WebApp API)

   Oqim:  Bot → Mini App → [egasi | mehmon] → To'y → Shaxsiy havola → RSVP → egasiga botda
     • ?w=<kod> (yoki startapp=w_<kod>) bor  → MEHMON: shu to'yning taklifnomasi
     • kod yo'q                              → "egasimisiz yoki mehmon?" tanlovi
   Foydalanuvchi shaxsi har doim Telegram imzosi (initData) bilan backendda tekshiriladi.
   ============================================================ */

// ---------- SOZLAMALAR ----------
// BACKEND_URL index.html'dagi erta skriptda aniqlanadi (u taklifnomani oldindan so'rash uchun ham kerak)
const BACKEND_URL = window.BACKEND_URL || "https://toy-taklifnoma.onrender.com";

// ---------- TELEGRAM ----------
const tg = window.Telegram && window.Telegram.WebApp;
const tgInitData = tg && tg.initData ? tg.initData : null;
const tgUser = tg && tg.initDataUnsafe ? tg.initDataUnsafe.user : null;
const inTelegram = !!tgInitData;

function safe(fn) { try { return fn(); } catch (e) { /* eski klientda yo'q */ } }
const $ = (id) => document.getElementById(id);
function haptic(kind, style) {
  if (!tg || !tg.HapticFeedback) return;
  safe(() => (kind === "notify" ? tg.HapticFeedback.notificationOccurred(style) : tg.HapticFeedback.impactOccurred(style || "light")));
}

if (tg) {
  safe(() => tg.ready());
  safe(() => tg.expand());
  safe(() => tg.disableVerticalSwipes && tg.disableVerticalSwipes());
}
if (inTelegram) {
  document.body.classList.add("in-telegram");
  $("tg-hint").hidden = false;
}

// Backendni oldindan uyg'otamiz (Render bepul tarifda uxlab qoladi)
if (!window.__prefetch) fetch(`${BACKEND_URL}/health`, { mode: "no-cors", cache: "no-store" }).catch(() => {});

// Backend bilan ishlash. body berilsa POST (tgInitData avtomatik qo'shiladi), aks holda GET.
async function api(path, body) {
  const res = await fetch(BACKEND_URL + path, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tgInitData, ...body }),
  });
  let data = null;
  try { data = await res.json(); } catch (e) { /* bo'sh javob */ }
  if (!res.ok) { const err = new Error((data && data.error) || "HTTP " + res.status); err.status = res.status; throw err; }
  return data;
}

// ============================================================
// I18N
// ============================================================
const LANGS = ["uz", "ru", "ja"];
function pickInitialLang() {
  let saved = null;
  try { saved = localStorage.getItem("wedding_lang"); } catch (e) {}
  if (LANGS.includes(saved)) return saved;
  const code = tgUser && tgUser.language_code ? tgUser.language_code.slice(0, 2).toLowerCase() : "";
  return LANGS.includes(code) ? code : "uz";
}
let currentLang = pickInitialLang();
const LOCALE = { uz: "uz-UZ", ru: "ru-RU", ja: "ja-JP" };

function t(key) {
  const d = window.I18N[currentLang] || {};
  return d[key] != null ? d[key] : window.I18N.uz[key] || key;
}

function applyLang(lang) {
  currentLang = lang;
  document.documentElement.lang = lang;
  document.querySelectorAll("[data-i18n]").forEach((el) => (el.textContent = t(el.dataset.i18n)));
  document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder)));
  document.querySelectorAll("[data-i18n-title]").forEach((el) => el.setAttribute("title", t(el.dataset.i18nTitle)));
  document.title = W ? `${W.groom} & ${W.bride}` : t("meta.title");
  document.querySelectorAll(".lang-btn").forEach((b) => b.classList.toggle("is-active", b.dataset.lang === lang));
  renderDate();
  syncButtons();
  if (successShown) showSuccess(lastStatus);
  if (guestsData) renderGuests(guestsData);
}
document.querySelectorAll(".lang-btn").forEach((b) =>
  b.addEventListener("click", () => {
    haptic("impact", "light");
    // Faqat mehmon o'zi tanlagan tilni eslab qolamiz (avtomatik aniqlanganini emas)
    try { localStorage.setItem("wedding_lang", b.dataset.lang); } catch (e) {}
    applyLang(b.dataset.lang);
  })
);

// ============================================================
// TEMA (tayyor dizaynlar) — body[data-theme]
// ============================================================
function setTheme(name) {
  if (name && name !== "gold") document.body.dataset.theme = name; else delete document.body.dataset.theme;
  safe(() => {
    const iv = getComputedStyle(document.body).getPropertyValue("--ivory").trim();
    tg.setHeaderColor(iv); tg.setBackgroundColor(iv); tg.setBottomBarColor && tg.setBottomBarColor(iv);
  });
}

// ============================================================
// KO'RINISHLAR + Telegram tugmalari (Back / Main)
// ============================================================
const VIEWS = ["loading", "message", "role", "owner", "editor", "invite"];
let view = "loading";
let currentScreen = "home";
let preview = false;        // egasi o'z taklifnomasini ko'rib chiqmoqda
let messageBack = null;     // "xabar" ko'rinishidan orqaga qayerga
let editorHasWedding = false;

function showView(name) {
  view = name;
  VIEWS.forEach((v) => $("view-" + v).classList.toggle("is-active", v === name));
  syncButtons();
}

function showMessage(titleKey, textKey, back) {
  $("msg-title").dataset.i18n = titleKey; $("msg-text").dataset.i18n = textKey;
  $("msg-title").textContent = t(titleKey); $("msg-text").textContent = t(textKey);
  messageBack = back || null;
  setTheme("gold");
  showView("message");
}

function backVisible() {
  if (view === "invite") return currentScreen !== "home" || preview;
  return view === "owner" || view === "editor" || (view === "message" && !!messageBack);
}

function backAction() {
  haptic("impact", "light");
  if (view === "invite") {
    if (currentScreen !== "home") return go("home");
    if (preview) return exitPreview();
  } else if (view === "editor") {
    return editorHasWedding ? showOwner() : showRole();
  } else if (view === "owner") {
    return showRole();
  } else if (view === "message" && messageBack) {
    return showRole();
  }
}

let mainAction = null;
let busy = null; // { key } — MainButton ustida progress
function syncButtons() {
  let main = null;
  if (view === "editor") main = { label: t("editor.save"), fn: saveWedding };
  else if (view === "invite" && currentScreen === "rsvp" && !successShown && !preview) main = { label: t("rsvp.submit"), fn: submitRsvp };
  mainAction = main && main.fn;
  if (!tg) return;
  safe(() => (backVisible() ? tg.BackButton.show() : tg.BackButton.hide()));
  if (main) {
    safe(() => tg.MainButton.setParams({ text: busy ? t(busy) : main.label, color: getComputedStyle(document.body).getPropertyValue("--main-btn").trim() || "#b89443", text_color: "#ffffff" }));
    safe(() => tg.MainButton.show());
  } else {
    safe(() => tg.MainButton.hide());
  }
}
if (tg) {
  safe(() => tg.BackButton.onClick(backAction));
  safe(() => tg.MainButton.onClick(() => mainAction && mainAction()));
}
function setBusy(key) {
  busy = key;
  if (tg) safe(() => (key ? tg.MainButton.showProgress() : tg.MainButton.hideProgress()));
  syncButtons();
}

let dirty = false; // yopishdan oldin tasdiq
function setDirty(v) {
  if (v === dirty) return; // Telegram API'ni har belgi bosilganda chaqirmaymiz
  dirty = v;
  if (tg) safe(() => (v ? tg.enableClosingConfirmation() : tg.disableClosingConfirmation()));
}

// ============================================================
// ROL TANLASH
// ============================================================
function showRole() {
  setTheme("gold");
  showView("role");
}
$("role-guest").addEventListener("click", () => {
  haptic("impact", "light");
  showMessage("role.guestHint.title", "role.guestHint.text", "role");
});
$("role-owner").addEventListener("click", async () => {
  haptic("impact", "medium");
  showView("loading");
  try {
    const data = await api("/api/weddings/me", {});
    if (data.wedding) { ownerData = data; showOwner(); } else { openEditor(null); }
  } catch (e) {
    showMessage("guest.error.title", "guest.error.text", "role");
  }
});

// ============================================================
// EGASI KABINETI
// ============================================================
let ownerData = null; // { wedding, link }
let guestsData = null;

function showOwner() {
  setTheme(ownerData.wedding.design);
  $("owner-link").textContent = ownerData.link;
  guestsData = null;
  renderGuests({ guests: [] });
  showView("owner");
  api("/api/weddings/me/guests", {}).then((d) => { guestsData = d; renderGuests(d); }).catch(() => {});
}

function renderGuests(data) {
  const guests = (data && data.guests) || [];
  const yes = guests.filter((g) => g.status === "yes");
  $("st-yes").textContent = yes.length;
  $("st-people").textContent = yes.reduce((s, g) => s + (g.guest_count || 1), 0);
  $("st-no").textContent = guests.length - yes.length;

  const list = $("guest-list");
  if (!guests.length) {
    list.replaceChildren(Object.assign(document.createElement("div"), { className: "empty", textContent: t("guests.empty") }));
    return;
  }
  list.replaceChildren(...guests.map((g) => {
    const row = document.createElement("div"); row.className = "guest";
    const dot = Object.assign(document.createElement("span"), { className: "dot", textContent: g.status === "yes" ? "💚" : "💔" });
    const main = document.createElement("div");
    main.append(Object.assign(document.createElement("div"), { className: "g-name", textContent: g.guest_name }));
    if (g.guest_username) main.append(Object.assign(document.createElement("div"), { className: "g-comment", textContent: "@" + g.guest_username }));
    if (g.comment) main.append(Object.assign(document.createElement("div"), { className: "g-comment", textContent: "«" + g.comment + "»" }));
    const meta = document.createElement("div"); meta.className = "g-meta";
    if (g.status === "yes") meta.append(Object.assign(document.createElement("b"), { textContent: `${g.guest_count} ${t("guests.people")}` }));
    let when = "";
    try { when = new Date(g.created_at).toLocaleDateString(LOCALE[currentLang], { day: "numeric", month: "short" }); } catch (e) {}
    meta.append(document.createTextNode(when));
    row.append(dot, main, meta);
    return row;
  }));
}

$("owner-copy").addEventListener("click", async () => {
  const link = ownerData.link;
  try { await navigator.clipboard.writeText(link); }
  catch (e) {
    const ta = Object.assign(document.createElement("textarea"), { value: link }); // eski WebView'lar uchun
    document.body.appendChild(ta); ta.select(); safe(() => document.execCommand("copy")); ta.remove();
  }
  haptic("notify", "success");
  const lbl = $("owner-copy").querySelector("span");
  lbl.dataset.i18n = "owner.copied"; lbl.textContent = t("owner.copied");
  setTimeout(() => { lbl.dataset.i18n = "owner.copy"; lbl.textContent = t("owner.copy"); }, 1800);
});
$("owner-share").addEventListener("click", () => {
  haptic("impact", "medium");
  const url = `https://t.me/share/url?url=${encodeURIComponent(ownerData.link)}&text=${encodeURIComponent(t("owner.shareText"))}`;
  if (tg && tg.openTelegramLink) safe(() => tg.openTelegramLink(url)); else window.open(url, "_blank", "noopener");
});
$("owner-edit").addEventListener("click", () => { haptic("impact", "light"); openEditor(ownerData.wedding); });
$("owner-preview").addEventListener("click", () => {
  haptic("impact", "light");
  applyWedding(ownerData.wedding);
  enterInvite({ preview: true });
});

function exitPreview() {
  preview = false;
  document.body.classList.remove("is-preview");
  showOwner();
}
$("preview-close").addEventListener("click", () => { haptic("impact", "light"); exitPreview(); });

// ============================================================
// MUHARRIR (dizayn tanlash + ma'lumotlar)
// ============================================================
let editorDesign = "gold";
let editorPhoto = null;
const E = { groom: $("e-groom"), bride: $("e-bride"), date: $("e-date"), nikoh: $("e-nikoh"), banquet: $("e-banquet"),
  venue: $("e-venue"), address: $("e-address"), map: $("e-map"), message: $("e-message") };

function pickDesign(name) {
  editorDesign = name;
  document.querySelectorAll(".design").forEach((d) => d.classList.toggle("is-active", d.dataset.design === name));
  setTheme(name); // tanlangan dizayn darhol butun ilovada ko'rinadi
}
document.querySelectorAll(".design").forEach((d) =>
  d.addEventListener("click", () => { haptic("impact", "light"); pickDesign(d.dataset.design); setDirty(true); })
);

function setPhotoThumb(dataUrl) {
  const th = $("e-photo-thumb");
  th.style.backgroundImage = dataUrl ? `url(${dataUrl})` : "";
  th.textContent = dataUrl ? "" : "📷";
  const lbl = $("e-photo-btn").querySelector("span");
  lbl.dataset.i18n = dataUrl ? "editor.photoChange" : "editor.photoPick";
  lbl.textContent = t(lbl.dataset.i18n);
}

function openEditor(w) {
  editorHasWedding = !!w;
  E.groom.value = w ? w.groom : "";
  E.bride.value = w ? w.bride : "";
  E.date.value = w ? w.date : "";
  E.nikoh.value = w ? w.ceremonyTime || "" : "14:00";
  E.banquet.value = w ? w.banquetTime || "" : "18:00";
  E.venue.value = (w && w.venueName) || "";
  E.address.value = (w && w.venueAddress) || "";
  E.map.value = (w && w.mapQuery) || "";
  E.message.value = (w && w.message) || "";
  editorPhoto = (w && w.photo) || null;
  setPhotoThumb(editorPhoto);
  $("editor-msg").hidden = true;
  pickDesign((w && w.design) || "gold");
  setDirty(false);
  showView("editor");
  $("view-editor").querySelector(".view-scroll").scrollTop = 0;
}
$("view-editor").addEventListener("input", () => setDirty(true));

// Foto: markaziy kvadrat kesim, 720px, JPEG — hajmi ~100-300 KB (backend limiti 600 KB)
function fileToJpeg(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const side = Math.min(img.width, img.height), size = Math.min(720, side);
      const c = document.createElement("canvas"); c.width = c.height = size;
      c.getContext("2d").drawImage(img, (img.width - side) / 2, (img.height - side) / 2, side, side, 0, 0, size, size);
      let q = 0.85, out;
      do { out = c.toDataURL("image/jpeg", q); q -= 0.1; } while (out.length > 540 * 1024 && q > 0.3);
      URL.revokeObjectURL(url);
      resolve(out);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("img")); };
    img.src = url;
  });
}
$("e-photo-btn").addEventListener("click", () => $("e-photo").click());
$("e-photo").addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  try { editorPhoto = await fileToJpeg(file); setPhotoThumb(editorPhoto); setDirty(true); }
  catch (err) { editorMsg(t("editor.photoError")); }
  e.target.value = "";
});

function editorMsg(text) { const m = $("editor-msg"); m.textContent = text; m.className = "form-msg is-error"; m.hidden = false; }

let saving = false;
async function saveWedding() {
  if (saving) return;
  $("editor-msg").hidden = true;
  const groom = E.groom.value.trim(), bride = E.bride.value.trim(), date = E.date.value;
  if (!groom || !bride || !date) { editorMsg(t("editor.required")); haptic("notify", "error"); return; }

  // Boshlanish vaqti — egasining mahalliy vaqti bo'yicha (countdown to'g'ri ishlashi uchun)
  let startsAt = null;
  const d = new Date(`${date}T${E.nikoh.value || "12:00"}:00`);
  if (!Number.isNaN(d.getTime())) startsAt = d.toISOString();

  saving = true; setBusy("editor.saving"); $("editor-save").disabled = true;
  try {
    const data = await api("/api/weddings", { wedding: {
      design: editorDesign, groom, bride, date, startsAt,
      ceremonyTime: E.nikoh.value || null, banquetTime: E.banquet.value || null,
      venueName: E.venue.value.trim(), venueAddress: E.address.value.trim(), mapQuery: E.map.value.trim(),
      message: E.message.value.trim(), photo: editorPhoto,
    } });
    ownerData = data;
    setDirty(false);
    haptic("notify", "success");
    showOwner();
  } catch (err) {
    console.error("Saqlashda xatolik:", err);
    haptic("notify", "error");
    editorMsg(t("editor.error"));
  } finally {
    saving = false; setBusy(null); $("editor-save").disabled = false;
  }
}
$("editor-form").addEventListener("submit", (e) => { e.preventDefault(); saveWedding(); });

// ============================================================
// TAKLIFNOMA (mehmon ko'radi) — to'y ma'lumotlaridan chiziladi
// ============================================================
let W = null; // joriy to'y (ochiq ma'lumot)
let weddingTarget = null;
let cdTimer = null;
let mapLoaded = false;

function applyWedding(w) {
  const sameWedding = W && W.code === w.code;
  W = w;
  setTheme(w.design);
  $("inv-groom").textContent = w.groom;
  $("inv-bride").textContent = w.bride;
  document.title = `${w.groom} & ${w.bride}`;

  const msg = $("inv-message");
  msg.textContent = w.message || ""; msg.hidden = !w.message;

  // Dastur vaqtlari (vaqt ko'rsatilmagan tadbir yashiriladi)
  $("prog-nikoh").hidden = !w.ceremonyTime; $("prog-nikoh-time").textContent = w.ceremonyTime || "";
  $("prog-banquet").hidden = !w.banquetTime; $("prog-banquet-time").textContent = w.banquetTime || "";

  // Joy: egasi yozgan matn tilga qarab o'zgarmaydi (data-i18n olib tashlanadi)
  [["venue-name", w.venueName], ["venue-address", w.venueAddress]].forEach(([id, val]) => {
    const el = $(id); el.removeAttribute("data-i18n"); el.textContent = val || ""; el.hidden = !val;
  });
  const hasVenue = !!(w.venueName || w.venueAddress || w.mapQuery);
  $("tab-venue").hidden = !hasVenue;
  mapLoaded = false; $("venue-map").removeAttribute("src");

  // Foto
  const ring = $("photo-ring");
  const photoSrc = w.photo || (w.photoUrl ? BACKEND_URL + w.photoUrl : null); // egasida data-URL, mehmonda kesh'lanadigan fayl
  if (photoSrc) {
    $("couple-photo").src = photoSrc; ring.classList.remove("no-photo");
    document.querySelector(".intro-photo").style.backgroundImage = `linear-gradient(rgba(251,248,242,0.78), rgba(251,248,242,0.88)), url(${photoSrc})`;
  } else {
    ring.classList.add("no-photo");
    document.querySelector(".intro-photo").style.backgroundImage = "";
  }

  weddingTarget = w.startsAt ? new Date(w.startsAt) : new Date(`${w.date}T${w.ceremonyTime || "12:00"}:00`);
  startCountdown();
  renderDate();
  if (!sameWedding) resetRsvp();
}

// O'zbek tilida oy nomlari ko'p WebView'larda (ICU) yo'q — "2026 M11 15" chiqib qoladi, shuning uchun o'zimiz yozamiz
const UZ_MONTHS = ["yanvar", "fevral", "mart", "aprel", "may", "iyun", "iyul", "avgust", "sentyabr", "oktyabr", "noyabr", "dekabr"];

function renderDate() {
  if (!W) return;
  let s;
  if (currentLang === "uz") {
    const [y, m, d] = W.date.split("-").map(Number);
    s = `${d}-${UZ_MONTHS[m - 1]}, ${y}`;
  } else {
    try { s = new Intl.DateTimeFormat(LOCALE[currentLang], { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" }).format(new Date(`${W.date}T12:00:00Z`)); }
    catch (e) { s = W.date; }
  }
  $("wedding-date-str").textContent = W.ceremonyTime ? `${s} · ${W.ceremonyTime}` : s;
}

function enterInvite({ preview: isPreview = false } = {}) {
  preview = isPreview;
  currentScreen = "";
  go("home", true);
  $("preview-bar").hidden = !isPreview;
  document.body.classList.toggle("is-preview", isPreview);
  // Intro (konvert) — qayta ochishga tayyorlanadi; ko'rib chiqishda o'tkazib yuboriladi
  opened = false;
  envelope.classList.remove("is-opening");
  if (isPreview) {
    opened = true;
    intro.classList.add("is-open");
    document.body.classList.remove("intro-locked");
  } else {
    intro.classList.remove("is-open");
    document.body.classList.add("intro-locked");
  }
  showView("invite");
}

// ---------- ichki ekranlar (tab-bar) ----------
const screens = [...document.querySelectorAll(".screen")];
const tabs = [...document.querySelectorAll(".tab")];

function go(name, force) {
  if (!screens.some((s) => s.dataset.screen === name) || (name === currentScreen && !force)) return;
  currentScreen = name;
  screens.forEach((s) => {
    const active = s.dataset.screen === name;
    s.classList.toggle("is-active", active);
    if (active) s.scrollTop = 0;
  });
  tabs.forEach((tb) => tb.classList.toggle("is-active", tb.dataset.go === name));
  if (name === "venue" && !mapLoaded && W) { mapLoaded = true; setupMap(); }
  syncButtons();
}
document.querySelectorAll("[data-go]").forEach((el) =>
  el.addEventListener("click", () => { haptic("impact", "light"); go(el.dataset.go); })
);

// ---------- INTRO — konvert ----------
const intro = $("intro");
const envelope = $("envelope");
let opened = false;

function openEnvelope() {
  if (opened) return;
  opened = true;
  haptic("impact", "medium");
  envelope.classList.add("is-opening");
  playRustle();
  setTimeout(() => {
    intro.classList.add("is-open");
    document.body.classList.remove("intro-locked");
    haptic("notify", "success");
  }, 900);
}
envelope.addEventListener("click", openEnvelope);

function playRustle() {
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    const dur = 0.7;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.5;
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type = "bandpass"; f.frequency.value = 2600; f.Q.value = 0.8;
    const g = ctx.createGain(); const n = ctx.currentTime;
    g.gain.setValueAtTime(0.0001, n);
    g.gain.exponentialRampToValueAtTime(0.22, n + 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, n + dur);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(n); src.stop(n + dur);
    src.onended = () => ctx.close();
  } catch (e) {}
}

// ---------- COUNTDOWN ----------
const pad = (n) => String(n).padStart(2, "0");
function tick() {
  if (!weddingTarget) return;
  const diff = weddingTarget.getTime() - Date.now();
  if (diff <= 0) {
    $("countdown").style.display = "none";
    $("countdown-over").hidden = false;
    clearInterval(cdTimer);
    return;
  }
  const s = Math.floor(diff / 1000);
  $("cd-days").textContent = Math.floor(s / 86400);
  $("cd-hours").textContent = pad(Math.floor((s % 86400) / 3600));
  $("cd-minutes").textContent = pad(Math.floor((s % 3600) / 60));
  $("cd-seconds").textContent = pad(s % 60);
}
function startCountdown() {
  clearInterval(cdTimer);
  $("countdown").style.display = "";
  $("countdown-over").hidden = true;
  tick();
  cdTimer = setInterval(tick, 1000);
}

// ---------- FOTO / VIDEO / XARITA ----------
const couplePhoto = $("couple-photo");
couplePhoto.addEventListener("error", () => $("photo-ring").classList.add("no-photo"));

// Ixtiyoriy fon video: HERO_VIDEO'ga manzil yozing (masalan "assets/hero.mp4"). Bo'sh bo'lsa so'rov umuman yuborilmaydi.
const HERO_VIDEO = "";
const heroVideo = $("hero-video");
if (!HERO_VIDEO || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
  heroVideo.remove();
} else {
  heroVideo.addEventListener("error", () => heroVideo.remove());
  heroVideo.addEventListener("canplay", () => safe(() => heroVideo.play()), { once: true });
  heroVideo.src = HERO_VIDEO;
}

const mapQ = () => encodeURIComponent((W && (W.mapQuery || W.venueAddress || W.venueName)) || "");
function setupMap() { $("venue-map").src = `https://www.google.com/maps?q=${mapQ()}&output=embed`; }
$("venue-link").addEventListener("click", () => {
  const url = `https://www.google.com/maps?q=${mapQ()}`;
  if (tg && tg.openLink) safe(() => tg.openLink(url)); else window.open(url, "_blank", "noopener");
});

// ============================================================
// RSVP (mehmon) — egasiga botda boradi
// ============================================================
const form = $("rsvp-form");
const successCard = $("rsvp-success");
const statusBtns = document.querySelectorAll(".seg-btn");
const countField = $("count-field");
const countInput = $("guestCount");
const nameInput = $("guestName");
const commentInput = $("comment");
const msgEl = $("form-msg");
const submitBtn = $("rsvp-submit");

let status = "";
let sending = false;
let successShown = false;
let lastStatus = "";

function showMsg(text) { msgEl.textContent = text; msgEl.className = "form-msg is-error"; msgEl.hidden = false; }
function clearMsg() { msgEl.hidden = true; msgEl.textContent = ""; }

function resetRsvp() {
  successShown = false; successCard.hidden = true; form.hidden = false;
  commentInput.value = ""; countInput.value = 1; status = "";
  statusBtns.forEach((x) => { x.classList.remove("is-active"); x.setAttribute("aria-checked", "false"); });
  countField.classList.remove("is-hidden");
  nameInput.value = tgUser ? [tgUser.first_name, tgUser.last_name].filter(Boolean).join(" ") : "";
  clearMsg();
  setDirty(false);
}

statusBtns.forEach((b) =>
  b.addEventListener("click", () => {
    status = b.dataset.status;
    statusBtns.forEach((x) => {
      x.classList.toggle("is-active", x === b);
      x.setAttribute("aria-checked", x === b ? "true" : "false");
    });
    countField.classList.toggle("is-hidden", status === "no");
    haptic("impact", "light");
    clearMsg();
    setDirty(true);
  })
);
[nameInput, commentInput].forEach((el) => el.addEventListener("input", () => setDirty(true)));

function step(d) {
  countInput.value = Math.min(20, Math.max(1, (parseInt(countInput.value, 10) || 1) + d));
  haptic("impact", "light");
}
$("count-minus").addEventListener("click", () => step(-1));
$("count-plus").addEventListener("click", () => step(1));

function showSuccess(st) {
  lastStatus = st;
  successShown = true;
  $("success-text").textContent = st === "yes" ? t("rsvp.successYes") : t("rsvp.successNo");
  form.hidden = true;
  successCard.hidden = false;
  setDirty(false);
  syncButtons();
}
$("rsvp-another").addEventListener("click", () => { resetRsvp(); syncButtons(); haptic("impact", "light"); });

async function submitRsvp() {
  if (sending) return;
  clearMsg();
  if (preview) { showMsg(t("preview.noSend")); return; }

  const guestName = nameInput.value.trim();
  if (!guestName) { showMsg(t("rsvp.errorName")); haptic("notify", "error"); nameInput.focus(); return; }
  if (status !== "yes" && status !== "no") { showMsg(t("rsvp.errorStatus")); haptic("notify", "error"); return; }

  sending = true;
  submitBtn.disabled = true;
  setBusy("rsvp.sending");

  try {
    await api("/api/rsvp", {
      guestName,
      status,
      guestCount: status === "no" ? 1 : parseInt(countInput.value, 10) || 1,
      comment: commentInput.value.trim() || null,
      language: currentLang,
      weddingCode: W.code,
    });
    haptic("notify", "success");
    sending = false;
    showSuccess(status);
  } catch (err) {
    console.error("RSVP xatolik:", err);
    haptic("notify", "error");
    showMsg(t("rsvp.errorNetwork"));
    sending = false;
  } finally {
    submitBtn.disabled = false;
    setBusy(null);
  }
}
form.addEventListener("submit", (e) => { e.preventDefault(); submitRsvp(); });

// ============================================================
// MUSIQA
// ============================================================
const music = $("bg-music");
const musicBtn = $("music-toggle");
const musicIcon = musicBtn.querySelector(".music-icon");
function setMusicUi(playing) {
  musicIcon.textContent = playing ? "🔊" : "🔇";
  musicBtn.classList.toggle("is-playing", playing);
  musicBtn.setAttribute("aria-pressed", String(playing));
  musicBtn.title = playing ? t("music.off") : t("music.on");
}
musicBtn.addEventListener("click", async () => {
  haptic("impact", "light");
  try {
    if (music.paused) { await music.play(); setMusicUi(true); } else { music.pause(); setMusicUi(false); }
  } catch (e) { setMusicUi(false); }
});
document.addEventListener("visibilitychange", () => { if (document.hidden && !music.paused) { music.pause(); setMusicUi(false); } });

// ============================================================
// ISHGA TUSHIRISH — start parametri bo'yicha yo'naltirish
// ============================================================
// Mehmon havolasi: bot tugmasi ?w=<kod> beradi; to'g'ridan-to'g'ri Mini App havolasi (startapp=w_<kod>) ham ishlaydi.
function getWeddingCode() {
  const q = new URLSearchParams(location.search).get("w");
  if (q && /^[\w-]{4,32}$/.test(q)) return q;
  const sp = tg && tg.initDataUnsafe && tg.initDataUnsafe.start_param;
  if (sp && /^w_[\w-]{4,32}$/.test(sp)) return sp.slice(2);
  return null;
}

async function boot() {
  applyLang(currentLang);
  const code = getWeddingCode();
  if (!code) return showRole();

  // MEHMON: shu to'yning taklifnomasi
  try {
    // Ma'lumot index.html'dagi erta skript tomonidan allaqachon so'ralgan bo'lishi mumkin — tarmoq kutilmaydi
    const pre = window.__prefetch && window.__prefetch.code === code ? await window.__prefetch.promise.catch(() => null) : null;
    let wedding;
    if (pre && pre.ok && pre.data) wedding = pre.data.wedding;
    else if (pre && !pre.ok && pre.status === 404) { const err = new Error("not found"); err.status = 404; throw err; }
    else wedding = (await api("/api/weddings/" + encodeURIComponent(code))).wedding;
    applyWedding(wedding);
    enterInvite();
  } catch (e) {
    if (e.status === 404) showMessage("guest.notFound.title", "guest.notFound.text");
    else showMessage("guest.error.title", "guest.error.text");
  }
}
boot();
