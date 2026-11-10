// The Apps Script Web App /exec URL is public configuration, never a secret.
// Leave empty until deployment; no runtime URL override is accepted.
export const CONFIG = Object.freeze({
  API_URL: 'https://script.googleusercontent.com/macros/echo?user_content_key=AUkAhnRTuwsUfzvOHDvbb9CFt8CI8AiytLC5O5LlSce6Am8f7EABdvxVaJxC0IfLXbRGmMy_aUtX3NRI8wJq0gpgydj0N8qGNpxLfjIB3sqzj2VRxAExN_ZrZituegEFpIakx3RUch0sX-JCrY-3gkg7td1_0HHEPOliWqQ39v4RVwZK1teVXa85BkZN0YqaYb8lfMZDDroUKyxF3rr-ivv1bFS0_AsVaYDMh_bLBpNd1Dik0sg46deUwxNZrsd-iSkIhhrZcGgWNMGP9qX0jmm6Wdx7qFzkdg&lib=MMXYObIOyjoCeuPlJtZSklsIDDx8yuSIQ',
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
