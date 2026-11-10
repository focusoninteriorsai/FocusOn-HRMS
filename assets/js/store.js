const listeners = new Set();

const state = {
  ready: false,
  user: null,
  mustChangePassword: false,
  permissions: new Set(),
  scopes: {},
  session: null,
  branding: {
    companyName: 'FOCUSON HRMS',
    tagline: '',
    logoUrl: '',
    loginNotice: '',
    featureHighlights: [],
    defaultLanguage: 'en',
    defaultTheme: 'light',
    themeTokens: {},
    background: { type: 'gradient', preset: 'astra', overlayOpacity: 0, blur: 0 }
  }
};

export function getState() {
  return state;
}

export function setState(patch) {
  Object.keys(patch).forEach((key) => {
    state[key] = patch[key];
  });
  listeners.forEach((listener) => listener(state));
}

export function mergeBranding(branding) {
  state.branding = { ...state.branding, ...branding };
  listeners.forEach((listener) => listener(state));
}

export function clearSessionState() {
  state.user = null;
  state.mustChangePassword = false;
  state.permissions = new Set();
  state.scopes = {};
  state.session = null;
  listeners.forEach((listener) => listener(state));
}

export function hasPermission(permission) {
  if (!permission) return true;
  return Boolean(state.user && (state.user.isSuperAdmin || state.permissions.has(permission)));
}

export function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
