/**
 * The only Sheets data-access layer. Schemas are additive and all operations use
 * batched Range reads/writes. User values are validated and formula-escaped.
 */
var Database = (function () {
  var CACHE_SECONDS = 600;
  var LOCK_TIMEOUT_MS = 15000;
  var COMMON = [
    ['id', 'string', 128],
    ['created_at', 'datetime'],
    ['updated_at', 'datetime'],
    ['created_by', 'string', 128],
    ['updated_by', 'string', 128],
    ['status', 'string', 40]
  ];
  var SCHEMAS = buildSchemas();

  function buildSchemas() {
    var schemas = {};
    function core(name, columns, required) { schemas[name] = makeSchema('CORE', columns, required); }
    function attendance(name, columns, required) { schemas[name] = makeSchema('ATTENDANCE', columns, required); }

    core('Users', [
      ['employee_id', 'string', 64], ['password_hash', 'string', 256], ['password_salt', 'string', 128],
      ['password_iterations', 'integer'], ['must_change_password', 'boolean'], ['password_changed_at', 'datetime'],
      ['language', 'string', 8], ['theme', 'string', 16], ['simple_mode', 'boolean']
    ], ['employee_id', 'password_hash', 'password_salt']);
    core('Employees', [
      ['employee_id', 'string', 64], ['display_name', 'string', 160], ['first_name', 'string', 100], ['last_name', 'string', 100],
      ['work_email', 'string', 254], ['personal_email', 'string', 254], ['mobile', 'string', 32],
      ['department_id', 'string', 128], ['department', 'string', 160], ['designation_id', 'string', 128], ['designation', 'string', 160],
      ['branch_id', 'string', 128], ['branch', 'string', 160], ['reporting_manager_id', 'string', 64],
      ['work_location_type', 'string', 80], ['attendance_policy_id', 'string', 128], ['joining_date', 'date'],
      ['date_of_birth', 'date'], ['gender', 'string', 60], ['photo_file_id', 'string', 256],
      ['bank_account_number', 'string', 128], ['bank_ifsc', 'string', 32], ['bank_name', 'string', 160],
      ['pan_number', 'string', 64], ['aadhaar_number', 'string', 64], ['pf_uan', 'string', 64], ['esi_number', 'string', 64],
      ['medical_notes', 'string', 4000], ['blood_group', 'string', 16], ['ctc_annual', 'number'], ['basic_salary', 'number'], ['gross_salary', 'number']
    ], ['display_name']);
    core('Departments', [['code', 'string', 64], ['name', 'string', 160], ['head_employee_id', 'string', 64], ['branch_id', 'string', 128]], ['code', 'name']);
    core('Designations', [['code', 'string', 64], ['name', 'string', 160], ['level', 'integer']], ['code', 'name']);
    core('Branches', [['code', 'string', 64], ['name', 'string', 160], ['address', 'string', 1000], ['timezone', 'string', 80]], ['code', 'name']);

    core('Roles', [['role_code', 'string', 80], ['name', 'string', 160], ['description', 'string', 1000], ['scope_type', 'string', 40], ['conditions_json', 'json', 8000], ['built_in', 'boolean']], ['role_code', 'name', 'scope_type']);
    core('Permissions_Catalog', [['permission_key', 'string', 160], ['module', 'string', 100], ['action', 'string', 100], ['description', 'string', 1000], ['sensitive', 'boolean']], ['permission_key', 'module', 'action']);
    core('Role_Permissions', [['role_id', 'string', 128], ['permission_key', 'string', 160], ['conditions_json', 'json', 8000]], ['role_id', 'permission_key']);
    core('User_Role_Map', [['employee_id', 'string', 64], ['role_id', 'string', 128], ['valid_from', 'datetime'], ['valid_until', 'datetime'], ['assigned_by', 'string', 64], ['reason', 'string', 1000]], ['employee_id', 'role_id']);
    core('User_Permission_Overrides', [['employee_id', 'string', 64], ['permission_key', 'string', 160], ['effect', 'string', 16], ['scope_type', 'string', 40], ['conditions_json', 'json', 8000], ['reason', 'string', 1000], ['expires_at', 'datetime'], ['granted_by', 'string', 64]], ['employee_id', 'permission_key', 'effect', 'reason', 'expires_at']);
    core('Delegations', [['delegator_employee_id', 'string', 64], ['delegate_employee_id', 'string', 64], ['permissions_json', 'json', 16000], ['scope_type', 'string', 40], ['capability_ceiling_json', 'json', 16000], ['workflow_define', 'boolean'], ['starts_at', 'datetime'], ['ends_at', 'datetime'], ['reason', 'string', 1000]], ['delegator_employee_id', 'delegate_employee_id', 'starts_at', 'ends_at']);
    core('Feature_Flags', [['feature_key', 'string', 160], ['enabled', 'boolean'], ['scope_type', 'string', 40], ['scope_id', 'string', 128]], ['feature_key']);
    core('Sessions', [['employee_id', 'string', 64], ['token_hash', 'string', 128], ['last_seen_at', 'datetime'], ['expires_at', 'datetime'], ['device_hash', 'string', 128], ['revoked_at', 'datetime']], ['employee_id', 'token_hash', 'expires_at']);

    core('Workflow_Definitions', [['request_type', 'string', 100], ['version', 'integer'], ['name', 'string', 160], ['definition_json', 'json', 30000], ['published_at', 'datetime']], ['request_type', 'version', 'name']);
    core('Workflow_Steps', [['workflow_id', 'string', 128], ['step_number', 'integer'], ['step_type', 'string', 40], ['approver_rule_json', 'json', 8000], ['conditions_json', 'json', 8000], ['sla_hours', 'number'], ['escalation_json', 'json', 8000]], ['workflow_id', 'step_number']);
    core('Approvals', [['request_type', 'string', 100], ['request_id', 'string', 128], ['workflow_id', 'string', 128], ['workflow_version', 'integer'], ['requester_employee_id', 'string', 64], ['current_step', 'integer'], ['payload_json', 'json', 30000], ['due_at', 'datetime']], ['request_type', 'request_id', 'requester_employee_id']);
    core('Approval_Actions', [['approval_id', 'string', 128], ['step_number', 'integer'], ['approver_employee_id', 'string', 64], ['action', 'string', 40], ['comment', 'string', 4000], ['acted_at', 'datetime']], ['approval_id', 'step_number', 'action']);

    core('Attendance_Policies', [['name', 'string', 160], ['policy_type', 'string', 80], ['settings_json', 'json', 20000]], ['name', 'policy_type']);
    core('Geofence_Locations', [['branch_id', 'string', 128], ['name', 'string', 160], ['latitude', 'number'], ['longitude', 'number'], ['radius_meters', 'number'], ['minimum_accuracy_meters', 'number'], ['checkout_enabled', 'boolean'], ['outside_behavior', 'string', 40], ['gps_denied_behavior', 'string', 40], ['checkin_window_json', 'json', 4000]], ['branch_id', 'name', 'latitude', 'longitude', 'radius_meters']);
    core('Shifts', [['name', 'string', 160], ['start_time', 'string', 8], ['end_time', 'string', 8], ['rules_json', 'json', 16000]], ['name']);
    core('Leave_Types', [['code', 'string', 64], ['name', 'string', 160], ['rules_json', 'json', 20000]], ['code', 'name']);
    core('Leave_Applications', [['employee_id', 'string', 64], ['leave_type_id', 'string', 128], ['start_date', 'date'], ['end_date', 'date'], ['half_day', 'boolean'], ['reason', 'string', 4000], ['attachment_file_id', 'string', 256], ['approval_id', 'string', 128]], ['employee_id', 'leave_type_id', 'start_date', 'end_date', 'reason']);
    core('Leave_Balances', [['employee_id', 'string', 64], ['leave_type_id', 'string', 128], ['year', 'integer'], ['ledger_json', 'json', 30000], ['balance_days', 'number']], ['employee_id', 'leave_type_id', 'year']);
    core('Holidays', [['branch_id', 'string', 128], ['name', 'string', 160], ['holiday_date', 'date'], ['holiday_type', 'string', 60]], ['name', 'holiday_date']);
    core('Sites', [['code', 'string', 64], ['name', 'string', 160], ['branch_id', 'string', 128], ['address', 'string', 1000]], ['code', 'name']);
    core('Employee_Site_Assignment', [['employee_id', 'string', 64], ['site_id', 'string', 128], ['valid_from', 'date'], ['valid_until', 'date']], ['employee_id', 'site_id', 'valid_from']);

    core('Salary_Structure', [['employee_id', 'string', 64], ['effective_from', 'date'], ['effective_to', 'date'], ['salary_type', 'string', 60], ['payable_days_divisor', 'number'], ['components_json', 'json', 30000]], ['employee_id', 'effective_from', 'salary_type']);
    core('Salary_Components', [['code', 'string', 64], ['name', 'string', 160], ['component_type', 'string', 40], ['taxable', 'boolean'], ['statutory_wage', 'boolean'], ['formula_json', 'json', 8000]], ['code', 'name', 'component_type']);
    core('Salary_Revisions', [['employee_id', 'string', 64], ['structure_id', 'string', 128], ['effective_from', 'date'], ['approval_id', 'string', 128], ['arrears_json', 'json', 16000]], ['employee_id', 'structure_id', 'effective_from']);
    core('Loans_Advances', [['employee_id', 'string', 64], ['request_type', 'string', 40], ['principal_amount', 'number'], ['emi_amount', 'number'], ['emi_count', 'integer'], ['disbursed_amount', 'number'], ['approval_id', 'string', 128], ['ledger_json', 'json', 30000]], ['employee_id', 'request_type', 'principal_amount']);
    core('Payroll_Runs', [['period', 'string', 7], ['run_state', 'string', 40], ['prepared_by', 'string', 64], ['verified_by', 'string', 64], ['approved_by', 'string', 64], ['released_by', 'string', 64], ['reopen_reason', 'string', 4000], ['processing_cursor', 'integer']], ['period', 'run_state']);
    core('Payroll', [['run_id', 'string', 128], ['employee_id', 'string', 64], ['period', 'string', 7], ['paid_days', 'number'], ['lop_days', 'number'], ['earnings_json', 'json', 30000], ['deductions_json', 'json', 30000], ['net_pay', 'number'], ['calculation_json', 'json', 40000]], ['run_id', 'employee_id', 'period']);
    core('Payslips', [['run_id', 'string', 128], ['payroll_id', 'string', 128], ['employee_id', 'string', 64], ['period', 'string', 7], ['file_id', 'string', 256], ['released_at', 'datetime']], ['run_id', 'payroll_id', 'employee_id', 'period']);
    core('Expenses', [['employee_id', 'string', 64], ['expense_date', 'date'], ['category', 'string', 100], ['amount', 'number'], ['description', 'string', 4000], ['receipt_file_id', 'string', 256], ['approval_id', 'string', 128]], ['employee_id', 'expense_date', 'amount']);
    core('Recruitment', [['opening_code', 'string', 64], ['title', 'string', 200], ['department_id', 'string', 128], ['headcount', 'integer'], ['opening_date', 'date'], ['closing_date', 'date']], ['opening_code', 'title']);
    core('Candidates', [['opening_id', 'string', 128], ['name', 'string', 160], ['email', 'string', 254], ['phone', 'string', 32], ['stage', 'string', 80], ['interview_json', 'json', 16000], ['onboarding_json', 'json', 16000]], ['opening_id', 'name']);
    core('Performance', [['cycle_id', 'string', 128], ['employee_id', 'string', 64], ['cycle_name', 'string', 160], ['goals_json', 'json', 30000], ['review_json', 'json', 30000], ['reviewer_employee_id', 'string', 64]], ['employee_id', 'cycle_name']);
    core('Exit_Records', [['employee_id', 'string', 64], ['resignation_date', 'date'], ['last_working_date', 'date'], ['reason', 'string', 4000], ['clearance_json', 'json', 30000], ['settlement_json', 'json', 30000], ['approval_id', 'string', 128]], ['employee_id']);
    core('Documents', [['employee_id', 'string', 64], ['category', 'string', 100], ['document_number', 'string', 100], ['version', 'integer'], ['template_id', 'string', 128], ['file_id', 'string', 256], ['watermark', 'string', 40], ['approval_id', 'string', 128]], ['employee_id', 'category', 'document_number', 'file_id']);
    core('Doc_Templates', [['name', 'string', 160], ['category', 'string', 100], ['google_doc_id', 'string', 256], ['placeholders_json', 'json', 16000], ['sensitive', 'boolean'], ['signatory_employee_id', 'string', 64]], ['name', 'category', 'google_doc_id']);
    core('Notifications', [['employee_id', 'string', 64], ['notification_type', 'string', 100], ['title', 'string', 300], ['body', 'string', 4000], ['read_at', 'datetime'], ['action_url', 'string', 500]], ['employee_id', 'title']);
    core('Audit_Logs', [['event_type', 'string', 120], ['actor_id', 'string', 64], ['target_entity', 'string', 100], ['target_id', 'string', 128], ['outcome', 'string', 40], ['req_id', 'string', 128], ['device_hash', 'string', 128], ['details_json', 'json', 30000]], ['event_type', 'actor_id', 'outcome']);
    core('Company_Settings', [['setting_key', 'string', 160], ['setting_value', 'string', 30000], ['category', 'string', 100], ['description', 'string', 1000]], ['setting_key', 'category']);
    core('Backup_Logs', [['backup_type', 'string', 60], ['file_id', 'string', 256], ['row_counts_json', 'json', 16000], ['integrity_result', 'string', 1000], ['restored_from_id', 'string', 256]], ['backup_type']);
    core('Consent_Log', [['employee_id', 'string', 64], ['consent_type', 'string', 60], ['consent_version', 'string', 40], ['consented_at', 'datetime'], ['withdrawn_at', 'datetime']], ['employee_id', 'consent_type', 'consent_version', 'consented_at']);
    core('Integration_Log', [['integration', 'string', 60], ['operation', 'string', 100], ['source_file_name', 'string', 300], ['records_received', 'integer'], ['records_accepted', 'integer'], ['errors_json', 'json', 30000]], ['integration', 'operation']);
    core('API_Requests', [['req_id', 'string', 128], ['action', 'string', 160], ['actor_id', 'string', 64], ['response_json', 'json', 40000], ['completed_at', 'datetime'], ['expires_at', 'datetime']], ['req_id', 'action']);

    attendance('Attendance', [['employee_id', 'string', 64], ['attendance_date', 'date'], ['shift_id', 'string', 128], ['check_in_at', 'datetime'], ['check_out_at', 'datetime'], ['work_minutes', 'integer'], ['inside_geofence', 'boolean'], ['distance_meters', 'number'], ['accuracy_meters', 'number'], ['raw_latitude', 'number'], ['raw_longitude', 'number'], ['selfie_file_id', 'string', 256], ['flags_json', 'json', 16000], ['marked_by', 'string', 64], ['lock_id', 'string', 128]], ['employee_id', 'attendance_date']);
    attendance('Attendance_Regularization', [['employee_id', 'string', 64], ['attendance_date', 'date'], ['requested_check_in_at', 'datetime'], ['requested_check_out_at', 'datetime'], ['reason', 'string', 4000], ['approval_id', 'string', 128], ['month_lock_id', 'string', 128]], ['employee_id', 'attendance_date', 'reason']);
    return schemas;
  }

  function makeSchema(file, columns, required) {
    var fields = {};
    COMMON.concat(columns).forEach(function (column) {
      fields[column[0]] = { type: column[1] || 'string', max: column[2] || (column[1] === 'json' ? 30000 : 1000) };
    });
    return { file: file, fields: fields, required: required || [], headers: Object.keys(fields) };
  }

  function getSchema(tabName) {
    var schema = SCHEMAS[tabName];
    if (!schema) Utils.fail('SERVER', 'Unknown database schema.');
    return schema;
  }

  function getCoreSpreadsheet() {
    var id = PropertiesService.getScriptProperties().getProperty('HRMS_CORE_DB_ID');
    if (!id) Utils.fail('SERVER', 'The core database is not configured. Run setupSystem().');
    return SpreadsheetApp.openById(id);
  }

  function getAttendanceSpreadsheet(year) {
    var targetYear = Number(year || new Date().getFullYear());
    if (!/^\d{4}$/.test(String(targetYear))) Utils.fail('VALIDATION', 'Attendance year is invalid.');
    var key = 'HRMS_ATTENDANCE_' + targetYear + '_ID';
    var properties = PropertiesService.getScriptProperties();
    var id = properties.getProperty(key);
    if (!id && typeof ensureAttendanceYear === 'function') {
      ensureAttendanceYear(targetYear);
      id = properties.getProperty(key);
    }
    if (!id) Utils.fail('NOT_FOUND', 'The attendance database for ' + targetYear + ' is not configured.');
    return SpreadsheetApp.openById(id);
  }

  function getSheet(tabName, year) {
    var schema = getSchema(tabName);
    var spreadsheet = schema.file === 'ATTENDANCE' ? getAttendanceSpreadsheet(year) : getCoreSpreadsheet();
    var sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) Utils.fail('SERVER', 'The database tab is missing: ' + tabName + '. Run setupSystem() to migrate.');
    return sheet;
  }

  function normalizeCell(value, type) {
    if (Object.prototype.toString.call(value) === '[object Date]') {
      if (type === 'date') return Utilities.formatDate(value, 'UTC', 'yyyy-MM-dd');
      return value.toISOString();
    }
    return value;
  }

  function getAll(tabName, options) {
    options = options || {};
    var schema = getSchema(tabName);
    var sheet = getSheet(tabName, options.year);
    var lastRow = sheet.getLastRow();
    var lastColumn = sheet.getLastColumn();
    if (lastRow < 2 || lastColumn < 1) return [];
    var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
    var headers = values[0];
    var records = [];
    for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
      if (values[rowIndex].every(function (cell) { return cell === ''; })) continue;
      var record = {};
      for (var columnIndex = 0; columnIndex < headers.length; columnIndex++) {
        var header = headers[columnIndex];
        if (!header) continue;
        var type = schema.fields[header] ? schema.fields[header].type : 'string';
        record[header] = normalizeCell(values[rowIndex][columnIndex], type);
      }
      if (!options.includeDeleted && String(record.status).toUpperCase() === 'DELETED') continue;
      records.push(record);
    }
    return records;
  }

  function getAllCached(tabName) {
    var cache = CacheService.getScriptCache();
    var key = 'HRMS_TABLE_V1_' + tabName;
    var cached = cache.get(key);
    if (cached) {
      try { return JSON.parse(cached); } catch (error) { cache.remove(key); }
    }
    var records = getAll(tabName);
    try {
      var json = JSON.stringify(records);
      if (json.length <= 90000) cache.put(key, json, CACHE_SECONDS);
    } catch (error) {
      // Cache failure never changes the authoritative Sheets result.
    }
    return records;
  }

  function invalidateCache(tabName) {
    CacheService.getScriptCache().remove('HRMS_TABLE_V1_' + tabName);
  }

  function findById(tabName, id, options) {
    options = options || {};
    var records = options.cached ? getAllCached(tabName) : getAll(tabName, options);
    for (var i = 0; i < records.length; i++) {
      if (String(records[i].id) === String(id)) return records[i];
    }
    return null;
  }

  function findOne(tabName, predicate, options) {
    options = options || {};
    var records = options.cached ? getAllCached(tabName) : getAll(tabName, options);
    for (var i = 0; i < records.length; i++) if (predicate(records[i])) return records[i];
    return null;
  }

  function validateRecord(tabName, record, partial) {
    var schema = getSchema(tabName);
    Utils.assertObject(record, 'record');
    Object.keys(record).forEach(function (key) {
      var rule = schema.fields[key];
      if (!rule) Utils.fail('VALIDATION', 'Field ' + key + ' is not allowed in ' + tabName + '.');
      var value = record[key];
      if (value === '' || value === null || value === undefined) return;
      if (rule.type === 'number' && (typeof value !== 'number' || !isFinite(value))) Utils.fail('VALIDATION', key + ' must be a finite number.');
      if (rule.type === 'integer' && (typeof value !== 'number' || !isFinite(value) || Math.floor(value) !== value)) Utils.fail('VALIDATION', key + ' must be an integer.');
      if (rule.type === 'boolean' && typeof value !== 'boolean') Utils.fail('VALIDATION', key + ' must be boolean.');
      if (rule.type === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(String(value))) Utils.fail('VALIDATION', key + ' must be an ISO date.');
      if (rule.type === 'datetime' && !Utils.dateValue(value)) Utils.fail('VALIDATION', key + ' must be an ISO date-time.');
      if (rule.type === 'json') {
        if (typeof value !== 'string') Utils.fail('VALIDATION', key + ' must be serialized JSON.');
        if (!Utils.safeParseJson(value, null)) Utils.fail('VALIDATION', key + ' must contain valid JSON.');
      }
      if ((rule.type === 'string' || rule.type === 'json') && String(value).length > rule.max) Utils.fail('VALIDATION', key + ' exceeds its allowed length.');
    });
    if (!partial) {
      schema.required.forEach(function (key) {
        if (record[key] === '' || record[key] === null || record[key] === undefined) Utils.fail('VALIDATION', key + ' is required in ' + tabName + '.');
      });
    }
  }

  function withLock(callback, timeoutMs) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(timeoutMs || LOCK_TIMEOUT_MS)) {
      Utils.fail('LOCKED', 'Another update is in progress. Retry this request shortly.', { retryAfterSeconds: 5 });
    }
    try { return callback(); } finally { lock.releaseLock(); }
  }

  function insert(tabName, input, actorId, options) {
    options = options || {};
    return withLock(function () {
      var sheet = getSheet(tabName, options.year);
      var now = Utils.nowIso();
      var record = {};
      Object.keys(input || {}).forEach(function (key) { record[key] = input[key]; });
      record.id = record.id || Utils.generateId(tabName);
      record.created_at = record.created_at || now;
      record.updated_at = now;
      record.created_by = record.created_by || actorId || 'SYSTEM';
      record.updated_by = actorId || 'SYSTEM';
      record.status = record.status || 'ACTIVE';
      validateRecord(tabName, record, false);
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var row = headers.map(function (header) { return Utils.sanitizeForSheet(record[header]); });
      var targetRow = sheet.getLastRow() + 1;
      sheet.getRange(targetRow, 1, 1, headers.length).setValues([row]);
      invalidateCache(tabName);
      return record;
    });
  }

  function batchInsert(tabName, inputs, actorId, options) {
    options = options || {};
    if (!inputs.length) return [];
    return withLock(function () {
      var sheet = getSheet(tabName, options.year);
      var now = Utils.nowIso();
      var records = inputs.map(function (input) {
        var record = {};
        Object.keys(input).forEach(function (key) { record[key] = input[key]; });
        record.id = record.id || Utils.generateId(tabName);
        record.created_at = record.created_at || now;
        record.updated_at = now;
        record.created_by = record.created_by || actorId || 'SETUP';
        record.updated_by = actorId || 'SETUP';
        record.status = record.status || 'ACTIVE';
        validateRecord(tabName, record, false);
        return record;
      });
      var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
      var rows = records.map(function (record) {
        return headers.map(function (header) { return Utils.sanitizeForSheet(record[header]); });
      });
      sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
      invalidateCache(tabName);
      return records;
    });
  }

  function update(tabName, id, changes, actorId, options) {
    options = options || {};
    return withLock(function () {
      var sheet = getSheet(tabName, options.year);
      var lastRow = sheet.getLastRow();
      var lastColumn = sheet.getLastColumn();
      if (lastRow < 2) Utils.fail('NOT_FOUND', 'Record not found.');
      var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
      var headers = values[0];
      var idColumn = headers.indexOf('id');
      var targetIndex = -1;
      for (var i = 1; i < values.length; i++) {
        if (String(values[i][idColumn]) === String(id)) { targetIndex = i; break; }
      }
      if (targetIndex < 0) Utils.fail('NOT_FOUND', 'Record not found.');
      ['id', 'created_at', 'created_by'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(changes, key)) Utils.fail('VALIDATION', key + ' is immutable.');
      });
      validateRecord(tabName, changes, true);
      var merged = {};
      headers.forEach(function (header, index) { merged[header] = normalizeCell(values[targetIndex][index], getSchema(tabName).fields[header] ? getSchema(tabName).fields[header].type : 'string'); });
      Object.keys(changes).forEach(function (key) { merged[key] = changes[key]; });
      merged.updated_at = Utils.nowIso();
      merged.updated_by = actorId || 'SYSTEM';
      validateRecord(tabName, merged, false);
      var row = headers.map(function (header) { return Utils.sanitizeForSheet(merged[header]); });
      sheet.getRange(targetIndex + 1, 1, 1, headers.length).setValues([row]);
      invalidateCache(tabName);
      return merged;
    });
  }

  function updateMany(tabName, predicate, changeFactory, actorId, options) {
    options = options || {};
    return withLock(function () {
      var sheet = getSheet(tabName, options.year);
      var lastRow = sheet.getLastRow();
      var lastColumn = sheet.getLastColumn();
      if (lastRow < 2) return [];
      var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
      var headers = values[0];
      var schema = getSchema(tabName);
      var changedRecords = [];
      var now = Utils.nowIso();
      for (var rowIndex = 1; rowIndex < values.length; rowIndex++) {
        var current = {};
        headers.forEach(function (header, index) {
          current[header] = normalizeCell(values[rowIndex][index], schema.fields[header] ? schema.fields[header].type : 'string');
        });
        if (!predicate(current)) continue;
        var changes = typeof changeFactory === 'function' ? changeFactory(current) : changeFactory;
        ['id', 'created_at', 'created_by'].forEach(function (key) {
          if (changes && Object.prototype.hasOwnProperty.call(changes, key)) Utils.fail('VALIDATION', key + ' is immutable.');
        });
        validateRecord(tabName, changes || {}, true);
        Object.keys(changes || {}).forEach(function (key) { current[key] = changes[key]; });
        current.updated_at = now;
        current.updated_by = actorId || 'SYSTEM';
        validateRecord(tabName, current, false);
        values[rowIndex] = headers.map(function (header) { return Utils.sanitizeForSheet(current[header]); });
        changedRecords.push(current);
      }
      if (changedRecords.length) {
        sheet.getRange(1, 1, lastRow, lastColumn).setValues(values);
        invalidateCache(tabName);
      }
      return changedRecords;
    });
  }

  function softDelete(tabName, id, actorId, options) {
    return update(tabName, id, { status: 'DELETED' }, actorId, options);
  }

  function getSettingsMap() {
    var settings = {};
    getAllCached('Company_Settings').forEach(function (row) {
      if (String(row.status).toUpperCase() === 'ACTIVE') settings[row.setting_key] = row.setting_value;
    });
    return settings;
  }

  function getSetting(key, fallback) {
    var settings = getSettingsMap();
    return Object.prototype.hasOwnProperty.call(settings, key) && settings[key] !== '' ? settings[key] : fallback;
  }

  return {
    SCHEMAS: SCHEMAS,
    getSchema: getSchema,
    getCoreSpreadsheet: getCoreSpreadsheet,
    getAttendanceSpreadsheet: getAttendanceSpreadsheet,
    getSheet: getSheet,
    getAll: getAll,
    getAllCached: getAllCached,
    invalidateCache: invalidateCache,
    findById: findById,
    findOne: findOne,
    validateRecord: validateRecord,
    withLock: withLock,
    insert: insert,
    batchInsert: batchInsert,
    update: update,
    updateMany: updateMany,
    softDelete: softDelete,
    getSettingsMap: getSettingsMap,
    getSetting: getSetting
  };
})();
