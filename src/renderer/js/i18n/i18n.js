// ==========================================================================
// i18n — Lightweight Localisation Utility
// Usage:
//   t('key')                → translated string (fallback to key if missing)
//   t('key', {name:'Foo'}) → interpolated: "{name}" → "Foo"
//   applyI18n()            → walk the DOM and replace [data-i18n] elements
//   setLanguage('en')      → switch language in-place
//   getCurrentLang()       → returns current lang code string
// ==========================================================================

(function () {
    'use strict';

    const SUPPORTED = ['zh-CN', 'en', 'ja'];
    const STORAGE_KEY = 'app_language';

    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.dataset.i18nDynamic = 'true';
            script.onload = () => resolve();
            script.onerror = () => reject(new Error(`Failed to load locale script: ${src}`));
            document.head.appendChild(script);
        });
    }

    async function loadLocaleBundle(lang) {
        document.querySelectorAll('script[data-i18n-dynamic="true"]').forEach(el => el.remove());
        window.__LOCALE_DATA__ = {};

        const cacheBust = `?t=${Date.now()}`;
        const scripts = [
            `js/i18n/locales/${lang}.js${cacheBust}`,
            `js/i18n/locales/extra.js${cacheBust}`,
            `js/i18n/locales/ui-extra.js${cacheBust}`
        ];

        for (const src of scripts) {
            await loadScript(src);
        }
    }

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

    async function setLanguage(lang) {
        if (!SUPPORTED.includes(lang)) return;
        localStorage.setItem(STORAGE_KEY, lang);
        document.documentElement.lang = lang;
        await loadLocaleBundle(lang);
        applyI18n();
        window.dispatchEvent(new CustomEvent('app-language-changed', { detail: { lang } }));
    }

    // -----------------------------------------------------------------------
    // Initial locale script injection (called from the inline <script> in
    // <head> before DOMContentLoaded, so it's synchronous)
    // -----------------------------------------------------------------------
    function injectLocaleScript() {
        const lang = getCurrentLang();
        // The locale file sets window.__LOCALE_DATA__
        const script = document.createElement('script');
        script.src = `js/i18n/locales/${lang}.js`;
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
    window.__i18n_loadLocaleBundle = loadLocaleBundle;
})();
