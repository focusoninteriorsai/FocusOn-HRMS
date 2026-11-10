/**
 * FOCUSON HRMS - Database Layer (Google Apps Script)
 * Batch operations, header mapping, formula injection protection, CacheService & LockService integration.
 */

var Database = (function() {
  var CACHE_EXPIRATION_SEC = 900; // 15 minutes cache for read-heavy static tables
  var LOCK_TIMEOUT_MS = 15000;    // 15 seconds lock wait

  /**
   * Retrieves the Core Database Spreadsheet.
   */
  function getCoreSpreadsheet() {
    var props = PropertiesService.getScriptProperties();
    var sheetId = props.getProperty('HRMS_CORE_DB_ID');
    if (!sheetId) {
      throw new Error('HRMS_CORE_DB_ID is not configured in Script Properties. Run setupSystem() first.');
    }
    return SpreadsheetApp.openById(sheetId);
  }

  /**
   * Retrieves the Attendance Database Spreadsheet for the specified or current year.
   */
  function getAttendanceSpreadsheet(year) {
    var y = year || new Date().getFullYear();
    var props = PropertiesService.getScriptProperties();
    var key = 'HRMS_ATTENDANCE_' + y + '_ID';
    var sheetId = props.getProperty(key);
    if (!sheetId) {
      throw new Error('Attendance sheet for year ' + y + ' is not configured. Run setupSystem() first.');
    }
    return SpreadsheetApp.openById(sheetId);
  }

  /**
   * Resolves sheet object from core or yearly attendance spreadsheet.
   */
  function getSheet(tabName, year) {
    if (tabName === 'Attendance' || tabName === 'Attendance_Regularization') {
      return getAttendanceSpreadsheet(year).getSheetByName(tabName);
    }
    return getCoreSpreadsheet().getSheetByName(tabName);
  }

  /**
   * Batch reads all records from a tab as an array of JSON objects.
   * Filters out soft-deleted records (status === 'DELETED') unless includeDeleted is true.
   */
  function getAll(tabName, options) {
    options = options || {};
    var sheet = getSheet(tabName, options.year);
    if (!sheet) {
      throw new Error('Table tab "' + tabName + '" does not exist.');
    }

    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow <= 1 || lastCol === 0) {
      return [];
    }

    var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    var headers = values[0];
    var results = [];

    for (var r = 1; r < values.length; r++) {
      var row = values[r];
      var record = {};
      for (var c = 0; c < headers.length; c++) {
        var h = headers[c];
        if (h) {
          record[h] = row[c];
        }
      }
      if (!options.includeDeleted && record.status === 'DELETED') {
        continue;
      }
      results.push(record);
    }

    return results;
  }

  /**
   * Cached batch read for static/read-heavy tables (e.g. Roles, Permissions_Catalog, Company_Settings).
   */
  function getAllCached(tabName) {
    var cache = CacheService.getScriptCache();
    var cacheKey = 'DB_TABLE_' + tabName;
    var cachedJson = cache.get(cacheKey);

    if (cachedJson) {
      try {
        return JSON.parse(cachedJson);
      } catch (e) {
        // Fallback to fresh read on corrupted cache
      }
    }

    var data = getAll(tabName);
    try {
      var str = JSON.stringify(data);
      if (str.length < 90000) { // Apps Script Cache item limit is 100KB
        cache.put(cacheKey, str, CACHE_EXPIRATION_SEC);
      }
    } catch (e) {
      // Ignore cache put failure
    }

    return data;
  }

  /**
   * Invalidates cache for a table tab.
   */
  function invalidateCache(tabName) {
    var cache = CacheService.getScriptCache();
    cache.remove('DB_TABLE_' + tabName);
  }

  /**
   * Inserts a new record into a tab with concurrency lock and formula injection protection.
   */
  function insert(tabName, record, actorId, options) {
    options = options || {};
    var lock = LockService.getScriptLock();
    var hasLock = lock.tryLock(LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw { code: 'LOCKED', message: 'Database is currently busy with another write transaction. Please retry.' };
    }

    try {
      var sheet = getSheet(tabName, options.year);
      if (!sheet) throw new Error('Sheet ' + tabName + ' not found.');

      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var now = Utils.nowIso();

      record.id = record.id || (tabName.toLowerCase() + '_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16));
      record.created_at = record.created_at || now;
      record.updated_at = now;
      record.created_by = record.created_by || actorId || 'SYSTEM';
      record.updated_by = actorId || 'SYSTEM';
      record.status = record.status || 'ACTIVE';

      var rowValues = [];
      for (var c = 0; c < headers.length; c++) {
        var h = headers[c];
        var val = record[h] !== undefined ? record[h] : '';
        rowValues.push(Utils.sanitizeForSheet(val));
      }

      sheet.appendRow(rowValues);
      invalidateCache(tabName);
      return record;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Updates an existing record by id with concurrency lock and formula injection protection.
   */
  function update(tabName, id, updates, actorId, options) {
    options = options || {};
    var lock = LockService.getScriptLock();
    var hasLock = lock.tryLock(LOCK_TIMEOUT_MS);
    if (!hasLock) {
      throw { code: 'LOCKED', message: 'Database is locked for concurrent write. Please retry.' };
    }

    try {
      var sheet = getSheet(tabName, options.year);
      if (!sheet) throw new Error('Sheet ' + tabName + ' not found.');

      var lastRow = sheet.getLastRow();
      var lastCol = sheet.getLastColumn();
      if (lastRow <= 1) throw { code: 'NOT_FOUND', message: 'Record not found.' };

      var allValues = sheet.getRange(1, 1, lastRow, lastCol).getValues();
      var headers = allValues[0];
      var idColIdx = headers.indexOf('id');
      if (idColIdx === -1) throw new Error('Column "id" not found in ' + tabName);

      var targetRowIdx = -1;
      for (var r = 1; r < allValues.length; r++) {
        if (allValues[r][idColIdx] === id) {
          targetRowIdx = r + 1; // 1-indexed for Sheet range
          break;
        }
      }

      if (targetRowIdx === -1) {
        throw { code: 'NOT_FOUND', message: 'Record ' + id + ' not found in ' + tabName };
      }

      updates.updated_at = Utils.nowIso();
      updates.updated_by = actorId || 'SYSTEM';

      var currentRowValues = sheet.getRange(targetRowIdx, 1, 1, lastCol).getValues()[0];
      for (var key in updates) {
        var colIdx = headers.indexOf(key);
        if (colIdx !== -1) {
          currentRowValues[colIdx] = Utils.sanitizeForSheet(updates[key]);
        }
      }

      sheet.getRange(targetRowIdx, 1, 1, lastCol).setValues([currentRowValues]);
      invalidateCache(tabName);
      return updates;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Soft-deletes a record by setting status = 'DELETED'.
   */
  function softDelete(tabName, id, actorId, options) {
    return update(tabName, id, { status: 'DELETED' }, actorId, options);
  }

  return {
    getCoreSpreadsheet: getCoreSpreadsheet,
    getAttendanceSpreadsheet: getAttendanceSpreadsheet,
    getSheet: getSheet,
    getAll: getAll,
    getAllCached: getAllCached,
    invalidateCache: invalidateCache,
    insert: insert,
    update: update,
    softDelete: softDelete
  };
})();
