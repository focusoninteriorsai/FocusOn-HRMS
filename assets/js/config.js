// FOCUSON HRMS - Client Configuration
// ONLY non-secret variables live here. Secrets live in Apps Script Script Properties.

export const CONFIG = {
  // Default Apps Script Web App URL.
  // Can be configured at build/deploy time or overridden in browser via localStorage for testing.
  DEFAULT_API_URL: '',

  get API_URL() {
    return localStorage.getItem('FOCUSON_API_URL') || this.DEFAULT_API_URL || '';
  },

  set API_URL(url) {
    if (url) {
      localStorage.setItem('FOCUSON_API_URL', url.trim());
    } else {
      localStorage.removeItem('FOCUSON_API_URL');
    }
  },

  APP_VERSION: '1.0.0-phase1',
  DEFAULT_LANGUAGE: 'en',
  DEFAULT_THEME: 'light',
  SESSION_IDLE_TIMEOUT_MS: 30 * 60 * 1000, // 30 minutes idle timeout
  REQUEST_TIMEOUT_MS: 30000, // 30 seconds
  MAX_RETRIES: 2
};
