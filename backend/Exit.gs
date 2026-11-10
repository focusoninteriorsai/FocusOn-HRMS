/**
 * Exit management: resignation, approval, configurable clearance checklist,
 * assets return, full-and-final settlement estimate and employee exit status.
 */
var Exit = (function () {
  function clearanceItems() {
    var configured = Settings.json('EXIT_CLEARANCE_ITEMS', ['IT assets', 'Finance dues', 'Knowledge transfer', 'HR documents', 'Access cards']);
    return (Array.isArray(configured) ? configured : []).map(function (item, index) {
      return { key: 'item_' + (index + 1), label: String(item), cleared: false, note: '', clearedBy: '', clearedAt: '' };
    });
  }

  function shape(row) {
    var clearance = Utils.safeParseJson(row.clearance_json, { items: [] });
    var settlement = Utils.safeParseJson(row.settlement_json, {});
    var approval = Workflow.statusFor('exit', row.id);
    return {
      id: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
      department: (Repo.employee(row.employee_id) || {}).department || '',
      resignationDate: String(row.resignation_date || '').slice(0, 10),
      lastWorkingDate: String(row.last_working_date || '').slice(0, 10),
      noticePeriodDays: Utils.dayDiff(String(row.resignation_date || '').slice(0, 10), String(row.last_working_date || '').slice(0, 10)),
      reason: row.reason || '', exitType: row.exit_type || 'RESIGNATION',
      state: approval ? String(approval.status).toUpperCase() : String(row.exit_state || row.status || 'PENDING').toUpperCase(),
      clearance: Array.isArray(clearance.items) ? clearance.items : [],
      clearanceComplete: (clearance.items || []).length > 0 && (clearance.items || []).every(function (item) { return item.cleared; }),
      settlement: settlement,
      canClear: true,
      createdAt: Utils.toIso(row.created_at)
    };
  }

  function list(authentication, payload) {
    var actor = authentication.actor;
    var scope = Utils.cleanString(payload.scope || 'mine');
    var items = Database.getAllCached('Exit_Records').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (scope === 'mine') return row.employee_id === actor.employeeId;
      return actor.isSuperAdmin || actor.permissions.indexOf('exit.view') >= 0 || Repo.canSeeEmployee(actor, row.employee_id);
    }).map(shape);
    if (payload.state) items = items.filter(function (item) { return item.state === String(payload.state).toUpperCase(); });
    items.sort(function (left, right) { return String(right.resignationDate).localeCompare(String(left.resignationDate)); });
    var paged = Utils.paginate(items, payload, { searchFields: ['employeeName', 'reason', 'state'], sortFields: ['resignationDate', 'employeeName', 'state'], maxPageSize: 300 });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      stats: {
        pending: items.filter(function (item) { return item.state === 'PENDING'; }).length,
        approved: items.filter(function (item) { return item.state === 'APPROVED'; }).length,
        clearancePending: items.filter(function (item) { return item.state === 'APPROVED' && !item.clearanceComplete; }).length,
        completed: items.filter(function (item) { return item.state === 'COMPLETED' || item.state === 'EXITED'; }).length
      },
      noticePeriod: Settings.number('EXIT_NOTICE_PERIOD_DAYS', 30),
      clearanceTemplate: clearanceItems(),
      canEdit: actor.isSuperAdmin || actor.permissions.indexOf('exit.edit') >= 0,
      canApprove: actor.isSuperAdmin || actor.permissions.indexOf('exit.approve') >= 0
    };
  }

  function submit(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.cleanString(payload.employeeId) && actor.isSuperAdmin
      ? Utils.normalizeEmployeeId(payload.employeeId) : actor.employeeId;
    var existing = Database.findOne('Exit_Records', function (row) {
      return row.employee_id === employeeId && ['PENDING', 'APPROVED', 'CLEARANCE'].indexOf(String(row.exit_state || 'PENDING').toUpperCase()) >= 0 &&
        String(row.status).toUpperCase() !== 'DELETED';
    }, { cached: true });
    if (existing) Utils.fail('CONFLICT', 'An exit process is already in progress for this employee.');
    var resignationDate = Utils.cleanString(payload.resignationDate) ? Utils.requireDate(payload.resignationDate, 'Resignation date') : Utils.today();
    var noticeDays = Utils.numberOrZero(payload.noticeDays) || Settings.number('EXIT_NOTICE_PERIOD_DAYS', 30);
    var lastWorkingDate = Utils.cleanString(payload.lastWorkingDate)
      ? Utils.requireDate(payload.lastWorkingDate, 'Last working date')
      : Utils.addDays(resignationDate, noticeDays);
    if (lastWorkingDate < resignationDate) Utils.fail('VALIDATION', 'The last working date must follow the resignation date.');
    var record = Database.insert('Exit_Records', {
      employee_id: employeeId, resignation_date: resignationDate, last_working_date: lastWorkingDate,
      reason: Utils.requireString(payload, 'reason', { max: 4000, min: 10 }),
      exit_type: Utils.requireEnum(payload.exitType || 'RESIGNATION', ['RESIGNATION', 'TERMINATION', 'RETIREMENT', 'ABSCONDING', 'END_OF_CONTRACT'], 'Exit type'),
      clearance_json: JSON.stringify({ items: clearanceItems() }), settlement_json: JSON.stringify({}),
      exit_state: 'PENDING', status: 'ACTIVE'
    }, actor.employeeId);
    if (Settings.bool('EXIT_REQUIRE_APPROVAL', true) && Permissions.isFeatureEnabled('workflow')) {
      Workflow.start(authentication, 'exit', record.id, { lastWorkingDate: lastWorkingDate }, {
        summary: 'Exit on ' + lastWorkingDate + ' — ' + String(payload.reason).slice(0, 100)
      });
    } else {
      Database.update('Exit_Records', record.id, { exit_state: 'APPROVED' }, actor.employeeId);
    }
    Audit.logEvent('EXIT_SUBMITTED', actor.employeeId, 'Exit_Records', record.id, 'SUCCESS', { employeeId: employeeId, lastWorkingDate: lastWorkingDate }, {});
    return { exitId: record.id, lastWorkingDate: lastWorkingDate };
  }

  function onDecision(approval, state, authentication) {
    var exit = Repo.find('Exit_Records', approval.request_id);
    if (!exit) return;
    Database.update('Exit_Records', exit.id, {
      exit_state: state === 'APPROVED' ? 'APPROVED' : state, approval_id: approval.id
    }, authentication.actor.employeeId);
    if (state === 'APPROVED') {
      var employee = Repo.employee(exit.employee_id);
      if (employee) {
        Database.update('Employees', employee.id, {
          employment_status: 'NOTICE', resignation_date: String(exit.resignation_date).slice(0, 10),
          last_working_date: String(exit.last_working_date).slice(0, 10)
        }, authentication.actor.employeeId);
      }
    }
  }

  function updateClearance(authentication, payload) {
    var exit = Repo.requireRecord('Exit_Records', payload.exitId, 'Exit record');
    var data = Utils.safeParseJson(exit.clearance_json, { items: [] });
    var items = Array.isArray(data.items) ? data.items : [];
    var key = Utils.requireString(payload, 'key', { max: 40 });
    var item = null;
    items.forEach(function (row) { if (row.key === key) item = row; });
    if (!item) Utils.fail('NOT_FOUND', 'Clearance item not found.');
    item.cleared = payload.cleared === true;
    item.note = Utils.cleanString(payload.note).slice(0, 500);
    item.clearedBy = item.cleared ? authentication.actor.employeeId : '';
    item.clearedAt = item.cleared ? Utils.nowIso() : '';
    Database.update('Exit_Records', exit.id, { clearance_json: JSON.stringify({ items: items }) }, authentication.actor.employeeId);
    Audit.logEvent('EXIT_CLEARANCE_UPDATED', authentication.actor.employeeId, 'Exit_Records', exit.id, 'SUCCESS', { key: key, cleared: item.cleared }, {});
    return { items: items };
  }

  /** Estimates full-and-final settlement from real balances only. */
  function computeSettlement(authentication, payload) {
    var exit = Repo.requireRecord('Exit_Records', payload.exitId, 'Exit record');
    var employee = Repo.requireEmployee(exit.employee_id);
    var lastWorkingDate = String(exit.last_working_date).slice(0, 10);
    var period = lastWorkingDate.slice(0, 7);
    var structure = Payroll.structureFor(exit.employee_id, lastWorkingDate);
    var components = structure ? Utils.safeParseJson(structure.components_json, []) : [];
    var totals = Payroll.summaryOf(components);
    var attendance = Attendance.summarizeMonth(employee, period);
    var range = Utils.monthRange(period);
    var calendarDays = Utils.dayDiff(range.start, range.end) + 1;
    var workedDays = Math.min(calendarDays, Number(lastWorkingDate.slice(8, 10)));
    var monthlyGross = totals.gross;
    var payableThisMonth = Utils.round2(monthlyGross / calendarDays * Math.min(calendarDays, Utils.numberOrZero(attendance.paidDays)));
    var leaveEncashment = 0;
    var encashDays = 0;
    var year = Leave.leaveYearFor(lastWorkingDate);
    Leave.balancesFor(exit.employee_id, year).forEach(function (balance) {
      var type = Repo.find('Leave_Types', balance.leaveTypeId);
      var rules = type ? Utils.safeParseJson(type.rules_json, {}) : {};
      if (rules.encashable) {
        var basic = 0;
        components.forEach(function (component) {
          if (String(component.kind || 'EARNING').toUpperCase() !== 'DEDUCTION' && String(component.statutoryWage).toUpperCase() === 'TRUE') basic += Utils.numberOrZero(component.amount);
        });
        leaveEncashment += balance.balance * (basic / 30);
        encashDays += balance.balance;
      }
    });
    leaveEncashment = Utils.round2(leaveEncashment);
    var gratuityConfig = Settings.json('GRATUITY_SETTINGS', { enabled: false });
    var gratuity = 0;
    var serviceYears = employee.joining_date ? Utils.dayDiff(String(employee.joining_date).slice(0, 10), lastWorkingDate) / 365.25 : 0;
    if (gratuityConfig && gratuityConfig.enabled && serviceYears >= Utils.numberOrZero(gratuityConfig.minimumYears || 5)) {
      var basicDa = 0;
      components.forEach(function (component) {
        var name = String(component.name || '').toLowerCase();
        if (name.indexOf('basic') >= 0 || name === 'da') basicDa += Utils.numberOrZero(component.amount);
      });
      gratuity = Utils.round2(basicDa * Utils.numberOrZero(gratuityConfig.ratePerYear || 4.81) * serviceYears);
      if (gratuityConfig.maximumAmount) gratuity = Math.min(gratuity, Utils.numberOrZero(gratuityConfig.maximumAmount));
    }
    var loans = Database.getAllCached('Loans_Advances').filter(function (row) {
      return row.employee_id === exit.employee_id && String(row.approval_state).toUpperCase() === 'APPROVED';
    });
    var loanRecovery = 0;
    loans.forEach(function (loan) {
      var ledger = Utils.safeParseJson(loan.ledger_json, { instalments: [] });
      var repaid = (ledger.instalments || []).reduce(function (sum, entry) { return sum + Utils.numberOrZero(entry.amount); }, 0);
      loanRecovery += Math.max(0, Utils.numberOrZero(loan.disbursed_amount) - repaid);
    });
    var noticeRecovery = 0;
    var servedDays = Utils.dayDiff(String(exit.resignation_date).slice(0, 10), lastWorkingDate);
    var requiredNotice = Settings.number('EXIT_NOTICE_PERIOD_DAYS', 30);
    if (servedDays < requiredNotice && monthlyGross > 0) {
      noticeRecovery = Utils.round2(monthlyGross / 30 * (requiredNotice - servedDays));
    }
    var earnings = [
      { name: 'Salary for days worked', amount: payableThisMonth },
      { name: 'Leave encashment (' + encashDays + ' days)', amount: leaveEncashment },
      { name: 'Gratuity', amount: gratuity }
    ];
    var deductions = [
      { name: 'Loan / advance recovery', amount: Utils.round2(loanRecovery) },
      { name: 'Notice period shortfall', amount: noticeRecovery }
    ];
    var totalEarnings = Utils.round2(earnings.reduce(function (sum, line) { return sum + line.amount; }, 0));
    var totalDeductions = Utils.round2(deductions.reduce(function (sum, line) { return sum + line.amount; }, 0));
    var result = {
      exitId: exit.id, employeeId: exit.employee_id, employeeName: employee.display_name || '',
      lastWorkingDate: lastWorkingDate, serviceYears: Utils.round2(serviceYears),
      workedDaysInFinalMonth: workedDays, earnings: earnings, deductions: deductions,
      totalEarnings: totalEarnings, totalDeductions: totalDeductions,
      netSettlement: Utils.round2(totalEarnings - totalDeductions),
      components: components, calculatedAt: Utils.nowIso(),
      disclaimer: 'Estimate only. Statutory and gratuity figures use the company configured values and must be checked by the payroll team before payment.'
    };
    Database.update('Exit_Records', exit.id, { settlement_json: JSON.stringify(result) }, authentication.actor.employeeId);
    Audit.logEvent('EXIT_SETTLEMENT_CALCULATED', authentication.actor.employeeId, 'Exit_Records', exit.id, 'SUCCESS', { net: result.netSettlement }, {});
    return result;
  }

  function complete(authentication, payload) {
    var exit = Repo.requireRecord('Exit_Records', payload.exitId, 'Exit record');
    var clearance = Utils.safeParseJson(exit.clearance_json, { items: [] }).items || [];
    if (clearance.length && !clearance.every(function (item) { return item.cleared; })) {
      Utils.fail('CONFLICT', 'All clearance items must be cleared before completing the exit.');
    }
    var assets = Database.getAllCached('Assets').filter(function (row) {
      return row.assigned_employee_id === exit.employee_id && !row.returned_at && String(row.status).toUpperCase() === 'ACTIVE';
    });
    if (assets.length) Utils.fail('CONFLICT', assets.length + ' asset(s) are still assigned. Return them first.');
    var employee = Repo.requireEmployee(exit.employee_id);
    var lastWorkingDate = String(exit.last_working_date).slice(0, 10);
    Database.update('Exit_Records', exit.id, { exit_state: 'COMPLETED', completed_at: Utils.nowIso() }, authentication.actor.employeeId);
    Database.update('Employees', employee.id, {
      status: 'INACTIVE', employment_status: 'EXITED', exit_date: lastWorkingDate
    }, authentication.actor.employeeId);
    Auth.revokeUserSessions(exit.employee_id, null);
    Audit.logEvent('EXIT_COMPLETED', authentication.actor.employeeId, 'Exit_Records', exit.id, 'SUCCESS', { employeeId: exit.employee_id, lastWorkingDate: lastWorkingDate }, {});
    return { completed: true, employeeId: exit.employee_id };
  }

  return {
    list: list,
    submit: submit,
    onDecision: onDecision,
    updateClearance: updateClearance,
    computeSettlement: computeSettlement,
    complete: complete
  };
})();
