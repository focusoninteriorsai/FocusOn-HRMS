// FOCUSON HRMS - Reactive State Store

const state = {
  user: null,
  token: null,
  mustChangePassword: false,
  effectivePermissions: new Set(),
  branding: {
    companyName: 'FOCUSON HRMS',
    tagline: 'Enterprise HR & Payroll Management',
    logoUrl: './assets/icons/icon-192.svg',
    loginNotice: '',
    themeTokens: null
  },
  simpleMode: localStorage.getItem('FOCUSON_SIMPLE_MODE') === 'true',
  activeRoute: '#/login'
};

const subscribers = new Set();

export function getState() {
  return state;
}

export function setState(patch) {
  Object.assign(state, patch);
  if (patch.simpleMode !== undefined) {
    localStorage.setItem('FOCUSON_SIMPLE_MODE', String(patch.simpleMode));
  }
  subscribers.forEach(fn => fn(state));
}

export function subscribe(fn) {
  subscribers.add(fn);
  return () => subscribers.delete(fn);
}

export function hasPermission(permissionKey) {
  if (!state.user) return false;
  if (state.user.isSuperAdmin) return true;
  return state.effectivePermissions.has(permissionKey);
}
