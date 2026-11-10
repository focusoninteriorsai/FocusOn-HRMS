// FOCUSON HRMS - Theme Manager (Light & Dark mode meeting WCAG AA)

let currentTheme = localStorage.getItem('FOCUSON_THEME') || 'light';
const listeners = new Set();

export function initTheme() {
  if (!localStorage.getItem('FOCUSON_THEME')) {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    currentTheme = prefersDark ? 'dark' : 'light';
  }
  applyTheme(currentTheme);
}

export function getTheme() {
  return currentTheme;
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  currentTheme = theme;
  localStorage.setItem('FOCUSON_THEME', theme);
  applyTheme(theme);
  listeners.forEach(fn => fn(theme));
}

export function toggleTheme() {
  const next = currentTheme === 'light' ? 'dark' : 'light';
  setTheme(next);
  return next;
}

export function onThemeChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
}
