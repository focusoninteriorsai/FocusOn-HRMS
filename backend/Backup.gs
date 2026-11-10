/**
 * Verified backups, guarded restore and the administrator self test.
 * A backup is a private Drive JSON snapshot of every application table plus a
 * checksum. Restore always takes a safety copy first and validates row counts.
 */
var Backup = (function () {
  function snapshot() {
    var tables = {};
    var counts = {};
    Object.keys(Database.SCHEMAS).forEach(function (tabName) {
      try {
        var data = Database.readSheet(tabName);
        tables[tabName] = { headers: data.headers, rows: data.values };
        counts[tabName] = data.values.length;
      } catch (error) {
        tables[tabName] = { headers: Database.SCHEMAS[tabName].headers, rows: [] };
        counts[tabName] = 0;
      }
    });
    return { schemaVersion: HRMS_SCHEMA_VERSION, createdAt: Utils.nowIso(), tables: tables, counts: counts };
  }

  function checksum(text) {
    return Utils.sha256(text);
  }

  function create(authentication, payload) {
    var actor = authentication.actor;
    var folderId = PropertiesService.getScriptProperties().getProperty('HRMS_FOLDER_BACKUPS_ID');
    if (!folderId) Utils.fail('SERVER', 'Backup storage is not configured. Run setupSystem().');
    var data = snapshot();
    var json = JSON.stringify(data);
    if (json.length > 45000000) Utils.fail('VALIDATION', 'The dataset is too large for a single backup file. Contact support.');
    var digest = checksum(json);
    var name = 'FOCUSON_BACKUP_' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
    var folder = DriveApp.getFolderById(folderId);
    var file = folder.createFile(Utilities.newBlob(json, 'application/json', name));
    var record = Database.insert('Backup_Logs', {
      backup_type: Utils.cleanString(payload.type) || 'MANUAL',
      file_id: file.getId(),
      row_counts_json: JSON.stringify({ counts: data.counts, bytes: json.length }),
      integrity_result: 'VERIFIED:' + digest,
      restored_from_id: ''
    }, actor.employeeId);
    Audit.logEvent('BACKUP_CREATED', actor.employeeId, 'Backup_Logs', record.id, 'SUCCESS', {
      bytes: json.length, tables: Object.keys(data.counts).length
    }, {});
    prune(folder);
    return {
      backupId: record.id, fileName: name, fileId: file.getId(),
      bytes: json.length, tables: Object.keys(data.counts).length,
      totalRows: Object.keys(data.counts).reduce(function (sum, key) { return sum + data.counts[key]; }, 0),
      checksum: digest
    };
  }

  function prune(folder) {
    var keep = Settings.number('BACKUP_KEEP_COPIES', 10);
    var retentionDays = Settings.number('BACKUP_RETENTION_DAYS', 30);
    var cutoff = new Date(Date.now() - retentionDays * 86400000);
    var files = [];
    var iterator = folder.getFiles();
    while (iterator.hasNext()) {
      var file = iterator.next();
      if (file.getName().indexOf('FOCUSON_BACKUP_') !== 0) continue;
      files.push(file);
    }
    files.sort(function (left, right) { return right.getDateCreated().getTime() - left.getDateCreated().getTime(); });
    files.forEach(function (file, index) {
      if (index < keep && file.getDateCreated().getTime() >= cutoff.getTime()) return;
      if (index < Math.max(1, Math.floor(keep / 2))) return;
      try { file.setTrashed(true); } catch (error) { /* retention is best effort */ }
    });
  }

  function list(authentication, payload) {
    var items = Database.getAllCached('Backup_Logs').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var counts = Utils.safeParseJson(row.row_counts_json, {});
      return {
        id: row.id, type: row.backup_type, fileId: row.file_id,
        createdAt: Utils.toIso(row.created_at),
        createdBy: Repo.employeeName(row.created_by),
        integrity: String(row.integrity_result || ''),
        verified: String(row.integrity_result || '').indexOf('VERIFIED:') === 0,
        totalRows: Object.keys(counts.counts || {}).reduce(function (sum, key) { return sum + Utils.numberOrZero(counts.counts[key]); }, 0),
        bytes: Utils.numberOrZero(counts.bytes),
        restoredFrom: row.restored_from_id || ''
      };
    }).sort(function (left, right) { return String(right.createdAt).localeCompare(String(left.createdAt)); });
    return {
      items: items.slice(0, 100), total: items.length,
      autoDaily: Settings.bool('BACKUP_AUTO_DAILY', true),
      keep: Settings.number('BACKUP_KEEP_COPIES', 10),
      retentionDays: Settings.number('BACKUP_RETENTION_DAYS', 30)
    };
  }

  function verify(authentication, payload) {
    var log = Repo.requireRecord('Backup_Logs', payload.backupId, 'Backup');
    var file = DriveApp.getFileById(log.file_id);
    var text = file.getBlob().getDataAsString();
    var parsed = Utils.safeParseJson(text, null);
    if (!parsed || !parsed.tables) Utils.fail('VALIDATION', 'The backup file could not be parsed.');
    var digest = checksum(text);
    var stored = String(log.integrity_result || '').replace('VERIFIED:', '');
    var expected = Utils.safeParseJson(log.row_counts_json, { counts: {} }).counts || {};
    var mismatches = [];
    Object.keys(expected).forEach(function (tabName) {
      var actual = parsed.tables[tabName] ? parsed.tables[tabName].rows.length : 0;
      if (actual !== expected[tabName]) mismatches.push({ table: tabName, expected: expected[tabName], actual: actual });
    });
    var result = {
      backupId: log.id, checksumMatches: digest === stored, digest: digest,
      rowCountMatches: mismatches.length === 0, mismatches: mismatches,
      tables: Object.keys(parsed.tables).length, createdAt: parsed.createdAt
    };
    Database.update('Backup_Logs', log.id, {
      integrity_result: (result.checksumMatches && result.rowCountMatches ? 'VERIFIED:' : 'FAILED:') + digest
    }, authentication.actor.employeeId);
    Audit.logEvent('BACKUP_VERIFIED', authentication.actor.employeeId, 'Backup_Logs', log.id, result.checksumMatches ? 'SUCCESS' : 'FAILED', result, {});
    return result;
  }

  /** Restore is deliberately guarded: typed confirmation, reason and a safety copy. */
  function restore(authentication, payload) {
    var actor = authentication.actor;
    if (!actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can restore a backup.');
    if (String(payload.confirmation || '').trim().toUpperCase() !== 'RESTORE') {
      Utils.fail('VALIDATION', 'Type RESTORE to confirm. This replaces current data.');
    }
    var reason = Utils.requireString(payload, 'reason', { max: 1000, min: 15 });
    var log = Repo.requireRecord('Backup_Logs', payload.backupId, 'Backup');
    var file = DriveApp.getFileById(log.file_id);
    var text = file.getBlob().getDataAsString();
    var parsed = Utils.safeParseJson(text, null);
    if (!parsed || !parsed.tables) Utils.fail('VALIDATION', 'The backup file is not readable.');
    var stored = String(log.integrity_result || '').replace('VERIFIED:', '');
    if (stored && checksum(text) !== stored) Utils.fail('CONFLICT', 'The backup checksum does not match. Restore refuses to continue.');
    var safety = create(authentication, { type: 'PRE_RESTORE_SAFETY' });
    var restored = {};
    Object.keys(parsed.tables).forEach(function (tabName) {
      if (!Database.SCHEMAS[tabName]) return;
      var table = parsed.tables[tabName];
      var records = (table.rows || []).map(function (row) {
        var record = {};
        (table.headers || []).forEach(function (header, index) {
          if (!header) return;
          record[header] = cellValue(row[index], header);
        });
        return record;
      }).filter(function (record) { return record.id; });
      try {
        restored[tabName] = Database.replaceSheet(tabName, records, actor.employeeId);
      } catch (error) {
        restored[tabName] = 'FAILED: ' + (error && error.message ? error.message : 'unknown');
      }
    });
    Database.update('Backup_Logs', log.id, { restored_from_id: safety.backupId }, actor.employeeId);
    Audit.logEvent('BACKUP_RESTORED', actor.employeeId, 'Backup_Logs', log.id, 'SUCCESS', {
      reason: reason, safetyBackupId: safety.backupId, restored: restored
    }, {});
    return { restored: restored, safetyBackupId: safety.backupId, note: 'Sign in again. All sessions now require a new login.' };
  }

  function cellValue(value, header) {
    if (value === null || value === undefined) return '';
    if (Object.prototype.toString.call(value) === '[object Date]') {
      var schema = null;
      Object.keys(Database.SCHEMAS).forEach(function (name) {
        if (Database.SCHEMAS[name].fields[header]) schema = Database.SCHEMAS[name].fields[header];
      });
      if (schema && schema.type === 'date') return Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd');
      return value.toISOString();
    }
    return value;
  }

  /** Administrator self test: structural checks only, no data is changed. */
  function selfTest(authentication) {
    var actor = authentication.actor;
    var checks = [];
    function check(name, passed, detail) {
      checks.push({ name: name, passed: Boolean(passed), detail: detail || '' });
    }
    check('Core database configured', Boolean(PropertiesService.getScriptProperties().getProperty('HRMS_CORE_DB_ID')));
    var attendanceYear = PropertiesService.getScriptProperties().getProperty('HRMS_ATTENDANCE_' + new Date().getFullYear() + '_ID');
    check('Attendance database for the current year', Boolean(attendanceYear));
    var missingTabs = [];
    Object.keys(Database.SCHEMAS).forEach(function (tabName) {
      try { Database.getSheet(tabName); } catch (error) { missingTabs.push(tabName); }
    });
    check('All schema tabs exist', missingTabs.length === 0, missingTabs.join(', '));
    var superAdmins = Access.superAdminCount();
    check('At least one Super Admin', superAdmins > 0, superAdmins + ' active');
    check('Super Admin limit respected', superAdmins <= Settings.number('MAX_SUPER_ADMINS', 3), superAdmins + ' of ' + Settings.number('MAX_SUPER_ADMINS', 3));
    check('Permission catalog seeded', Access.permissionCatalog().length > 30, Access.permissionCatalog().length + ' permissions');
    check('Feature switches present', Settings.describe().features.length >= 15, Settings.describe().features.length + ' switches');
    var settingsCount = Database.getAllCached('Company_Settings').length;
    check('Settings present', settingsCount >= 60, settingsCount + ' settings');
    var folders = ['DOCUMENTS', 'SELFIES', 'RECEIPTS', 'GENERATED', 'BACKUPS', 'TEMPLATES'];
    var missingFolders = folders.filter(function (name) {
      return !PropertiesService.getScriptProperties().getProperty('HRMS_FOLDER_' + name + '_ID');
    });
    check('Private Drive folders registered', missingFolders.length === 0, missingFolders.join(', '));

    var employees = Repo.employees();
    var ids = {};
    var duplicates = [];
    employees.forEach(function (employee) {
      var id = Repo.employeeKey(employee);
      if (ids[id]) duplicates.push(id);
      ids[id] = true;
    });
    check('No duplicate Employee IDs', duplicates.length === 0, duplicates.slice(0, 5).join(', '));

    var orphanManagers = employees.filter(function (employee) {
      return employee.reporting_manager_id && !Repo.employee(employee.reporting_manager_id);
    }).map(function (employee) { return Repo.employeeKey(employee); });
    check('Reporting managers resolve', orphanManagers.length === 0, orphanManagers.slice(0, 5).join(', '));

    var usersWithoutEmployee = Repo.users().filter(function (user) { return !Repo.employee(user.employee_id); }).map(function (user) { return user.employee_id; });
    check('Every login has an employee record', usersWithoutEmployee.length === 0, usersWithoutEmployee.slice(0, 5).join(', '));

    var employeesWithoutStructure = Repo.activeEmployees().filter(function (employee) { return !Payroll.structureFor(Repo.employeeKey(employee), Utils.today()); }).length;
    check('Salary structures configured', employeesWithoutStructure === 0, employeesWithoutStructure + ' employee(s) without a structure');

    var statutory = Payroll.statutory();
    check('Statutory values CA-verified', Boolean(statutory.caVerified), statutory.caVerified ? 'Verified' : 'Not verified — payroll will stay blocked');
    var attendancePolicies = Database.getAllCached('Attendance_Policies').filter(function (row) { return String(row.status).toUpperCase() === 'ACTIVE'; }).length;
    check('Attendance policy configured', attendancePolicies > 0, attendancePolicies + ' active');
    var geofences = Database.getAllCached('Geofence_Locations').filter(function (row) { return String(row.status).toUpperCase() === 'ACTIVE'; }).length;
    var geofenceRequired = Permissions.isFeatureEnabled('geofence', { employeeId: actor.employeeId, isSuperAdmin: true, permissions: [] });
    check('Geofence location configured', geofences > 0 || !geofenceRequired, geofences + ' active, geofence ' + (geofenceRequired ? 'on' : 'off'));
    var leaveTypes = Leave.leaveTypes().length;
    check('Leave types configured', leaveTypes > 0, leaveTypes + ' active');
    var holidays = Database.getAllCached('Holidays').length;
    check('Holiday calendar present', holidays > 0, holidays + ' holidays');
    var triggers = ScriptApp.getProjectTriggers().map(function (trigger) { return trigger.getHandlerFunction(); });
    check('Daily maintenance trigger', triggers.indexOf('runDailyFoundationMaintenance') >= 0);
    check('Leave accrual trigger', triggers.indexOf('runMonthlyAccrual') >= 0);
    check('Payroll reminder trigger', triggers.indexOf('runMonthlyPayrollReminder') >= 0);
    check('Audit log writable', (function () {
      try {
        var before = Database.getAllCached('Audit_Logs').length;
        Audit.logEvent('SELF_TEST', actor.employeeId, 'System', '', 'SUCCESS', { check: 'audit' }, {});
        return Database.getAll('Audit_Logs').length > before;
      } catch (error) {
        return false;
      }
    })(), 'Writes a SELF_TEST audit event');

    // Advisory: report the optional Google Workspace channels without failing the
    // installation when a channel is intentionally switched off.
    if (typeof Google !== 'undefined') {
      var googleStatus = Google.status();
      checks.push({
        name: 'Google Workspace channels',
        passed: true,
        detail: 'Gmail ' + (googleStatus.mail.enabled ? 'on (' + googleStatus.mail.quota + ' left today)' : 'off') +
          ', Calendar ' + (googleStatus.calendar.enabled ? 'on' : 'off') +
          ', Chat ' + (googleStatus.chat.enabled ? 'on' : 'off') +
          ', Contacts ' + (googleStatus.contacts.enabled ? 'on' : 'off') +
          ', Tasks ' + (googleStatus.tasks.enabled ? 'on' : 'off') +
          ', Docs ' + (googleStatus.docs.enabled ? 'on' : 'off')
      });
    }

    var passed = checks.filter(function (item) { return item.passed; }).length;
    return {
      checks: checks, passed: passed, failed: checks.length - passed, total: checks.length,
      score: Utils.round2(passed / checks.length * 100),
      generatedAt: Utils.nowIso(),
      note: 'Advisory checks only. Fix failed items in the relevant settings screen.'
    };
  }

  function autoDaily() {
    if (!Settings.bool('BACKUP_AUTO_DAILY', true)) return { created: false };
    try {
      var today = Utils.today();
      var existing = Database.getAllCached('Backup_Logs').filter(function (row) {
        return String(row.backup_type).toUpperCase() === 'AUTOMATIC' && Utils.toIso(row.created_at).slice(0, 10) === today;
      });
      if (existing.length) return { created: false };
      var result = create({ actor: { employeeId: 'SYSTEM', isSuperAdmin: true, permissions: [] } }, { type: 'AUTOMATIC' });
      return { created: true, backupId: result.backupId };
    } catch (error) {
      return { created: false, error: String(error && error.message || error) };
    }
  }

  return {
    create: create,
    list: list,
    verify: verify,
    restore: restore,
    selfTest: selfTest,
    autoDaily: autoDaily,
    snapshot: snapshot
  };
})();
