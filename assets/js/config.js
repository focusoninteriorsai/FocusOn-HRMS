// The Apps Script Web App /exec URL is public configuration, never a secret.
// Leave empty until deployment; no runtime URL override is accepted.
export const CONFIG = Object.freeze({
  API_URL: '',
  APP_VERSION: '1.0.0-phase1',
  REQUEST_TIMEOUT_MS: 30000,
  MAX_READ_RETRIES: 2,
  DEFAULT_LANGUAGE: 'en',
  DEFAULT_THEME: 'light'
});

export function getApiUrl() {
  if (!CONFIG.API_URL) return '';
  let url;
  try {
    url = new URL(CONFIG.API_URL);
  } catch (error) {
    throw new Error('invalidApiUrl');
  }
  const validPath = /^\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url.pathname);
  if (url.protocol !== 'https:' || url.hostname !== 'script.google.com' || !validPath || url.search || url.hash) {
    throw new Error('invalidApiUrl');
  }
  return url.toString();
}
