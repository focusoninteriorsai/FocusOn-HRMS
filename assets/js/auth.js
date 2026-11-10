// FOCUSON HRMS - Authentication & Session Management
// Token strictly kept in sessionStorage; auto idle logout; forced password change.

import { apiRequest } from './api.js';
import { CONFIG } from './config.js';
import { setState, getState } from './store.js';

let idleTimer = null;

function resetIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  const token = sessionStorage.getItem('FOCUSON_SESSION_TOKEN');
  if (!token) return;

  idleTimer = setTimeout(() => {
    logout(true); // Idle timeout logout
  }, CONFIG.SESSION_IDLE_TIMEOUT_MS);
}

// Activity listeners to reset idle timer
['mousedown', 'keydown', 'touchstart', 'scroll'].forEach(evt => {
  window.addEventListener(evt, resetIdleTimer, { passive: true });
});

export async function login(employeeId, password) {
  if (!employeeId || !password) {
    throw { code: 'VALIDATION', message: 'Employee ID and password are required' };
  }

  const cleanEmpId = employeeId.trim().toUpperCase();
  const res = await apiRequest('auth.login', {
    employeeId: cleanEmpId,
    password: password
  }, { skipAuth: true });

  // Store token in sessionStorage
  sessionStorage.setItem('FOCUSON_SESSION_TOKEN', res.token);

  const permissionsSet = new Set(res.effectivePermissions || []);

  setState({
    token: res.token,
    user: res.user,
    mustChangePassword: !!res.mustChangePassword,
    effectivePermissions: permissionsSet
  });

  resetIdleTimer();
  return res;
}

export async function validateExistingSession() {
  const token = sessionStorage.getItem('FOCUSON_SESSION_TOKEN');
  if (!token) {
    setState({ user: null, token: null, effectivePermissions: new Set() });
    return null;
  }

  try {
    const res = await apiRequest('auth.validateSession', {}, { isRead: true });
    const permissionsSet = new Set(res.effectivePermissions || []);

    setState({
      token,
      user: res.user,
      mustChangePassword: !!res.mustChangePassword,
      effectivePermissions: permissionsSet
    });

    resetIdleTimer();
    return res;
  } catch (err) {
    sessionStorage.removeItem('FOCUSON_SESSION_TOKEN');
    setState({ user: null, token: null, effectivePermissions: new Set() });
    return null;
  }
}

export async function changePassword(currentPassword, newPassword) {
  const res = await apiRequest('auth.changePassword', {
    currentPassword,
    newPassword
  });

  setState({ mustChangePassword: false });
  return res;
}

export async function logout(isIdle = false) {
  if (idleTimer) clearTimeout(idleTimer);

  try {
    const token = sessionStorage.getItem('FOCUSON_SESSION_TOKEN');
    if (token) {
      await apiRequest('auth.logout', {});
    }
  } catch (e) {
    // Silently continue client-side cleanup
  } finally {
    sessionStorage.removeItem('FOCUSON_SESSION_TOKEN');
    setState({
      user: null,
      token: null,
      mustChangePassword: false,
      effectivePermissions: new Set()
    });
    window.location.hash = '#/login';
    if (isIdle) {
      window.dispatchEvent(new CustomEvent('focuson:idle_logout'));
    }
  }
}

export async function logoutAll() {
  if (idleTimer) clearTimeout(idleTimer);

  try {
    await apiRequest('auth.logoutAll', {});
  } finally {
    sessionStorage.removeItem('FOCUSON_SESSION_TOKEN');
    setState({
      user: null,
      token: null,
      mustChangePassword: false,
      effectivePermissions: new Set()
    });
    window.location.hash = '#/login';
  }
}
