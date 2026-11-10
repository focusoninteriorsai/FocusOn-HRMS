/**
 * FOCUSON HRMS - Backend Utilities (Google Apps Script)
 * Formula injection protection, iterated HMAC cryptography, response envelopes, and geographic math.
 */

var Utils = (function() {
  var PEPPER_PROPERTY_KEY = 'AUTH_PEPPER';
  var HASH_ITERATIONS = 1000; // Calibrated for Apps Script execution budget

  /**
   * Prevents formula injection (CSV/Spreadsheet injection).
   * Prefixes any string starting with =, +, -, @, tab, or carriage return with an apostrophe.
   */
  function sanitizeForSheet(val) {
    if (val === null || val === undefined) return '';
    if (typeof val === 'number' || typeof val === 'boolean') return val;
    var str = String(val);
    if (/^[=+\-@\t\r]/.test(str)) {
      return "'" + str;
    }
    return str;
  }

  /**
   * Sanitizes object properties recursively before storing in Google Sheets.
   */
  function sanitizeRecord(obj) {
    if (!obj || typeof obj !== 'object') return sanitizeForSheet(obj);
    var clean = Array.isArray(obj) ? [] : {};
    for (var key in obj) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        var v = obj[key];
        if (typeof v === 'object' && v !== null) {
          clean[key] = sanitizeRecord(v);
        } else {
          clean[key] = sanitizeForSheet(v);
        }
      }
    }
    return clean;
  }

  /**
   * Retrieves or initializes server-side pepper stored in Script Properties.
   */
  function getServerPepper() {
    var props = PropertiesService.getScriptProperties();
    var pepper = props.getProperty(PEPPER_PROPERTY_KEY);
    if (!pepper) {
      pepper = Utilities.getUuid() + '-' + Utilities.getUuid();
      props.setProperty(PEPPER_PROPERTY_KEY, pepper);
    }
    return pepper;
  }

  /**
   * Generates a random cryptographic salt.
   */
  function generateSalt() {
    return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  }

  /**
   * Computes iterated HMAC-SHA256 hash using user salt + server pepper.
   */
  function hashPassword(password, salt) {
    var pepper = getServerPepper();
    var key = salt + pepper;
    var current = password;
    for (var i = 0; i < HASH_ITERATIONS; i++) {
      var sigBytes = Utilities.computeHmacSha256Signature(current, key);
      current = Utilities.base64Encode(sigBytes);
    }
    return current;
  }

  /**
   * Generates cryptographically strong session token.
   */
  function generateSessionToken() {
    return 'fcs_' + Utilities.getUuid() + '_' + Utilities.getUuid().substring(0, 12);
  }

  /**
   * Computes SHA-256 hash of a session token for safe storage in Sessions sheet.
   */
  function hashSessionToken(token) {
    var digest = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token, Utilities.Charset.UTF_8);
    return digest.map(function(b) {
      var byteVal = (b < 0 ? b + 256 : b).toString(16);
      return byteVal.length === 1 ? '0' + byteVal : byteVal;
    }).join('');
  }

  /**
   * Standardized JSON success envelope.
   */
  function okResponse(data, reqId) {
    return {
      ok: true,
      data: data !== undefined ? data : null,
      reqId: reqId || null
    };
  }

  /**
   * Standardized JSON error envelope with stable error code.
   */
  function errorResponse(code, message, reqId) {
    return {
      ok: false,
      error: {
        code: code || 'SERVER',
        message: message || 'An unexpected error occurred'
      },
      reqId: reqId || null
    };
  }

  /**
   * Haversine formula to compute distance in meters between two lat/lng coordinates.
   */
  function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
    var R = 6371000; // Radius of Earth in meters
    var dLat = (lat2 - lat1) * Math.PI / 180;
    var dLon = (lon2 - lon1) * Math.PI / 180;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
    var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  }

  /**
   * Gets current ISO timestamp in UTC/IST.
   */
  function nowIso() {
    return new Date().toISOString();
  }

  return {
    sanitizeForSheet: sanitizeForSheet,
    sanitizeRecord: sanitizeRecord,
    generateSalt: generateSalt,
    hashPassword: hashPassword,
    generateSessionToken: generateSessionToken,
    hashSessionToken: hashSessionToken,
    okResponse: okResponse,
    errorResponse: errorResponse,
    haversineDistanceMeters: haversineDistanceMeters,
    nowIso: nowIso
  };
})();
