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

  /** ---------- Date helpers (all calendar maths is done in Asia/Kolkata) ---------- */

  var TIMEZONE = 'Asia/Kolkata';

  function today() {
    return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM-dd');
  }

  function todayDate() {
    var parts = today().split('-');
    return new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  }

  function requireDate(value, label, options) {
    options = options || {};
    var text = cleanString(value);
    if (!text) {
      if (options.optional) return '';
      fail('VALIDATION', (label || 'Date') + ' is required.');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) fail('VALIDATION', (label || 'Date') + ' must use the YYYY-MM-DD format.');
    var parts = text.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    if (isNaN(date.getTime()) || date.getFullYear() !== Number(parts[0]) || date.getMonth() !== Number(parts[1]) - 1 || date.getDate() !== Number(parts[2])) {
      fail('VALIDATION', (label || 'Date') + ' is not a real calendar date.');
    }
    if (options.noFuture && text > today()) fail('VALIDATION', (label || 'Date') + ' cannot be in the future.');
    return text;
  }

  function parseDateOnly(value) {
    var text = cleanString(value).slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    var parts = text.split('-');
    var date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return isNaN(date.getTime()) ? null : date;
  }

  function dateOnly(date) {
    if (!date) return '';
    if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) return date.slice(0, 10);
    var parsed = dateValue(date);
    return parsed ? Utilities.formatDate(parsed, TIMEZONE, 'yyyy-MM-dd') : '';
  }

  function addDays(dateText, days) {
    var date = parseDateOnly(dateText) || todayDate();
    date.setDate(date.getDate() + Number(days || 0));
    return Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd');
  }

  function dayDiff(fromText, toText) {
    var from = parseDateOnly(fromText);
    var to = parseDateOnly(toText);
    if (!from || !to) return 0;
    return Math.round((to.getTime() - from.getTime()) / 86400000);
  }

  function monthOf(value) {
    var text = cleanString(value);
    return /^\d{4}-\d{2}$/.test(text) ? text : today().slice(0, 7);
  }

  function monthRange(monthText) {
    var month = monthOf(monthText);
    var start = month + '-01';
    var date = parseDateOnly(start);
    date.setMonth(date.getMonth() + 1);
    date.setDate(0);
    return { start: start, end: Utilities.formatDate(date, TIMEZONE, 'yyyy-MM-dd'), month: month };
  }

  function dayOfWeek(dateText) {
    var date = parseDateOnly(dateText);
    return date ? date.getDay() : 0;
  }

  function isWeekend(dateText, weekendDays) {
    return (weekendDays || [0]).indexOf(dayOfWeek(dateText)) >= 0;
  }

  function formatTime(dateText) {
    var date = dateValue(dateText);
    return date ? Utilities.formatDate(date, TIMEZONE, 'HH:mm') : '';
  }

  function minutesSinceMidnight(dateText) {
    var date = dateValue(dateText);
    if (!date) return -1;
    var parts = Utilities.formatDate(date, TIMEZONE, 'HH:mm').split(':');
    return Number(parts[0]) * 60 + Number(parts[1]);
  }

  function timeToMinutes(value) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(cleanString(value));
    if (!match) return -1;
    return Math.min(1439, Number(match[1]) * 60 + Number(match[2]));
  }

  function round2(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.round((number + Number.EPSILON) * 100) / 100;
  }

  function requireNumber(value, label, options) {
    options = options || {};
    if (value === '' || value === null || value === undefined) {
      if (options.optional) return 0;
      fail('VALIDATION', (label || 'Value') + ' is required.');
    }
    var number = Number(value);
    if (!isFinite(number)) fail('VALIDATION', (label || 'Value') + ' must be a number.');
    if (options.integer && Math.floor(number) !== number) fail('VALIDATION', (label || 'Value') + ' must be a whole number.');
    if (options.min !== undefined && number < options.min) fail('VALIDATION', (label || 'Value') + ' must be at least ' + options.min + '.');
    if (options.max !== undefined && number > options.max) fail('VALIDATION', (label || 'Value') + ' must be at most ' + options.max + '.');
    return number;
  }

  function requireEnum(value, allowed, label) {
    var text = cleanString(value);
    if (allowed.indexOf(text) < 0) fail('VALIDATION', (label || 'Value') + ' must be one of: ' + allowed.join(', ') + '.');
    return text;
  }

  function optionalEnum(value, allowed, label) {
    var text = cleanString(value);
    if (!text) return '';
    return requireEnum(text, allowed, label);
  }

  function requireEmail(value, label, optional) {
    var text = cleanString(value);
    if (!text) {
      if (optional) return '';
      fail('VALIDATION', (label || 'Email') + ' is required.');
    }
    if (text.length > 254 || !/^[^\s@]+@[^\s@]+\.[A-Za-z]{2,}$/.test(text)) fail('VALIDATION', (label || 'Email') + ' is not a valid email address.');
    return text;
  }

  function requireMobile(value, label, optional) {
    var text = cleanString(value).replace(/[\s-]/g, '');
    if (!text) {
      if (optional) return '';
      fail('VALIDATION', (label || 'Mobile number') + ' is required.');
    }
    if (!/^\+?\d{7,15}$/.test(text)) fail('VALIDATION', (label || 'Mobile number') + ' is not valid.');
    return text;
  }

  /** Pagination + sorting + text search shared by every list action. */
  function paginate(records, payload, options) {
    options = options || {};
    var pageSize = Math.min(options.maxPageSize || 200, Math.max(1, Math.floor(asNumber(payload.pageSize, 25))));
    var page = Math.max(1, Math.floor(asNumber(payload.page, 1)));
    var search = cleanString(payload.search).toLowerCase().slice(0, 120);
    var filtered = records;
    if (search && options.searchFields && options.searchFields.length) {
      filtered = filtered.filter(function (record) {
        return options.searchFields.some(function (field) {
          return String(record[field] === undefined || record[field] === null ? '' : record[field]).toLowerCase().indexOf(search) >= 0;
        });
      });
    }
    var sortBy = cleanString(payload.sortBy);
    var allowedSort = options.sortFields || (records.length ? Object.keys(records[0]) : []);
    if (sortBy && allowedSort.indexOf(sortBy) >= 0) {
      var direction = String(payload.sortDir).toLowerCase() === 'desc' ? -1 : 1;
      filtered = filtered.slice().sort(function (left, right) {
        var a = left[sortBy] === undefined || left[sortBy] === null ? '' : left[sortBy];
        var b = right[sortBy] === undefined || right[sortBy] === null ? '' : right[sortBy];
        if (typeof a === 'number' && typeof b === 'number') return (a - b) * direction;
        return String(a).localeCompare(String(b)) * direction;
      });
    }
    var total = filtered.length;
    var start = (page - 1) * pageSize;
    return {
      items: filtered.slice(start, start + pageSize),
      page: page,
      pageSize: pageSize,
      total: total,
      pageCount: Math.max(1, Math.ceil(total / pageSize))
    };
  }

  function filterEquals(payload, field, recordField) {
    var value = cleanString(payload[field]);
    if (!value) return true;
    return String(payload[field]).toLowerCase() === String(payload[recordField || field]).toLowerCase();
  }

  function containsText(value) {
    return cleanString(value).toLowerCase();
  }

  function pick(source, keys) {
    var output = {};
    (keys || []).forEach(function (key) {
      if (source && Object.prototype.hasOwnProperty.call(source, key)) output[key] = source[key];
    });
    return output;
  }

  function csvEscape(value) {
    var text = value === null || value === undefined ? '' : String(value);
    if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
    return '"' + text.replace(/"/g, '""') + '"';
  }

  function toCsv(columns, rows) {
    var lines = [columns.map(function (column) { return csvEscape(column.label || column.key); }).join(',')];
    (rows || []).forEach(function (row) {
      lines.push(columns.map(function (column) { return csvEscape(row[column.key]); }).join(','));
    });
    return lines.join('\r\n');
  }

  function toBase64(text) {
    return Utilities.base64Encode(text, Utilities.Charset.UTF_8);
  }

  function shortId(prefix, length) {
    return String(prefix || 'id').toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Utilities.getUuid().replace(/-/g, '').slice(0, length || 12);
  }

  function numberOrZero(value) {
    var number = Number(value);
    return isFinite(number) ? number : 0;
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
    csvUnique: csvUnique,
    TIMEZONE: TIMEZONE,
    today: today,
    todayDate: todayDate,
    requireDate: requireDate,
    parseDateOnly: parseDateOnly,
    dateOnly: dateOnly,
    addDays: addDays,
    dayDiff: dayDiff,
    monthOf: monthOf,
    monthRange: monthRange,
    dayOfWeek: dayOfWeek,
    isWeekend: isWeekend,
    formatTime: formatTime,
    minutesSinceMidnight: minutesSinceMidnight,
    timeToMinutes: timeToMinutes,
    round2: round2,
    requireNumber: requireNumber,
    requireEnum: requireEnum,
    optionalEnum: optionalEnum,
    requireEmail: requireEmail,
    requireMobile: requireMobile,
    paginate: paginate,
    filterEquals: filterEquals,
    containsText: containsText,
    pick: pick,
    csvEscape: csvEscape,
    toCsv: toCsv,
    toBase64: toBase64,
    shortId: shortId,
    numberOrZero: numberOrZero
  };
})();
