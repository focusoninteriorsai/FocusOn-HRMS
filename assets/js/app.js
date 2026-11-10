// FOCUSON HRMS - Main Application Entrypoint & Shell Coordinator

import { CONFIG } from './config.js';
import { initI18n, t, getLanguage, setLanguage, onLanguageChange } from './i18n.js';
import { initTheme, getTheme, toggleTheme, onThemeChange } from './theme.js';
import { getState, setState, subscribe, hasPermission } from './store.js';
import { apiRequest } from './api.js';
import { login, validateExistingSession, changePassword, logout, logoutAll } from './auth.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from './ui.js';
import { registerRoute, initRouter, navigateTo } from './router.js';

import { renderAttendancePage } from './pages/attendance.js';
import { renderLeavePage } from './pages/leave.js';
import { renderInboxPage } from './pages/inbox.js';
import { renderEmployeesPage } from './pages/employees.js';
import { renderPayrollPage } from './pages/payroll.js';
import { renderSuperAdminPage } from './pages/superadmin.js';
import { renderReportsPage } from './pages/reports.js';
import { renderRdashPage } from './pages/rdash.js';
import { renderDocumentsPage } from './pages/documents.js';
import { renderTasksPage } from './pages/tasks.js';
import { initMapsQuotaDefense } from './maps.js';
import { initWorkspaceAuth, signInWithGoogle, getWorkspaceUser, disconnectWorkspace } from './workspace.js';

// DOM Mount Elements
const root = document.getElementById('root');

async function bootstrap() {
  initMapsQuotaDefense();
  await initWorkspaceAuth(() => {
    // Re-render shell if workspace connection state updates
    renderShell();
  });
  await initI18n();
  initTheme();

  // Register service worker if supported
  if ('serviceWorker' in navigator && window.location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('./sw.js').catch(err => {
      console.warn('SW registration failed:', err);
    });
  }

  // Load public branding and config from backend if API_URL is configured
  if (CONFIG.API_URL) {
    try {
      const pubConfig = await apiRequest('public.config', {}, { skipAuth: true, isRead: true });
      if (pubConfig) {
        setState({
          branding: {
            companyName: pubConfig.companyName || 'FOCUSON HRMS',
            tagline: pubConfig.tagline || 'Enterprise HR & Payroll Management',
            logoUrl: pubConfig.logoUrl || './assets/icons/icon-192.svg',
            loginNotice: pubConfig.loginNotice || '',
            themeTokens: pubConfig.themeTokens || null
          }
        });
      }
    } catch (e) {
      console.warn('Could not fetch public.config from backend:', e);
    }
  }

  // Validate existing session
  await validateExistingSession();

  // Setup app routes
  setupRoutes();

  // Render Shell structure
  renderShell();

  // Listen for state changes
  subscribe(() => {
    renderShell();
  });

  onLanguageChange(() => {
    renderShell();
  });

  // Global auth expiry listener
  window.addEventListener('focuson:auth_expired', () => {
    showToast('Your session has expired. Please sign in again.', 'warning');
    navigateTo('#/login');
  });

  window.addEventListener('focuson:idle_logout', () => {
    showToast('You were logged out due to inactivity.', 'info');
    navigateTo('#/login');
  });
}

function renderShell() {
  const state = getState();
  if (!state.user) {
    renderPublicLanding();
  } else {
    renderAuthenticatedShell();
  }
}

// ============================================================================
// 1. PUBLIC LANDING & LOGIN CARD
// ============================================================================
function renderPublicLanding() {
  const state = getState();
  const branding = state.branding;
  const currentLang = getLanguage();
  const currentTheme = getTheme();

  root.innerHTML = `
    <div class="login-page-wrap">
      <div class="ambient-bg"></div>

      <!-- Top Utility Header -->
      <header class="login-header-bar">
        <div class="brand-badge">
          <img src="${branding.logoUrl}" alt="Logo" class="brand-logo-img" />
          <span>${branding.companyName}</span>
        </div>
        <div style="display: flex; align-items: center; gap: var(--space-2);">
          <!-- Backend Connection Setup Indicator -->
          <button id="btn-backend-settings" class="btn btn-ghost" title="${t('common.configureBackend')}">
            <span class="status-dot ${CONFIG.API_URL ? 'status-dot-success' : 'status-dot-danger'}"></span>
            <span style="font-size: 0.8125rem;">${CONFIG.API_URL ? t('common.connected') : t('common.notConnected')}</span>
          </button>
          <!-- Language Toggle -->
          <div class="segmented-control" role="group" aria-label="${t('login.language')}">
            <button class="segmented-btn ${currentLang === 'en' ? 'active' : ''}" id="btn-lang-en">EN</button>
            <button class="segmented-btn ${currentLang === 'hi' ? 'active' : ''}" id="btn-lang-hi">हिंदी</button>
          </div>
          <!-- Theme Toggle -->
          <button id="btn-theme-toggle" class="btn btn-ghost btn-icon" aria-label="${t('login.theme')}">
            ${currentTheme === 'dark' ? ICONS.sun : ICONS.moon}
          </button>
        </div>
      </header>

      <!-- Main Login Container -->
      <main class="login-main-container">
        <!-- Hero Column -->
        <section class="login-hero-column">
          <h1 class="login-hero-title">${branding.companyName}</h1>
          <p class="login-hero-desc">${branding.tagline}. Designed for 80 to 300+ employees with rock-solid role governance, Google Workspace integration, and transparent compliance.</p>
          
          <div class="login-feature-list">
            <div class="login-feature-card">
              <h4>Geofenced Attendance</h4>
              <p>GPS verification with Haversine distance validation & optional selfie proof.</p>
            </div>
            <div class="login-feature-card">
              <h4>Zero-Leak Permissions</h4>
              <p>Granular RBAC, ceiling delegations, and field-level salary/bank masking.</p>
            </div>
            <div class="login-feature-card">
              <h4>Maker-Checker Payroll</h4>
              <p>Strict segregation of duties, automated payable days & statutory statements.</p>
            </div>
          </div>
        </section>

        <!-- Login Card Column -->
        <section class="login-card-column">
          <div class="login-card">
            ${branding.loginNotice ? `
              <div class="login-notice-banner">
                <div>${ICONS.alertCircle}</div>
                <div>${branding.loginNotice}</div>
              </div>
            ` : ''}

            <h2 style="font-size: 1.375rem; margin-bottom: 0.25rem;">${t('login.title')}</h2>
            <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1.5rem;">${t('login.subtitle')}</p>

            <form id="login-form">
              <div class="form-group">
                <label for="login-emp-id" class="form-label">${t('login.employeeId')}</label>
                <div class="form-input-wrap">
                  <input
                    type="text"
                    id="login-emp-id"
                    name="employeeId"
                    class="form-input"
                    placeholder="${t('login.employeeIdPlaceholder')}"
                    required
                    autocomplete="username"
                  />
                </div>
              </div>

              <div class="form-group">
                <div class="form-label">
                  <label for="login-password">${t('login.password')}</label>
                  <button type="button" id="btn-forgot-pwd" class="btn-ghost" style="padding: 0; font-size: 0.8125rem; color: var(--brand-primary);">
                    ${t('login.forgotPassword')}
                  </button>
                </div>
                <div class="form-input-wrap">
                  <input
                    type="password"
                    id="login-password"
                    name="password"
                    class="form-input form-input-icon-right"
                    placeholder="${t('login.passwordPlaceholder')}"
                    required
                    autocomplete="current-password"
                  />
                  <button type="button" id="btn-toggle-pwd" class="input-icon-right-btn" aria-label="${t('login.showPassword')}">
                    ${ICONS.eye}
                  </button>
                </div>
              </div>

              <div id="login-error-msg" class="form-error" style="display: none; margin-bottom: 1rem;"></div>

              <button type="submit" id="btn-submit-login" class="btn btn-primary" style="width: 100%; margin-top: 0.5rem;">
                <span id="login-btn-text">${t('login.signIn')}</span>
              </button>
            </form>
          </div>
        </section>
      </main>
    </div>
  `;

  // Attach event handlers
  document.getElementById('btn-lang-en').onclick = () => setLanguage('en');
  document.getElementById('btn-lang-hi').onclick = () => setLanguage('hi');
  document.getElementById('btn-theme-toggle').onclick = () => toggleTheme();

  // Backend settings button (for configuring Web App URL)
  document.getElementById('btn-backend-settings').onclick = () => openBackendConfigModal();

  // Password visibility toggle
  const pwdInput = document.getElementById('login-password');
  const togglePwdBtn = document.getElementById('btn-toggle-pwd');
  togglePwdBtn.onclick = () => {
    const isPassword = pwdInput.type === 'password';
    pwdInput.type = isPassword ? 'text' : 'password';
    togglePwdBtn.innerHTML = isPassword ? ICONS.eyeOff : ICONS.eye;
    togglePwdBtn.setAttribute('aria-label', isPassword ? t('login.hidePassword') : t('login.showPassword'));
  };

  // Forgot password
  document.getElementById('btn-forgot-pwd').onclick = () => {
    openModal({
      title: t('login.forgotPassword'),
      contentNode: (() => {
        const div = document.createElement('div');
        div.innerHTML = `
          <p style="margin-bottom: 1.25rem; font-size: 0.9375rem; color: var(--text-secondary); line-height: 1.6;">
            ${t('login.forgotNotice')}
          </p>
          <div style="background-color: var(--bg-surface-muted); padding: 1rem; border-radius: var(--radius-md); font-size: 0.8125rem; color: var(--text-muted);">
            <strong>Security Notice:</strong> End-user passwords cannot be reset via plain email. In accordance with zero-trust HR policy, your authorized HR administrator or Super Admin will issue a one-time temporary password.
          </div>
        `;
        return div;
      })()
    });
  };

  // Login form submission
  const loginForm = document.getElementById('login-form');
  loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const empId = document.getElementById('login-emp-id').value;
    const pwd = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error-msg');
    const submitBtn = document.getElementById('btn-submit-login');
    const btnText = document.getElementById('login-btn-text');

    if (!empId || !pwd) {
      errorEl.textContent = t('login.errorEmptyFields');
      errorEl.style.display = 'flex';
      return;
    }

    if (!CONFIG.API_URL) {
      errorEl.textContent = 'Backend Web App URL is not set. Click "Backend Offline" at the top right to configure your Google Apps Script URL.';
      errorEl.style.display = 'flex';
      return;
    }

    errorEl.style.display = 'none';
    submitBtn.disabled = true;
    btnText.textContent = t('login.signingIn');

    try {
      await login(empId, pwd);
      navigateTo('#/dashboard');
    } catch (err) {
      errorEl.textContent = err.message || t('login.errorAuthFailed');
      errorEl.style.display = 'flex';
    } finally {
      submitBtn.disabled = false;
      btnText.textContent = t('login.signIn');
    }
  };
}

// Modal to configure Apps Script Web App URL
function openBackendConfigModal() {
  const content = document.createElement('div');
  content.innerHTML = `
    <p style="font-size: 0.875rem; color: var(--text-secondary); margin-bottom: 1rem; line-height: 1.5;">
      Enter the deployed <strong>Google Apps Script Web App URL</strong> (from Google Apps Script &gt; Deploy &gt; Web App &gt; Execute as Me, Anyone):
    </p>
    <div class="form-group">
      <input type="url" id="input-api-url" class="form-input" placeholder="https://script.google.com/macros/s/.../exec" value="${CONFIG.API_URL}" />
    </div>
    <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.25rem;">
      <button class="btn btn-secondary" id="btn-cancel-config">${t('common.cancel')}</button>
      <button class="btn btn-primary" id="btn-save-config">${t('common.save')}</button>
    </div>
  `;

  openModal({
    title: t('common.configureBackend'),
    contentNode: content
  });

  document.getElementById('btn-cancel-config').onclick = () => closeModal();
  document.getElementById('btn-save-config').onclick = () => {
    const val = document.getElementById('input-api-url').value;
    CONFIG.API_URL = val;
    closeModal();
    showToast('Backend URL updated successfully.', 'success');
    renderShell();
  };
}

// ============================================================================
// 2. AUTHENTICATED APP SHELL
// ============================================================================
function renderAuthenticatedShell() {
  const state = getState();
  const user = state.user || {};
  const branding = state.branding;
  const currentLang = getLanguage();
  const currentTheme = getTheme();
  const isSimple = state.simpleMode;

  root.innerHTML = `
    <div class="app-shell">
      <!-- Desktop Sidebar -->
      <aside class="app-sidebar" id="app-sidebar">
        <div class="sidebar-header">
          <div class="brand-badge">
            <img src="${branding.logoUrl}" alt="Logo" class="brand-logo-img" />
            <span style="font-size: 1rem;">${branding.companyName}</span>
          </div>
        </div>

        <nav class="sidebar-nav">
          <div class="nav-section-title">Self Service</div>
          <a href="#/dashboard" class="nav-item" data-route="#/dashboard">
            <span class="nav-item-icon">${ICONS.dashboard}</span>
            <span>${t('nav.dashboard')}</span>
          </a>
          <a href="#/attendance" class="nav-item" data-route="#/attendance">
            <span class="nav-item-icon">${ICONS.clock}</span>
            <span>${t('nav.attendance')}</span>
          </a>
          <a href="#/leave" class="nav-item" data-route="#/leave">
            <span class="nav-item-icon">${ICONS.calendar}</span>
            <span>${t('nav.leave')}</span>
          </a>
          <a href="#/payslips" class="nav-item" data-route="#/payslips">
            <span class="nav-item-icon">${ICONS.dollarSign}</span>
            <span>${t('nav.payslips')}</span>
          </a>
          <a href="#/documents" class="nav-item" data-route="#/documents">
            <span class="nav-item-icon">${ICONS.fileText}</span>
            <span>${t('nav.documents')}</span>
          </a>
          <a href="#/tasks" class="nav-item" data-route="#/tasks">
            <span class="nav-item-icon">${ICONS.checkCircle}</span>
            <span>Tasks & Drive</span>
          </a>
          <a href="#/inbox" class="nav-item" data-route="#/inbox">
            <span class="nav-item-icon">${ICONS.inbox}</span>
            <span>${t('nav.inbox')}</span>
          </a>

          <!-- Organization & Admin Navigation (Permission Gated) -->
          ${(hasPermission('employee.view') || user.isSuperAdmin) ? `
            <div class="nav-section-title">Workforce</div>
            <a href="#/employees" class="nav-item" data-route="#/employees">
              <span class="nav-item-icon">${ICONS.users}</span>
              <span>${t('nav.employees')}</span>
            </a>
          ` : ''}

          ${(hasPermission('payroll.prepare') || hasPermission('payroll.view') || user.isSuperAdmin) ? `
            <div class="nav-section-title">Finance</div>
            <a href="#/payroll" class="nav-item" data-route="#/payroll">
              <span class="nav-item-icon">${ICONS.dollarSign}</span>
              <span>${t('nav.payroll')}</span>
            </a>
          ` : ''}

          ${user.isSuperAdmin ? `
            <div class="nav-section-title">Administration</div>
            <a href="#/superadmin" class="nav-item" data-route="#/superadmin">
              <span class="nav-item-icon">${ICONS.shield}</span>
              <span>${t('nav.superAdmin')}</span>
            </a>
            <a href="#/settings" class="nav-item" data-route="#/settings">
              <span class="nav-item-icon">${ICONS.settings}</span>
              <span>${t('nav.settings')}</span>
            </a>
          ` : ''}
        </nav>
      </aside>

      <!-- Main Viewport -->
      <div class="app-main">
        <!-- Topbar -->
        <header class="app-topbar">
          <div class="topbar-left">
            <button id="btn-sidebar-toggle" class="btn-icon" aria-label="Toggle menu" style="display: none;">
              ${ICONS.menu}
            </button>
            <h2 class="page-title" id="page-heading">${t('nav.dashboard')}</h2>
          </div>

            <!-- Google Workspace Connection Indicator -->
            <button id="btn-workspace-auth" class="btn btn-ghost" style="font-size: 0.8125rem;" title="Connect Google Workspace (Sheets, Docs, Calendar, Drive)">
              <span class="status-dot ${getWorkspaceUser() ? 'status-dot-success' : 'status-dot-warning'}"></span>
              <span>${getWorkspaceUser() ? 'Workspace Connected' : 'Connect Workspace'}</span>
            </button>

            <!-- Simple Mode Toggle for field/storekeeper users -->
            <button id="btn-toggle-simple" class="btn btn-ghost" style="font-size: 0.8125rem;">
              <span class="status-dot ${isSimple ? 'status-dot-success' : 'status-dot-info'}"></span>
              <span>${isSimple ? 'Simple Mode: ON' : 'Simple Mode: OFF'}</span>
            </button>

            <!-- Language Toggle -->
            <div class="segmented-control" role="group">
              <button class="segmented-btn ${currentLang === 'en' ? 'active' : ''}" id="shell-lang-en">EN</button>
              <button class="segmented-btn ${currentLang === 'hi' ? 'active' : ''}" id="shell-lang-hi">हिंदी</button>
            </div>

            <!-- Theme Toggle -->
            <button id="shell-theme-toggle" class="btn btn-ghost btn-icon">
              ${currentTheme === 'dark' ? ICONS.sun : ICONS.moon}
            </button>

            <!-- User Profile Avatar Menu -->
            <div style="position: relative;">
              <button id="btn-user-menu" class="user-profile-btn">
                <div class="user-avatar">${(user.name || user.employeeId || 'U').substring(0, 2).toUpperCase()}</div>
                <div style="text-align: left; display: flex; flex-direction: column;">
                  <span style="font-size: 0.8125rem; font-weight: 600; line-height: 1.2;">${user.name || user.employeeId}</span>
                  <span style="font-size: 0.6875rem; color: var(--text-muted);">${user.isSuperAdmin ? 'Super Admin' : (user.designation || 'Staff')}</span>
                </div>
              </button>
            </div>
          </div>
        </header>

        <!-- Viewport Mount -->
        <main class="viewport-content" id="viewport-mount">
          <!-- Dynamic route content injected here -->
        </main>

        <!-- Mobile Bottom Navigation -->
        <nav class="mobile-bottom-nav">
          <a href="#/dashboard" class="mobile-nav-item" data-route="#/dashboard">
            ${ICONS.dashboard}
            <span>${t('nav.dashboard')}</span>
          </a>
          <a href="#/attendance" class="mobile-nav-item" data-route="#/attendance">
            ${ICONS.clock}
            <span>${t('nav.checkin')}</span>
          </a>
          <a href="#/leave" class="mobile-nav-item" data-route="#/leave">
            ${ICONS.calendar}
            <span>${t('nav.leave')}</span>
          </a>
          <a href="#/payslips" class="mobile-nav-item" data-route="#/payslips">
            ${ICONS.dollarSign}
            <span>${t('nav.payslips')}</span>
          </a>
          <button id="btn-mobile-more" class="mobile-nav-item" style="border: none; background: none;">
            ${ICONS.grid}
            <span>${t('nav.more')}</span>
          </button>
        </nav>
      </div>
    </div>
  `;

  // Bind topbar events
  document.getElementById('shell-lang-en').onclick = () => setLanguage('en');
  document.getElementById('shell-lang-hi').onclick = () => setLanguage('hi');
  document.getElementById('shell-theme-toggle').onclick = () => toggleTheme();

  // Simple Mode Toggle
  document.getElementById('btn-toggle-simple').onclick = () => {
    setState({ simpleMode: !isSimple });
    showToast(isSimple ? 'Switched to detailed view' : 'Simple Mode enabled for streamlined actions', 'info');
  };

  // User Menu Profile modal
  document.getElementById('btn-user-menu').onclick = () => openUserMenuModal();

  // Workspace Auth Trigger
  const wsBtn = document.getElementById('btn-workspace-auth');
  if (wsBtn) {
    wsBtn.onclick = async () => {
      const currentWsUser = getWorkspaceUser();
      if (currentWsUser) {
        const confirmed = await confirmDialog('Google Workspace', `Connected as ${currentWsUser.email}. Disconnect?`);
        if (confirmed) {
          await disconnectWorkspace();
          showToast('Disconnected from Google Workspace.', 'info');
          renderShell();
        }
      } else {
        try {
          showToast('Connecting to Google Workspace...', 'info');
          const res = await signInWithGoogle();
          showToast(`Connected to Google Workspace as ${res.user.email}!`, 'success');
          renderShell();
        } catch (err) {
          showToast(err.message || 'Google Sign-In failed', 'error');
        }
      }
    };
  }

  // Mobile drawer trigger
  const moreBtn = document.getElementById('btn-mobile-more');
  if (moreBtn) {
    moreBtn.onclick = () => {
      const sidebar = document.getElementById('app-sidebar');
      sidebar.classList.toggle('mobile-open');
    };
  }

  // Active navigation highlight
  const updateNavActive = () => {
    const current = window.location.hash || '#/dashboard';
    document.querySelectorAll('.nav-item, .mobile-nav-item').forEach(el => {
      const r = el.getAttribute('data-route');
      if (r && current.startsWith(r)) {
        el.classList.add('active');
      } else {
        el.classList.remove('active');
      }
    });
  };

  window.addEventListener('hashchange', updateNavActive);
  updateNavActive();

  // Initialize Hash Router on viewport mount
  const mount = document.getElementById('viewport-mount');
  initRouter(mount);
}

function openUserMenuModal() {
  const state = getState();
  const user = state.user || {};

  const content = document.createElement('div');
  content.innerHTML = `
    <div style="display: flex; align-items: center; gap: 1rem; margin-bottom: 1.5rem; padding-bottom: 1rem; border-bottom: 1px solid var(--border-subtle);">
      <div class="user-avatar" style="width: 48px; height: 48px; font-size: 1.125rem;">
        ${(user.name || user.employeeId || 'U').substring(0, 2).toUpperCase()}
      </div>
      <div>
        <h4 style="margin: 0; font-size: 1rem;">${user.name || user.employeeId}</h4>
        <div class="meta-cluster" style="margin-top: 4px;">
          <span>ID: ${user.employeeId}</span>
          <span class="meta-dot">·</span>
          <span>${user.department || 'Department N/A'}</span>
          ${user.isSuperAdmin ? `<span class="meta-dot">·</span><strong style="color: var(--brand-primary);">${t('common.superAdminBadge')}</strong>` : ''}
        </div>
      </div>
    </div>

    <div style="display: flex; flex-direction: column; gap: 0.5rem;">
      <a href="#/profile" class="btn btn-secondary" style="justify-content: flex-start;" id="btn-modal-profile">
        ${ICONS.users} View Full Profile
      </a>
      <a href="#/change-password" class="btn btn-secondary" style="justify-content: flex-start;" id="btn-modal-change-pwd">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 2l-2 2m-1.5 1.5L16 7l-4 4-2-2-4 4 2 2-4 4 3 3 4-4-2-2 4-4 1.5-1.5L21 2z"></path></svg>
        Change Password
      </a>
      <button class="btn btn-ghost" style="justify-content: flex-start; color: var(--status-danger);" id="btn-modal-logout">
        ${ICONS.logout} ${t('common.logout')}
      </button>
      <button class="btn btn-ghost" style="justify-content: flex-start; color: var(--text-muted); font-size: 0.8125rem;" id="btn-modal-logout-all">
        ${t('common.logoutAll')}
      </button>
    </div>
  `;

  openModal({
    title: 'Account & Security',
    contentNode: content
  });

  document.getElementById('btn-modal-profile').onclick = () => closeModal();
  document.getElementById('btn-modal-change-pwd').onclick = () => closeModal();

  document.getElementById('btn-modal-logout').onclick = async () => {
    closeModal();
    const confirmed = await confirmDialog('Log Out', 'Are you sure you want to log out of your session?');
    if (confirmed) {
      await logout();
      showToast('Logged out successfully.', 'info');
    }
  };

  document.getElementById('btn-modal-logout-all').onclick = async () => {
    closeModal();
    const confirmed = await confirmDialog('Log Out All Devices', 'This will invalidate your sessions on all mobile and desktop devices. Proceed?', 'Log Out All', true);
    if (confirmed) {
      await logoutAll();
      showToast('Logged out of all devices.', 'info');
    }
  };
}

// ============================================================================
// 3. CORE ROUTE REGISTRATIONS
// ============================================================================
function setupRoutes() {
  // Forced Password Change Route
  registerRoute('#/change-password', {
    title: t('login.firstLoginTitle'),
    requiresAuth: true,
    render: (container) => {
      container.innerHTML = `
        <div style="max-width: 480px; margin: 2rem auto;">
          <div class="astra-card">
            <h2 class="astra-card-title">${t('login.firstLoginTitle')}</h2>
            <p class="astra-card-subtitle" style="margin-bottom: 1.5rem;">${t('login.firstLoginDesc')}</p>

            <form id="change-pwd-form">
              <div class="form-group">
                <label for="curr-pwd" class="form-label">Current / Temporary Password</label>
                <input type="password" id="curr-pwd" class="form-input" required autocomplete="current-password" />
              </div>

              <div class="form-group">
                <label for="new-pwd" class="form-label">${t('login.newPassword')}</label>
                <input type="password" id="new-pwd" class="form-input" required minlength="8" autocomplete="new-password" />
                <span class="form-hint">Minimum 8 characters with at least one number or special character.</span>
              </div>

              <div class="form-group">
                <label for="conf-pwd" class="form-label">${t('login.confirmPassword')}</label>
                <input type="password" id="conf-pwd" class="form-input" required minlength="8" autocomplete="new-password" />
              </div>

              <div id="change-pwd-error" class="form-error" style="display: none; margin-bottom: 1rem;"></div>

              <button type="submit" id="btn-save-new-pwd" class="btn btn-primary" style="width: 100%;">
                ${t('login.savePassword')}
              </button>
            </form>
          </div>
        </div>
      `;

      document.getElementById('change-pwd-form').onsubmit = async (e) => {
        e.preventDefault();
        const curr = document.getElementById('curr-pwd').value;
        const next = document.getElementById('new-pwd').value;
        const conf = document.getElementById('conf-pwd').value;
        const errEl = document.getElementById('change-pwd-error');

        if (next !== conf) {
          errEl.textContent = t('login.passwordMismatch');
          errEl.style.display = 'flex';
          return;
        }

        if (next.length < 8) {
          errEl.textContent = t('login.passwordLengthError');
          errEl.style.display = 'flex';
          return;
        }

        try {
          await changePassword(curr, next);
          showToast('Password changed successfully.', 'success');
          navigateTo('#/dashboard');
        } catch (err) {
          errEl.textContent = err.message || 'Failed to update password.';
          errEl.style.display = 'flex';
        }
      };
    }
  });

  // Dashboard Route (Simple Mode or Detailed View)
  registerRoute('#/dashboard', {
    title: t('nav.dashboard'),
    requiresAuth: true,
    render: async (container) => {
      const state = getState();
      const user = state.user || {};

      // If user is in Simple Mode (Office boy / storekeeper basic phone user)
      if (state.simpleMode) {
        container.innerHTML = `
          <div style="max-width: 600px; margin: 0 auto;">
            <div style="margin-bottom: 1rem; text-align: center;">
              <h2>${t('simpleMode.title')}</h2>
              <p style="font-size: 0.875rem;">${t('dashboard.welcome')}, ${user.name || user.employeeId}</p>
            </div>
            <div class="simple-mode-grid">
              <a href="#/attendance" class="simple-mode-card">
                <div class="simple-mode-card-icon">${ICONS.clock}</div>
                <div class="simple-mode-card-label">${t('simpleMode.checkin')}</div>
              </a>
              <a href="#/leave" class="simple-mode-card">
                <div class="simple-mode-card-icon">${ICONS.calendar}</div>
                <div class="simple-mode-card-label">${t('simpleMode.leave')}</div>
              </a>
              <a href="#/payslips" class="simple-mode-card">
                <div class="simple-mode-card-icon">${ICONS.dollarSign}</div>
                <div class="simple-mode-card-label">${t('simpleMode.payslips')}</div>
              </a>
              <a href="#/profile" class="simple-mode-card">
                <div class="simple-mode-card-icon">${ICONS.users}</div>
                <div class="simple-mode-card-label">${t('simpleMode.profile')}</div>
              </a>
            </div>
          </div>
        `;
        return;
      }

      // Detailed Astra Dashboard View
      container.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          <!-- Welcome Bar -->
          <div class="astra-card astra-card-glass" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
            <div>
              <h2 style="font-size: 1.25rem; font-weight: 700;">${t('dashboard.welcome')}, ${user.name || user.employeeId}!</h2>
              <div class="meta-cluster" style="margin-top: 4px;">
                <span>ID: ${user.employeeId}</span>
                <span class="meta-dot">·</span>
                <span>${user.designation || 'Staff'}</span>
                <span class="meta-dot">·</span>
                <span>${user.department || 'General'}</span>
              </div>
            </div>
            <div style="display: flex; gap: 0.75rem;">
              <a href="#/attendance" class="btn btn-primary">${ICONS.clock} Check-in / Out</a>
              <a href="#/leave" class="btn btn-secondary">${ICONS.calendar} Apply Leave</a>
            </div>
          </div>

          <!-- Real KPI Cards Grid -->
          <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 1rem;" class="stagger-container">
            <div class="astra-card stagger-item">
              <div class="astra-card-header">
                <span class="astra-card-subtitle">${t('dashboard.todayStatus')}</span>
                <span class="status-dot status-dot-warning"></span>
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-main);" id="kpi-today-status">
                Pending Check-in
              </div>
              <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--text-muted);">
                Office Geofenced Policy
              </div>
            </div>

            <div class="astra-card stagger-item">
              <div class="astra-card-header">
                <span class="astra-card-subtitle">${t('dashboard.monthlyAttendance')}</span>
                <span class="nav-item-icon" style="color: var(--brand-primary);">${ICONS.clock}</span>
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-main);" id="kpi-present-days">
                -- / -- Days
              </div>
              <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--text-muted);">
                Current Pay Cycle
              </div>
            </div>

            <div class="astra-card stagger-item">
              <div class="astra-card-header">
                <span class="astra-card-subtitle">${t('dashboard.leaveBalance')}</span>
                <span class="nav-item-icon" style="color: var(--status-success);">${ICONS.calendar}</span>
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-main);" id="kpi-leave-balance">
                -- Days
              </div>
              <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--text-muted);">
                Available Paid Leaves
              </div>
            </div>

            <div class="astra-card stagger-item">
              <div class="astra-card-header">
                <span class="astra-card-subtitle">${t('dashboard.pendingApprovals')}</span>
                <span class="nav-item-icon" style="color: var(--status-info);">${ICONS.inbox}</span>
              </div>
              <div style="font-size: 1.5rem; font-weight: 700; color: var(--text-main);" id="kpi-pending-approvals">
                0 Items
              </div>
              <div style="margin-top: 0.5rem; font-size: 0.8125rem; color: var(--text-muted);">
                Awaiting your action
              </div>
            </div>
          </div>

          <!-- Section: Recent Notifications & Quick Links -->
          <div style="display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem;">
            <div class="astra-card">
              <div class="astra-card-header">
                <h3 class="astra-card-title">${ICONS.inbox} Approvals & Requests</h3>
                <a href="#/inbox" class="btn btn-ghost" style="font-size: 0.8125rem;">View Inbox &rarr;</a>
              </div>
              <div class="empty-state" style="padding: 2rem 1rem;">
                <div class="empty-state-icon">${ICONS.checkCircle}</div>
                <div class="empty-state-title">${t('dashboard.noPending')}</div>
                <div class="empty-state-desc">You are all caught up on pending team leave, regularization, and expense approvals.</div>
              </div>
            </div>

            <div class="astra-card">
              <div class="astra-card-header">
                <h3 class="astra-card-title">${ICONS.fileText} Quick Downloads</h3>
              </div>
              <div style="display: flex; flex-direction: column; gap: 0.75rem;">
                <a href="#/payslips" class="btn btn-secondary" style="justify-content: flex-start;">
                  ${ICONS.dollarSign} Latest Payslip PDF
                </a>
                <a href="#/documents" class="btn btn-secondary" style="justify-content: flex-start;">
                  ${ICONS.fileText} Employment Letter
                </a>
                <a href="#/attendance" class="btn btn-secondary" style="justify-content: flex-start;">
                  ${ICONS.clock} Attendance Monthly Log
                </a>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  });

  // Profile Route
  registerRoute('#/profile', {
    title: 'My Profile',
    requiresAuth: true,
    render: (container) => {
      const state = getState();
      const user = state.user || {};
      container.innerHTML = `
        <div style="max-width: 800px; margin: 0 auto; display: flex; flex-direction: column; gap: 1.5rem;">
          <div class="astra-card">
            <div style="display: flex; align-items: center; gap: 1.25rem; margin-bottom: 1.5rem;">
              <div class="user-avatar" style="width: 64px; height: 64px; font-size: 1.5rem;">
                ${(user.name || user.employeeId || 'U').substring(0, 2).toUpperCase()}
              </div>
              <div>
                <h2 style="margin: 0; font-size: 1.35rem;">${user.name || user.employeeId}</h2>
                <div class="meta-cluster" style="margin-top: 4px;">
                  <span>ID: ${user.employeeId}</span>
                  <span class="meta-dot">·</span>
                  <span>${user.designation || 'Staff'}</span>
                  <span class="meta-dot">·</span>
                  <span>${user.department || 'General'}</span>
                </div>
              </div>
            </div>

            <h3 style="font-size: 1rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">Employment Details</h3>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem; margin-bottom: 1.5rem;">
              <div>
                <span class="form-hint">Reporting Line / Manager</span>
                <p style="font-weight: 500;">${user.reportingManagerId || 'None (Direct to Management)'}</p>
              </div>
              <div>
                <span class="form-hint">Work Policy</span>
                <p style="font-weight: 500;">Office Geofenced Policy</p>
              </div>
              <div>
                <span class="form-hint">Branch / Location</span>
                <p style="font-weight: 500;">${user.branch || 'Head Office'}</p>
              </div>
              <div>
                <span class="form-hint">Role(s)</span>
                <p style="font-weight: 500;">${user.isSuperAdmin ? 'Super Admin' : (user.roles?.join(', ') || 'Employee')}</p>
              </div>
            </div>

            <h3 style="font-size: 1rem; margin-bottom: 0.75rem; border-bottom: 1px solid var(--border-subtle); padding-bottom: 0.5rem;">Sensitive Financial Data</h3>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem;">
              Masked per zero-trust privacy policy. Viewing unmasked values requires the <code>field.salary.view</code> and <code>field.bank.view</code> permissions.
            </p>
            <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 1rem;">
              <div>
                <span class="form-hint">Bank Account</span>
                <p style="font-family: var(--font-mono); font-weight: 600;">•••••••• 8821</p>
              </div>
              <div>
                <span class="form-hint">PF UAN</span>
                <p style="font-family: var(--font-mono); font-weight: 600;">•••••••• 4920</p>
              </div>
              <div>
                <span class="form-hint">PAN Number</span>
                <p style="font-family: var(--font-mono); font-weight: 600;">••••• 491F</p>
              </div>
            </div>
          </div>
        </div>
      `;
    }
  });
  // Core Functional Page Routes
  registerRoute('#/attendance', {
    title: t('nav.attendance'),
    requiresAuth: true,
    render: renderAttendancePage
  });

  registerRoute('#/leave', {
    title: t('nav.leave'),
    requiresAuth: true,
    render: renderLeavePage
  });

  registerRoute('#/inbox', {
    title: t('nav.inbox'),
    requiresAuth: true,
    render: renderInboxPage
  });

  registerRoute('#/employees', {
    title: t('nav.employees'),
    requiresAuth: true,
    permission: 'employee.view',
    render: renderEmployeesPage
  });

  registerRoute('#/payroll', {
    title: t('nav.payroll'),
    requiresAuth: true,
    permission: 'payroll.prepare',
    render: renderPayrollPage
  });

  registerRoute('#/payslips', {
    title: t('nav.payslips'),
    requiresAuth: true,
    render: renderPayrollPage
  });

  registerRoute('#/documents', {
    title: t('nav.documents'),
    requiresAuth: true,
    render: renderDocumentsPage
  });

  registerRoute('#/tasks', {
    title: 'Tasks & Drive',
    requiresAuth: true,
    render: renderTasksPage
  });

  registerRoute('#/superadmin', {
    title: t('nav.superAdmin'),
    requiresAuth: true,
    render: renderSuperAdminPage
  });

  registerRoute('#/settings', {
    title: t('nav.settings'),
    requiresAuth: true,
    render: renderSuperAdminPage
  });

  registerRoute('#/reports', {
    title: t('nav.reports'),
    requiresAuth: true,
    render: renderReportsPage
  });

  registerRoute('#/rdash', {
    title: t('nav.rdash'),
    requiresAuth: true,
    render: renderRdashPage
  });
}

// Start application
window.addEventListener('DOMContentLoaded', bootstrap);
