// ==========================================================================
// i18n — Lightweight Localisation Utility
// Usage:
//   t('key')                → translated string (fallback to key if missing)
//   t('key', {name:'Foo'}) → interpolated: "{name}" → "Foo"
//   applyI18n()            → walk the DOM and replace [data-i18n] elements
//   setLanguage('en')      → switch language and reload
//   getCurrentLang()       → returns current lang code string
// ==========================================================================

(function () {
    'use strict';

    const SUPPORTED = ['zh-CN', 'en', 'ja'];
    const STORAGE_KEY = 'app_language';

    // -----------------------------------------------------------------------
    // Core translation function
    // -----------------------------------------------------------------------
    function t(key, vars = {}) {
        const data = window.__LOCALE_DATA__ || {};
        const template = Object.prototype.hasOwnProperty.call(data, key) ? data[key] : key;
        return String(template).replace(/\{(\w+)\}/g, (_, k) =>
            Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
        );
    }

    // -----------------------------------------------------------------------
    // Apply translations to DOM via [data-i18n] attributes
    //   data-i18n="key"            → sets textContent
    //   data-i18n-placeholder="key"→ sets placeholder attribute
    //   data-i18n-title="key"      → sets title attribute
    //   data-i18n-html="key"       → sets innerHTML (use sparingly)
    // -----------------------------------------------------------------------
    function applyI18n(root = document) {
        // textContent
        root.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            if (key) el.textContent = t(key);
        });
        // placeholder
        root.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
            const key = el.getAttribute('data-i18n-placeholder');
            if (key) el.placeholder = t(key);
        });
        // title
        root.querySelectorAll('[data-i18n-title]').forEach(el => {
            const key = el.getAttribute('data-i18n-title');
            if (key) el.title = t(key);
        });
        // innerHTML — use only for trusted static keys
        root.querySelectorAll('[data-i18n-html]').forEach(el => {
            const key = el.getAttribute('data-i18n-html');
            if (key) el.innerHTML = t(key);
        });
    }

    // -----------------------------------------------------------------------
    // Language management
    // -----------------------------------------------------------------------
    function getCurrentLang() {
        const stored = localStorage.getItem(STORAGE_KEY);
        return SUPPORTED.includes(stored) ? stored : 'zh-CN';
    }

    function setLanguage(lang) {
        if (!SUPPORTED.includes(lang)) return;
        localStorage.setItem(STORAGE_KEY, lang);
        // Reload the page to apply the new locale script
        window.location.reload();
    }

    // -----------------------------------------------------------------------
    // Initial locale script injection (called from the inline <script> in
    // <head> before DOMContentLoaded, so it's synchronous)
    // -----------------------------------------------------------------------
    function injectLocaleScript() {
        const lang = getCurrentLang();
        // The locale file sets window.__LOCALE_DATA__
        const script = document.createElement('script');
        script.src = `js/locales/${lang}.js`;
        // Synchronous load: append to <head> — since this runs in <head>
        // before DOMContentLoaded, the script won't execute until it loads.
        // We use document.write-like approach: append and let browser handle.
        document.head.appendChild(script);
        return lang;
    }

    // -----------------------------------------------------------------------
    // Public API
    // -----------------------------------------------------------------------
    window.t = t;
    window.applyI18n = applyI18n;
    window.setLanguage = setLanguage;
    window.getCurrentLang = getCurrentLang;
    window.__i18n_injectLocale = injectLocaleScript;
})();
