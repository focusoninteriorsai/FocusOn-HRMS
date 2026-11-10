import { CONFIG } from './config.js';

const listeners = new Set();
const HEX_COLOR = /^#[0-9a-fA-F]{6}$/;
const ALLOWED_TOKENS = new Set(['primaryColor', 'accentColor', 'cornerRadius', 'cardStyle', 'density', 'font']);
let theme = CONFIG.DEFAULT_THEME;

function storedTheme() {
  try {
    const value = localStorage.getItem('focuson.theme');
    return ['light', 'dark'].includes(value) ? value : '';
  } catch (error) {
    return '';
  }
}

export function initTheme(preferredTheme = '') {
  theme = ['light', 'dark'].includes(preferredTheme)
    ? preferredTheme
    : (storedTheme() || CONFIG.DEFAULT_THEME);
  applyTheme();
}

export function getTheme() {
  return theme;
}

export function setTheme(nextTheme, { persist = true } = {}) {
  if (!['light', 'dark'].includes(nextTheme)) return;
  theme = nextTheme;
  if (persist) {
    try {
      localStorage.setItem('focuson.theme', nextTheme);
    } catch (error) {
      // The selected theme still applies for the current tab.
    }
  }
  applyTheme();
  listeners.forEach((listener) => listener(theme));
}

export function toggleTheme(options) {
  setTheme(theme === 'dark' ? 'light' : 'dark', options);
}

function applyTheme() {
  document.documentElement.dataset.theme = theme;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = theme === 'dark' ? '#101522' : '#f4f7fc';
}

export function applyBranding(tokens = {}, background = {}) {
  const root = document.documentElement;
  Object.entries(tokens).forEach(([key, value]) => {
    if (!ALLOWED_TOKENS.has(key)) return;
    if ((key === 'primaryColor' || key === 'accentColor') && HEX_COLOR.test(value)) {
      root.style.setProperty(key === 'primaryColor' ? '--brand-primary' : '--brand-accent', value);
    }
    if (key === 'cornerRadius' && Number.isFinite(value) && value >= 8 && value <= 24) {
      root.style.setProperty('--radius-card', `${value}px`);
    }
    if (key === 'cardStyle' && ['flat', 'soft', 'glass'].includes(value)) {
      root.dataset.cardStyle = value;
    }
    if (key === 'density' && ['comfortable', 'compact'].includes(value)) {
      root.dataset.density = value;
    }
    if (key === 'font' && ['system', 'humanist', 'readable'].includes(value)) {
      root.dataset.font = value;
    }
  });

  const backgroundType = ['solid', 'gradient', 'animated'].includes(background.type) ? background.type : 'gradient';
  root.dataset.loginBackground = backgroundType;
  root.dataset.backgroundPreset = ['astra', 'dawn', 'mono'].includes(background.preset) ? background.preset : 'astra';
  const overlay = Number(background.overlayOpacity);
  root.style.setProperty('--login-overlay-opacity', Number.isFinite(overlay) ? Math.min(0.9, Math.max(0, overlay)) : 0);
  const blur = Number(background.blur);
  root.style.setProperty('--login-background-blur', Number.isFinite(blur) ? `${Math.min(20, Math.max(0, blur))}px` : '0px');
}

export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
