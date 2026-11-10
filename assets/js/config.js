// The Apps Script Web App /exec URL is public configuration, never a secret.
// Expected shape: https://script.google.com/macros/s/<deployment id>/exec
//
// Do NOT paste a script.googleusercontent.com/macros/echo?... URL here.
// Google shows that as a one-use redirect after a request: it carries no
// deployment id, it expires, and this validator rejects it, so the sign-in
// screen would show "API is not configured" (CONFIGURATION / invalidApiUrl).
// Run hrmsBootstrapEverything() in Apps Script and it prints the correct block.
export const CONFIG = Object.freeze({
  API_URL: '',
  APP_VERSION: '1.0.0-phase1',
  REQUEST_TIMEOUT_MS: 30000,
  MAX_READ_RETRIES: 2,
  DEFAULT_LANGUAGE: 'en',
  DEFAULT_THEME: 'light'
});

function deploymentUrl(value) {
  let url;
  try {
    url = new URL(String(value || '').trim());
  } catch (error) {
    throw new Error('invalidApiUrl');
  }
  const validPath = /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !validPath || url.search || url.hash) {
    throw new Error('invalidApiUrl');
  }
  return url.toString();
}

export function getApiUrl() {
  if (!CONFIG.API_URL) return '';
  return deploymentUrl(CONFIG.API_URL);
}
