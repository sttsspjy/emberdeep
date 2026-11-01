// Display translation (client only; sim, net and save never see translated text). English source strings are the keys.
// Tables: src/i18n/<lang>-*.js call ED.I18N.add(lang, { 'English source': 'translation' }); calls merge. Placeholders {0} {1} ... may be reordered.
// ED.t(en, a0, a1, ...): template lookup, args fill {n}; falls back to English. ED.tr(s): runtime string (exact key, else numbers -> {n} key, numbers refilled), else s.
// ED.I18N: lang, set(lang) (stores settings.lang, sets <html lang>, re-applies DOM, fires on() listeners), init(settings) at boot (no store), applyDom(root),
//   norm(s) -> { key, nums } (shared with tools/check-i18n.js), missing (Set of English keys that missed while lang != 'en').
// DOM: [data-i18n] textContent = ED.t(source) (source = attribute value, or the element's English text cached into it on first apply);
//   [data-i18n-attr="aria-label,title"] translates those attributes (English cached in data-i18n-<attr>).
(function (ED) {
  'use strict';
  const LANGS = ['en', 'ko'];
  const I = ED.I18N = { lang: 'en', langs: LANGS, tables: {}, missing: new Set() };
  const subs = [];
  let cache = new Map(); // ED.tr results for the active language
  const NUM = /\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g;
  const PH = /\{(\d+)\}/g;

  I.add = (lang, tbl) => { const t = I.tables[lang] || (I.tables[lang] = {}); for (const k in tbl) t[k] = tbl[k]; cache = new Map(); };
  I.on = (fn) => { subs.push(fn); };
  I.norm = (s) => { const nums = []; const key = String(s).replace(NUM, (m) => '{' + (nums.push(m) - 1) + '}'); return { key, nums }; };
  const fill = (s, args, off) => s.replace(PH, (m, i) => { const v = args[+i + off]; return v === undefined ? m : String(v); });
  const table = () => (I.lang === 'en' ? null : I.tables[I.lang] || null);

  ED.t = function (en) {
    const tb = table();
    let s = tb ? tb[en] : undefined;
    if (s === undefined) { s = en; if (I.lang !== 'en') I.missing.add(en); }
    return arguments.length > 1 ? fill(s, arguments, 1) : s;
  };
  ED.tr = (s) => {
    if (I.lang === 'en' || s === undefined || s === null || s === '') return s;
    const hit = cache.get(s); if (hit !== undefined) return hit;
    const tb = table();
    let out = tb ? tb[s] : undefined;
    if (out === undefined) {
      const n = I.norm(s), t = tb && n.nums.length ? tb[n.key] : undefined;
      if (t !== undefined) out = fill(t, n.nums, 0);
      else { out = s; I.missing.add(n.nums.length ? n.key : s); }
    }
    if (cache.size > 4000) cache = new Map();
    cache.set(s, out);
    return out;
  };

  I.detect = (settings) => {
    const s = settings && settings.lang;
    if (LANGS.indexOf(s) >= 0) return s;
    const nav = typeof navigator !== 'undefined' ? String(navigator.language || '') : '';
    return /^ko\b/i.test(nav) ? 'ko' : 'en';
  };
  const apply = (lang) => {
    I.lang = LANGS.indexOf(lang) >= 0 ? lang : 'en';
    cache = new Map();
    if (typeof document === 'undefined') return;
    document.documentElement.lang = I.lang;
    // canvas text (HUD, banners, damage numbers) uses the Hangul face only once it is loaded
    if (I.lang === 'ko' && document.fonts && document.fonts.load) document.fonts.load('16px "Wickdeep Hangul"', '\uAC00').catch(() => {});
    I.applyDom(document);
  };
  I.init = (settings) => { apply(I.detect(settings)); };
  I.set = (lang) => {
    apply(lang);
    const A = ED.App;
    if (A && A.settings && A.settings.lang !== I.lang) { A.settings.lang = I.lang; if (ED.Save) ED.Save.storeSettings(A.settings); }
    for (const fn of subs) fn(I.lang);
  };

  I.applyDom = (root) => {
    root = root || document;
    for (const el of root.querySelectorAll('[data-i18n]')) {
      let en = el.getAttribute('data-i18n');
      if (!en) { en = el.textContent.replace(/\s+/g, ' ').trim(); el.setAttribute('data-i18n', en); }
      el.textContent = ED.t(en);
    }
    for (const el of root.querySelectorAll('[data-i18n-attr]')) {
      for (const a of el.getAttribute('data-i18n-attr').split(',')) {
        const at = a.trim(), k = 'data-i18n-' + at;
        let en = el.getAttribute(k);
        if (en === null) { en = el.getAttribute(at); if (en === null) continue; el.setAttribute(k, en); }
        el.setAttribute(at, ED.t(en));
      }
    }
  };
})(globalThis.ED || (globalThis.ED = {}));
