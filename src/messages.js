// Telegram xabarlari matnini yasaydi. Sof funksiyalar: botga/bazaga bog'liq emas,
// shuning uchun outbox'ga yoziladigan matn tranzaksiya ichida ham xavfsiz yasaladi.

// HTML parse_mode uchun maxsus belgilarni xavfsiz qilish (mehmon nima yozsa ham xabar buzilmasin)
function esc(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Xabarning eng tepasidagi "kimdan" qatori.
// Telegram orqali ochilgan bo'lsa — @username (yoki ism) va bosiladigan havola.
function senderLine(tgUser) {
  if (!tgUser) return '🌐 Sayt orqali (Telegramsiz)';
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');
  const link = `<a href="tg://user?id=${tgUser.id}">${esc(fullName || 'Telegram foydalanuvchi')}</a>`;
  return tgUser.username ? `📨 @${esc(tgUser.username)} · ${link}` : `📨 ${link}`;
}

// RSVP xabari. rsvpId — raqam ("№12"): agar tarmoq nosozligida xabar ikki marta kelib qolsa
// (Telegram "yetkazdim" deb javob berolmagan holat), egasi uni bir xil raqamdan darhol taniydi.
function renderRsvpMessage({ guestName, status, guestCount, comment }, tgUser, title, rsvpId) {
  const extra = Math.max(0, (Number(guestCount) || 1) - 1);

  let text = `${senderLine(tgUser)}\n`;
  if (title) text += `💒 ${esc(title)}\n`;
  text += `\n`;

  if (status === 'yes') {
    text += `🎊 <b>МЕҲМОНДАН ХУШХАБАР!</b>\n\n`;
    text += `👤 ${esc(guestName)}\n`;
    text += `💚 Келаман деди\n`;
    if (extra > 0) text += `👥 +${extra} меҳмон\n`;
  } else {
    text += `💌 <b>МЕҲМОНДАН ЖАВОБ</b>\n\n`;
    text += `👤 ${esc(guestName)}\n`;
    text += `💔 Келолмайман деди\n`;
  }

  if (comment) text += `\n💬 «${esc(comment)}»\n`;

  text += status === 'yes' ? `\n🥂 Кўришгунча!` : `\n🤍 Барибир раҳмат!`;
  if (rsvpId) text += `\n\n<i>№${rsvpId}</i>`;
  return text;
}

module.exports = { esc, senderLine, renderRsvpMessage };
