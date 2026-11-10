import { apiRequest } from './api.js';
import { changePassword, resetIdleTimer, restoreSession, savePreferences, signIn, signOut } from './auth.js';
import { CONFIG } from './config.js';
import { getLanguage, initI18n, onLanguageChange, setLanguage, t, translateError } from './i18n.js';
import { registerRoute, initRouter, navigate, handleRoute } from './router.js';
import { getState, hasPermission, mergeBranding, setState, subscribe } from './store.js';
import { applyBranding, getTheme, initTheme, onThemeChange, setTheme, toggleTheme } from './theme.js';
import { closeDialog, element, icon, openDialog, setButtonBusy, showToast } from './ui.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderProfile } from './pages/profile.js';
import { renderChangePassword } from './pages/change-password.js';
import { renderForbidden, renderNotFound } from './pages/error.js';

const dom = {};
let publicConfigurationWarning = false;

function cacheDom() {
  [
    'boot-screen', 'login-view', 'app-view', 'public-language', 'app-language', 'public-theme', 'app-theme',
    'public-brand-name', 'hero-company-name', 'app-brand-name', 'mobile-brand-name', 'public-tagline',
    'public-features', 'public-brand-logo', 'app-brand-logo', 'login-notice', 'configuration-notice',
    'login-form', 'employee-id', 'login-password', 'login-error', 'login-submit', 'toggle-password',
    'forgot-password', 'desktop-navigation', 'mobile-navigation', 'topbar-user', 'topbar-avatar',
    'topbar-profile', 'sidebar-logout', 'topbar-logout', 'main-app-content'
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

function registerRoutes() {
  registerRoute('#/login', { requiresAuth: false, render: () => {}, title: 'login.title' });
  registerRoute('#/dashboard', { render: renderDashboard, title: 'dashboard.title' });
  registerRoute('#/profile', { permission: 'employee.view', render: renderProfile, title: 'profile.title' });
  registerRoute('#/change-password', { render: renderChangePassword, title: 'changePassword.title' });
  registerRoute('#/not-found', { requiresAuth: false, render: renderNotFound, title: 'notFound.title' });
  registerRoute('#/forbidden', { render: renderForbidden, title: 'forbidden.title' });
}

function bindEvents() {
  dom['login-form'].addEventListener('submit', handleLogin);
  dom['toggle-password'].addEventListener('click', togglePasswordVisibility);
  dom['toggle-password'].replaceChildren(icon('eye'));
  dom['forgot-password'].addEventListener('click', showForgotPassword);
  dom['public-theme'].addEventListener('click', () => toggleTheme());
  dom['app-theme'].addEventListener('click', handleThemeToggle);
  dom['public-language'].addEventListener('change', (event) => changeLanguage(event.target.value));
  dom['app-language'].addEventListener('change', (event) => changeLanguage(event.target.value));
  dom['sidebar-logout'].addEventListener('click', () => signOut());
  dom['topbar-logout'].addEventListener('click', () => signOut());
  document.addEventListener('focuson:route-render', updateNavigationState);
  window.addEventListener('focuson:session-ended', handleSessionEnded);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) resetIdleTimer();
  });
  subscribe(renderIdentity);
  onThemeChange(renderThemeControls);
  onLanguageChange(async () => {
    syncLanguageControls();
    renderIdentity();
    buildNavigation();
    await handleRoute();
  });
}

async function bootstrap() {
  cacheDom();
  registerRoutes();
  bindEvents();
  await initI18n();
  initTheme();
  await loadPublicConfiguration();
  await restoreSession();
  const user = getState().user;
  if (user) await applyUserPreferences(user);
  setState({ ready: true });
  renderView();
  buildNavigation();
  renderThemeControls();
  syncLanguageControls();
  await initRouter(dom['main-app-content']);
  registerOfflineShell();
}

async function loadPublicConfiguration() {
  try {
    const config = await apiRequest('public.config', {}, { skipAuth: true, isRead: true });
    mergeBranding({
      companyName: safeText(config.companyName, 120) || 'FOCUSON HRMS',
      tagline: safeText(config.tagline, 240),
      logoUrl: safeLogoUrl(config.logoUrl),
      loginNotice: safeText(config.loginNotice, 1000),
      featureHighlights: Array.isArray(config.featureHighlights)
        ? config.featureHighlights.slice(0, 4).map((item) => safeText(item, 160)).filter(Boolean)
        : [],
      defaultLanguage: ['en', 'hi'].includes(config.defaultLanguage) ? config.defaultLanguage : 'en',
      defaultTheme: ['light', 'dark'].includes(config.defaultTheme) ? config.defaultTheme : 'light',
      themeTokens: config.themeTokens && typeof config.themeTokens === 'object' ? config.themeTokens : {},
      background: config.background && typeof config.background === 'object' ? config.background : {}
    });
    applyBranding(getState().branding.themeTokens, getState().branding.background);
    if (!hasStoredPreference('focuson.language')) await setLanguage(getState().branding.defaultLanguage, { persist: false });
    if (!hasStoredPreference('focuson.theme')) setTheme(getState().branding.defaultTheme, { persist: false });
  } catch (error) {
    publicConfigurationWarning = true;
  }
  renderBranding();
}

function hasStoredPreference(key) {
  try {
    return Boolean(localStorage.getItem(key));
  } catch (error) {
    return false;
  }
}

function safeText(value, maximumLength) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, maximumLength) : '';
}

function safeLogoUrl(value) {
  if (!value) return '';
  if (/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
  try {
    const url = new URL(value, window.location.href);
    return url.origin === window.location.origin && !url.protocol.startsWith('javascript') ? url.href : '';
  } catch (error) {
    return '';
  }
}

function renderBranding() {
  const branding = getState().branding;
  ['public-brand-name', 'hero-company-name', 'app-brand-name', 'mobile-brand-name'].forEach((id) => {
    dom[id].textContent = branding.companyName;
  });
  [dom['public-brand-logo'], dom['app-brand-logo']].forEach((logo) => {
    logo.src = branding.logoUrl || './assets/icons/icon-192.svg';
  });
  dom['public-tagline'].textContent = branding.tagline;
  dom['public-tagline'].hidden = !branding.tagline;
  dom['login-notice'].textContent = branding.loginNotice;
  dom['login-notice'].hidden = !branding.loginNotice;
  dom['public-features'].replaceChildren(...branding.featureHighlights.map((highlight) => (
    element('div', { className: 'feature-pill' }, [icon('check'), element('span', { text: highlight })])
  )));
  if (!CONFIG.API_URL) showConfigurationNotice('login.configMissing');
  else if (!getState().user && publicConfigurationWarning) showConfigurationNotice('login.configUnavailable');
}

function showConfigurationNotice(key) {
  dom['configuration-notice'].textContent = t(key);
  dom['configuration-notice'].hidden = false;
}

async function applyUserPreferences(user) {
  if (['en', 'hi'].includes(user.language) && user.language !== getLanguage()) {
    await setLanguage(user.language, { persist: false });
  }
  if (['light', 'dark'].includes(user.theme) && user.theme !== getTheme()) {
    setTheme(user.theme, { persist: false });
  }
}

async function changeLanguage(language) {
  await setLanguage(language);
  if (getState().user) {
    try {
      await savePreferences({ language });
    } catch (error) {
      showToast(translateError(error), 'error');
    }
  }
}

async function handleThemeToggle() {
  toggleTheme();
  if (getState().user) {
    try {
      await savePreferences({ theme: getTheme() });
    } catch (error) {
      showToast(translateError(error), 'error');
    }
  }
}

function renderView() {
  const user = getState().user;
  dom['boot-screen'].hidden = true;
  dom['login-view'].hidden = Boolean(user);
  dom['app-view'].hidden = !user;
  if (user) {
    renderIdentity();
    buildNavigation();
  } else {
    renderBranding();
    document.title = `${t('login.title')} · ${getState().branding.companyName}`;
  }
}

function renderIdentity() {
  const { user, ready } = getState();
  if (!ready) return;
  renderViewIfChanged(user);
  if (!user) return;
  dom['topbar-user'].textContent = user.displayName || user.employeeId;
  dom['topbar-avatar'].textContent = initials(user.displayName || user.employeeId);
  dom['topbar-profile'].hidden = !hasPermission('employee.view');
  dom['app-view'].classList.toggle('password-change-only', getState().mustChangePassword);
}

let lastRenderedUser = null;
function renderViewIfChanged(user) {
  if (lastRenderedUser === user) return;
  lastRenderedUser = user;
  dom['login-view'].hidden = Boolean(user);
  dom['app-view'].hidden = !user;
  if (!user) renderBranding();
}

function buildNavigation() {
  const items = [
    { path: '/dashboard', label: 'dashboard.title', icon: 'dashboard', visible: Boolean(getState().user && !getState().mustChangePassword) },
    { path: '/profile', label: 'profile.title', icon: 'user', visible: Boolean(getState().user && !getState().mustChangePassword && hasPermission('employee.view')) }
  ].filter((item) => item.visible);
  [dom['desktop-navigation'], dom['mobile-navigation']].forEach((navigation) => {
    navigation.replaceChildren(...items.map((item) => {
      const link = element('a', { className: 'navigation-link', href: `#${item.path}`, dataset: { route: `#${item.path}` } }, [
        icon(item.icon), element('span', { text: t(item.label) })
      ]);
      return link;
    }));
    updateNavigationState();
  });
  dom['sidebar-logout'].replaceChildren(icon('logout'), element('span', { text: t('common.logout') }));
}

function updateNavigationState() {
  document.querySelectorAll('.navigation-link').forEach((link) => {
    const active = link.dataset.route === window.location.hash;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

function renderThemeControls() {
  const name = getTheme() === 'dark' ? 'sun' : 'moon';
  [dom['public-theme'], dom['app-theme']].forEach((button) => button.replaceChildren(icon(name)));
  dom['topbar-logout'].replaceChildren(icon('logout'));
}

function syncLanguageControls() {
  dom['public-language'].value = getLanguage();
  dom['app-language'].value = getLanguage();
}

function initials(value) {
  return String(value).trim().split(/\s+/).slice(0, 2).map((part) => part.charAt(0).toLocaleUpperCase()).join('');
}

function togglePasswordVisibility() {
  const showing = dom['login-password'].type === 'text';
  dom['login-password'].type = showing ? 'password' : 'text';
  dom['toggle-password'].replaceChildren(icon(showing ? 'eye' : 'eyeOff'));
  dom['toggle-password'].setAttribute('aria-label', t(showing ? 'login.showPassword' : 'login.hidePassword'));
}

async function handleLogin(event) {
  event.preventDefault();
  dom['login-error'].hidden = true;
  const employeeId = dom['employee-id'].value.trim();
  const password = dom['login-password'].value;
  if (!employeeId || !password) {
    showLoginError(t('login.required'));
    return;
  }
  setButtonBusy(dom['login-submit'], true, 'login.signingIn');
  try {
    const data = await signIn(employeeId, password);
    dom['login-form'].reset();
    await applyUserPreferences(data.user);
    lastRenderedUser = null;
    renderView();
    buildNavigation();
    navigate(data.mustChangePassword ? '/change-password' : '/dashboard');
  } catch (error) {
    showLoginError(translateError(error));
  } finally {
    setButtonBusy(dom['login-submit'], false);
    dom['login-password'].value = '';
  }
}

function showLoginError(message) {
  dom['login-error'].textContent = message;
  dom['login-error'].hidden = false;
}

function showForgotPassword() {
  openDialog({
    title: t('login.forgotTitle'),
    content: element('p', { text: t('login.forgotDescription') }),
    actions: [element('button', { className: 'button button-primary', type: 'button', text: t('common.close'), onclick: closeDialog })]
  });
}

function handleSessionEnded(event) {
  if (!getState().ready) return;
  lastRenderedUser = null;
  closeDialog();
  renderView();
  buildNavigation();
  navigate('/login');
  const reason = event.detail?.reason;
  if (reason === 'expired') showToast(t('errors.SESSION_EXPIRED'), 'error');
  else if (reason === 'idle') showToast(t('app.idleLogout'), 'info');
  else if (reason === 'logoutAll') showToast(t('app.loggedOutAll'), 'success');
}

function registerOfflineShell() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // The online application remains fully usable when offline-shell registration fails.
  });
}

bootstrap().catch(() => {
  cacheDom();
  dom['boot-screen'].hidden = true;
  dom['login-view'].hidden = false;
  showConfigurationNotice('errors.STARTUP');
});
