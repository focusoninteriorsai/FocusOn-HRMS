import { getState, hasPermission } from './store.js';
import { t } from './i18n.js';
import { emptyState } from './ui.js';

const routes = new Map();
let mount = null;
let navigationSequence = 0;

export function registerRoute(path, config) {
  routes.set(path, { requiresAuth: true, ...config });
}

export function navigate(path, { replace = false } = {}) {
  const hash = path.startsWith('#') ? path : `#${path}`;
  if (window.location.hash === hash) {
    handleRoute();
    return;
  }
  if (replace) window.location.replace(hash);
  else window.location.hash = hash;
}

export function currentPath() {
  return (window.location.hash || '#/').split('?')[0];
}

function redirect(path) {
  if (currentPath() === path) return false;
  window.location.replace(`#${path}`);
  return true;
}

export async function handleRoute() {
  if (!mount || !getState().ready) return;
  const sequence = ++navigationSequence;
  let path = currentPath();
  const state = getState();

  if (path === '#/' || path === '#') {
    redirect(state.user ? '/dashboard' : '/login');
    return;
  }
  if (!state.user && path !== '#/login') {
    redirect('/login');
    return;
  }
  if (state.user && state.mustChangePassword && path !== '#/change-password') {
    redirect('/change-password');
    return;
  }
  if (state.user && !state.mustChangePassword && ['#/login', '#/change-password'].includes(path)) {
    redirect('/dashboard');
    return;
  }

  const route = routes.get(path);
  if (!route) {
    renderRoute(sequence, path, routes.get('#/not-found'));
    return;
  }
  if (route.requiresAuth && !state.user) {
    redirect('/login');
    return;
  }
  if (route.permission && !hasPermission(route.permission)) {
    renderRoute(sequence, path, routes.get('#/forbidden'));
    return;
  }
  await renderRoute(sequence, path, route);
}

async function renderRoute(sequence, requestedPath, route) {
  if (!route || sequence !== navigationSequence) return;
  mount.replaceChildren();
  const container = document.createElement('div');
  container.className = 'page-enter';
  mount.append(container);
  document.dispatchEvent(new CustomEvent('focuson:route-render', { detail: { path: requestedPath } }));
  try {
    await route.render(container);
  } catch (error) {
    if (sequence !== navigationSequence) return;
    container.replaceChildren(emptyState(t('errors.pageTitle'), error.message || t('errors.SERVER'), 'alert'));
  }
  if (sequence === navigationSequence) {
    document.title = `${route.title ? `${t(route.title)} · ` : ''}${getState().branding.companyName}`;
    const heading = container.querySelector('h1');
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
  }
}

export function initRouter(mountPoint) {
  mount = mountPoint;
  window.addEventListener('hashchange', handleRoute);
  return handleRoute();
}
