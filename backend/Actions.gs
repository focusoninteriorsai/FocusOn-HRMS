/**
 * Declarative API surface. Every action declares its authorization requirements;
 * dispatchAction() in Code.gs enforces them before the handler runs. The frontend
 * never decides authorization.
 */
var Actions = (function () {
  function read(permission, handler, options) {
    options = options || {};
    return {
      write: false, permission: permission, fields: options.fields || [],
      featureKey: options.featureKey || null, entity: options.entity || '',
      // Collection endpoints act on lists, so a grant at any scope is enough to
      // open the screen. Handlers still filter every row by scope.
      collection: options.collection !== false,
      handler: handler
    };
  }

  function write(permission, handler, options) {
    options = options || {};
    return {
      write: true, permission: permission, fields: options.fields || [],
      featureKey: options.featureKey || null, entity: options.entity || '',
      makerChecker: Boolean(options.makerChecker), superAdminOnly: Boolean(options.superAdminOnly),
      handler: function (payload, authentication, context) {
        return handler(payload, authentication, context);
      }
    };
  }

  function self(handler, options) {
    options = options || {};
    return {
      write: options.write === true, permission: null, fields: [], entity: '',
      featureKey: options.featureKey || null,
      collection: options.collection !== false,
      handler: handler
    };
  }

  /** Sends one test message to the caller so mail wiring can be proven. */
  function googleTestMail(authentication, payload) {
    var to = Utils.cleanString(payload.to) || Google.employeeEmail(authentication.actor.employeeId);
    if (!to) Utils.fail('VALIDATION', 'Give a destination address or set the caller work email.');
    var result = Google.sendMail(to, 'Test message from FOCUSON HRMS',
      'Mail delivery works. Sent by ' + authentication.actor.employeeId + ' at ' + Utils.nowIso() + '.',
      { force: true, prefix: Settings.text('MAIL_SUBJECT_PREFIX', '[FOCUSON HRMS]') + ' ' });
    if (!result.ok) Utils.fail('VALIDATION', 'Mail could not be sent: ' + (result.error || 'unknown error'));
    return { to: to, messageId: result.result, quota: Google.mailQuota().remaining };
  }

  /** Posts a test message to the configured Google Chat space. */
  function googleTestChat(payload) {
    var result = Google.chatSend(Utils.cleanString(payload && payload.text) || 'FOCUSON HRMS test message.', { force: true });
    if (!result.ok) Utils.fail('VALIDATION', 'Chat could not be reached: ' + (result.error || 'no webhook configured'));
    return { posted: true };
  }

  /** Pushes every active employee into Google Contacts (People advanced service). */
  function googleSyncContacts(authentication, payload) {
    var employees = Repo.employees().filter(function (row) {
      return String(row.status).toUpperCase() === 'ACTIVE' && row.work_email;
    }).slice(0, 100);
    var synced = 0;
    var failed = 0;
    employees.forEach(function (row) {
      var result = Google.syncContact(row.employee_id || row.id);
      if (result.ok) synced += 1; else failed += 1;
    });
    return { synced: synced, failed: failed, total: employees.length, enabled: Google.contactsEnabled() };
  }

  /** Adds a holiday to the HRMS Google Calendar as an all-day event. */
  function googleCreateHolidayEvent(authentication, payload) {
    var holiday = Repo.requireRecord('Holidays', payload.holidayId, 'Holiday');
    var result = Google.createAllDayEvent(holiday.name, holiday.holiday_date, holiday.holiday_date,
      holiday.description || '', []);
    if (!result.ok) Utils.fail('VALIDATION', 'Calendar event could not be created: ' + (result.error || 'calendar sync is off'));
    return { eventId: result.result };
  }

  /** Mails every current approver a one-message digest of their open items. */
  function googleMailDigest(authentication) {
    if (!Google.mailEnabled()) Utils.fail('VALIDATION', 'E-mail delivery is switched off in Settings.');
    var inbox = Workflow.inbox(authentication, { filter: 'pending', pageSize: 300 });
    var byApprover = {};
    (inbox.items || []).forEach(function (item) {
      (item.approvers || []).forEach(function (employeeId) {
        byApprover[employeeId] = (byApprover[employeeId] || 0) + 1;
      });
    });
    var sent = 0;
    Object.keys(byApprover).forEach(function (employeeId) {
      var to = Google.employeeEmail(employeeId);
      if (!to) return;
      var result = Google.sendMail(to, 'Your open approvals: ' + byApprover[employeeId], [
        Repo.employeeName(employeeId) + ',',
        '',
        'You have ' + byApprover[employeeId] + ' request(s) waiting for a decision.',
        Google.appLink('/workflow') ? 'Open the approval inbox: ' + Google.appLink('/workflow') : ''
      ].filter(Boolean).join('\n'), { prefix: Settings.text('MAIL_SUBJECT_PREFIX', '[FOCUSON HRMS]') + ' ' });
      if (result.ok) sent += 1;
    });
    return { sent: sent, approvers: Object.keys(byApprover).length };
  }

  var registry = {
    // ---------- Shell and identity ----------
    'access.bootstrap': self(function (payload, authentication) { return Access.bootstrap(authentication); }),
    'dashboard.get': self(function (payload, authentication) { return Reports.dashboardSummary(authentication, payload); }),

    // ---------- Employees ----------
    'employees.list': read('employee.view', function (p, a) { return Employees.list(a, p); }),
    'employees.detail': read('employee.view', function (p, a) { return Employees.detail(a, p); }),
    'employees.create': write('employee.create', function (p, a) { return Employees.save(a, p); }),
    'employees.update': write('employee.edit', function (p, a) { return Employees.save(a, p); }),
    'employees.status': write('employee.delete', function (p, a) { return Employees.setStatus(a, p); }),
    'employees.import': write('employee.create', function (p, a) { return Employees.importCsv(a, p); }),
    'employees.export': read('employee.export', function (p, a) { return Employees.exportCsv(a, p); }),
    'employees.picker': read('employee.view', function (p, a) { return Employees.picker(a, p); }),
    'employees.requestChange': self(function (p, a) { return Employees.requestChange(a, p); }, { write: true }),
    'employees.myChanges': self(function (p, a) { return Employees.myChanges(a); }),
    'employees.nextId': read('employee.create', function () { return Employees.generateNextId(); }),

    // ---------- Employees: own profile ----------
    // Self-service: every signed-in user may read their own profile, so this is a
    // self action. Employees.detail still enforces scope for other employees.
    'profile.get': self(function (p, a) {
      var response = Employees.detail(a, { employeeId: p.employeeId || a.actor.employeeId });
      return { profile: legacyProfile(response.employee) };
    }),

    // ---------- Organization ----------
    'org.list': read('org.view', function (p, a) { return Organization.list(a, p); }),
    'org.save': write('org.edit', function (p, a) { return Organization.save(a, p); }),
    'org.remove': write('org.delete', function (p, a) { return Organization.remove(a, p); }),
    'org.tree': read('org.view', function (p, a) { return Organization.tree(a); }),

    // ---------- Attendance ----------
    'attendance.today': self(function (p, a) { return Attendance.today(a); }, { featureKey: 'attendance' }),
    'attendance.markSelf': self(function (p, a) { return Attendance.markSelf(a, p); }, { write: true, featureKey: 'attendance' }),
    'attendance.register': read('attendance.view', function (p, a) { return Attendance.register(a, p); }, { featureKey: 'attendance' }),
    'attendance.mark': write('attendance.markothers', function (p, a) { return Attendance.mark(a, p); }, { featureKey: 'attendance' }),
    'attendance.requestRegularization': self(function (p, a) { return Attendance.requestRegularization(a, p); }, { write: true, featureKey: 'attendance' }),
    'attendance.regularizations': self(function (p, a) { return Attendance.myRegularizations(a); }, { featureKey: 'attendance' }),
    'attendance.monthly': self(function (p, a) { return Attendance.monthly(a, p); }, { featureKey: 'attendance' }),
    'attendance.lockMonth': write('attendance.lock', function (p, a) { return Attendance.lockMonth(a, p); }, { featureKey: 'attendance' }),
    'attendance.unlockMonth': write('attendance.lock', function (p, a) { return Attendance.unlockMonth(a, p); }, { featureKey: 'attendance' }),

    // ---------- Leave ----------
    'leave.myLeave': self(function (p, a) { return Leave.myLeave(a, p); }, { featureKey: 'leave' }),
    'leave.apply': self(function (p, a) { return Leave.apply(a, p); }, { write: true, featureKey: 'leave' }),
    'leave.cancel': self(function (p, a) { return Leave.cancelApplication(a, p); }, { write: true, featureKey: 'leave' }),
    'leave.register': read('leave.view', function (p, a) { return Leave.register(a, p); }, { featureKey: 'leave' }),
    'leave.saveType': write('leave.manage', function (p, a) { return Leave.saveType(a, p); }, { featureKey: 'leave' }),
    'leave.adjustBalance': write('leave.manage', function (p, a) { return Leave.adjustBalance(a, p); }, { featureKey: 'leave' }),
    'leave.runAccrual': write('leave.manage', function (p, a) { return Leave.runAccrual(a.actor.employeeId); }, { featureKey: 'leave' }),
    'leave.calendar': self(function (p, a) { return Leave.calendar(a, p); }, { featureKey: 'leave' }),

    // ---------- Payroll ----------
    'payroll.salaryIndex': read('salary.view', function (p, a) { return Payroll.salaryIndex(a, p); }, { featureKey: 'payroll', fields: ['ctc_annual', 'basic_salary', 'gross_salary'] }),
    'payroll.structureDetail': read('salary.view', function (p, a) { return Payroll.structureDetail(a, p); }, { featureKey: 'payroll', fields: ['ctc_annual', 'basic_salary', 'gross_salary'] }),
    'payroll.saveStructure': write('salary.edit', function (p, a) { return Payroll.saveStructure(a, p); }, { featureKey: 'payroll', fields: ['ctc_annual', 'basic_salary', 'gross_salary'] }),
    'payroll.requestRevision': write('salary.revise', function (p, a) { return Payroll.salaryRevision(a, p); }, { featureKey: 'payroll' }),
    'payroll.runs': read('payroll.view', function (p, a) { return Payroll.runs(a, p); }, { featureKey: 'payroll' }),
    'payroll.prepare': write('payroll.prepare', function (p, a) { return Payroll.prepare(a, p); }, { featureKey: 'payroll' }),
    'payroll.runDetail': read('payroll.view', function (p, a) { return Payroll.runDetail(a, p); }, { featureKey: 'payroll' }),
    'payroll.verify': write('payroll.verify', function (p, a) { return Payroll.transition(a, mergeState(p, 'VERIFIED')); }, { featureKey: 'payroll' }),
    'payroll.approve': write('payroll.approve', function (p, a) { return Payroll.transition(a, mergeState(p, 'APPROVED')); }, { featureKey: 'payroll' }),
    'payroll.release': write('payroll.release', function (p, a) { return Payroll.transition(a, mergeState(p, 'RELEASED')); }, { featureKey: 'payroll' }),
    'payroll.close': write('payroll.release', function (p, a) { return Payroll.transition(a, mergeState(p, 'CLOSED')); }, { featureKey: 'payroll' }),
    'payroll.reopen': write('payroll.reopen', function (p, a) { return Payroll.transition(a, mergeState(p, 'REOPENED')); }, { featureKey: 'payroll' }),
    'payroll.myPayslips': self(function (p, a) { return Payroll.myPayslips(a, p); }, { featureKey: 'payslips' }),
    'payroll.payslip': self(function (p, a) { return Payroll.payslip(a, p); }, { featureKey: 'payslips' }),
    'payroll.statutoryReport': read('payroll.view', function (p, a) { return Payroll.statutoryReport(a, p); }, { featureKey: 'payroll' }),

    // ---------- Money ----------
    'money.expenses': self(function (p, a) { return Money.expenseList(a, p); }, { featureKey: 'expenses' }),
    'money.submitExpense': self(function (p, a) { return Money.submitExpense(a, p); }, { write: true, featureKey: 'expenses' }),
    'money.payExpense': write('advance.disburse', function (p, a) { return Money.payExpense(a, p); }, { featureKey: 'expenses' }),
    'money.loans': self(function (p, a) { return Money.loanList(a, p); }, { featureKey: 'advances' }),
    'money.requestLoan': self(function (p, a) { return Money.requestLoan(a, p); }, { write: true, featureKey: 'advances' }),
    'money.disburseLoan': write('advance.disburse', function (p, a) { return Money.disburseLoan(a, p); }, { featureKey: 'advances' }),

    // ---------- Documents ----------
    'documents.list': self(function (p, a) { return Documents.list(a, p); }, { featureKey: 'documents' }),
    'documents.saveTemplate': write('document.template.manage', function (p, a) { return Documents.saveTemplate(a, p); }, { featureKey: 'documents' }),
    'documents.generate': self(function (p, a) { return Documents.generate(a, p); }, { write: true, featureKey: 'documents' }),
    'documents.detail': self(function (p, a) { return Documents.detail(a, p); }, { featureKey: 'documents' }),
    'documents.upload': self(function (p, a) { return Documents.upload(a, p); }, { write: true, featureKey: 'documents' }),
    'documents.download': self(function (p, a) { return Documents.download(a, p); }, { featureKey: 'documents' }),
    'documents.expiring': read('document.view', function (p, a) { return Documents.expiring(a, p); }, { featureKey: 'documents' }),

    // ---------- Recruitment ----------
    'recruitment.list': read('recruitment.view', function (p, a) { return Recruitment.list(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.openingDetail': read('recruitment.view', function (p, a) { return Recruitment.openingDetail(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.saveOpening': write('recruitment.edit', function (p, a) { return Recruitment.saveOpening(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.saveCandidate': write('recruitment.edit', function (p, a) { return Recruitment.saveCandidate(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.moveStage': write('recruitment.edit', function (p, a) { return Recruitment.moveStage(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.scheduleInterview': write('recruitment.edit', function (p, a) { return Recruitment.scheduleInterview(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.releaseOffer': write('recruitment.approve', function (p, a) { return Recruitment.releaseOffer(a, p); }, { featureKey: 'recruitment' }),
    'recruitment.convert': write('recruitment.approve', function (p, a) { return Recruitment.convertToEmployee(a, p); }, { featureKey: 'recruitment' }),

    // ---------- Performance ----------
    'performance.list': self(function (p, a) { return Performance.list(a, p); }, { featureKey: 'performance' }),
    'performance.detail': self(function (p, a) { return Performance.detail(a, p); }, { featureKey: 'performance' }),
    'performance.openCycle': write('performance.create', function (p, a) { return Performance.openCycle(a, p); }, { featureKey: 'performance' }),
    'performance.saveGoals': self(function (p, a) { return Performance.saveGoals(a, p); }, { write: true, featureKey: 'performance' }),
    'performance.selfReview': self(function (p, a) { return Performance.submitSelfReview(a, p); }, { write: true, featureKey: 'performance' }),
    'performance.managerReview': write('performance.approve', function (p, a) { return Performance.submitManagerReview(a, p); }, { featureKey: 'performance' }),

    // ---------- Exit ----------
    'exit.list': self(function (p, a) { return Exit.list(a, p); }, { featureKey: 'exit' }),
    'exit.submit': self(function (p, a) { return Exit.submit(a, p); }, { write: true, featureKey: 'exit' }),
    'exit.updateClearance': write('exit.edit', function (p, a) { return Exit.updateClearance(a, p); }, { featureKey: 'exit' }),
    'exit.settlement': read('exit.view', function (p, a) { return Exit.computeSettlement(a, p); }, { featureKey: 'exit' }),
    'exit.complete': write('exit.approve', function (p, a) { return Exit.complete(a, p); }, { featureKey: 'exit' }),

    // ---------- Assets ----------
    'assets.list': read('asset.view', function (p, a) { return Assets.list(a, p); }, { featureKey: 'assets' }),
    'assets.myAssets': self(function (p, a) { return Assets.myAssets(a); }, { featureKey: 'assets' }),
    'assets.save': write('asset.manage', function (p, a) { return Assets.save(a, p); }, { featureKey: 'assets' }),
    'assets.assign': write('asset.manage', function (p, a) { return Assets.assign(a, p); }, { featureKey: 'assets' }),
    'assets.return': write('asset.manage', function (p, a) { return Assets.returnAsset(a, p); }, { featureKey: 'assets' }),

    // ---------- Announcements ----------
    'announcements.list': self(function (p, a) { return Announcements.list(a, p); }, { featureKey: 'announcements' }),
    'announcements.save': write('announcement.manage', function (p, a) { return Announcements.save(a, p); }, { featureKey: 'announcements' }),
    'announcements.remove': write('announcement.manage', function (p, a) { return Announcements.remove(a, p); }, { featureKey: 'announcements' }),

    // ---------- Google Workspace integration ----------
    'google.status': read('settings.view', function (p, a) { return Google.status(); }, { collection: true }),
    'google.testMail': write('settings.edit', function (p, a) { return googleTestMail(a, p); }, {}),
    'google.testChat': write('settings.edit', function (p, a) { return googleTestChat(p); }, {}),
    'google.syncContacts': write('employee.edit', function (p, a) { return googleSyncContacts(a, p); }, {}),
    'google.createCalendarEvent': write('settings.edit', function (p, a) { return googleCreateHolidayEvent(a, p); }, {}),
    'google.mailDigest': write('settings.edit', function (p, a) { return googleMailDigest(a); }, {}),

    // ---------- Notifications ----------
    'notifications.list': self(function (p, a) { return Notifications.list(a, p); }),
    'notifications.markRead': self(function (p, a) { return Notifications.markRead(a, p); }, { write: true }),

    // ---------- Workflow ----------
    'workflow.inbox': read('workflow.inbox', function (p, a) { return Workflow.inbox(a, p); }),
    'workflow.detail': self(function (p, a) { return Workflow.detail(a, p); }),
    'workflow.decide': self(function (p, a) { return Workflow.decide(a, p); }, { write: true }),
    'workflow.definitions': read('workflow.define', function (p, a) { return Workflow.definitions(a, p); }),
    'workflow.saveDefinition': write('workflow.define', function (p, a) { return Workflow.saveDefinition(a, p); }),

    // ---------- Reports ----------
    'reports.generate': self(function (p, a) { return Reports.generate(a, p); }, { featureKey: 'reports' }),
    'reports.export': self(function (p, a) { return Reports.exportCsv(a, p); }, { featureKey: 'reports' }),

    // ---------- Settings ----------
    'settings.get': read('settings.view', function () { return Settings.describe(); }),
    'settings.update': write('settings.edit', function (p, a) { return Settings.update(a, p); }),
    'settings.updateFeatures': write('settings.edit', function (p, a) { return Settings.updateFeatures(a, p); }),

    // ---------- Access administration ----------
    'access.users': read('user.view', function (p, a) { return Access.listUsers(a, p); }),
    'access.createUser': write('user.create', function (p, a) { return Access.createUser(a, p); }),
    'access.resetPassword': write('user.resetpassword', function (p, a) { return Access.resetPassword(a, p); }),
    'access.setUserStatus': write('user.resetpassword', function (p, a) { return Access.setUserStatus(a, p); }),
    'access.sessions': read('user.view', function (p, a) { return Access.userSessions(a, p); }),
    'access.revokeSession': self(function (p, a) { return Access.revokeSession(a, p); }, { write: true }),
    'access.roles': read('role.define', function (p, a) { return Access.listRoles(a, p); }),
    'access.saveRole': write('role.define', function (p, a) { return Access.saveRole(a, p); }),
    'access.saveRolePermissions': write('role.define', function (p, a) { return Access.saveRolePermissions(a, p); }),
    'access.deleteRole': write('role.define', function (p, a) { return Access.deleteRole(a, p); }),
    'access.assignRole': write('role.assign', function (p, a) { return Access.assign(a, p); }),
    'access.unassignRole': write('role.assign', function (p, a) { return Access.unassign(a, p); }),
    'access.employeeAccess': read('user.view', function (p, a) { return Access.employeeAccess(a, p); }),
    'access.saveOverride': write('override.grant', function (p, a) { return Access.saveOverride(a, p); }),
    'access.deleteOverride': write('override.grant', function (p, a) { return Access.deleteOverride(a, p); }),
    'access.saveDelegation': write('workflow.delegate', function (p, a) { return Access.saveDelegation(a, p); }),
    'access.deleteDelegation': write('workflow.delegate', function (p, a) { return Access.deleteDelegation(a, p); }),
    'access.auditLog': read('accesslog.view', function (p, a) { return Access.auditLog(a, p); }),
    'access.featureScopes': read('settings.view', function (p, a) { return Access.featureScopes(a, p); }),
    'access.saveFeatureScope': write('settings.edit', function (p, a) { return Access.saveFeatureScope(a, p); }),
    'access.deleteFeatureScope': write('settings.edit', function (p, a) { return Access.deleteFeatureScope(a, p); }),

    // ---------- Backup and diagnostics ----------
    'backup.list': read('backup.create', function (p, a) { return Backup.list(a, p); }),
    'backup.create': write('backup.create', function (p, a) { return Backup.create(a, p); }),
    'backup.verify': write('backup.create', function (p, a) { return Backup.verify(a, p); }),
    'backup.restore': write('backup.restore', function (p, a) { return Backup.restore(a, p); }, { superAdminOnly: true }),
    'system.selfTest': read('settings.view', function (p, a) { return Backup.selfTest(a); }),
    'system.runSetup': write('settings.edit', function () {
      if (typeof setupSystem !== 'function') Utils.fail('SERVER', 'Setup is not available in this deployment.');
      return setupSystem();
    }, { superAdminOnly: true }),
    'system.runMaintenance': write('settings.edit', function (p, a) { return Maintenance.run(a.actor.employeeId); }, { superAdminOnly: true })
  };

  function mergeState(payload, state) {
    var copy = {};
    Object.keys(payload || {}).forEach(function (key) { copy[key] = payload[key]; });
    copy.state = state;
    return copy;
  }

  function legacyProfile(employee) {
    return {
      employeeId: employee.employeeId, displayName: employee.displayName,
      workEmail: employee.workEmail, mobile: employee.mobile,
      department: employee.department, designation: employee.designation,
      branch: employee.branch, reportingManagerId: employee.reportingManagerId,
      workLocationType: employee.workLocationType, joiningDate: employee.joiningDate
    };
  }

  return { registry: registry, read: read, write: write, self: self };
})();
