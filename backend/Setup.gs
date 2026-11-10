/**
 * Idempotent owner-run bootstrap. No account is created unless the owner first
 * supplies SETUP_ADMIN_EMP_ID and SETUP_ADMIN_PASSWORD in Script Properties.
 */
var HRMS_SCHEMA_VERSION = '1';

function setupSystem() {
  Utils.ensureServerPepper();
  var properties = PropertiesService.getScriptProperties();
  var core = ensureCoreDatabase();
  ensureWorkbookSchemas(core, 'CORE');
  ensureAttendanceYear(new Date().getFullYear());
  var root = ensureDriveTree();
  seedPermissionsCatalog(core);
  seedSuperAdminRole(core);
  seedSystemSettings(core);
  bootstrapFirstAdmin(core);
  ensureFoundationTrigger();
  Database.invalidateCache('Company_Settings');
  return {
    schemaVersion: HRMS_SCHEMA_VERSION,
    coreTabs: Object.keys(Database.SCHEMAS).filter(function (key) { return Database.SCHEMAS[key].file === 'CORE'; }).length,
    privateStorageReady: Boolean(root),
    ready: true
  };
}

function ensureCoreDatabase() {
  var properties = PropertiesService.getScriptProperties();
  var id = properties.getProperty('HRMS_CORE_DB_ID');
  if (id) return SpreadsheetApp.openById(id);
  var spreadsheet = SpreadsheetApp.create('FOCUSON_HRMS_CORE_DB');
  properties.setProperty('HRMS_CORE_DB_ID', spreadsheet.getId());
  return spreadsheet;
}

function ensureAttendanceYear(year) {
  var numericYear = Number(year);
  if (!isFinite(numericYear) || numericYear < 2000 || numericYear > 2200) Utils.fail('VALIDATION', 'Attendance year is invalid.');
  var properties = PropertiesService.getScriptProperties();
  var key = 'HRMS_ATTENDANCE_' + numericYear + '_ID';
  var id = properties.getProperty(key);
  var spreadsheet = id ? SpreadsheetApp.openById(id) : null;
  if (!spreadsheet) {
    spreadsheet = SpreadsheetApp.create('FOCUSON_HRMS_ATTENDANCE_' + numericYear);
    properties.setProperty(key, spreadsheet.getId());
  }
  ensureWorkbookSchemas(spreadsheet, 'ATTENDANCE');
  return spreadsheet;
}

function ensureWorkbookSchemas(spreadsheet, fileType) {
  var names = Object.keys(Database.SCHEMAS).filter(function (name) { return Database.SCHEMAS[name].file === fileType; });
  names.forEach(function (name) {
    var schema = Database.getSchema(name);
    var sheet = spreadsheet.getSheetByName(name);
    if (!sheet) sheet = spreadsheet.insertSheet(name);
    var existingHeaders = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].filter(String) : [];
    var missing = schema.headers.filter(function (header) { return existingHeaders.indexOf(header) < 0; });
    if (missing.length) {
      var startColumn = sheet.getLastColumn() + 1;
      sheet.getRange(1, startColumn, 1, missing.length).setValues([missing]);
    }
    sheet.setFrozenRows(1);
    var finalColumns = sheet.getLastColumn();
    sheet.getRange(1, 1, 1, finalColumns).setFontWeight('bold').setBackground('#e9eeff').setFontColor('#172033');
    sheet.getRange(1, 1, Math.max(sheet.getLastRow(), 2), finalColumns).setVerticalAlignment('top');
    protectSheet(sheet);
  });
  var defaultSheet = spreadsheet.getSheetByName('Sheet1');
  if (defaultSheet && spreadsheet.getSheets().length > 1 && defaultSheet.getLastRow() === 0) spreadsheet.deleteSheet(defaultSheet);
}

function protectSheet(sheet) {
  var description = 'FOCUSON HRMS application-managed tab';
  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.SHEET);
  for (var i = 0; i < protections.length; i++) {
    if (protections[i].getDescription() === description) return;
  }
  var protection = sheet.protect().setDescription(description);
  protection.setWarningOnly(false);
  var editors = protection.getEditors();
  if (editors.length) {
    try { protection.removeEditors(editors); } catch (error) {
      // The owner cannot be removed; all other removable editors are removed.
    }
  }
}

function ensureDriveTree() {
  var properties = PropertiesService.getScriptProperties();
  var rootId = properties.getProperty('HRMS_ROOT_FOLDER_ID');
  var root = rootId ? DriveApp.getFolderById(rootId) : DriveApp.createFolder('FOCUSON_HRMS_PRIVATE_STORAGE');
  if (!rootId) properties.setProperty('HRMS_ROOT_FOLDER_ID', root.getId());
  ['Documents', 'Selfies', 'Receipts', 'Generated', 'Backups', 'Templates'].forEach(function (name) {
    var key = 'HRMS_FOLDER_' + name.toUpperCase() + '_ID';
    var id = properties.getProperty(key);
    var folder = id ? DriveApp.getFolderById(id) : null;
    if (!folder) {
      var matches = root.getFoldersByName(name);
      folder = matches.hasNext() ? matches.next() : root.createFolder(name);
      properties.setProperty(key, folder.getId());
    }
  });
  return root;
}

function permissionCatalog() {
  return [
    ['employee.view', 'Employees', 'View', 'View employee profiles within the assigned scope.', false],
    ['employee.create', 'Employees', 'Create', 'Create employee master records.', false],
    ['employee.edit', 'Employees', 'Edit', 'Edit non-sensitive employee master fields.', false],
    ['employee.delete', 'Employees', 'Delete', 'Soft-delete or deactivate employee records.', true],
    ['employee.export', 'Employees', 'Export', 'Export employee data within the assigned scope.', true],
    ['field.salary.view', 'Sensitive fields', 'View', 'View salary fields.', true],
    ['field.salary.edit', 'Sensitive fields', 'Edit', 'Edit salary fields.', true],
    ['field.bank.view', 'Sensitive fields', 'View', 'View bank fields.', true],
    ['field.bank.edit', 'Sensitive fields', 'Edit', 'Edit bank fields.', true],
    ['field.govtid.view', 'Sensitive fields', 'View', 'View government identifiers.', true],
    ['field.medical.view', 'Sensitive fields', 'View', 'View medical fields.', true],
    ['org.view', 'Organization', 'View', 'View organization setup.', false],
    ['org.create', 'Organization', 'Create', 'Create organization records.', false],
    ['org.edit', 'Organization', 'Edit', 'Edit organization records.', false],
    ['org.delete', 'Organization', 'Delete', 'Soft-delete organization records.', true],
    ['attendance.markself', 'Attendance', 'Create', 'Mark own check-in and check-out.', false],
    ['attendance.markothers', 'Attendance', 'Create', 'Mark attendance for employees within scope.', true],
    ['attendance.view', 'Attendance', 'View', 'View attendance within scope.', false],
    ['attendance.correct', 'Attendance', 'Edit', 'Correct attendance before lock.', true],
    ['attendance.regularize.approve', 'Attendance', 'Approve', 'Approve attendance regularization.', false],
    ['attendance.lock', 'Attendance', 'Edit', 'Lock attendance for payroll.', true],
    ['attendance.export', 'Attendance', 'Export', 'Export attendance records.', true],
    ['attendance.policy.manage', 'Attendance', 'Edit', 'Manage attendance policies and shifts.', true],
    ['geofence.manage', 'Attendance', 'Edit', 'Manage office geofence locations.', true],
    ['selfie.view', 'Attendance', 'View', 'View attendance selfies.', true],
    ['leave.apply', 'Leave', 'Create', 'Apply for own leave.', false],
    ['leave.view', 'Leave', 'View', 'View leave within scope.', false],
    ['leave.approve', 'Leave', 'Approve', 'Approve leave through workflow.', false],
    ['leave.manage', 'Leave', 'Edit', 'Manage leave types, balances and accrual.', true],
    ['leave.export', 'Leave', 'Export', 'Export leave reports.', true],
    ['calendar.view', 'Calendar', 'View', 'View holiday and availability calendars.', false],
    ['calendar.manage', 'Calendar', 'Edit', 'Manage holidays and calendar entries.', false],
    ['salary.view', 'Payroll', 'View', 'View salary structures within scope.', true],
    ['salary.create', 'Payroll', 'Create', 'Create salary structures.', true],
    ['salary.edit', 'Payroll', 'Edit', 'Edit salary structures.', true],
    ['salary.revise', 'Payroll', 'Approve', 'Create salary revisions and arrears.', true],
    ['payroll.prepare', 'Payroll', 'Create', 'Prepare monthly payroll runs.', true],
    ['payroll.verify', 'Payroll', 'Verify', 'Verify payroll prepared by another user.', true],
    ['payroll.approve', 'Payroll', 'Approve', 'Approve verified payroll.', true],
    ['payroll.release', 'Payroll', 'Release', 'Release approved payslips.', true],
    ['payroll.reopen', 'Payroll', 'Edit', 'Reopen payroll with a mandatory reason.', true],
    ['payroll.view', 'Payroll', 'View', 'View payroll registers.', true],
    ['payslip.view', 'Payroll', 'View', 'View payslips within scope.', true],
    ['payroll.statutory.export', 'Payroll', 'Export', 'Export PF, ESI, PT and related data.', true],
    ['payroll.ff.manage', 'Payroll', 'Edit', 'Prepare full and final settlement.', true],
    ['advance.apply', 'Money', 'Create', 'Request an advance or loan.', false],
    ['advance.view', 'Money', 'View', 'View advances and loans within scope.', false],
    ['advance.approve', 'Money', 'Approve', 'Approve advances and loans.', true],
    ['advance.disburse', 'Money', 'Edit', 'Record advance and loan disbursement.', true],
    ['expense.apply', 'Money', 'Create', 'Submit expense claims.', false],
    ['expense.view', 'Money', 'View', 'View expenses within scope.', false],
    ['expense.approve', 'Money', 'Approve', 'Approve expense claims.', true],
    ['document.view', 'Documents', 'View', 'View documents within scope.', false],
    ['document.generate', 'Documents', 'Create', 'Generate approved document types.', false],
    ['document.template.manage', 'Documents', 'Edit', 'Manage document templates.', true],
    ['document.hiring.view', 'Documents', 'View', 'View hiring documents.', false],
    ['document.employment.view', 'Documents', 'View', 'View employment documents.', false],
    ['document.exit.view', 'Documents', 'View', 'View exit documents.', true],
    ['document.disciplinary.view', 'Documents', 'View', 'View disciplinary documents.', true],
    ['document.certificates.view', 'Documents', 'View', 'View certificates.', false],
    ['document.payroll.view', 'Documents', 'View', 'View payroll documents.', true],
    ['document.attendance.view', 'Documents', 'View', 'View attendance documents.', false],
    ['document.finance.view', 'Documents', 'View', 'View finance documents.', true],
    ['recruitment.view', 'Recruitment', 'View', 'View openings and candidates.', false],
    ['recruitment.create', 'Recruitment', 'Create', 'Create openings and candidates.', false],
    ['recruitment.edit', 'Recruitment', 'Edit', 'Edit recruitment records and schedule interviews.', false],
    ['recruitment.approve', 'Recruitment', 'Approve', 'Approve hiring and offers.', true],
    ['performance.view', 'Performance', 'View', 'View performance cycles and reviews within scope.', false],
    ['performance.create', 'Performance', 'Create', 'Create performance cycles and goals.', false],
    ['performance.edit', 'Performance', 'Edit', 'Edit goals and reviews.', false],
    ['performance.approve', 'Performance', 'Approve', 'Approve performance reviews.', false],
    ['exit.view', 'Exit', 'View', 'View exit records within scope.', true],
    ['exit.create', 'Exit', 'Create', 'Create resignation and exit records.', false],
    ['exit.edit', 'Exit', 'Edit', 'Manage clearances and exit processing.', true],
    ['exit.approve', 'Exit', 'Approve', 'Approve exit and settlement.', true],
    ['workflow.inbox', 'Workflow', 'View', 'View the unified approval inbox.', false],
    ['workflow.delegate', 'Workflow', 'Edit', 'Delegate approvals during absence.', false],
    ['workflow.override', 'Workflow', 'Approve', 'Override workflow with mandatory audit reason.', true],
    ['workflow.define', 'Workflow', 'Edit', 'Define and version workflows.', true],
    ['report.attendance.view', 'Reports', 'View', 'View attendance and muster reports.', false],
    ['report.attendance.export', 'Reports', 'Export', 'Export attendance and muster reports.', true],
    ['report.payroll.view', 'Reports', 'View', 'View payroll reports.', true],
    ['report.payroll.export', 'Reports', 'Export', 'Export payroll reports.', true],
    ['report.leave.view', 'Reports', 'View', 'View leave reports.', false],
    ['report.leave.export', 'Reports', 'Export', 'Export leave reports.', true],
    ['report.headcount.view', 'Reports', 'View', 'View headcount and attrition reports.', false],
    ['report.headcount.export', 'Reports', 'Export', 'Export headcount and attrition reports.', true],
    ['user.view', 'Access', 'View', 'View login users and effective access.', true],
    ['user.create', 'Access', 'Create', 'Create user accounts.', true],
    ['user.resetpassword', 'Access', 'Edit', 'Reset user passwords with forced change.', true],
    ['role.define', 'Access', 'Create', 'Create, clone and edit roles.', true],
    ['role.assign', 'Access', 'Edit', 'Assign roles within authority.', true],
    ['override.grant', 'Access', 'Edit', 'Grant ALLOW or DENY overrides with reason and expiry.', true],
    ['authority.delegate', 'Access', 'Edit', 'Create bounded authority profiles.', true],
    ['accesslog.view', 'Access', 'View', 'View audit logs and access reviews.', true],
    ['settings.view', 'System', 'View', 'View company and system settings.', true],
    ['settings.edit', 'System', 'Edit', 'Edit company settings and feature switches.', true],
    ['backup.create', 'System', 'Create', 'Create verified backups.', true],
    ['backup.restore', 'System', 'Edit', 'Restore from backup after a safety copy.', true],
    ['announcement.view', 'System', 'View', 'View announcements.', false],
    ['announcement.manage', 'System', 'Edit', 'Publish announcements.', false]
  ];
}

function seedPermissionsCatalog(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Permissions_Catalog');
  var existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues() : [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyColumn = headers.indexOf('permission_key');
  var known = {};
  existing.forEach(function (row) { known[row[keyColumn]] = true; });
  var now = Utils.nowIso();
  var rows = permissionCatalog().filter(function (item) { return !known[item[0]]; }).map(function (item) {
    var record = {
      id: 'perm_' + item[0].replace(/[^a-z0-9]+/gi, '_'), permission_key: item[0], module: item[1], action: item[2],
      description: item[3], sensitive: item[4], created_at: now, updated_at: now, created_by: 'SETUP', updated_by: 'SETUP', status: 'ACTIVE'
    };
    return headers.map(function (header) { return Utils.sanitizeForSheet(record[header]); });
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  Database.invalidateCache('Permissions_Catalog');
}

function seedSuperAdminRole(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Roles');
  var rows = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues() : [];
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var codeColumn = headers.indexOf('role_code');
  var exists = rows.some(function (row) { return row[codeColumn] === 'SUPER_ADMIN'; });
  if (exists) return;
  var now = Utils.nowIso();
  var record = {
    id: 'role_super_admin', role_code: 'SUPER_ADMIN', name: 'Super Admin',
    description: 'Built-in system owner role.', scope_type: 'Company', conditions_json: '{}', built_in: true,
    created_at: now, updated_at: now, created_by: 'SETUP', updated_by: 'SETUP', status: 'ACTIVE'
  };
  sheet.getRange(sheet.getLastRow() + 1, 1, 1, headers.length).setValues([headers.map(function (header) { return Utils.sanitizeForSheet(record[header]); })]);
  Database.invalidateCache('Roles');
}

function systemSettingKeys() {
  return [
    'SCHEMA_VERSION', 'COMPANY_NAME', 'COMPANY_TAGLINE', 'COMPANY_LOGO_URL', 'LOGIN_NOTICE', 'PUBLIC_FEATURE_HIGHLIGHTS',
    'DEFAULT_LANGUAGE', 'DEFAULT_THEME', 'BRAND_PRIMARY_COLOR', 'BRAND_ACCENT_COLOR', 'BRAND_CORNER_RADIUS',
    'BRAND_CARD_STYLE', 'BRAND_DENSITY', 'BRAND_FONT', 'LOGIN_BACKGROUND_TYPE', 'LOGIN_BACKGROUND_PRESET',
    'LOGIN_BACKGROUND_OVERLAY_OPACITY', 'LOGIN_BACKGROUND_BLUR', 'SESSION_IDLE_MINUTES', 'SESSION_ABSOLUTE_HOURS',
    'LOGIN_MAX_FAILED_ATTEMPTS', 'LOGIN_LOCK_MINUTES', 'LOGIN_GLOBAL_MAX_PER_MINUTE', 'PASSWORD_MIN_LENGTH',
    'PASSWORD_REQUIRE_COMPLEXITY', 'MAX_SUPER_ADMINS', 'SELFIE_RETENTION_DAYS', 'RAW_GPS_RETENTION_DAYS',
    'PF_SETTINGS', 'ESI_SETTINGS', 'PROFESSIONAL_TAX_SETTINGS', 'TDS_SETTINGS', 'BONUS_SETTINGS', 'GRATUITY_SETTINGS',
    'WAGE_DEFINITION_SETTINGS', 'PAYROLL_CA_VERIFIED'
  ];
}

function seedSystemSettings(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Company_Settings');
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var keyColumn = headers.indexOf('setting_key');
  var existing = sheet.getLastRow() > 1 ? sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues() : [];
  var known = {};
  existing.forEach(function (row) { known[row[keyColumn]] = true; });
  var now = Utils.nowIso();
  var rows = systemSettingKeys().filter(function (key) { return !known[key]; }).map(function (key) {
    var record = {
      id: 'setting_' + key.toLowerCase(), setting_key: key, setting_value: key === 'SCHEMA_VERSION' ? HRMS_SCHEMA_VERSION : '',
      category: key.indexOf('PF_') === 0 || key.indexOf('ESI_') === 0 || key.indexOf('TDS_') === 0 ? 'STATUTORY' : 'SYSTEM',
      description: '', created_at: now, updated_at: now, created_by: 'SETUP', updated_by: 'SETUP', status: 'ACTIVE'
    };
    return headers.map(function (header) { return Utils.sanitizeForSheet(record[header]); });
  });
  if (rows.length) sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  Database.invalidateCache('Company_Settings');
}

function bootstrapFirstAdmin(spreadsheet) {
  var properties = PropertiesService.getScriptProperties();
  var employeeIdProperty = properties.getProperty('SETUP_ADMIN_EMP_ID');
  var temporaryPassword = properties.getProperty('SETUP_ADMIN_PASSWORD');
  var users = Database.getAll('Users', { includeDeleted: true });
  if (users.length && !employeeIdProperty) return;
  if (!employeeIdProperty || !temporaryPassword) {
    Utils.fail('VALIDATION', 'Before first setup, set SETUP_ADMIN_EMP_ID and SETUP_ADMIN_PASSWORD in Script Properties.');
  }
  var employeeId = Utils.normalizeEmployeeId(employeeIdProperty);
  if (temporaryPassword.length < 12 || temporaryPassword.length > 128 || !(/[a-z]/.test(temporaryPassword) && /[A-Z]/.test(temporaryPassword) && /[0-9]/.test(temporaryPassword) && /[^A-Za-z0-9]/.test(temporaryPassword))) {
    Utils.fail('VALIDATION', 'The one-time setup password must be 12–128 characters and include uppercase, lowercase, number and symbol.');
  }

  var displayName = (properties.getProperty('SETUP_ADMIN_NAME') || employeeId).trim().slice(0, 160);
  var now = Utils.nowIso();
  var user = null;
  users.forEach(function (row) { if (row.employee_id === employeeId) user = row; });
  if (!user) {
    var salt = Utils.generateSalt();
    var iterations = Utils.configuredHashIterations();
    user = Database.insert('Users', {
      employee_id: employeeId,
      password_hash: Utils.hashPassword(temporaryPassword, salt, iterations),
      password_salt: salt,
      password_iterations: iterations,
      must_change_password: true,
      password_changed_at: now,
      language: 'en', theme: 'light', simple_mode: false
    }, 'SETUP');
  }
  var employee = Database.findOne('Employees', function (row) { return String(row.employee_id || row.id) === employeeId; }, { includeDeleted: true });
  if (!employee) {
    Database.insert('Employees', {
      id: employeeId, employee_id: employeeId, display_name: displayName,
      first_name: displayName, last_name: '', work_location_type: 'UNASSIGNED'
    }, 'SETUP');
  }
  var mapping = Database.findOne('User_Role_Map', function (row) {
    return row.employee_id === employeeId && row.role_id === 'role_super_admin' && String(row.status).toUpperCase() === 'ACTIVE';
  }, { includeDeleted: true });
  if (!mapping) {
    Database.insert('User_Role_Map', {
      employee_id: employeeId, role_id: 'role_super_admin', valid_from: now,
      assigned_by: 'SETUP', reason: 'Initial owner bootstrap'
    }, 'SETUP');
  }
  Database.invalidateCache('User_Role_Map');
  Audit.logEvent('FIRST_ADMIN_CREATED', 'SETUP', 'Users', user.id, 'SUCCESS', { forcedPasswordChange: true }, {});
  properties.deleteProperty('SETUP_ADMIN_EMP_ID');
  properties.deleteProperty('SETUP_ADMIN_PASSWORD');
  properties.deleteProperty('SETUP_ADMIN_NAME');
}

function ensureFoundationTrigger() {
  var functionName = 'runDailyFoundationMaintenance';
  var triggers = ScriptApp.getProjectTriggers();
  var exists = triggers.some(function (trigger) { return trigger.getHandlerFunction() === functionName; });
  if (!exists) ScriptApp.newTrigger(functionName).timeBased().everyDays(1).atHour(2).create();
}

function runDailyFoundationMaintenance() {
  ensureAttendanceYear(new Date().getFullYear());
  var cleaned = Auth.cleanupExpiredSessions();
  Audit.logEvent('FOUNDATION_MAINTENANCE', 'SYSTEM', 'Sessions', '', 'SUCCESS', { expiredOrPurged: cleaned }, {});
}
