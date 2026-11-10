// FOCUSON HRMS - Single API Client
// Adheres strictly to Apps Script text/plain POST JSON contract to avoid CORS preflight issues.

import { CONFIG } from './config.js';
import { getState } from './store.js';

const inFlightRequests = new Map();

function generateReqId() {
  return 'req_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 8);
}

export async function apiRequest(action, payload = {}, options = {}) {
  const apiUrl = CONFIG.API_URL;
  if (!apiUrl) {
    throw {
      code: 'SERVER',
      message: 'Backend Web App URL is not configured. Please set the Apps Script URL.'
    };
  }

  const {
    isRead = false,
    retryCount = 0,
    skipAuth = false,
    reqId = generateReqId()
  } = options;

  // Deduplication for identical in-flight read requests
  const flightKey = isRead ? `${action}:${JSON.stringify(payload)}` : null;
  if (flightKey && inFlightRequests.has(flightKey)) {
    return inFlightRequests.get(flightKey);
  }

  const token = skipAuth ? null : (sessionStorage.getItem('FOCUSON_SESSION_TOKEN') || null);

  const requestBody = JSON.stringify({
    action,
    token,
    payload,
    reqId
  });

  const execute = async () => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: requestBody,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        throw {
          code: 'SERVER',
          message: `HTTP Error ${response.status}: ${response.statusText}`
        };
      }

      const text = await response.text();
      let result;
      try {
        result = JSON.parse(text);
      } catch (parseErr) {
        throw {
          code: 'SERVER',
          message: 'Invalid JSON response from Google Apps Script. Check deployment logs.'
        };
      }

      if (!result.ok) {
        const error = result.error || { code: 'SERVER', message: 'An unknown server error occurred' };
        
        // Handle global session expiry
        if (error.code === 'SESSION_EXPIRED' || error.code === 'AUTH_REQUIRED') {
          sessionStorage.removeItem('FOCUSON_SESSION_TOKEN');
          window.dispatchEvent(new CustomEvent('focuson:auth_expired', { detail: error }));
        }

        throw error;
      }

      return result.data;
    } catch (err) {
      clearTimeout(timeoutId);

      // Retry safe reads with exponential backoff
      if (isRead && retryCount < CONFIG.MAX_RETRIES && (err.name === 'AbortError' || err.code === 'SERVER')) {
        const backoffMs = Math.pow(2, retryCount) * 800;
        await new Promise(r => setTimeout(r, backoffMs));
        return apiRequest(action, payload, { ...options, retryCount: retryCount + 1, reqId });
      }

      if (err.name === 'AbortError') {
        throw {
          code: 'SERVER',
          message: 'Request timed out waiting for Google Apps Script execution.'
        };
      }

      throw err;
    } finally {
      if (flightKey) {
        inFlightRequests.delete(flightKey);
      }
    }
  };

  const promise = execute();
  if (flightKey) {
    inFlightRequests.set(flightKey, promise);
  }
  return promise;
}
