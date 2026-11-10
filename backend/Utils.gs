/**
 * Shared backend primitives. No secret value is defined in this file.
 */
var Utils = (function () {
  var DEFAULT_HASH_ITERATIONS = 10000;
  var MIN_HASH_ITERATIONS = 10000;
  var MAX_HASH_ITERATIONS = 50000;
  var FORBIDDEN_KEYS = { '__proto__': true, 'prototype': true, 'constructor': true };

  function fail(code, message, details) {
    var error = new Error(message);
    error.code = code || 'SERVER';
    error.expose = true;
    if (details !== undefined) error.details = details;
    throw error;
  }

  function okResponse(data, reqId) {
    return { ok: true, data: data === undefined ? null : data, reqId: reqId || null };
  }

  function errorResponse(code, message, reqId, details) {
    var envelope = {
      ok: false,
      error: { code: code || 'SERVER', message: message || 'The request could not be completed.' },
      reqId: reqId || null
    };
    if (details !== undefined) envelope.error.details = details;
    return envelope;
  }

  function nowIso() {
    return new Date().toISOString();
  }

  function toIso(value) {
    if (!value) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      return isNaN(value.getTime()) ? '' : value.toISOString();
    }
    var date = new Date(value);
    return isNaN(date.getTime()) ? String(value) : date.toISOString();
  }

  function dateValue(value) {
    if (!value) return null;
    var date = Object.prototype.toString.call(value) === '[object Date]' ? value : new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function addSeconds(date, seconds) {
    return new Date(date.getTime() + seconds * 1000).toISOString();
  }

  function asBoolean(value) {
    return value === true || String(value).toUpperCase() === 'TRUE' || value === 1 || value === '1';
  }

  function asNumber(value, fallback) {
    if (value === '' || value === null || value === undefined) return fallback;
    var number = Number(value);
    return isFinite(number) ? number : fallback;
  }

  function assertObject(value, name, maximumDepth) {
    var maxDepth = maximumDepth || 8;
    if (!value || Object.prototype.toString.call(value) !== '[object Object]') {
      fail('VALIDATION', (name || 'Payload') + ' must be a JSON object.');
    }
    inspectJson(value, name || 'payload', 0, maxDepth);
    return value;
  }

  function inspectJson(value, path, depth, maximumDepth) {
    if (depth > maximumDepth) fail('VALIDATION', 'JSON nesting is too deep at ' + path + '.');
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
    if (typeof value === 'number') {
      if (!isFinite(value)) fail('VALIDATION', 'A numeric value is invalid at ' + path + '.');
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 1000) fail('VALIDATION', 'Too many array entries at ' + path + '.');
      for (var i = 0; i < value.length; i++) inspectJson(value[i], path + '[' + i + ']', depth + 1, maximumDepth);
      return;
    }
    if (Object.prototype.toString.call(value) !== '[object Object]') {
      fail('VALIDATION', 'Unsupported JSON value at ' + path + '.');
    }
    var keys = Object.keys(value);
    if (keys.length > 250) fail('VALIDATION', 'Too many properties at ' + path + '.');
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (FORBIDDEN_KEYS[key]) fail('VALIDATION', 'A reserved property was supplied at ' + path + '.');
      inspectJson(value[key], path + '.' + key, depth + 1, maximumDepth);
    }
  }

  function cleanString(value) {
    if (value === null || value === undefined) return '';
    return String(value).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '').trim();
  }

  function requireString(payload, key, options) {
    options = options || {};
    var value = cleanString(payload[key]);
    if (!value) fail('VALIDATION', (options.label || key) + ' is required.');
    var maximum = options.max || 500;
    if (value.length > maximum) fail('VALIDATION', (options.label || key) + ' exceeds ' + maximum + ' characters.');
    if (options.min && value.length < options.min) fail('VALIDATION', (options.label || key) + ' is too short.');
    if (options.pattern && !options.pattern.test(value)) fail('VALIDATION', (options.label || key) + ' has an invalid format.');
    return value;
  }

  function optionalString(payload, key, options) {
    options = options || {};
    var value = cleanString(payload[key]);
    if (value.length > (options.max || 500)) fail('VALIDATION', (options.label || key) + ' is too long.');
    if (options.pattern && value && !options.pattern.test(value)) fail('VALIDATION', (options.label || key) + ' has an invalid format.');
    return value;
  }

  function normalizeEmployeeId(value) {
    var id = cleanString(value).toUpperCase();
    if (!id || id.length > 64 || !/^[A-Z0-9][A-Z0-9._\/-]*$/.test(id)) {
      fail('VALIDATION', 'Employee ID must use letters, numbers, dots, slashes, underscores or hyphens.');
    }
    return id;
  }

  function sanitizeForSheet(value) {
    if (value === null || value === undefined) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') return value.toISOString();
    if (typeof value === 'number' || typeof value === 'boolean') return value;
    var string = typeof value === 'object' ? JSON.stringify(value) : String(value);
    if (string.length > 49000) fail('VALIDATION', 'A value exceeds the Google Sheets cell size limit.');
    return /^[=+\-@\t\r]/.test(string) ? "'" + string : string;
  }

  function ensureServerPepper() {
    var properties = PropertiesService.getScriptProperties();
    var pepper = properties.getProperty('AUTH_PEPPER');
    if (!pepper) {
      pepper = Utilities.getUuid() + Utilities.getUuid() + Utilities.getUuid();
      properties.setProperty('AUTH_PEPPER', pepper);
    }
    return pepper;
  }

  function getServerPepper() {
    var pepper = PropertiesService.getScriptProperties().getProperty('AUTH_PEPPER');
    if (!pepper || pepper.length < 40) fail('SERVER', 'Authentication is not initialized. Run setupSystem().');
    return pepper;
  }

  function generateSalt() {
    return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }

  function configuredHashIterations() {
    var configured = asNumber(PropertiesService.getScriptProperties().getProperty('PASSWORD_HASH_ITERATIONS'), DEFAULT_HASH_ITERATIONS);
    return Math.min(MAX_HASH_ITERATIONS, Math.max(MIN_HASH_ITERATIONS, Math.floor(configured)));
  }

  function validateIterationCount(iterations) {
    var count = asNumber(iterations, DEFAULT_HASH_ITERATIONS);
    if (count < MIN_HASH_ITERATIONS || count > MAX_HASH_ITERATIONS) fail('SERVER', 'The stored password work factor is unsupported.');
    return Math.floor(count);
  }

  function hashPassword(password, salt, iterations) {
    var count = validateIterationCount(iterations);
    var key = String(salt) + ':' + getServerPepper();
    var current = String(password);
    for (var round = 0; round < count; round++) {
      current = Utilities.base64Encode(Utilities.computeHmacSha256Signature(current, key + ':' + round));
    }
    return current;
  }

  function generateSessionToken() {
    return 'fcs_' + Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }

  function sha256(value) {
    var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(value), Utilities.Charset.UTF_8);
    return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
  }

  function hashSessionToken(token) {
    return sha256('FOCUSON-SESSION-V1:' + token);
  }

  function hashDevice(value) {
    if (!value) return '';
    return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature(String(value), getServerPepper())).replace(/=+$/g, '');
  }

  function constantTimeEquals(left, right) {
    var a = String(left || '');
    var b = String(right || '');
    var mismatch = a.length === b.length ? 0 : 1;
    var length = Math.max(a.length, b.length);
    for (var i = 0; i < length; i++) {
      mismatch |= (a.charCodeAt(i % Math.max(1, a.length)) || 0) ^ (b.charCodeAt(i % Math.max(1, b.length)) || 0);
    }
    return mismatch === 0;
  }

  function generateId(prefix) {
    return String(prefix || 'row').toLowerCase() + '_' + Utilities.getUuid().replace(/-/g, '');
  }

  function safeAuditDetails(value, depth) {
    var currentDepth = depth || 0;
    if (currentDepth > 5) return '[truncated]';
    if (value === null || value === undefined) return value;
    if (typeof value !== 'object') return cleanString(value).slice(0, 1000);
    if (Array.isArray(value)) {
      return value.slice(0, 100).map(function (item) { return safeAuditDetails(item, currentDepth + 1); });
    }
    var result = {};
    Object.keys(value).slice(0, 100).forEach(function (key) {
      if (/password|token|secret|pepper|salt|credential/i.test(key)) result[key] = '[redacted]';
      else result[key] = safeAuditDetails(value[key], currentDepth + 1);
    });
    return result;
  }

  function safeParseJson(value, fallback) {
    if (!value) return fallback;
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function csvUnique(values) {
    var seen = {};
    var output = [];
    (values || []).forEach(function (value) {
      var key = String(value);
      if (!seen[key]) {
        seen[key] = true;
        output.push(key);
      }
    });
    return output;
  }

  return {
    DEFAULT_HASH_ITERATIONS: DEFAULT_HASH_ITERATIONS,
    fail: fail,
    okResponse: okResponse,
    errorResponse: errorResponse,
    nowIso: nowIso,
    toIso: toIso,
    dateValue: dateValue,
    addSeconds: addSeconds,
    asBoolean: asBoolean,
    asNumber: asNumber,
    assertObject: assertObject,
    cleanString: cleanString,
    requireString: requireString,
    optionalString: optionalString,
    normalizeEmployeeId: normalizeEmployeeId,
    sanitizeForSheet: sanitizeForSheet,
    ensureServerPepper: ensureServerPepper,
    getServerPepper: getServerPepper,
    generateSalt: generateSalt,
    configuredHashIterations: configuredHashIterations,
    hashPassword: hashPassword,
    generateSessionToken: generateSessionToken,
    sha256: sha256,
    hashSessionToken: hashSessionToken,
    hashDevice: hashDevice,
    constantTimeEquals: constantTimeEquals,
    generateId: generateId,
    safeAuditDetails: safeAuditDetails,
    safeParseJson: safeParseJson,
    csvUnique: csvUnique
  };
})();
