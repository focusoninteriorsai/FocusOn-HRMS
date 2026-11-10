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
import { renderAccess, renderEmployees } from './pages/access.js';
import { renderOrganization } from './pages/organization.js';
import { renderAttendance } from './pages/attendance.js';
import { renderLeave } from './pages/leave.js';
import { renderPayroll } from './pages/payroll.js';
import { renderMoney } from './pages/money.js';
import { renderRecruitment } from './pages/recruitment.js';
import { renderDocuments, renderPerformance, renderExit, renderAssets, renderAnnouncements } from './pages/work.js';
import { renderReports, renderWorkflow, renderNotifications, renderSettings } from './pages/operations.js';
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
    'topbar-profile', 'sidebar-logout', 'topbar-logout', 'main-app-content', 'topbar-alerts'
  ].forEach((id) => { dom[id] = document.getElementById(id); });
}

function registerRoutes() {
  registerRoute('#/login', { requiresAuth: false, render: () => {}, title: 'login.title' });
  registerRoute('#/dashboard', { render: renderDashboard, title: 'dashboard.title' });
  registerRoute('#/profile', { render: renderProfile, title: 'profile.title' });
  registerRoute('#/employees', { permission: 'employee.view', render: renderEmployees, title: 'employees.title' });
  registerRoute('#/organization', { permission: 'org.view', render: renderOrganization, title: 'org.title' });
  registerRoute('#/attendance', { permission: 'attendance.view', render: renderAttendance, title: 'attendance.title' });
  registerRoute('#/leave', { permission: 'leave.view', render: renderLeave, title: 'leave.title' });
  registerRoute('#/payroll', { permission: 'payroll.view', render: renderPayroll, title: 'payroll.title' });
  registerRoute('#/payslips', { permission: 'payslip.view', render: renderPayroll, title: 'payroll.tabPayslips' });
  registerRoute('#/money', { permission: 'expense.view', render: renderMoney, title: 'money.title' });
  registerRoute('#/documents', { permission: 'document.view', render: renderDocuments, title: 'documents.title' });
  registerRoute('#/recruitment', { permission: 'recruitment.view', render: renderRecruitment, title: 'recruitment.title' });
  registerRoute('#/performance', { permission: 'performance.view', render: renderPerformance, title: 'performance.title' });
  registerRoute('#/exit', { permission: 'exit.view', render: renderExit, title: 'exit.title' });
  registerRoute('#/assets', { permission: 'asset.view', render: renderAssets, title: 'assets.title' });
  registerRoute('#/announcements', { permission: 'announcement.view', render: renderAnnouncements, title: 'announcements.title' });
  registerRoute('#/reports', { permission: 'report.headcount.view', render: renderReports, title: 'reports.title' });
  registerRoute('#/workflow', { permission: 'workflow.inbox', render: renderWorkflow, title: 'workflow.title' });
  registerRoute('#/notifications', { render: renderNotifications, title: 'notifications.title' });
  registerRoute('#/access', { permission: 'user.view', render: renderAccess, title: 'access.title' });
  registerRoute('#/settings', { permission: 'settings.view', render: renderSettings, title: 'settings.title' });
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
  dom['topbar-alerts'].addEventListener('click', () => navigate('/notifications'));
  document.addEventListener('focuson:route-render', updateNavigationState);
  document.addEventListener('focuson:data-changed', () => refreshBootstrap());
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

let bootstrapPayload = null;
let bootstrapFor = null;

/** Refreshes permissions, feature switches and counters from the server. */
async function refreshBootstrap() {
  if (!getState().user) return;
  try {
    const data = await apiRequest('access.bootstrap', {}, { isRead: true });
    bootstrapPayload = data;
    bootstrapFor = getState().user.employeeId;
    setState({
      features: data.features || {},
      pendingApprovals: data.pendingApprovals || 0,
      unreadNotifications: data.unreadNotifications || 0,
      company: data.company || getState().company
    });
    buildNavigation();
    updateAlertBadge();
  } catch (error) {
    // A failed refresh must never break the shell; the next navigation retries.
  }
}

function updateAlertBadge() {
  const unread = Number(getState().unreadNotifications || 0);
  dom['topbar-alerts'].classList.toggle('has-badge', unread > 0);
  dom['topbar-alerts'].setAttribute('aria-label', unread > 0 ? `${t('notifications.title')} (${unread})` : t('notifications.title'));
  dom['topbar-alerts'].replaceChildren(icon('bell'), unread > 0 ? element('span', { className: 'nav-badge', text: String(unread) }) : '');
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
  updateAlertBadge();
  if (bootstrapFor !== user.employeeId) refreshBootstrap();
}

/** Keeps the shell in step when data changes elsewhere in the app. */
function announceDataChanged() {
  document.dispatchEvent(new CustomEvent('focuson:data-changed'));
}

let lastRenderedUser = null;
function renderViewIfChanged(user) {
  if (lastRenderedUser === user) return;
  lastRenderedUser = user;
  dom['login-view'].hidden = Boolean(user);
  dom['app-view'].hidden = !user;
  if (!user) renderBranding();
}

/** Single source of truth for routes, navigation labels, icons and permissions. */
const NAVIGATION = [
  { group: 'nav.workspace', items: [
    { path: '/dashboard', label: 'dashboard.title', icon: 'dashboard' },
    { path: '/profile', label: 'profile.title', icon: 'user' }
  ] },
  { group: 'nav.people', items: [
    { path: '/employees', label: 'employees.title', icon: 'users', permission: 'employee.view' },
    { path: '/organization', label: 'org.title', icon: 'building', permission: 'org.view' },
    { path: '/recruitment', label: 'recruitment.title', icon: 'briefcase', permission: 'recruitment.view', feature: 'recruitment' },
    { path: '/performance', label: 'performance.title', icon: 'target', permission: 'performance.view', feature: 'performance' },
    { path: '/exit', label: 'exit.title', icon: 'logout', permission: 'exit.view', feature: 'exit' }
  ] },
  { group: 'nav.time', items: [
    { path: '/attendance', label: 'attendance.title', icon: 'clock', permission: 'attendance.view', feature: 'attendance' },
    { path: '/leave', label: 'leave.title', icon: 'calendar', permission: 'leave.view', feature: 'leave' },
    { path: '/workflow', label: 'workflow.title', icon: 'check', permission: 'workflow.inbox', feature: 'workflow' }
  ] },
  { group: 'nav.pay', items: [
    { path: '/payroll', label: 'payroll.title', icon: 'money', permission: 'payroll.view', feature: 'payroll' },
    { path: '/payslips', label: 'payroll.tabPayslips', icon: 'file', permission: 'payslip.view', feature: 'payslips' },
    { path: '/money', label: 'money.title', icon: 'wallet', permission: 'expense.view', feature: 'expenses' },
    { path: '/reports', label: 'reports.title', icon: 'chart', permission: 'report.headcount.view', feature: 'reports' }
  ] },
  { group: 'nav.records', items: [
    { path: '/documents', label: 'documents.title', icon: 'folder', permission: 'document.view', feature: 'documents' },
    { path: '/assets', label: 'assets.title', icon: 'box', permission: 'asset.view', feature: 'assets' },
    { path: '/announcements', label: 'announcements.title', icon: 'megaphone', permission: 'announcement.view', feature: 'announcements' },
    { path: '/notifications', label: 'notifications.title', icon: 'bell' }
  ] },
  { group: 'nav.admin', items: [
    { path: '/access', label: 'access.title', icon: 'shield', permission: 'user.view' },
    { path: '/settings', label: 'settings.title', icon: 'cog', permission: 'settings.view' }
  ] }
];

function visibleNavigation() {
  const state = getState();
  if (!state.user || state.mustChangePassword) return [];
  const features = state.features || {};
  return NAVIGATION.map((group) => ({
    group: group.group,
    items: group.items.filter((item) => (
      (!item.permission || hasPermission(item.permission)) && (!item.feature || features[item.feature] !== false)
    ))
  })).filter((group) => group.items.length);
}

function buildNavigation() {
  const groups = visibleNavigation();
  [dom['desktop-navigation'], dom['mobile-navigation']].forEach((navigation, index) => {
    const nodes = [];
    groups.forEach((group) => {
      if (index === 0) nodes.push(element('div', { className: 'nav-group-label', text: t(group.group) }));
      group.items.forEach((item) => {
        nodes.push(element('a', {
          className: 'navigation-link',
          href: `#${item.path}`,
          title: t(item.label),
          dataset: { route: `#${item.path}` }
        }, [
          icon(item.icon),
          element('span', { text: t(item.label) }),
          item.path === '/workflow' && getState().pendingApprovals
            ? element('span', { className: 'nav-badge', text: String(getState().pendingApprovals) })
            : null
        ].filter(Boolean)));
      });
    });
    navigation.replaceChildren(...nodes);
    updateNavigationState();
  });
  dom['sidebar-logout'].replaceChildren(icon('logout'), element('span', { text: t('common.logout') }));
  dom['topbar-alerts'].replaceChildren(icon('bell'));
  dom['topbar-alerts'].hidden = !getState().user;
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
