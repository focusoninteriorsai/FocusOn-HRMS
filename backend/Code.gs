/**
 * FOCUSON HRMS - Main Router & Dispatcher (Google Apps Script)
 * Single entry point for doPost / doGet, action dispatching, and standard JSON envelopes.
 */

function doGet(e) {
  var health = {
    ok: true,
    status: 'healthy',
    system: 'FOCUSON HRMS Web App API',
    timestamp: new Date().toISOString()
  };
  return ContentService.createTextOutput(JSON.stringify(health))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  var reqId = null;

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return respondJson(Utils.errorResponse('VALIDATION', 'Missing request body'));
    }

    var body;
    try {
      body = JSON.parse(e.postData.contents);
    } catch (parseErr) {
      return respondJson(Utils.errorResponse('VALIDATION', 'Malformed JSON in request payload'));
    }

    reqId = body.reqId;
    var action = body.action;
    var token = body.token;
    var payload = body.payload || {};

    if (!action) {
      return respondJson(Utils.errorResponse('VALIDATION', 'Action property is required', reqId));
    }

    var clientMeta = {
      ipHash: (e.parameter && e.parameter.ip) ? Utils.hashSessionToken(e.parameter.ip) : '',
      uaHash: (e.parameter && e.parameter.ua) ? Utils.hashSessionToken(e.parameter.ua) : ''
    };

    var result = dispatchAction(action, token, payload, clientMeta, reqId);
    return respondJson(Utils.okResponse(result, reqId));

  } catch (err) {
    var code = err.code || 'SERVER';
    var message = err.message || (typeof err === 'string' ? err : 'Internal server error');
    return respondJson(Utils.errorResponse(code, message, reqId));
  }
}

function respondJson(outputObj) {
  return ContentService.createTextOutput(JSON.stringify(outputObj))
    .setMimeType(ContentService.MimeType.JSON);
}

function dispatchAction(action, token, payload, clientMeta, reqId) {
  // 1. PUBLIC ACTIONS
  if (action === 'public.config') {
    return handlePublicConfig();
  }

  if (action === 'auth.login') {
    return Auth.login(payload.employeeId, payload.password, clientMeta);
  }

  // 2. AUTHENTICATED ACTIONS
  var session = Auth.validateSession(token);
  var actor = {
    employeeId: session.user.employeeId,
    name: session.user.name,
    department: session.user.department,
    designation: session.user.designation,
    branch: session.user.branch,
    isSuperAdmin: session.user.isSuperAdmin,
    permissions: session.effectivePermissions
  };

  switch (action) {
    // Auth
    case 'auth.validateSession':
      return session;
    case 'auth.changePassword':
      return Auth.changePassword(actor.employeeId, payload.currentPassword, payload.newPassword);
    case 'auth.logout':
      return Auth.logout(token);
    case 'auth.logoutAll':
      return Auth.logoutAll(actor.employeeId);

    // Profile
    case 'profile.get':
      return Employees.getEmployee(actor.employeeId, actor);

    // Organization
    case 'org.get':
      return Org.getOrgHierarchy();
    case 'org.saveDepartment':
      return Org.saveDepartment(payload, actor);
    case 'org.saveDesignation':
      return Org.saveDesignation(payload, actor);
    case 'org.saveBranch':
      return Org.saveBranch(payload, actor);
    case 'org.saveSite':
      return Org.saveSite(payload, actor);

    // Employees
    case 'employee.list':
      return Employees.listEmployees(actor, payload.filters);
    case 'employee.get':
      return Employees.getEmployee(payload.employeeId, actor);
    case 'employee.save':
      return Employees.saveEmployee(payload, actor);
    case 'employee.deactivate':
      return Employees.deactivateEmployee(payload.employeeId, payload.reason, actor);

    // Attendance
    case 'attendance.checkIn':
      return Attendance.checkIn(payload, actor);
    case 'attendance.checkOut':
      return Attendance.checkOut(payload, actor);
    case 'attendance.getMyLog':
      return Attendance.getMyLog(payload.employeeId || actor.employeeId, payload.monthYear, actor);
    case 'attendance.regularize':
      return Attendance.regularize(payload, actor);

    // Leave
    case 'leave.getTypes':
      return Leave.getLeaveTypes();
    case 'leave.getMyBalances':
      return Leave.getMyBalances(payload.employeeId || actor.employeeId);
    case 'leave.apply':
      return Leave.applyLeave(payload, actor);
    case 'leave.getTeamCalendar':
      return Leave.getTeamCalendar(payload.monthYear, actor);

    // Payroll
    case 'payroll.prepareRun':
      return Payroll.prepareRun(payload.monthYear, actor);
    case 'payroll.verifyRun':
      return Payroll.verifyRun(payload.runId, actor);
    case 'payroll.approveRun':
      return Payroll.approveRun(payload.runId, actor);
    case 'payroll.releaseRun':
      return Payroll.releaseRun(payload.runId, actor);
    case 'payroll.exportBankCsv':
      return Payroll.exportBankCsv(payload.runId, actor);

    // Workflow & Approval Inbox
    case 'workflow.inbox':
      return Workflow.getPendingApprovals(actor);
    case 'workflow.action':
      return Workflow.handleAction(payload, actor);

    // Expenses & Loans
    case 'expenses.list':
      return Expenses.listExpenses(actor);
    case 'expenses.apply':
      return Expenses.applyExpense(payload, actor);

    // Documents
    case 'documents.list':
      return Documents.listDocuments(actor);
    case 'documents.getTemplates':
      return Documents.getTemplates();
    case 'documents.generate':
      return Documents.generateDocument(payload.templateCode, payload.targetEmployeeId, actor);

    // Reports
    case 'reports.musterRoll':
      return Reports.getMusterRoll(payload.monthYear, actor);
    case 'reports.headcount':
      return Reports.getHeadcount(actor);

    // Settings, Roles & Security
    case 'settings.get':
      return Settings.getSystemSettings(actor);
    case 'settings.save':
      return Settings.saveSystemSetting(payload.key, payload.value, payload.category, actor);
    case 'roles.list':
      return Settings.getRoles(actor);
    case 'roles.save':
      return Settings.saveRole(payload, actor);
    case 'roles.assign':
      return Settings.assignUserRole(payload.employeeId, payload.roleId, actor);
    case 'permissions.getCatalog':
      return Settings.getPermissionsCatalog(actor);

    // Backup
    case 'backup.create':
      return Backup.createBackup(actor);
    case 'backup.list':
      return Backup.listBackups(actor);

    // Tests runner
    case 'tests.run':
      if (!actor.isSuperAdmin) throw { code: 'FORBIDDEN', message: 'Only Super Admin can execute self-tests.' };
      return runAllSystemTests();

    default:
      throw { code: 'NOT_FOUND', message: 'API action "' + action + '" is not recognized.' };
  }
}

function handlePublicConfig() {
  var settings = Database.getAllCached('Company_Settings');
  var config = {
    companyName: 'FOCUSON HRMS',
    tagline: 'Enterprise HR & Payroll Management',
    logoUrl: './assets/icons/icon-192.svg',
    loginNotice: '',
    defaultLanguage: 'en',
    defaultTheme: 'light',
    themeTokens: null
  };

  for (var i = 0; i < settings.length; i++) {
    var k = settings[i].setting_key;
    var v = settings[i].setting_value;
    if (k === 'COMPANY_NAME' && v) config.companyName = v;
    if (k === 'COMPANY_TAGLINE' && v) config.tagline = v;
    if (k === 'COMPANY_LOGO_URL' && v) config.logoUrl = v;
    if (k === 'LOGIN_NOTICE' && v) config.loginNotice = v;
    if (k === 'DEFAULT_LANGUAGE' && v) config.defaultLanguage = v;
    if (k === 'DEFAULT_THEME' && v) config.defaultTheme = v;
  }

  return config;
}
