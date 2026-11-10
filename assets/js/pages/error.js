import { navigate } from '../router.js';
import { getState } from '../store.js';
import { t } from '../i18n.js';
import { element, emptyState } from '../ui.js';

export function renderNotFound(container) {
  renderError(container, 'notFound.title', 'notFound.description');
}

export function renderForbidden(container) {
  renderError(container, 'forbidden.title', 'forbidden.description');
}

function renderError(container, titleKey, descriptionKey) {
  const state = emptyState(t(titleKey), t(descriptionKey), 'alert');
  const button = element('button', {
    className: 'button button-primary',
    type: 'button',
    text: t(getState().user ? 'common.backDashboard' : 'common.backLogin'),
    onclick: () => navigate(getState().user ? '/dashboard' : '/login')
  });
  state.append(button);
  container.replaceChildren(state);
}
