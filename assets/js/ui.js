import { getLanguage, t } from './i18n.js';

const ICON_PATHS = Object.freeze({
  dashboard: ['M3 12h8V3H3v9Z', 'M13 21h8v-9h-8v9Z', 'M3 21h8v-5H3v5Z', 'M13 8h8V3h-8v5Z'],
  user: ['M20 21a8 8 0 0 0-16 0', 'M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'],
  lock: ['M6 10h12v11H6z', 'M8 10V7a4 4 0 0 1 8 0v3'],
  eye: ['M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z'],
  eyeOff: ['m3 3 18 18', 'M10.6 5.2A11.7 11.7 0 0 1 12 5c6.5 0 10 7 10 7a17.4 17.4 0 0 1-2.2 3', 'M6.2 6.2C3.4 8.1 2 12 2 12s3.5 7 10 7a10.8 10.8 0 0 0 4.1-.8'],
  sun: ['M12 4V2', 'M12 22v-2', 'm4 4 1.5 1.5', 'm18.5 18.5 1.5 1.5', 'M2 12h2', 'M20 12h2', 'm4 20 1.5-1.5', 'M18.5 5.5 20 4', 'M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z'],
  moon: ['M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8Z'],
  logout: ['M10 17l5-5-5-5', 'M15 12H3', 'M15 4h5v16h-5'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z', 'm9 12 2 2 4-4'],
  clock: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 6v6l4 2'],
  check: ['m5 12 4 4L19 6'],
  alert: ['M12 9v4', 'M12 17h.01', 'M10.3 3.7 2.2 18a2 2 0 0 0 1.7 3h16.2a2 2 0 0 0 1.7-3L13.7 3.7a2 2 0 0 0-3.4 0Z'],
  close: ['m6 6 12 12', 'M18 6 6 18'],
  arrow: ['m9 18 6-6-6-6'],
  users: ['M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2', 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z', 'M22 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  building: ['M3 21h18', 'M5 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16', 'M15 9h2a2 2 0 0 1 2 2v10', 'M9 7h2', 'M9 11h2', 'M9 15h2'],
  briefcase: ['M4 7h16v13H4z', 'M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2', 'M4 12h16'],
  target: ['M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z', 'M12 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z', 'M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z'],
  calendar: ['M4 5h16v16H4z', 'M8 3v4', 'M16 3v4', 'M4 10h16'],
  money: ['M2 7h20v10H2z', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M6 10v4', 'M18 10v4'],
  wallet: ['M3 7h15a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H5a2 2 0 0 1-2-2V7Z', 'M3 7V6a2 2 0 0 1 2-2h11v3', 'M17 13h.01'],
  chart: ['M4 20V10', 'M10 20V4', 'M16 20v-7', 'M22 20H2'],
  folder: ['M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z'],
  box: ['m12 3 8 4.5v9L12 21l-8-4.5v-9L12 3Z', 'M4 7.5 12 12l8-4.5', 'M12 12v9'],
  megaphone: ['M4 10v4a1 1 0 0 0 1 1h2l9 5V4L7 9H5a1 1 0 0 0-1 1Z', 'M18 9a3 3 0 0 1 0 6'],
  bell: ['M18 8a6 6 0 1 0-12 0c0 6-3 7-3 7h18s-3-1-3-7', 'M13.7 21a2 2 0 0 1-3.4 0'],
  cog: ['M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z', 'M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2 2 2 0 1 1-4 0 1.7 1.7 0 0 0-2.9-1.2l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1A1.7 1.7 0 0 0 3 15a2 2 0 1 1 0-4 1.7 1.7 0 0 0 1.5-2.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1A1.7 1.7 0 0 0 10 4a2 2 0 1 1 4 0 1.7 1.7 0 0 0 2.9 1.2l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1A1.7 1.7 0 0 0 21 11a2 2 0 1 1 0 4Z'],
  file: ['M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8l-5-5Z', 'M14 3v5h5', 'M9 13h6', 'M9 17h6'],
  plus: ['M12 5v14', 'M5 12h14'],
  download: ['M12 3v12', 'm7 10 5 5 5-5', 'M5 21h14'],
  refresh: ['M21 12a9 9 0 1 1-3-6.7', 'M21 3v6h-6'],
  search: ['M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Z', 'm21 21-4.3-4.3'],
  edit: ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z'],
  trash: ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6', 'M10 11v6', 'M14 11v6'],
  language: ['M4 5h7', 'M7 3v2c0 4-2 7-5 9', 'M5 9c1 3 3 5 6 6', 'm13 21 4-10 4 10', 'M14.5 17h5']
});

export function element(tag, options = {}, children = []) {
  const node = document.createElement(tag);
  Object.entries(options).forEach(([key, value]) => {
    if (value === undefined || value === null) return;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key === 'dataset') Object.assign(node.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (key in node && !key.startsWith('aria-')) node[key] = value;
    else node.setAttribute(key, String(value));
  });
  const list = Array.isArray(children) ? children : [children];
  list.filter((child) => child !== null && child !== undefined).forEach((child) => {
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  });
  return node;
}

export function icon(name, size = 20) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', String(size));
  svg.setAttribute('height', String(size));
  svg.setAttribute('fill', 'none');
  svg.setAttribute('stroke', 'currentColor');
  svg.setAttribute('stroke-width', '1.8');
  svg.setAttribute('stroke-linecap', 'round');
  svg.setAttribute('stroke-linejoin', 'round');
  svg.setAttribute('aria-hidden', 'true');
  (ICON_PATHS[name] || ICON_PATHS.dashboard).forEach((data) => {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', data);
    svg.append(path);
  });
  return svg;
}

export function setButtonBusy(button, busy, busyKey = 'common.working') {
  if (busy) {
    button.dataset.originalText = button.textContent;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    button.textContent = t(busyKey);
  } else {
    button.disabled = false;
    button.removeAttribute('aria-busy');
    if (button.dataset.originalText) button.textContent = button.dataset.originalText;
    delete button.dataset.originalText;
  }
}

export function showToast(message, type = 'info') {
  const region = document.getElementById('toast-region');
  const toast = element('div', { className: `toast toast-${type}`, role: type === 'error' ? 'alert' : 'status' }, [
    icon(type === 'success' ? 'check' : 'alert'),
    element('span', { text: message })
  ]);
  region.append(toast);
  requestAnimationFrame(() => toast.classList.add('is-visible'));
  setTimeout(() => {
    toast.classList.remove('is-visible');
    toast.addEventListener('transitionend', () => toast.remove(), { once: true });
    setTimeout(() => toast.remove(), 500);
  }, 5000);
}

let activeDialog = null;
let returnFocus = null;

export function openDialog({ title, content, actions = [], dismissible = true }) {
  closeDialog();
  returnFocus = document.activeElement;
  const backdrop = element('div', { className: 'dialog-backdrop' });
  const dialog = element('section', {
    className: 'dialog-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'dialog-title',
    tabindex: '-1'
  });
  const header = element('header', { className: 'dialog-header' }, [
    element('h2', { id: 'dialog-title', text: title })
  ]);
  if (dismissible) {
    header.append(element('button', {
      className: 'icon-button',
      type: 'button',
      'aria-label': t('common.close'),
      onclick: closeDialog
    }, icon('close')));
  }
  const body = element('div', { className: 'dialog-body' }, content);
  const footer = element('footer', { className: 'dialog-actions' }, actions);
  dialog.append(header, body, footer);
  backdrop.append(dialog);
  document.body.append(backdrop);
  document.body.classList.add('dialog-open');
  activeDialog = { backdrop, dialog, dismissible };

  backdrop.addEventListener('click', (event) => {
    if (dismissible && event.target === backdrop) closeDialog();
  });
  backdrop.addEventListener('keydown', trapDialogKeys);
  dialog.focus();
  return dialog;
}

function trapDialogKeys(event) {
  if (!activeDialog) return;
  if (event.key === 'Escape' && activeDialog.dismissible) {
    event.preventDefault();
    closeDialog();
    return;
  }
  if (event.key !== 'Tab') return;
  const focusable = Array.from(activeDialog.dialog.querySelectorAll('button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex="0"]'));
  if (!focusable.length) {
    event.preventDefault();
    activeDialog.dialog.focus();
    return;
  }
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

export function closeDialog() {
  if (!activeDialog) return;
  activeDialog.backdrop.remove();
  activeDialog = null;
  document.body.classList.remove('dialog-open');
  if (returnFocus?.isConnected) returnFocus.focus();
  returnFocus = null;
}

export function emptyState(title, description, iconName = 'dashboard') {
  return element('section', { className: 'empty-state card' }, [
    element('div', { className: 'empty-state-icon' }, icon(iconName, 28)),
    element('h2', { text: title }),
    element('p', { text: description })
  ]);
}

export function loadingState() {
  return element('div', { className: 'loading-stack', 'aria-label': t('common.loading') }, [
    element('div', { className: 'skeleton skeleton-title' }),
    element('div', { className: 'skeleton skeleton-card' }),
    element('div', { className: 'skeleton skeleton-card' })
  ]);
}

export function formatDate(value, options = {}) {
  if (!value) return t('common.notAvailable');
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('common.notAvailable');
  return new Intl.DateTimeFormat(getLanguage() === 'hi' ? 'hi-IN' : 'en-IN', {
    dateStyle: options.dateStyle || 'medium',
    timeStyle: options.timeStyle,
    timeZone: 'Asia/Kolkata'
  }).format(date);
}

export function definitionList(entries) {
  const list = element('dl', { className: 'definition-list' });
  entries.forEach(([label, value]) => {
    const row = element('div', { className: 'definition-row' }, [
      element('dt', { text: label }),
      element('dd', { text: value || t('common.notAvailable') })
    ]);
    list.append(row);
  });
  return list;
}
