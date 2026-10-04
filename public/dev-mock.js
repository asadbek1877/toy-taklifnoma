// Faqat DEV uchun: localhost'da `?mock` bilan ochilganda Telegram WebApp'ni taqlid qiladi,
// shunda Mini App'ni oddiy brauzerda sinash mumkin. Production'da (boshqa domen) hech narsa qilmaydi.
(function () {
  const isLocal = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  if (!isLocal || !/[?&]mock\b/.test(location.search)) return;

  const bar = document.createElement("div");
  bar.style.cssText =
    "position:fixed;left:0;right:0;bottom:0;z-index:999;background:#b89443;color:#fff;font:600 15px sans-serif;" +
    "text-align:center;padding:14px;display:none;cursor:pointer;max-width:560px;margin:0 auto";
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(bar));

  let mainCb = null, backCb = null;
  const back = document.createElement("button");
  back.textContent = "‹ Back";
  back.style.cssText = "position:fixed;left:8px;top:8px;z-index:999;display:none;padding:6px 10px;font:12px sans-serif";
  back.onclick = () => backCb && backCb();
  document.addEventListener("DOMContentLoaded", () => document.body.appendChild(back));
  bar.onclick = () => mainCb && mainCb();

  const log = (window.__tgCalls = []);
  const rec = (n) => log.push(n);

  // Ixtiyoriy: ?mockuser=ID&signer=http://localhost:PORT — sinov serveridan HAQIQIY imzolangan initData oladi
  // (backend imzoni tekshirgani uchun to'liq oqimni sinash mumkin). Aks holda imzo soxta.
  const qs = new URLSearchParams(location.search);
  let initData = "mock=1&hash=mock";
  let user = { id: 1, first_name: "Test", last_name: "User", username: "testuser", language_code: "ru" };
  if (qs.get("signer") && qs.get("mockuser")) {
    try {
      const x = new XMLHttpRequest();
      x.open("GET", `${qs.get("signer")}/__sign?id=${encodeURIComponent(qs.get("mockuser"))}&name=${encodeURIComponent(qs.get("mockname") || "Test")}&username=${encodeURIComponent(qs.get("mockusername") || "")}&lang=${encodeURIComponent(qs.get("mocklang") || "ru")}`, false);
      x.send();
      const r = JSON.parse(x.responseText);
      initData = r.initData; user = r.user;
    } catch (e) { console.warn("signer ishlamadi", e); }
  }

  window.Telegram = { WebApp: {
    initData,
    initDataUnsafe: { user },
    platform: "android", version: "8.0",
    ready() { rec("ready"); }, expand() { rec("expand"); },
    disableVerticalSwipes() { rec("disableVerticalSwipes"); },
    setHeaderColor() {}, setBackgroundColor() {}, setBottomBarColor() {},
    enableClosingConfirmation() { rec("closeConfirmOn"); }, disableClosingConfirmation() { rec("closeConfirmOff"); },
    openLink(u) { rec("openLink:" + u); }, openTelegramLink(u) { rec("openTelegramLink:" + u); }, onEvent() {},
    HapticFeedback: { impactOccurred(s) { rec("impact:" + s); }, notificationOccurred(s) { rec("notify:" + s); } },
    MainButton: {
      setParams(p) { bar.textContent = p.text; }, show() { bar.style.display = "block"; }, hide() { bar.style.display = "none"; },
      onClick(cb) { mainCb = cb; }, showProgress() { bar.style.opacity = 0.6; }, hideProgress() { bar.style.opacity = 1; },
    },
    BackButton: { show() { back.style.display = "block"; }, hide() { back.style.display = "none"; }, onClick(cb) { backCb = cb; } },
  } };
})();
