/**
 * FOCUSON HRMS - Bootstrap & Initialization Engine (Google Apps Script)
 * One-time idempotent system setup: Google Sheets schemas, Drive folder tree,
 * Permissions Catalog, built-in Super Admin role, and initial Super Admin bootstrap.
 */

function setupSystem() {
  var props = PropertiesService.getScriptProperties();

  // 1. Initialize Server Pepper if missing
  var pepper = props.getProperty('AUTH_PEPPER');
  if (!pepper) {
    pepper = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('AUTH_PEPPER', pepper);
  }

  // 2. Create or bind HRMS_CORE_DB
  var coreDbId = props.getProperty('HRMS_CORE_DB_ID');
  var coreSs = null;
  if (coreDbId) {
    try {
      coreSs = SpreadsheetApp.openById(coreDbId);
    } catch (e) {
      coreSs = null;
    }
  }
  if (!coreSs) {
    coreSs = SpreadsheetApp.create('FOCUSON_HRMS_CORE_DB');
    props.setProperty('HRMS_CORE_DB_ID', coreSs.getId());
  }

  // 3. Create or bind HRMS_ATTENDANCE_<YEAR>
  var currentYear = new Date().getFullYear();
  var attKey = 'HRMS_ATTENDANCE_' + currentYear + '_ID';
  var attDbId = props.getProperty(attKey);
  var attSs = null;
  if (attDbId) {
    try {
      attSs = SpreadsheetApp.openById(attDbId);
    } catch (e) {
      attSs = null;
    }
  }
  if (!attSs) {
    attSs = SpreadsheetApp.create('FOCUSON_HRMS_ATTENDANCE_' + currentYear);
    props.setProperty(attKey, attSs.getId());
  }

  // 4. Create Private Drive Folder Hierarchy
  var rootFolderId = props.getProperty('HRMS_ROOT_FOLDER_ID');
  var rootFolder = null;
  if (rootFolderId) {
    try {
      rootFolder = DriveApp.getFolderById(rootFolderId);
    } catch (e) {
      rootFolder = null;
    }
  }
  if (!rootFolder) {
    rootFolder = DriveApp.createFolder('FOCUSON_HRMS_PRIVATE_STORAGE');
    props.setProperty('HRMS_ROOT_FOLDER_ID', rootFolder.getId());
  }

  var folderNames = ['Documents', 'Selfies', 'Receipts', 'Generated', 'Backups', 'Templates'];
  for (var f = 0; f < folderNames.length; f++) {
    var fName = folderNames[f];
    var existingSub = rootFolder.getFoldersByName(fName);
    var subFolder = null;
    if (existingSub.hasNext()) {
      subFolder = existingSub.next();
    } else {
      subFolder = rootFolder.createFolder(fName);
    }
    props.setProperty('HRMS_FOLDER_' + fName.toUpperCase() + '_ID', subFolder.getId());
  }

  // 5. Tab Schemas for Core Database
  var coreSchemas = {
    'Users': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'password_hash', 'password_salt', 'is_super_admin', 'must_change_password', 'password_updated_at'],
    'Employees': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'first_name', 'last_name', 'email', 'phone', 'department_id', 'department', 'designation_id', 'designation', 'branch_id', 'branch', 'reporting_manager_id', 'work_location_type', 'attendance_policy_id', 'date_of_joining', 'date_of_birth', 'gender', 'emergency_contact', 'blood_group', 'pan_number', 'aadhaar_number', 'pf_uan', 'bank_account_number', 'bank_ifsc', 'bank_name', 'basic_salary', 'gross_salary', 'ctc_annual'],
    'Departments': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'head_employee_id'],
    'Designations': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'title', 'level'],
    'Branches': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'address', 'city', 'state'],
    'Roles': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'description', 'is_built_in'],
    'Permissions_Catalog': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'permission_key', 'module', 'action', 'description', 'is_sensitive'],
    'Role_Permissions': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'role_id', 'permission_key', 'scope', 'condition_json'],
    'User_Role_Map': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'role_id'],
    'User_Permission_Overrides': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'permission_key', 'effect', 'reason', 'expiry_date'],
    'Delegations': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'authorizer_employee_id', 'delegate_employee_id', 'permissions_csv', 'scope', 'start_date', 'end_date', 'reason'],
    'Feature_Flags': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'feature_key', 'name', 'enabled', 'description'],
    'Sessions': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'token_hash', 'expires_at', 'last_seen_at', 'user_agent_hash', 'ip_hash'],
    'Workflow_Definitions': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'request_type', 'version', 'name', 'is_active'],
    'Workflow_Steps': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'workflow_id', 'step_order', 'approver_type', 'approver_value', 'condition_json', 'sla_hours'],
    'Approvals': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'request_type', 'request_id', 'applicant_id', 'current_step_id', 'current_approver_id', 'overall_status'],
    'Approval_Actions': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'approval_id', 'step_id', 'action', 'actor_id', 'comments'],
    'Attendance_Policies': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'name', 'code', 'requires_geofence', 'requires_selfie', 'grace_minutes', 'half_day_hours', 'full_day_hours'],
    'Geofence_Locations': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'branch_id', 'name', 'latitude', 'longitude', 'radius_meters', 'min_accuracy_meters'],
    'Shifts': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'name', 'code', 'start_time', 'end_time'],
    'Leave_Types': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'annual_quota', 'is_carry_forward', 'max_carry_forward', 'is_paid'],
    'Leave_Applications': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'leave_type_code', 'start_date', 'end_date', 'total_days', 'is_half_day', 'reason'],
    'Leave_Balances': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'leave_type_code', 'year', 'opening', 'accrued', 'consumed', 'balance'],
    'Holidays': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'holiday_date', 'name', 'is_restricted'],
    'Sites': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'client_name', 'city'],
    'Employee_Site_Assignment': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'site_id', 'start_date', 'end_date'],
    'Salary_Structure': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'effective_from', 'monthly_gross', 'annual_ctc'],
    'Salary_Components': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'name', 'type', 'formula_type', 'is_taxable', 'is_statutory'],
    'Salary_Revisions': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'effective_date', 'previous_gross', 'revised_gross', 'reason'],
    'Loans_Advances': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'type', 'principal_amount', 'monthly_emi', 'balance_amount'],
    'Payroll_Runs': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'month_year', 'prepared_by', 'prepared_at', 'verified_by', 'verified_at', 'approved_by', 'approved_at', 'released_by', 'released_at', 'run_state'],
    'Payroll': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'payroll_run_id', 'employee_id', 'paid_days', 'lop_days', 'gross_earnings', 'total_deductions', 'net_payable'],
    'Payslips': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'payroll_id', 'employee_id', 'month_year', 'drive_file_id', 'viewed_at'],
    'Expenses': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'category', 'amount', 'expense_date', 'description', 'receipt_file_id'],
    'Recruitment': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'opening_title', 'department_id', 'open_positions', 'target_date'],
    'Candidates': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'opening_id', 'name', 'email', 'phone', 'stage', 'resume_file_id'],
    'Performance': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'cycle_name', 'employee_id', 'rating', 'feedback', 'review_date'],
    'Exit_Records': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'resignation_date', 'last_working_day', 'clearance_status', 'fnf_settlement_id'],
    'Documents': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'document_number', 'employee_id', 'title', 'category', 'drive_file_id', 'version', 'is_watermarked'],
    'Doc_Templates': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'code', 'title', 'category', 'docs_template_id'],
    'Notifications': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'title', 'message', 'type', 'is_read'],
    'Audit_Logs': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'action', 'actor_id', 'target_entity', 'target_id', 'ip_hash', 'user_agent_hash', 'details_json'],
    'Company_Settings': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'setting_key', 'setting_value', 'category', 'description'],
    'Backup_Logs': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'backup_date', 'file_name', 'drive_file_id', 'row_count_core', 'row_count_att'],
    'Consent_Log': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'consent_type', 'version', 'timestamp_iso', 'ip_hash'],
    'Integration_Log': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'system_name', 'direction', 'record_count', 'summary']
  };

  createSheetsWithHeaders(coreSs, coreSchemas);

  // 6. Tab Schemas for Yearly Attendance Database
  var attSchemas = {
    'Attendance': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'date', 'check_in_time', 'check_out_time', 'check_in_lat', 'check_in_lng', 'check_in_accuracy', 'check_in_distance', 'check_in_selfie_file_id', 'check_out_lat', 'check_out_lng', 'status_flag', 'anomaly_flags', 'total_hours'],
    'Attendance_Regularization': ['id', 'created_at', 'updated_at', 'created_by', 'updated_by', 'status', 'employee_id', 'attendance_id', 'date', 'requested_check_in', 'requested_check_out', 'reason', 'approval_status']
  };

  createSheetsWithHeaders(attSs, attSchemas);

  // 7. Seed Permissions Catalog
  seedPermissionsCatalog(coreSs);

  // 8. Seed Built-In Super Admin Role
  seedSuperAdminRole(coreSs);

  // 9. Bootstrap First Super Admin User (from Script Properties)
  bootstrapFirstAdmin(coreSs);

  Logger.log('FOCUSON HRMS setupSystem completed successfully.');
}

/**
 * Creates sheets and frozen header rows idempotently.
 */
function createSheetsWithHeaders(spreadsheet, schemas) {
  var existingSheets = spreadsheet.getSheets();
  var sheetMap = {};
  for (var s = 0; s < existingSheets.length; s++) {
    sheetMap[existingSheets[s].getName()] = existingSheets[s];
  }

  for (var name in schemas) {
    var headers = schemas[name];
    var sheet = sheetMap[name];
    if (!sheet) {
      sheet = spreadsheet.insertSheet(name);
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
    } else {
      // Check if headers match or need update
      var lastCol = sheet.getLastColumn();
      if (lastCol === 0) {
        sheet.appendRow(headers);
        sheet.setFrozenRows(1);
      }
    }
  }

  // Remove default 'Sheet1' if present and other sheets exist
  var defaultSheet = sheetMap['Sheet1'];
  if (defaultSheet && spreadsheet.getSheets().length > 1) {
    try { spreadsheet.deleteSheet(defaultSheet); } catch (e) {}
  }
}

/**
 * Seeds comprehensive Permissions Catalog with sensitive flags.
 */
function seedPermissionsCatalog(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Permissions_Catalog');
  if (!sheet) return;
  if (sheet.getLastRow() > 1) return; // Already seeded

  var catalog = [
    // Employee & Profile
    ['employee.view', 'Employees', 'View', 'View employee directory and profiles', 'FALSE'],
    ['employee.create', 'Employees', 'Create', 'Create new employee profiles', 'FALSE'],
    ['employee.edit', 'Employees', 'Edit', 'Edit general employee details', 'FALSE'],
    ['employee.delete', 'Employees', 'Delete', 'Deactivate/soft-delete employee records', 'TRUE'],

    // Sensitive Field Views
    ['field.salary.view', 'Employees', 'View', 'View unmasked salary and CTC information', 'TRUE'],
    ['field.salary.edit', 'Employees', 'Edit', 'Modify salary and compensation structures', 'TRUE'],
    ['field.bank.view', 'Employees', 'View', 'View unmasked bank account & IFSC details', 'TRUE'],
    ['field.bank.edit', 'Employees', 'Edit', 'Edit bank account and payout details', 'TRUE'],
    ['field.govtid.view', 'Employees', 'View', 'View PAN, Aadhaar, and PF UAN numbers', 'TRUE'],
    ['field.medical.view', 'Employees', 'View', 'View blood group and medical notes', 'TRUE'],

    // Organization Setup
    ['org.manage', 'Organization', 'Edit', 'Manage branches, departments, and designations', 'FALSE'],

    // Attendance
    ['attendance.markself', 'Attendance', 'Create', 'Mark personal check-in / check-out', 'FALSE'],
    ['attendance.markothers', 'Attendance', 'Create', 'Mark attendance on behalf of employees', 'TRUE'],
    ['attendance.view', 'Attendance', 'View', 'View attendance logs within scope', 'FALSE'],
    ['attendance.correct', 'Attendance', 'Edit', 'Directly correct attendance records', 'TRUE'],
    ['attendance.regularize.approve', 'Attendance', 'Approve', 'Approve regularization requests', 'FALSE'],
    ['attendance.lock', 'Attendance', 'Edit', 'Lock attendance monthly pay cycle', 'TRUE'],
    ['attendance.export', 'Attendance', 'Export', 'Export muster roll & attendance registers', 'FALSE'],
    ['selfie.view', 'Attendance', 'View', 'View attendance verification selfie photos', 'TRUE'],

    // Leave
    ['leave.apply', 'Leave', 'Create', 'Apply for leave requests', 'FALSE'],
    ['leave.view', 'Leave', 'View', 'View leave history and calendar within scope', 'FALSE'],
    ['leave.approve', 'Leave', 'Approve', 'Approve or reject leave requests in workflow', 'FALSE'],
    ['leave.manage', 'Leave', 'Edit', 'Manage leave policies and adjust balances', 'TRUE'],

    // Payroll
    ['payroll.prepare', 'Payroll', 'Create', 'Prepare draft monthly payroll runs', 'TRUE'],
    ['payroll.verify', 'Payroll', 'Edit', 'Verify prepared payroll run (Maker-Checker)', 'TRUE'],
    ['payroll.approve', 'Payroll', 'Approve', 'Approve verified payroll run for release', 'TRUE'],
    ['payroll.release', 'Payroll', 'Edit', 'Release approved payslips to employees', 'TRUE'],
    ['payroll.reopen', 'Payroll', 'Edit', 'Reopen locked or released payroll run', 'TRUE'],
    ['payroll.view', 'Payroll', 'View', 'View company-wide payroll registers', 'TRUE'],
    ['payslip.view', 'Payroll', 'View', 'View employee payslip documents', 'FALSE'],
    ['payroll.export', 'Payroll', 'Export', 'Export bank transfer and statutory sheets', 'TRUE'],

    // Expenses & Loans
    ['expense.apply', 'Expenses', 'Create', 'Submit advance, loan or expense claims', 'FALSE'],
    ['expense.approve', 'Expenses', 'Approve', 'Approve expense and advance requests', 'FALSE'],

    // Documents
    ['document.generate', 'Documents', 'Create', 'Generate letters from templates', 'FALSE'],
    ['document.view', 'Documents', 'View', 'View generated documents within scope', 'FALSE'],
    ['document.template.edit', 'Documents', 'Edit', 'Edit Google Docs templates', 'TRUE'],

    // Approvals / Workflow
    ['workflow.inbox', 'Workflow', 'View', 'Access approval workflow inbox', 'FALSE'],
    ['workflow.delegate', 'Workflow', 'Edit', 'Delegate approval authority during absence', 'FALSE'],
    ['workflow.define', 'Workflow', 'Edit', 'Configure workflow steps and chains', 'TRUE'],

    // Users and Security
    ['user.create', 'Security', 'Create', 'Provision user login accounts', 'TRUE'],
    ['user.resetpassword', 'Security', 'Edit', 'Trigger administrative password resets', 'TRUE'],
    ['role.define', 'Security', 'Create', 'Create and modify role definitions', 'TRUE'],
    ['role.assign', 'Security', 'Edit', 'Assign roles to employees within ceiling', 'TRUE'],
    ['authority.delegate', 'Security', 'Edit', 'Delegate authority profiles within ceiling', 'TRUE'],
    ['accesslog.view', 'Security', 'View', 'View audit logs and access reviews', 'TRUE'],

    // System
    ['settings.edit', 'System', 'Edit', 'Configure system settings and branding', 'TRUE'],
    ['backup.manage', 'System', 'Edit', 'Create and restore database backups', 'TRUE']
  ];

  var now = Utils.nowIso();
  var rows = catalog.map(function(item) {
    return [
      'perm_' + item[0].replace(/\./g, '_'),
      now, now, 'SYSTEM', 'SYSTEM', 'ACTIVE',
      item[0], item[1], item[2], item[3], item[4]
    ];
  });

  sheet.getRange(2, 1, rows.length, rows[0].length).setValues(rows);
}

/**
 * Seeds built-in Super Admin role.
 */
function seedSuperAdminRole(spreadsheet) {
  var sheet = spreadsheet.getSheetByName('Roles');
  if (!sheet || sheet.getLastRow() > 1) return;

  var now = Utils.nowIso();
  sheet.appendRow([
    'role_super_admin',
    now, now, 'SYSTEM', 'SYSTEM', 'ACTIVE',
    'SUPER_ADMIN',
    'Super Admin',
    'Built-in immutable administrator role with full access ceiling.',
    'TRUE'
  ]);
}

/**
 * Bootstraps the first Super Admin user from Script Properties.
 * Properties required before first run:
 * SETUP_ADMIN_EMP_ID (e.g. 'ADMIN001')
 * SETUP_ADMIN_PASSWORD (e.g. 'FocusOn@2026!')
 * Automatically forces must_change_password: true and cleans up the plain password property.
 */
function bootstrapFirstAdmin(spreadsheet) {
  var usersSheet = spreadsheet.getSheetByName('Users');
  if (!usersSheet) return;
  if (usersSheet.getLastRow() > 1) return; // User already exists

  var props = PropertiesService.getScriptProperties();
  var adminEmpId = (props.getProperty('SETUP_ADMIN_EMP_ID') || 'SUPERADMIN').trim().toUpperCase();
  var tempPassword = props.getProperty('SETUP_ADMIN_PASSWORD');

  if (!tempPassword) {
    // Generate one-time secure temporary password if not provided in properties
    tempPassword = 'Init#' + Utilities.getUuid().substring(0, 8);
    Logger.log('====================================================');
    Logger.log('FIRST SUPER ADMIN BOOTSTRAP:');
    Logger.log('Employee ID: ' + adminEmpId);
    Logger.log('One-Time Password: ' + tempPassword);
    Logger.log('Please save this credential and log in immediately.');
    Logger.log('====================================================');
  }

  var salt = Utils.generateSalt();
  var hash = Utils.hashPassword(tempPassword, salt);
  var now = Utils.nowIso();

  // Insert into Users tab
  usersSheet.appendRow([
    'usr_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
    now, now, 'SETUP', 'SETUP', 'ACTIVE',
    adminEmpId,
    hash,
    salt,
    'TRUE', // is_super_admin
    'TRUE', // must_change_password
    now
  ]);

  // Insert corresponding initial employee profile into Employees tab
  var empSheet = spreadsheet.getSheetByName('Employees');
  if (empSheet) {
    empSheet.appendRow([
      adminEmpId,
      now, now, 'SETUP', 'SETUP', 'ACTIVE',
      'System', 'Administrator',
      'admin@focuson.local', '',
      'DEPT_MGMT', 'Executive Management',
      'DESIG_ADMIN', 'Super Administrator',
      'BR_HQ', 'Headquarters',
      '', 'Office', 'POL_OFFICE',
      now.substring(0, 10), '1990-01-01', 'Other', '', '', '', '', '', '', '', '', '', '', ''
    ]);
  }

  // Remove temporary plain password from Script Properties for zero-leak security
  props.deleteProperty('SETUP_ADMIN_PASSWORD');
}
