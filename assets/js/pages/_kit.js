/**
 * Shared page kit. Every module page composes these helpers so behaviour,
 * accessibility, error handling and i18n stay consistent across the product.
 */
import { apiRequest } from '../api.js';
import { t, translateError } from '../i18n.js';
import { getState, hasPermission } from '../store.js';
import {
  closeDialog, element, emptyState, formatDate, icon, loadingState, openDialog, setButtonBusy, showToast
} from '../ui.js';

/* ------------------------------------------------------------------ Header */
export function pageHeader(titleKey, subtitleKey, actions = [], iconName = 'dashboard') {
  return element('header', { className: 'page-header' }, [
    element('div', {}, [
      element('p', { className: 'eyebrow', text: t('app.workspace') }),
      element('h1', { text: t(titleKey) }),
      subtitleKey ? element('p', { className: 'page-subtitle', text: t(subtitleKey) }) : null
    ]),
    element('div', { className: 'page-actions' }, [
      ...actions,
      iconName ? element('span', { className: 'page-header-icon' }, icon(iconName, 26)) : null
    ].filter(Boolean))
  ]);
}

export function button(labelKey, { onClick, variant = 'secondary', iconName, type = 'button', disabled = false, label } = {}) {
  return element('button', { className: `button button-${variant}`,
    type,
    disabled,
    onclick: onClick
  }, [iconName ? icon(iconName, 18) : null, element('span', { text: label || t(labelKey) })].filter(Boolean));
}

/* -------------------------------------------------------------------- Data */
export async function load(action, payload = {}, options = {}) {
  return apiRequest(action, payload, { isRead: true, ...options });
}

/** Runs a write call with busy state, translated errors and optional success toast. */
export async function submit(action, payload, { trigger, successKey, onDone, confirmKey } = {}) {
  if (trigger) setButtonBusy(trigger, true, 'common.saving');
  try {
    const data = await apiRequest(action, payload);
    if (successKey) showToast(t(successKey), 'success');
    if (onDone) await onDone(data);
    return data;
  } catch (error) {
    showToast(translateError(error), 'error');
    return null;
  } finally {
    if (trigger) setButtonBusy(trigger, false);
  }
}

export function mountPage(container, loader) {
  container.replaceChildren(loadingState());
  return loader().catch((error) => {
    container.replaceChildren(emptyState(t('errors.pageTitle'), translateError(error), 'alert'));
    throw error;
  });
}

/* ------------------------------------------------------------------- Filters */
export function filterBar(fields, onChange) {
  const bar = element('div', { className: 'toolbar', role: 'search' });
  fields.forEach((field) => {
    const id = `filter-${field.name}`;
    let control;
    if (field.type === 'select') {
      control = element('select', { id, className: 'form-input' });
      (field.options || []).forEach((option) => {
        control.append(element('option', { value: option.value, text: option.label }));
      });
      control.value = field.value ?? '';
    } else if (field.type === 'date') {
      control = element('input', { id, className: 'form-input', type: 'date', value: field.value ?? '' });
    } else {
      control = element('input', { id, className: 'form-input', type: field.type || 'search', placeholder: field.placeholder || '', value: field.value ?? '' });
    }
    if (field.name === 'search') control.setAttribute('aria-label', t('common.search'));
    control.addEventListener('change', () => onChange({ [field.name]: control.value }));
    if (field.type === 'search' || !field.type) {
      control.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          onChange({ [field.name]: control.value });
        }
      });
    }
    bar.append(element('div', { className: `form-field${field.narrow ? ' narrow' : ''}` }, [
      element('label', { for: id, text: t(field.labelKey) }),
      control
    ]));
  });
  return bar;
}

/* -------------------------------------------------------------------- Table */
/**
 * columns: [{ key, labelKey|label, align, render(row) -> Node|string, width }]
 */
export function dataTable(columns, rows, options = {}) {
  const table = element('table', { className: 'data-table' });
  if (options.caption) table.append(element('caption', { text: t(options.caption) }));
  const headRow = element('tr');
  columns.forEach((column) => {
    headRow.append(element('th', { className: column.align === 'right' ? 'numeric' : '',
      text: column.label || t(column.labelKey),
      scope: 'col'
    }));
  });
  table.append(element('thead', {}, [headRow]));
  const body = element('tbody');
  if (!rows.length) {
    body.append(element('tr', {}, [
      element('td', { colspan: String(columns.length), className: 'table-empty', text: t(options.emptyKey || 'common.noRecords') })
    ]));
  }
  rows.forEach((row) => {
    const tr = element('tr', { className: row.__muted ? 'is-muted' : '' });
    columns.forEach((column) => {
      const td = element('td', { className: column.align === 'right' ? 'numeric' : (column.className || '') });
      const value = column.render ? column.render(row) : row[column.key];
      if (value instanceof Node) td.append(value);
      else td.textContent = value === undefined || value === null || value === '' ? '—' : String(value);
      tr.append(td);
    });
    body.append(tr);
  });
  table.append(body);
  return element('div', { className: 'table-wrap' }, [table]);
}

export function pagination(meta, onPage) {
  const total = Number(meta.total || 0);
  const page = Number(meta.page || 1);
  const pageCount = Number(meta.pageCount || 1);
  return element('div', { className: 'pagination' }, [
    element('span', { className: 'muted-small',
      text: t('common.pageSummary', { page: page, pages: Math.max(1, pageCount), total: total })
    }),
    element('div', { className: 'pagination-actions' }, [
      button('common.previous', { onClick: () => onPage(page - 1), disabled: page <= 1, variant: 'secondary' }),
      button('common.next', { onClick: () => onPage(page + 1), disabled: page >= pageCount, variant: 'secondary' })
    ])
  ]);
}

export function statRow(cards) {
  return element('div', { className: 'grid grid-4' }, cards.map((card) => element('article', { className: `stat-card ${card.tone || ''}`
  }, [
    element('span', { className: 'stat-label', text: t(card.labelKey) }),
    element('strong', { className: 'stat-value', text: card.value }),
    card.hint ? element('span', { className: 'stat-hint', text: card.hint }) : null
  ].filter(Boolean))));
}

/* -------------------------------------------------------------------- Badge */
const STATE_TONES = {
  ACTIVE: 'success', APPROVED: 'success', PAID: 'success', RELEASED: 'success', COMPLETED: 'success',
  CLOSED: 'neutral', VERIFIED: 'info', ISSUED: 'success', CONFIRMED: 'success', PRESENT: 'success',
  PENDING: 'warning', DRAFT: 'neutral', PREPARED: 'info', IN_PROGRESS: 'info', SUBMITTED: 'info',
  RETURNED: 'warning', ON_HOLD: 'warning', HALF_DAY: 'warning', LATE: 'warning', PROBATION: 'info',
  REJECTED: 'danger', CANCELLED: 'neutral', FAILED: 'danger', ABSENT: 'danger', LOCKED: 'neutral',
  INACTIVE: 'neutral', EXPIRED: 'neutral', EXITED: 'neutral', OFFERED: 'info', WITHDRAWN: 'neutral'
};

export function stateBadge(state, labelOverride) {
  const normalized = String(state || '').toUpperCase();
  return element('span', { className: `badge badge-${STATE_TONES[normalized] || 'neutral'}`,
    text: labelOverride ? t(labelOverride) : humanize(normalized)
  });
}

export function humanize(value) {
  if (!value) return '—';
  const text = String(value).replace(/[_-]+/g, ' ').toLowerCase();
  return text.charAt(0).toUpperCase() + text.slice(1);
}

export function money(value, currency = '₹') {
  const number = Number(value || 0);
  return element('span', { className: `money${number < 0 ? ' negative' : ''}`,
    text: `${number < 0 ? '-' : ''}${currency}${Math.abs(number).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  });
}

export function currency() {
  return getState().company?.currency || '₹';
}

export function dateCell(value) {
  return element('span', { text: formatDate(value) });
}

/* --------------------------------------------------------------------- Tabs */
export function tabs(items, onSelect) {
  const bar = element('div', { className: 'tabs', role: 'tablist' });
  items.forEach((item, index) => {
    const tab = element('button', { className: 'tab-button',
      type: 'button',
      role: 'tab',
      'aria-selected': index === 0 ? 'true' : 'false',
      onclick: () => {
        bar.querySelectorAll('.tab-button').forEach((node) => node.setAttribute('aria-selected', 'false'));
        tab.setAttribute('aria-selected', 'true');
        onSelect(item.id, item.value);
      }
    }, item.label instanceof Node ? item.label : [element('span', { text: item.label || t(item.labelKey) })]);
    if (item.count) tab.append(element('span', { className: 'badge badge-neutral', text: String(item.count) }));
    bar.append(tab);
  });
  return bar;
}

/* ------------------------------------------------------------------- Modals */
/**
 * Opens a form dialog.
 * fields: [{ name, labelKey, type, options, required, value, help, min, max, step, span }]
 */
export function formDialog({ title, fields, onSubmit, submitLabel = 'common.save', wide = false, intro, extraNodes = [] }) {
  const form = element('form', { className: 'form-grid', novalidate: true });
  const errorLine = element('p', { className: 'form-error', role: 'alert', hidden: true });
  const controls = {};

  fields.forEach((field) => {
    const id = `field-${field.name}`;
    let control;
    if (field.type === 'select') {
      control = element('select', { id, className: 'form-input' });
      if (!field.required) control.append(element('option', { value: '', text: field.placeholder || t('common.none') }));
      (field.options || []).forEach((option) => {
        control.append(element('option', { value: String(option.value), text: option.label, selected: String(field.value ?? '') === String(option.value) }));
      });
      if (field.value !== undefined && field.value !== null) control.value = String(field.value);
    } else if (field.type === 'textarea') {
      control = element('textarea', { id, className: 'form-input', maxlength: field.max || 4000, value: field.value || '' });
    } else if (field.type === 'checkbox') {
      control = element('input', { id, type: 'checkbox', checked: Boolean(field.value) });
    } else if (field.type === 'checkboxGroup' || field.type === 'multiselect') {
      control = element('div', { className: 'checkbox-grid', id, role: 'group', 'aria-label': t(field.labelKey) });
      (field.options || []).forEach((option) => {
        const input = element('input', { type: 'checkbox', value: String(option.value), id: `${id}-${option.value}`, checked: (field.value || []).map(String).includes(String(option.value)) });
        input.dataset.optionKey = String(option.value);
        control.append(element('label', { className: 'checkbox-row', for: `${id}-${option.value}` }, [input, element('span', { text: option.label })]));
      });
    } else {
      control = element('input', {
        id,
        className: 'form-input',
        type: field.type || 'text',
        value: field.value ?? '',
        min: field.min,
        max: field.max,
        step: field.step,
        maxlength: field.maxlength || 255,
        placeholder: field.placeholder || '',
        autocomplete: field.autocomplete || 'off',
        inputmode: field.inputmode
      });
    }
    controls[field.name] = control;
    const wrapper = element('div', { className: `form-field ${field.span === 2 ? 'span-2' : ''} ${field.span === 'full' ? 'span-full' : ''}` }, [
      field.type === 'checkbox'
        ? element('label', { className: 'checkbox-row', for: id }, [control, element('span', { text: t(field.labelKey) })])
        : element('label', { for: id, text: t(field.labelKey) + (field.required ? ' *' : '') }),
      field.type !== 'checkbox' ? control : null,
      field.help ? element('span', { className: 'field-hint', text: t(field.help) }) : null
    ].filter(Boolean));
    form.append(wrapper);
  });

  if (intro) form.prepend(element('p', { className: 'muted-small span-full', text: intro }));

  const readValues = () => {
    const values = {};
    fields.forEach((field) => {
      const control = controls[field.name];
      if (field.type === 'checkbox') values[field.name] = control.checked;
      else if (field.type === 'checkboxGroup' || field.type === 'multiselect') {
        values[field.name] = Array.from(control.querySelectorAll('input:checked')).map((input) => input.dataset.optionKey);
      } else if (field.type === 'number') values[field.name] = control.value === '' ? '' : Number(control.value);
      else values[field.name] = control.value;
    });
    return values;
  };

  const submitButton = element('button', { className: 'button button-primary', type: 'submit' }, [
    icon('check', 18), element('span', { text: t(submitLabel) })
  ]);

  const dialog = openDialog({
    title: t(title),
    content: [form, ...extraNodes, errorLine],
    actions: [element('button', { className: 'button button-secondary', type: 'button', text: t('common.cancel'), onclick: closeDialog }), submitButton]
  });
  if (wide) dialog.classList.add('wide');

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorLine.hidden = true;
    const values = readValues();
    const missing = fields.filter((field) => field.required && (values[field.name] === '' || values[field.name] === undefined || values[field.name] === null)).map((field) => t(field.labelKey));
    if (missing.length) {
      errorLine.textContent = t('common.requiredFields', { fields: missing.join(', ') });
      errorLine.hidden = false;
      return;
    }
    setButtonBusy(submitButton, true, 'common.saving');
    try {
      const result = await onSubmit(values);
      if (result !== false) {
        closeDialog();
        if (result !== undefined && result !== null && result.__toast !== false) showToast(t('common.saved'), 'success');
      }
    } catch (error) {
      errorLine.textContent = translateError(error);
      errorLine.hidden = false;
    } finally {
      setButtonBusy(submitButton, false);
    }
  });

  const firstInput = form.querySelector('input:not([type="hidden"]), select, textarea');
  if (firstInput) firstInput.focus({ preventScroll: true });
  return dialog;
}

export function confirmDialog({ titleKey, message, confirmKey = 'common.confirm', variant = 'danger', onConfirm }) {
  const confirmButton = element('button', { className: `button button-${variant}`,
    type: 'button',
    text: t(confirmKey)
  });
  confirmButton.addEventListener('click', async () => {
    setButtonBusy(confirmButton, true, 'common.saving');
    try {
      const outcome = await onConfirm();
      if (outcome !== false) closeDialog();
    } catch (error) {
      showToast(translateError(error), 'error');
    } finally {
      setButtonBusy(confirmButton, false);
    }
  });
  return openDialog({
    title: t(titleKey),
    content: element('p', { text: message }),
    actions: [element('button', { className: 'button button-secondary', type: 'button', text: t('common.cancel'), onclick: closeDialog }), confirmButton]
  });
}

export function detailDialog({ title, content }) {
  const dialog = openDialog({
    title,
    content,
    actions: [element('button', { className: 'button button-secondary', type: 'button', text: t('common.close'), onclick: closeDialog })],
    dismissible: true
  });
  dialog.classList.add('wide');
  return dialog;
}

/* ------------------------------------------------------------------ Perms */
export function can(permission) {
  return hasPermission(permission);
}

export function isSuperAdmin() {
  return Boolean(getState().user?.isSuperAdmin);
}

export function featureOn(key) {
  return getState().features ? getState().features[key] === true : true;
}

export function readOnlyNotice(key) {
  return element('div', { className: 'notice-inline warning' }, [icon('lock', 18), element('span', { text: t(key) })]);
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = element('a', { href: url, download: filename });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/** Applies a CSS custom property without touching the style attribute (CSP). */
export function setVar(node, name, value) {
  if (node && value) node.style.setProperty(name, String(value));
  return node;
}

/** Copy-to-clipboard used for one-time secrets (temporary passwords). */
export async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(t('common.copied'), 'success');
  } catch (error) {
    showToast(t('common.copyFailed'), 'error');
  }
}

export { element, icon, emptyState, loadingState, openDialog, closeDialog, showToast, formatDate, translateError };
