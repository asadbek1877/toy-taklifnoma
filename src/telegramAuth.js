// Telegram Mini App (WebApp) dan kelgan initData'ni tekshiradi.
// Sayt bot orqali ochilganda Telegram foydalanuvchi ma'lumotini (username, ism)
// imzolab beradi. Imzoni bot tokeni bilan tekshiramiz — shunda nikni soxtalashtirib bo'lmaydi.

const crypto = require('crypto');

// initData to'g'ri bo'lsa { id, username, first_name, last_name } qaytaradi, aks holda null.
function verifyTelegramInitData(initData, botToken, maxAgeSec = 24 * 60 * 60) {
  if (!initData || typeof initData !== 'string' || !botToken) return null;

  try {
    const params = new URLSearchParams(initData);
    const hash = params.get('hash');
    if (!hash) return null;
    params.delete('hash');

    const dataCheckString = [...params.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .sort()
      .join('\n');

    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const expected = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');

    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(hash, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // Juda eski initData'ni qabul qilmaymiz
    const authDate = Number(params.get('auth_date'));
    if (!authDate || Date.now() / 1000 - authDate > maxAgeSec) return null;

    const user = JSON.parse(params.get('user') || 'null');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

module.exports = { verifyTelegramInitData };
