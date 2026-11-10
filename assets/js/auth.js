import { apiRequest, getSessionToken, storeSessionToken, clearSessionToken } from './api.js';
import { clearSessionState, getState, setState } from './store.js';

let idleTimer = null;
let lastActivityReset = 0;

function applySession(data) {
  setState({
    user: data.user,
    mustChangePassword: Boolean(data.mustChangePassword),
    permissions: new Set(data.effectivePermissions || []),
    scopes: data.scopes || {},
    session: data.session || null
  });
}

function clearIdleTimer() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = null;
}

export function resetIdleTimer() {
  clearIdleTimer();
  if (!getSessionToken() || !getState().user) return;
  const seconds = Number(getState().session?.idleTimeoutSeconds) || 1800;
  idleTimer = setTimeout(() => endLocalSession('idle'), Math.max(60, seconds) * 1000);
}

function onActivity() {
  const now = Date.now();
  if (now - lastActivityReset > 15000) {
    lastActivityReset = now;
    resetIdleTimer();
  }
}

['pointerdown', 'keydown', 'touchstart'].forEach((eventName) => {
  window.addEventListener(eventName, onActivity, { passive: true });
});

export async function signIn(employeeId, password) {
  const data = await apiRequest('auth.login', { employeeId: employeeId.trim().toUpperCase(), password }, { skipAuth: true });
  storeSessionToken(data.token);
  applySession(data);
  resetIdleTimer();
  return data;
}

export async function restoreSession() {
  if (!getSessionToken()) {
    clearSessionState();
    return null;
  }
  try {
    const data = await apiRequest('auth.session', {}, { isRead: true });
    applySession(data);
    resetIdleTimer();
    return data;
  } catch (error) {
    clearSessionToken();
    clearSessionState();
    return null;
  }
}

export async function changePassword(currentPassword, newPassword) {
  const data = await apiRequest('auth.changePassword', { currentPassword, newPassword });
  setState({ mustChangePassword: false });
  resetIdleTimer();
  return data;
}

export async function savePreferences(patch) {
  const data = await apiRequest('auth.updatePreferences', patch);
  if (data.session) setState({ session: data.session });
  return data;
}

async function revokeRemote(allDevices) {
  if (!getSessionToken()) return;
  try {
    await apiRequest(allDevices ? 'auth.logoutAll' : 'auth.logout', {});
  } catch (error) {
    // Local credentials are always removed, including when the network is unavailable.
  }
}

function endLocalSession(reason) {
  clearIdleTimer();
  clearSessionToken();
  clearSessionState();
  window.dispatchEvent(new CustomEvent('focuson:session-ended', { detail: { reason } }));
}

export async function signOut({ allDevices = false } = {}) {
  await revokeRemote(allDevices);
  endLocalSession(allDevices ? 'logoutAll' : 'logout');
}

window.addEventListener('focuson:session-ended', clearIdleTimer);
