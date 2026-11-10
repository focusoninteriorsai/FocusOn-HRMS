// FOCUSON HRMS - Hash Routing Engine with Permission Guards

import { getState, hasPermission } from './store.js';

const routes = new Map();
let notFoundHandler = null;

export function registerRoute(path, config) {
  // config: { title, permission, requiresAuth = true, render: (container) => void }
  routes.set(path, config);
}

export function setNotFoundHandler(handler) {
  notFoundHandler = handler;
}

export function navigateTo(hash) {
  window.location.hash = hash.startsWith('#') ? hash : `#${hash}`;
}

export function getCurrentRoute() {
  const hash = window.location.hash || '#/login';
  return hash.split('?')[0];
}

export function initRouter(mountPoint) {
  const handleHashChange = async () => {
    let currentHash = getCurrentRoute();
    const state = getState();

    // Forced password change route guard
    if (state.user && state.mustChangePassword && currentHash !== '#/change-password') {
      window.location.hash = '#/change-password';
      return;
    }

    // Default route mapping
    if (currentHash === '' || currentHash === '#/' || currentHash === '#') {
      currentHash = state.user ? '#/dashboard' : '#/login';
      window.location.hash = currentHash;
      return;
    }

    let routeConfig = routes.get(currentHash);

    // If route requires auth and user is unauthenticated
    if (routeConfig && routeConfig.requiresAuth && !state.user) {
      window.location.hash = '#/login';
      return;
    }

    // If user is already authenticated and visits #/login
    if (currentHash === '#/login' && state.user && !state.mustChangePassword) {
      window.location.hash = '#/dashboard';
      return;
    }

    // Permission Guard
    if (routeConfig && routeConfig.permission && !hasPermission(routeConfig.permission)) {
      mountPoint.innerHTML = `
        <div class="empty-state">
          <div class="empty-state-icon">
            <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="4.93" y1="4.93" x2="19.07" y2="19.07"></line></svg>
          </div>
          <h2 class="empty-state-title">Access Denied</h2>
          <p class="empty-state-desc">You do not have the required permission (${routeConfig.permission}) to view this section.</p>
          <a href="#/dashboard" class="btn btn-primary" style="margin-top: 1rem;">Back to Dashboard</a>
        </div>
      `;
      return;
    }

    if (!routeConfig) {
      if (notFoundHandler) {
        notFoundHandler(mountPoint, currentHash);
      } else {
        mountPoint.innerHTML = `
          <div class="empty-state">
            <h2 class="empty-state-title">Page Not Found</h2>
            <p class="empty-state-desc">The requested route "${currentHash}" does not exist.</p>
            <a href="#/dashboard" class="btn btn-primary" style="margin-top: 1rem;">Go to Dashboard</a>
          </div>
        `;
      }
      return;
    }

    // Render the route
    mountPoint.innerHTML = '';
    const container = document.createElement('div');
    container.className = 'page-enter';
    mountPoint.appendChild(container);
    await routeConfig.render(container);

    window.dispatchEvent(new CustomEvent('focuson:route_change', { detail: { route: currentHash, config: routeConfig } }));
  };

  window.addEventListener('hashchange', handleHashChange);
  handleHashChange();
}
