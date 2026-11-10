/**
 * Leave: configurable types with accrual rules, applications through the approval
 * workflow, a per-year balance ledger, calendars and the company leave register.
 */
var Leave = (function () {
  var HALF_DAY_PERIODS = ['', 'FIRST_HALF', 'SECOND_HALF'];

  function ruleDefaults() {
    return {
      annualQuota: 12, accrual: 'MONTHLY', accrualDay: 1, carryForward: true, maxCarryForward: 5,
      encashable: false, requiresApproval: Settings.bool('LEAVE_APPROVAL_REQUIRED', true),
      maxPerApplication: 0, minServiceDays: 0, gender: '', allowHalfDay: Settings.bool('LEAVE_ALLOW_HALF_DAY', true),
      documentRequired: false, color: '#3157d5', sandwichRule: false, probationAllowed: true
    };
  }

  function leaveYearFor(dateText) {
    var startMonth = Settings.number('LEAVE_YEAR_START_MONTH', 1);
    var date = Utils.parseDateOnly(dateText || Utils.today());
    var year = date.getFullYear();
    if (date.getMonth() + 1 < startMonth) year -= 1;
    return year;
  }

  function yearBounds(year) {
    var startMonth = Settings.number('LEAVE_YEAR_START_MONTH', 1);
    var start = year + '-' + String(startMonth).padStart(2, '0') + '-01';
    return { start: start, end: Utils.addDays(Utils.addDays(start, 366), -1).slice(0, 4) + '-12-31', year: year };
  }

  function typeShape(row) {
    var rules = Utils.safeParseJson(row.rules_json, {});
    var merged = {};
    var defaults = ruleDefaults();
    Object.keys(defaults).forEach(function (key) { merged[key] = rules[key] === undefined ? defaults[key] : rules[key]; });
    return {
      id: row.id, code: row.code, name: row.name, description: row.description || '',
      rules: merged, active: String(row.status).toUpperCase() === 'ACTIVE'
    };
  }

  function leaveTypes() {
    return Repo.leaveTypes().map(typeShape);
  }

  /** Repo.leaveTypes() intentionally returns raw rows; shape them before use. */
  function shapedTypes() {
    return Repo.leaveTypes().map(typeShape);
  }

  function workingDays(startDate, endDate, options) {
    options = options || {};
    var countWeekends = Settings.bool('LEAVE_COUNT_WEEKENDS', false) || options.countWeekends === true;
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var days = 0;
    for (var cursor = startDate; cursor <= endDate; cursor = Utils.addDays(cursor, 1)) {
      var isWeekend = workweek.indexOf(Utils.dayOfWeek(cursor)) < 0;
      var holiday = Repo.holidayOn(cursor, options.branchId || '');
      if (!countWeekends && (isWeekend || holiday.length)) continue;
      days += 1;
    }
    return days;
  }

  /** Balance ledger: opening + credits - debits, stored as a JSON ledger per year. */
  function ledgerRow(employeeId, leaveTypeId, year) {
    return Database.findOne('Leave_Balances', function (row) {
      return row.employee_id === employeeId && row.leave_type_id === leaveTypeId &&
        Number(row.year) === Number(year) && String(row.status).toUpperCase() === 'ACTIVE';
    }, { cached: true });
  }

  function ledgerEntries(row) {
    var ledger = Utils.safeParseJson(row ? row.ledger_json : '[]', []);
    return Array.isArray(ledger) ? ledger : [];
  }

  function balanceFrom(entries) {
    return Utils.round2(entries.reduce(function (total, entry) {
      return total + Utils.numberOrZero(entry.days);
    }, 0));
  }

  function ensureBalance(employeeId, leaveTypeId, year, actorId) {
    var existing = ledgerRow(employeeId, leaveTypeId, year);
    if (existing) return existing;
    var type = Repo.find('Leave_Types', leaveTypeId);
    var rules = type ? typeShape(type).rules : ruleDefaults();
    var employee = Repo.employee(employeeId);
    var entries = [];
    if (Utils.asNumber(rules.annualQuota, 0) > 0 && String(rules.accrual).toUpperCase() === 'ANNUAL') {
      entries.push({ date: yearBounds(year).start, type: 'CREDIT', days: Utils.numberOrZero(rules.annualQuota), note: 'Annual opening credit' });
    }
    if (employee && employee.joining_date && String(employee.joining_date).slice(0, 4) === String(year)) {
      // Proration is applied by the accrual job, not fabricated here.
    }
    return Database.insert('Leave_Balances', {
      employee_id: employeeId, leave_type_id: leaveTypeId, year: year,
      ledger_json: JSON.stringify(entries), balance_days: balanceFrom(entries)
    }, actorId || 'SYSTEM');
  }

  function addLedgerEntry(employeeId, leaveTypeId, year, entry, actorId) {
    var existing = ensureBalance(employeeId, leaveTypeId, year, actorId);
    var entries = ledgerEntries(existing);
    entries.push(entry);
    var balance = balanceFrom(entries);
    Database.update('Leave_Balances', existing.id, {
      ledger_json: JSON.stringify(entries.slice(-400)), balance_days: balance
    }, actorId || 'SYSTEM');
    return balance;
  }

  function balancesFor(employeeId, year) {
    return shapedTypes().map(function (type) {
      var row = ledgerRow(employeeId, type.id, year);
      var entries = ledgerEntries(row);
      return {
        leaveTypeId: type.id, name: type.name, code: type.code, color: type.rules.color,
        annualQuota: Utils.numberOrZero(type.rules.annualQuota),
        balance: Utils.round2(Utils.numberOrZero(row ? row.balance_days : 0)),
        used: Utils.numberOrZero(entries.filter(function (item) { return Utils.numberOrZero(item.days) < 0; }).reduce(function (total, item) { return total + Math.abs(Utils.numberOrZero(item.days)); }, 0)),
        credited: Utils.numberOrZero(entries.filter(function (item) { return Utils.numberOrZero(item.days) > 0; }).reduce(function (total, item) { return total + Utils.numberOrZero(item.days); }, 0)),
        allowHalfDay: type.rules.allowHalfDay !== false,
        requiresDocument: Boolean(type.rules.documentRequired),
        maxPerApplication: Utils.numberOrZero(type.rules.maxPerApplication)
      };
    });
  }

  function applicationsFor(employeeId, options) {
    options = options || {};
    return Database.getAllCached('Leave_Applications').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (employeeId && row.employee_id !== employeeId) return false;
      if (options.year && String(row.start_date).slice(0, 4) !== String(options.year)) {
        if (String(row.end_date).slice(0, 4) !== String(options.year)) return false;
      }
      return true;
    }).map(function (row) {
      var approval = Workflow.statusFor('leave', row.id);
      var rowStatus = String(row.status).toUpperCase();
      var effectiveState = String(row.status).toUpperCase() === 'ACTIVE'
        ? (approval ? String(approval.status).toUpperCase() : 'PENDING')
        : rowStatus;
      return {
        id: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
        leaveTypeId: row.leave_type_id, leaveTypeName: Repo.label('Leave_Types', row.leave_type_id),
        startDate: String(row.start_date).slice(0, 10), endDate: String(row.end_date).slice(0, 10),
        halfDay: String(row.half_day_period || '').length > 0,
        halfDayPeriod: row.half_day_period || '',
        days: Utils.numberOrZero(row.total_days), reason: row.reason || '',
        contactDuringLeave: row.contact_during_leave || '',
        handoverTo: row.handover_to || '', handoverName: Repo.employeeName(row.handover_to),
        state: effectiveState,
        approvalId: approval ? approval.id : '',
        attachmentFileId: row.attachment_file_id || '',
        appliedAt: Utils.toIso(row.created_at),
        decidedAt: Utils.toIso(row.decided_at)
      };
    }).sort(function (left, right) { return String(right.appliedAt).localeCompare(String(left.appliedAt)); });
  }

  /** Employee leave dashboard. */
  function myLeave(authentication, payload) {
    var employeeId = authentication.actor.employeeId;
    var year = Utils.numberOrZero(payload.year) || leaveYearFor(Utils.today());
    var applications = applicationsFor(employeeId, { year: year });
    var upcoming = applications.filter(function (item) {
      return ['PENDING', 'APPROVED'].indexOf(item.state) >= 0 && item.endDate >= Utils.today();
    });
    var consumed = applications.filter(function (item) { return item.state === 'APPROVED'; })
      .reduce(function (total, item) { return total + Utils.numberOrZero(item.days); }, 0);
    return {
      year: year,
      balances: balancesFor(employeeId, year),
      applications: applications,
      upcoming: upcoming.slice(0, 10),
      pendingCount: applications.filter(function (item) { return item.state === 'PENDING'; }).length,
      approvedDays: Utils.round2(consumed),
      leaveTypes: leaveTypes(),
      teamOnLeave: teamLeave(authentication, { days: 30 }),
      policy: {
        allowHalfDay: Settings.bool('LEAVE_ALLOW_HALF_DAY', true),
        maxConsecutiveDays: Settings.number('LEAVE_MAX_CONSECUTIVE_DAYS', 30),
        requireAttachmentAfter: Settings.number('LEAVE_REQUIRE_ATTACHMENT_AFTER_DAYS', 3),
        allowNegative: Settings.bool('LEAVE_ALLOW_NEGATIVE_BALANCE', false)
      }
    };
  }

  function teamLeave(authentication, payload) {
    var days = Math.min(120, Math.max(1, Utils.numberOrZero(payload.days) || 30));
    var from = Utils.today();
    var to = Utils.addDays(from, days);
    var actor = authentication.actor;
    var items = applicationsFor('', {}).filter(function (item) {
      return item.state === 'APPROVED' && item.endDate >= from && item.startDate <= to &&
        (item.employeeId === actor.employeeId || Repo.canSeeEmployee(actor, item.employeeId));
    });
    return {
      items: items.map(function (item) {
        return { employeeId: item.employeeId, employeeName: item.employeeName, startDate: item.startDate, endDate: item.endDate, leaveTypeName: item.leaveTypeName };
      })
    };
  }

  /** Applies for leave with balance, overlap, holiday and policy validation. */
  function apply(authentication, payload) {
    var actor = authentication.actor;
    if (!Permissions.isFeatureEnabled('leave')) Utils.fail('FORBIDDEN', 'Leave is disabled.');
    var leaveType = Repo.find('Leave_Types', payload.leaveTypeId);
    if (!leaveType || String(leaveType.status).toUpperCase() !== 'ACTIVE') Utils.fail('NOT_FOUND', 'Choose an active leave type.');
    var type = typeShape(leaveType);
    var startDate = Utils.requireDate(payload.startDate, 'Start date');
    var endDate = Utils.requireDate(payload.endDate, 'End date');
    if (endDate < startDate) Utils.fail('VALIDATION', 'The end date must follow the start date.');
    if (!Settings.bool('LEAVE_SANDBOX_APPLY_OUTSIDE_WINDOW', false) && startDate < Utils.addDays(Utils.today(), -7)) {
      Utils.fail('VALIDATION', 'Leave cannot be applied more than 7 days in the past.');
    }
    var halfDayPeriod = Utils.optionalEnum(payload.halfDayPeriod, HALF_DAY_PERIODS, 'Half day period') || '';
    if (halfDayPeriod && startDate !== endDate) Utils.fail('VALIDATION', 'A half day must be a single date.');
    if (halfDayPeriod && type.rules.allowHalfDay === false) Utils.fail('VALIDATION', 'This leave type does not allow half days.');
    var employee = authentication.employee;
    var days = halfDayPeriod ? 0.5 : workingDays(startDate, endDate, { branchId: employee.branch_id });
    if (days <= 0) Utils.fail('VALIDATION', 'The selected dates contain no working days.');
    if (type.rules.maxPerApplication && days > Utils.numberOrZero(type.rules.maxPerApplication)) {
      Utils.fail('VALIDATION', 'This leave type allows at most ' + type.rules.maxPerApplication + ' day(s) per application.');
    }
    if (days > Settings.number('LEAVE_MAX_CONSECUTIVE_DAYS', 30)) Utils.fail('VALIDATION', 'The maximum consecutive leave is ' + Settings.number('LEAVE_MAX_CONSECUTIVE_DAYS', 30) + ' days.');
    if (type.rules.gender && employee.gender && String(type.rules.gender).toUpperCase() !== String(employee.gender).toUpperCase()) {
      Utils.fail('VALIDATION', 'This leave type is not available for your profile.');
    }
    var overlapping = Database.getAllCached('Leave_Applications').filter(function (row) {
      if (row.employee_id !== actor.employeeId || String(row.status).toUpperCase() === 'DELETED') return false;
      var state = Workflow.statusFor('leave', row.id);
      var stateText = state ? String(state.status).toUpperCase() : String(row.status).toUpperCase();
      if (['PENDING', 'APPROVED'].indexOf(stateText) < 0) return false;
      return String(row.start_date).slice(0, 10) <= endDate && String(row.end_date).slice(0, 10) >= startDate;
    });
    if (overlapping.length) Utils.fail('CONFLICT', 'You already have a leave request overlapping these dates.');
    var year = leaveYearFor(startDate);
    var balanceRow = ensureBalance(actor.employeeId, type.id, year, actor.employeeId);
    var pendingDays = Database.getAllCached('Leave_Applications').filter(function (row) {
      if (row.employee_id !== actor.employeeId || row.leave_type_id !== type.id) return false;
      var approval = Workflow.statusFor('leave', row.id);
      return approval && String(approval.status).toUpperCase() === 'PENDING';
    }).reduce(function (total, row) { return total + Utils.numberOrZero(row.total_days); }, 0);
    var available = Utils.round2(Utils.numberOrZero(balanceRow.balance_days) - pendingDays);
    var allowNegative = Settings.bool('LEAVE_ALLOW_NEGATIVE_BALANCE', false);
    if (!allowNegative && days > available) {
      Utils.fail('VALIDATION', 'Insufficient ' + type.name + ' balance. Available: ' + available + ' day(s), requested: ' + days + '.');
    }
    var requireAttachmentAfter = Settings.number('LEAVE_REQUIRE_ATTACHMENT_AFTER_DAYS', 3);
    var attachmentRequired = Boolean(type.rules.documentRequired) || (requireAttachmentAfter > 0 && days > requireAttachmentAfter);
    if (attachmentRequired && !payload.attachmentFileId) Utils.fail('VALIDATION', 'An attachment is required for this leave request.');
    var record = Database.insert('Leave_Applications', {
      employee_id: actor.employeeId, leave_type_id: type.id, start_date: startDate, end_date: endDate,
      half_day_period: halfDayPeriod, total_days: days,
      reason: Utils.requireString(payload, 'reason', { max: 4000, min: 5 }),
      contact_during_leave: Utils.cleanString(payload.contactDuringLeave).slice(0, 100),
      handover_to: Utils.cleanString(payload.handoverTo).toUpperCase(),
      attachment_file_id: Utils.cleanString(payload.attachmentFileId).slice(0, 256),
      status: 'PENDING'
    }, actor.employeeId);
    if (approvalRequired(type)) {
      Workflow.start(authentication, 'leave', record.id, {
        leaveType: type.name, startDate: startDate, endDate: endDate, days: days
      }, { summary: type.name + ' · ' + days + ' day(s) · ' + startDate + ' to ' + endDate });
    } else {
      Database.update('Leave_Applications', record.id, { status: 'APPROVED', decided_at: Utils.nowIso() }, actor.employeeId);
      commitBalance(record, type.id, year, actor.employeeId);
    }
    if (Settings.bool('NOTIFY_LEAVE_SUBMITTED', true) && typeof Notifications !== 'undefined') {
      var approvers = Workflow.resolveApproverIds(Workflow.defaultRule('leave'), actor.employeeId, {});
      Notifications.pushMany(approvers, 'LEAVE', 'Leave request from ' + Repo.employeeName(actor.employeeId),
        type.name + ' · ' + days + ' day(s) · ' + startDate + ' to ' + endDate, 'leave');
    }
    Audit.logEvent('LEAVE_APPLIED', actor.employeeId, 'Leave_Applications', record.id, 'SUCCESS', {
      leaveType: type.name, days: days, startDate: startDate, endDate: endDate
    }, {});
    return { applicationId: record.id, days: days, balance: available - days, requiresApproval: approvalRequired(type) };
  }

  function approvalRequired(type) {
    return type.rules.requiresApproval !== false && Settings.bool('LEAVE_APPROVAL_REQUIRED', true) && Permissions.isFeatureEnabled('workflow');
  }

  function commitBalance(application, leaveTypeId, year, actorId) {
    var entry = {
      date: String(application.start_date).slice(0, 10), type: 'DEBIT', days: -Utils.numberOrZero(application.total_days),
      note: 'Leave ' + String(application.start_date).slice(0, 10) + ' to ' + String(application.end_date).slice(0, 10),
      applicationId: application.id
    };
    return addLedgerEntry(application.employee_id, leaveTypeId, year, entry, actorId);
  }

  function onDecision(approval, state, authentication) {
    var application = Repo.find('Leave_Applications', approval.request_id);
    if (!application) return;
    if (state === 'APPROVED') {
      Database.update('Leave_Applications', application.id, {
        status: 'APPROVED', approval_id: approval.id, decided_at: Utils.nowIso()
      }, authentication.actor.employeeId);
      var year = leaveYearFor(String(application.start_date).slice(0, 10));
      var already = ledgerEntries(ledgerRow(application.employee_id, application.leave_type_id, year)).some(function (entry) {
        return entry.applicationId === application.id;
      });
      if (!already) commitBalance(application, application.leave_type_id, year, authentication.actor.employeeId);
    } else if (state === 'REJECTED') {
      Database.update('Leave_Applications', application.id, { status: 'REJECTED', decided_at: Utils.nowIso() }, authentication.actor.employeeId);
    } else if (state === 'RETURNED' || state === 'CANCELLED') {
      Database.update('Leave_Applications', application.id, { status: state === 'CANCELLED' ? 'CANCELLED' : 'RETURNED', decided_at: Utils.nowIso() }, authentication.actor.employeeId);
    }
    var summary = Repo.label('Leave_Types', application.leave_type_id) + ' · ' +
      String(application.start_date).slice(0, 10) + ' to ' + String(application.end_date).slice(0, 10);
    if (Settings.bool('NOTIFY_LEAVE_DECIDED', true) && typeof Notifications !== 'undefined') {
      Notifications.push(application.employee_id, 'LEAVE', 'Leave ' + state.toLowerCase(), summary, 'leave');
    }
    syncLeaveToGoogle(application, state, summary);
  }

  /**
   * Google delivery for a leave decision: Gmail to the employee and an all-day
   * Google Calendar block while the leave is approved (removed when it is
   * cancelled or returned). Best-effort and fully switchable.
   */
  function syncLeaveToGoogle(application, state, summary) {
    try {
      if (typeof Google === 'undefined') return;
      var to = Google.employeeEmail(application.employee_id);
      if (Google.mailEnabled() && to) {
        Google.sendMail(to, 'Leave ' + String(state).toLowerCase(), [
          Repo.employeeName(application.employee_id) + ',',
          '',
          summary,
          '',
          'Your leave request is now ' + String(state).toLowerCase() + '.',
          Google.appLink('/leave') ? 'Open your leave page: ' + Google.appLink('/leave') : ''
        ].filter(Boolean).join('\n'), { prefix: Settings.text('MAIL_SUBJECT_PREFIX', '[FOCUSON HRMS]') + ' ' });
      }
      if (!Google.calendarEnabled()) return;
      var start = String(application.start_date).slice(0, 10);
      var end = String(application.end_date).slice(0, 10);
      if (state === 'APPROVED') {
        var guests = [to].filter(Boolean);
        var result = Google.createAllDayEvent(
          'Leave: ' + Repo.employeeName(application.employee_id) + ' (' + Repo.label('Leave_Types', application.leave_type_id) + ')',
          start, end, summary, guests);
        if (result && result.ok && result.result) {
          Database.update('Leave_Applications', application.id, { calendar_event_id: String(result.result) }, 'SYSTEM');
        }
      } else if (application.calendar_event_id) {
        Google.deleteEvent(application.calendar_event_id);
        Database.update('Leave_Applications', application.id, { calendar_event_id: '' }, 'SYSTEM');
      }
    } catch (error) {
      Audit.logEvent('LEAVE_GOOGLE_SYNC_FAILED', application.employee_id, 'Leave_Applications', application.id, 'FAILED',
        { message: String(error && error.message).slice(0, 300) }, {});
    }
  }

  function cancelApplication(authentication, payload) {
    var application = Repo.requireRecord('Leave_Applications', payload.applicationId, 'Leave application');
    if (application.employee_id !== authentication.actor.employeeId && !authentication.actor.isSuperAdmin) {
      Utils.fail('FORBIDDEN', 'You can only cancel your own leave request.');
    }
    var approval = Workflow.statusFor('leave', application.id);
    var state = approval ? String(approval.status).toUpperCase() : String(application.status).toUpperCase();
    if (['APPROVED', 'REJECTED', 'CANCELLED'].indexOf(state) >= 0 && !authentication.actor.isSuperAdmin) {
      if (state !== 'APPROVED') Utils.fail('CONFLICT', 'This request can no longer be cancelled.');
      if (String(application.start_date).slice(0, 10) <= Utils.today()) Utils.fail('CONFLICT', 'Approved leave can no longer be cancelled once it has started.');
    }
    if (approval && ['PENDING', 'RETURNED'].indexOf(state) >= 0) Workflow.cancelForRequest('leave', application.id, authentication.actor.employeeId);
    if (state === 'APPROVED') {
      var year = leaveYearFor(String(application.start_date).slice(0, 10));
      addLedgerEntry(application.employee_id, application.leave_type_id, year, {
        date: Utils.today(), type: 'CREDIT', days: Utils.numberOrZero(application.total_days),
        note: 'Cancellation refund', applicationId: application.id
      }, authentication.actor.employeeId);
    }
    Database.update('Leave_Applications', application.id, { status: 'CANCELLED', decided_at: Utils.nowIso() }, authentication.actor.employeeId);
    Audit.logEvent('LEAVE_CANCELLED', authentication.actor.employeeId, 'Leave_Applications', application.id, 'SUCCESS', {}, {});
    return { cancelled: true };
  }

  /** HR register for all employees. */
  function register(authentication, payload) {
    var actor = authentication.actor;
    var year = Utils.numberOrZero(payload.year) || leaveYearFor(Utils.today());
    var filter = Utils.cleanString(payload.filter || 'all').toLowerCase();
    var items = applicationsFor('', { year: year }).filter(function (item) {
      if (filter === 'pending' && item.state !== 'PENDING') return false;
      if (filter === 'approved' && item.state !== 'APPROVED') return false;
      if (filter === 'rejected' && ['REJECTED', 'CANCELLED'].indexOf(item.state) < 0) return false;
      if (payload.leaveTypeId && item.leaveTypeId !== payload.leaveTypeId) return false;
      if (payload.departmentId) {
        var employee = Repo.employee(item.employeeId);
        if (!employee || employee.department_id !== payload.departmentId) return false;
      }
      if (payload.employeeId && item.employeeId !== Utils.normalizeEmployeeId(payload.employeeId)) return false;
      if (payload.from && item.endDate < payload.from) return false;
      if (payload.to && item.startDate > payload.to) return false;
      return actor.isSuperAdmin || Repo.canSeeEmployee(actor, item.employeeId);
    });
    var summary = { pending: 0, approved: 0, rejected: 0, days: 0 };
    items.forEach(function (item) {
      if (item.state === 'PENDING') summary.pending += 1;
      if (item.state === 'APPROVED') { summary.approved += 1; summary.days += Utils.numberOrZero(item.days); }
      if (['REJECTED', 'CANCELLED'].indexOf(item.state) >= 0) summary.rejected += 1;
    });
    var paged = Utils.paginate(items, payload, {
      searchFields: ['employeeName', 'employeeId', 'leaveTypeName', 'reason'],
      sortFields: ['appliedAt', 'startDate', 'employeeName', 'state', 'days'],
      maxPageSize: 300
    });
    var employeeBalances = [];
    if (payload.includeBalances) {
      var ids = Utils.csvUnique(paged.items.map(function (item) { return item.employeeId; }));
      ids.forEach(function (employeeId) {
        employeeBalances.push({ employeeId: employeeId, displayName: Repo.employeeName(employeeId), balances: balancesFor(employeeId, year) });
      });
    }
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      summary: summary, leaveTypes: leaveTypes(), year: year, balances: employeeBalances,
      canManage: actor.isSuperAdmin || actor.permissions.indexOf('leave.manage') >= 0
    };
  }

  function saveType(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var code = Utils.requireString(payload, 'code', { max: 64 }).toUpperCase().replace(/[^A-Z0-9_]/g, '_');
    var name = Utils.requireString(payload, 'name', { max: 160 });
    var rules = payload.rules && typeof payload.rules === 'object' ? payload.rules : {};
    var clean = ruleDefaults();
    Object.keys(clean).forEach(function (key) {
      if (rules[key] === undefined || rules[key] === null) return;
      if (typeof clean[key] === 'boolean') clean[key] = rules[key] === true || String(rules[key]).toUpperCase() === 'TRUE';
      else if (typeof clean[key] === 'number') clean[key] = Utils.requireNumber(rules[key], key, { min: 0, max: 1000 });
      else clean[key] = Utils.cleanString(rules[key]).slice(0, 100);
    });
    if (clean.accrual && ['ANNUAL', 'MONTHLY', 'QUARTERLY', 'NONE'].indexOf(String(clean.accrual).toUpperCase()) < 0) {
      Utils.fail('VALIDATION', 'Accrual must be ANNUAL, MONTHLY, QUARTERLY or NONE.');
    }
    clean.accrual = String(clean.accrual).toUpperCase();
    var duplicate = Database.getAllCached('Leave_Types').some(function (row) {
      return row.code === code && row.id !== id && String(row.status).toUpperCase() !== 'DELETED';
    });
    if (duplicate) Utils.fail('CONFLICT', 'A leave type with this code already exists.');
    var changes = {
      code: code, name: name, rules_json: JSON.stringify(clean),
      description: Utils.cleanString(payload.description).slice(0, 1000),
      status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
    };
    var record = id ? Database.update('Leave_Types', Repo.requireRecord('Leave_Types', id, 'Leave type').id, changes, authentication.actor.employeeId)
      : Database.insert('Leave_Types', changes, authentication.actor.employeeId);
    Database.invalidateCache('Leave_Types');
    Audit.logEvent('LEAVE_TYPE_SAVED', authentication.actor.employeeId, 'Leave_Types', record.id, 'SUCCESS', { code: code, name: name }, {});
    return { id: record.id, leaveType: typeShape(record) };
  }

  /** Accrual job: credits monthly quota and applies carry-forward at year end. */
  function runAccrual(actorId) {
    var today = Utils.today();
    var period = today.slice(0, 7);
    var credited = 0;
    var employees = Repo.activeEmployees();
    shapedTypes().forEach(function (type) {
      if (String(type.rules.accrual).toUpperCase() !== 'MONTHLY') return;
      var monthly = Utils.round2(Utils.numberOrZero(type.rules.annualQuota) / 12);
      if (monthly <= 0) return;
      employees.forEach(function (employee) {
        var year = leaveYearFor(today);
        var row = ensureBalance(Repo.employeeKey(employee), type.id, year, actorId || 'SYSTEM');
        var entries = ledgerEntries(row);
        var already = entries.some(function (entry) { return entry.type === 'CREDIT' && entry.note === 'Monthly accrual ' + period; });
        if (already) return;
        addLedgerEntry(Repo.employeeKey(employee), type.id, year, {
          date: today, type: 'CREDIT', days: monthly, note: 'Monthly accrual ' + period
        }, actorId || 'SYSTEM');
        credited += 1;
      });
    });
    if (credited) Audit.logEvent('LEAVE_ACCRUAL', actorId || 'SYSTEM', 'Leave_Balances', '', 'SUCCESS', { period: period, credits: credited }, {});
    return { credited: credited, period: period };
  }

  function adjustBalance(authentication, payload) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var type = Repo.requireRecord('Leave_Types', payload.leaveTypeId, 'Leave type');
    var year = Utils.numberOrZero(payload.year) || leaveYearFor(Utils.today());
    var days = Utils.requireNumber(payload.days, 'Days', { min: -365, max: 365 });
    var reason = Utils.requireString(payload, 'reason', { max: 1000, min: 5 });
    var balance = addLedgerEntry(employeeId, type.id, year, {
      date: Utils.today(), type: days >= 0 ? 'CREDIT' : 'DEBIT', days: days, note: 'Manual adjustment: ' + reason
    }, authentication.actor.employeeId);
    Audit.logEvent('LEAVE_BALANCE_ADJUSTED', authentication.actor.employeeId, 'Leave_Balances', employeeId, 'SUCCESS', {
      leaveType: type.name, days: days, reason: reason
    }, {});
    return { employeeId: employeeId, balance: balance };
  }

  /** Month calendar with holidays, weekends, own leave and team leave. */
  function calendar(authentication, payload) {
    var month = Utils.monthOf(payload.month);
    var range = Utils.monthRange(month);
    var actor = authentication.actor;
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var holidayRows = Database.getAllCached('Holidays').filter(function (row) {
      return String(row.holiday_date).slice(0, 7) === month && String(row.status).toUpperCase() !== 'DELETED';
    });
    var applications = applicationsFor('', {}).filter(function (item) {
      return item.state === 'APPROVED' && item.endDate >= range.start && item.startDate <= range.end;
    });
    var days = [];
    for (var cursor = range.start; cursor <= range.end; cursor = Utils.addDays(cursor, 1)) {
      var holidaysOnDay = holidayRows.filter(function (row) { return String(row.holiday_date).slice(0, 10) === cursor; });
      days.push({
        date: cursor,
        weekend: workweek.indexOf(Utils.dayOfWeek(cursor)) < 0,
        holiday: holidaysOnDay.length ? holidaysOnDay[0].name : '',
        holidayType: holidaysOnDay.length ? holidaysOnDay[0].holiday_type : '',
        myLeave: applications.some(function (item) { return item.employeeId === actor.employeeId && item.startDate <= cursor && item.endDate >= cursor; }),
        leaveCount: applications.filter(function (item) { return item.startDate <= cursor && item.endDate >= cursor; }).length,
        leaveNames: applications.filter(function (item) { return item.startDate <= cursor && item.endDate >= cursor; }).slice(0, 5).map(function (item) {
          return item.employeeName.split(' ')[0];
        })
      });
    }
    return {
      month: month, days: days,
      holidays: holidayRows.map(function (row) {
        return { name: row.name, date: String(row.holiday_date).slice(0, 10), type: row.holiday_type, branchId: row.branch_id || '' };
      }).sort(function (left, right) { return left.date.localeCompare(right.date); }),
      myBalances: balancesFor(actor.employeeId, leaveYearFor(range.start))
    };
  }

  return {
    leaveTypes: leaveTypes,
    myLeave: myLeave,
    apply: apply,
    cancelApplication: cancelApplication,
    onDecision: onDecision,
    register: register,
    saveType: saveType,
    balancesFor: balancesFor,
    ensureBalance: ensureBalance,
    addLedgerEntry: addLedgerEntry,
    adjustBalance: adjustBalance,
    calendar: calendar,
    runAccrual: runAccrual,
    workingDays: workingDays,
    leaveYearFor: leaveYearFor
  };
})();
