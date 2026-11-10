import { CONFIG } from './config.js';

const SUPPORTED = ['en', 'hi'];
const listeners = new Set();
let language = CONFIG.DEFAULT_LANGUAGE;
let messages = {};
let fallbackMessages = {};

function readStoredLanguage() {
  try {
    const value = localStorage.getItem('focuson.language');
    return SUPPORTED.includes(value) ? value : '';
  } catch (error) {
    return '';
  }
}

async function loadMessages(locale) {
  const response = await fetch(new URL(`../i18n/${locale}.json`, import.meta.url), { cache: 'no-cache' });
  if (!response.ok) throw new Error('translationLoadFailed');
  return response.json();
}

export async function initI18n(preferredLanguage = '') {
  fallbackMessages = await loadMessages('en');
  const selected = preferredLanguage || readStoredLanguage() || CONFIG.DEFAULT_LANGUAGE;
  language = SUPPORTED.includes(selected) ? selected : 'en';
  messages = language === 'en' ? fallbackMessages : await loadMessages(language);
  applyDocumentLanguage();
}

function lookup(source, key) {
  return key.split('.').reduce((value, part) => (
    value && typeof value === 'object' ? value[part] : undefined
  ), source);
}

export function t(key, variables = {}) {
  const template = lookup(messages, key) ?? lookup(fallbackMessages, key) ?? key;
  return String(template).replace(/\{(\w+)\}/g, (match, name) => (
    Object.prototype.hasOwnProperty.call(variables, name) ? String(variables[name]) : match
  ));
}

export function getLanguage() {
  return language;
}

export async function setLanguage(nextLanguage, { persist = true } = {}) {
  if (!SUPPORTED.includes(nextLanguage)) return;
  language = nextLanguage;
  messages = nextLanguage === 'en' ? fallbackMessages : await loadMessages(nextLanguage);
  if (persist) {
    try {
      localStorage.setItem('focuson.language', nextLanguage);
    } catch (error) {
      // The preference remains valid for this tab when storage is unavailable.
    }
  }
  applyDocumentLanguage();
  listeners.forEach((listener) => listener(nextLanguage));
}

function applyDocumentLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n);
  });
  document.querySelectorAll('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria));
  });
  document.querySelectorAll('[data-i18n-title]').forEach((node) => {
    node.setAttribute('title', t(node.dataset.i18nTitle));
  });
}

export function translateError(error) {
  const code = error && error.code ? error.code : 'SERVER';
  const key = `errors.${code}`;
  const translated = t(key);
  if (language === 'en' && error?.message && /\s/.test(error.message)) return error.message;
  return translated === key ? (error?.message || t('errors.SERVER')) : translated;
}

export function onLanguageChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
