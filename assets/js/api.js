import { CONFIG, getApiUrl } from './config.js';

const inFlightReads = new Map();
const TOKEN_KEY = 'focuson.session.token';

export function getSessionToken() {
  return sessionStorage.getItem(TOKEN_KEY) || '';
}

export function storeSessionToken(token) {
  sessionStorage.setItem(TOKEN_KEY, token);
}

export function clearSessionToken() {
  sessionStorage.removeItem(TOKEN_KEY);
}

export function createRequestId() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function makeError(code, message, details) {
  return { code, message, details };
}

async function parseResponse(response) {
  const text = await response.text();
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch (error) {
    throw makeError('SERVER', 'invalidJsonResponse');
  }
  if (!envelope || typeof envelope.ok !== 'boolean') {
    throw makeError('SERVER', 'invalidApiResponse');
  }
  return envelope;
}

export function apiRequest(action, payload = {}, options = {}) {
  const {
    skipAuth = false,
    isRead = false,
    reqId = createRequestId()
  } = options;
  const token = skipAuth ? '' : getSessionToken();
  const flightKey = isRead ? `${token}:${action}:${JSON.stringify(payload)}` : '';
  if (flightKey && inFlightReads.has(flightKey)) return inFlightReads.get(flightKey);

  const promise = execute({ action, payload, token, reqId, skipAuth, isRead, retry: 0 })
    .finally(() => {
      if (flightKey) inFlightReads.delete(flightKey);
    });
  if (flightKey) inFlightReads.set(flightKey, promise);
  return promise;
}

async function execute({ action, payload, token, reqId, skipAuth, isRead, retry }) {
  let apiUrl;
  try {
    apiUrl = getApiUrl();
  } catch (error) {
    throw makeError('CONFIGURATION', 'invalidApiUrl');
  }
  if (!apiUrl) throw makeError('CONFIGURATION', 'missingApiUrl');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CONFIG.REQUEST_TIMEOUT_MS);
  const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? { ...payload } : {};
  safePayload.__client = { userAgent: navigator.userAgent.slice(0, 512) };

  try {
    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, token: token || null, payload: safePayload, reqId }),
      signal: controller.signal,
      credentials: 'omit',
      redirect: 'follow',
      referrerPolicy: 'no-referrer'
    });
    if (!response.ok) throw makeError('NETWORK', `http${response.status}`);
    const envelope = await parseResponse(response);
    if (envelope.reqId !== reqId) throw makeError('SERVER', 'requestIdMismatch');
    if (!envelope.ok) {
      const error = envelope.error || makeError('SERVER', 'unknownServerError');
      if (!skipAuth && token && ['AUTH_REQUIRED', 'SESSION_EXPIRED'].includes(error.code)) {
        clearSessionToken();
        window.dispatchEvent(new CustomEvent('focuson:session-ended', { detail: { reason: 'expired' } }));
      }
      throw error;
    }
    return envelope.data;
  } catch (error) {
    const retryable = error.name === 'AbortError' || error instanceof TypeError || error.code === 'NETWORK';
    if (isRead && retryable && retry < CONFIG.MAX_READ_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 400 * (2 ** retry)));
      return execute({ action, payload, token, reqId, skipAuth, isRead, retry: retry + 1 });
    }
    if (error.name === 'AbortError') throw makeError('NETWORK', 'requestTimeout');
    if (error instanceof TypeError) throw makeError('NETWORK', 'networkUnavailable');
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
