/* Katalog: shablonlar, ranglar palitrasi, shriftlar. Brauzerda (window.CATALOG) ham, serverda (require) ham ishlaydi:
   frontend shu bilan chizadi, backend shu bilan tekshiradi va AI'ga ruxsat etilgan qiymatlarni beradi. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CATALOG = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // ---------- RANG PALITRALARI ----------
  const P = (id, name, bg, surface, ink, soft, accent, accent2, dark) => ({ id, name, bg, surface, ink, soft, accent, accent2, dark: !!dark });
  const PALETTES = [
    P('ivory-gold', 'Ivory Gold', '#fbf8f2', '#ffffff', '#2b2620', '#6f6757', '#c9a95c', '#a8873f'),
    P('blush-rose', 'Blush Rose', '#fdf6f6', '#ffffff', '#3a2a2e', '#7d6168', '#d4909b', '#b05f72'),
    P('sage-garden', 'Sage Garden', '#f7f9f5', '#ffffff', '#26302a', '#627064', '#8fa68a', '#5f7a5b'),
    P('midnight-gold', 'Midnight Gold', '#14161f', '#1d2030', '#f4efe4', '#a9a79f', '#d6b46a', '#f0d58f', true),
    P('emerald-night', 'Emerald Night', '#0f1d1a', '#17302a', '#eef5ef', '#9db5ab', '#c9a95c', '#e0c37a', true),
    P('navy-silver', 'Navy Silver', '#f4f6fa', '#ffffff', '#1c2740', '#59657f', '#7c8fb5', '#4a5d86'),
    P('terracotta', 'Terracotta', '#fbf3ec', '#ffffff', '#3b2a22', '#7d6558', '#c8704a', '#9d4f2f'),
    P('lavender', 'Lavender', '#f8f5fc', '#ffffff', '#2e2640', '#6c6483', '#a78bd0', '#7e5fb0'),
    P('champagne', 'Champagne', '#f9f4ea', '#fffdf8', '#35302a', '#7a7164', '#cdb892', '#a58f64'),
    P('ocean', 'Ocean', '#f2f8fa', '#ffffff', '#17323c', '#547180', '#5aa3b8', '#2f7a92'),
    P('burgundy', 'Burgundy', '#faf3f3', '#ffffff', '#3a1c22', '#7d5a62', '#9a2f45', '#6e1f31'),
    P('mono', 'Mono', '#f6f6f4', '#ffffff', '#1b1b1b', '#6a6a6a', '#1b1b1b', '#555555'),
    P('peach', 'Peach', '#fff6f1', '#ffffff', '#3d2a24', '#85685d', '#ee9b7d', '#d0724f'),
    P('olive-cream', 'Olive Cream', '#f6f4ea', '#fffdf6', '#2e3022', '#6d705a', '#8a8f4a', '#656a2f'),
    P('plum-rose', 'Plum Rose', '#1f1420', '#2c1d2e', '#f6e9f1', '#b99aae', '#e08fb0', '#f3b6cf', true),
    P('royal-blue', 'Royal Blue', '#f3f5fb', '#ffffff', '#152046', '#56608a', '#3b5bdb', '#2742a8'),
  ];

  // ---------- SHRIFTLAR (hammasi kirill + lotin) ----------
  const F = (id, name, heading, body, gf) => ({ id, name, heading, body, gf });
  const FONTS = [
    F('classic', 'Classic', "'Cormorant Garamond', serif", "'Montserrat', sans-serif", 'Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Montserrat:wght@300;400;500'),
    F('elegant', 'Elegant', "'Playfair Display', serif", "'Lora', serif", 'Playfair+Display:wght@500;600&family=Lora:wght@400;500'),
    F('romantic', 'Romantic', "'Marck Script', cursive", "'Raleway', sans-serif", 'Marck+Script&family=Raleway:wght@300;400;500'),
    F('script', 'Script', "'Bad Script', cursive", "'Jost', sans-serif", 'Bad+Script&family=Jost:wght@300;400;500'),
    F('modern', 'Modern', "'Montserrat', sans-serif", "'Montserrat', sans-serif", 'Montserrat:wght@300;400;600'),
    F('editorial', 'Editorial', "'EB Garamond', serif", "'Jost', sans-serif", 'EB+Garamond:ital,wght@0,500;1,500&family=Jost:wght@300;400;500'),
    F('grand', 'Grand', "'Forum', serif", "'Philosopher', sans-serif", 'Forum&family=Philosopher:wght@400;700'),
    F('whimsy', 'Whimsy', "'Caveat', cursive", "'Raleway', sans-serif", 'Caveat:wght@500;600&family=Raleway:wght@300;400;500'),
    F('serif', 'Serif', "'Lora', serif", "'Montserrat', sans-serif", 'Lora:ital,wght@0,500;0,600;1,500&family=Montserrat:wght@300;400;500'),
    F('display', 'Display', "'Oranienbaum', serif", "'Raleway', sans-serif", 'Oranienbaum&family=Raleway:wght@300;400;500'),
  ];

  // ---------- SHABLONLAR (25): maket + palitra + shrift + bezak + kirish uslubi ----------
  // layout: classic | editorial | frame | split | arch | minimal       ornament: line | floral | dots | diamond | wave
  // intro:  envelope | cinematic | none
  const T = (id, name, layout, palette, font, ornament, intro, tag) => ({ id, name, layout, palette, font, ornament, intro, tag });
  const TEMPLATES = [
    T('t01', 'Aurora', 'classic', 'ivory-gold', 'classic', 'line', 'envelope', 'classic'),
    T('t02', 'Rosa', 'classic', 'blush-rose', 'romantic', 'floral', 'envelope', 'romantic'),
    T('t03', 'Verde', 'arch', 'sage-garden', 'elegant', 'floral', 'envelope', 'garden'),
    T('t04', 'Noir', 'frame', 'midnight-gold', 'grand', 'diamond', 'cinematic', 'luxury'),
    T('t05', 'Esmeralda', 'frame', 'emerald-night', 'grand', 'diamond', 'cinematic', 'luxury'),
    T('t06', 'Azure', 'minimal', 'navy-silver', 'modern', 'line', 'cinematic', 'modern'),
    T('t07', 'Terra', 'arch', 'terracotta', 'editorial', 'dots', 'envelope', 'boho'),
    T('t08', 'Lilac', 'classic', 'lavender', 'script', 'floral', 'envelope', 'romantic'),
    T('t09', 'Champagne', 'editorial', 'champagne', 'elegant', 'line', 'envelope', 'classic'),
    T('t10', 'Marina', 'split', 'ocean', 'modern', 'wave', 'cinematic', 'beach'),
    T('t11', 'Bordeaux', 'frame', 'burgundy', 'elegant', 'diamond', 'envelope', 'luxury'),
    T('t12', 'Mono', 'minimal', 'mono', 'editorial', 'line', 'cinematic', 'modern'),
    T('t13', 'Peach', 'arch', 'peach', 'whimsy', 'floral', 'envelope', 'boho'),
    T('t14', 'Olive', 'split', 'olive-cream', 'serif', 'dots', 'envelope', 'garden'),
    T('t15', 'Orchid', 'editorial', 'plum-rose', 'romantic', 'floral', 'cinematic', 'romantic'),
    T('t16', 'Royal', 'classic', 'royal-blue', 'grand', 'diamond', 'cinematic', 'luxury'),
    T('t17', 'Opal', 'split', 'champagne', 'display', 'wave', 'envelope', 'classic'),
    T('t18', 'Fleur', 'arch', 'blush-rose', 'elegant', 'floral', 'cinematic', 'romantic'),
    T('t19', 'Alpine', 'minimal', 'sage-garden', 'modern', 'line', 'envelope', 'modern'),
    T('t20', 'Velvet', 'editorial', 'burgundy', 'editorial', 'diamond', 'cinematic', 'luxury'),
    T('t21', 'Sunset', 'split', 'terracotta', 'romantic', 'wave', 'cinematic', 'beach'),
    T('t22', 'Pearl', 'classic', 'navy-silver', 'display', 'dots', 'envelope', 'classic'),
    T('t23', 'Garden', 'frame', 'olive-cream', 'script', 'floral', 'envelope', 'garden'),
    T('t24', 'Eclipse', 'split', 'midnight-gold', 'modern', 'wave', 'cinematic', 'modern'),
    T('t25', 'Serenity', 'minimal', 'lavender', 'editorial', 'line', 'envelope', 'modern'),
  ];

  const LAYOUTS = ['classic', 'editorial', 'frame', 'split', 'arch', 'minimal'];
  const ORNAMENTS = ['line', 'floral', 'dots', 'diamond', 'wave'];
  const INTROS = ['envelope', 'cinematic', 'none'];
  const SCHEDULE_ICONS = ['💍', '⛪', '🕌', '🥂', '🍽', '💃', '🎵', '📸', '🚗', '🎂', '🌅', '🎉'];
  // Almashtirib bo'ladigan bo'limlar (hero va RSVP har doim bor; hero boshida, RSVP oxirida)
  const SECTION_IDS = ['countdown', 'story', 'schedule', 'location', 'dress', 'menu', 'gallery', 'video'];

  const byId = (arr, id) => arr.find((x) => x.id === id);
  const getTemplate = (id) => byId(TEMPLATES, id) || TEMPLATES[0];
  const getPalette = (id) => byId(PALETTES, id) || PALETTES[0];
  const getFont = (id) => byId(FONTS, id) || FONTS[0];

  return { PALETTES, FONTS, TEMPLATES, LAYOUTS, ORNAMENTS, INTROS, SCHEDULE_ICONS, SECTION_IDS, getTemplate, getPalette, getFont };
});
