// FOCUSON HRMS - i18n Localization Engine (English & Hindi)

let currentLang = localStorage.getItem('FOCUSON_LANG') || 'en';
const translations = {
  en: null,
  hi: null
};

const listeners = new Set();

export async function initI18n() {
  try {
    const [enRes, hiRes] = await Promise.all([
      fetch('./assets/i18n/en.json'),
      fetch('./assets/i18n/hi.json')
    ]);
    translations.en = await enRes.json();
    translations.hi = await hiRes.json();
  } catch (err) {
    console.error('Failed to load i18n dictionaries:', err);
  }
}

export function getLanguage() {
  return currentLang;
}

export function setLanguage(lang) {
  if (lang !== 'en' && lang !== 'hi') return;
  currentLang = lang;
  localStorage.setItem('FOCUSON_LANG', lang);
  document.documentElement.lang = lang;
  listeners.forEach(fn => fn(lang));
}

export function onLanguageChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

// Translates dot-notated key: t('login.signIn') or with variables: t('common.welcome', { name: 'John' })
export function t(keyPath, params = {}) {
  const dict = translations[currentLang] || translations.en || {};
  const fallback = translations.en || {};
  
  const resolve = (obj, path) => path.split('.').reduce((acc, part) => (acc && acc[part] !== undefined ? acc[part] : null), obj);
  
  let text = resolve(dict, keyPath);
  if (text === null || text === undefined) {
    text = resolve(fallback, keyPath);
  }
  if (text === null || text === undefined) {
    return keyPath;
  }
  
  if (typeof text === 'string' && Object.keys(params).length > 0) {
    Object.keys(params).forEach(p => {
      text = text.replace(new RegExp(`{${p}}`, 'g'), params[p]);
    });
  }
  return text;
}
