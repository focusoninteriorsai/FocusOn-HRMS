/**
 * Payroll: salary structures built from editable components, monthly runs with
 * maker-checker separation of duties, statutory computation driven entirely by
 * Super-Admin-configured rates, payslip release and a self-service payslip view.
 *
 * No statutory rate is hard-coded as a payable value. Rates live in
 * PF_SETTINGS / ESI_SETTINGS / PROFESSIONAL_TAX_SETTINGS / TDS_SETTINGS and payroll
 * refuses to run until the company CA has verified them (configurable).
 */
var Payroll = (function () {
  var STATES = ['DRAFT', 'PREPARED', 'VERIFIED', 'APPROVED', 'RELEASED', 'CLOSED', 'REOPENED'];
  var EARNING = 'EARNING';
  var DEDUCTION = 'DEDUCTION';

  function statutory() {
    return {
      pf: Settings.json('PF_SETTINGS', { enabled: false }),
      esi: Settings.json('ESI_SETTINGS', { enabled: false }),
      pt: Settings.json('PROFESSIONAL_TAX_SETTINGS', { enabled: false }),
      tds: Settings.json('TDS_SETTINGS', { enabled: false }),
      bonus: Settings.json('BONUS_SETTINGS', { enabled: false }),
      wage: Settings.json('WAGE_DEFINITION_SETTINGS', { enabled: false }),
      caVerified: Settings.bool('PAYROLL_CA_VERIFIED', false)
    };
  }

  function structureFor(employeeId, onDate) {
    var date = onDate || Utils.today();
    var rows = Database.getAllCached('Salary_Structure').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE' &&
        String(row.effective_from).slice(0, 10) <= date &&
        (!row.effective_to || String(row.effective_to).slice(0, 10) >= date);
    });
    rows.sort(function (left, right) { return String(right.effective_from).localeCompare(String(left.effective_from)); });
    return rows.length ? rows[0] : null;
  }

  function componentsOf(structure) {
    var list = Utils.safeParseJson(structure ? structure.components_json : '[]', []);
    return Array.isArray(list) ? list : [];
  }

  function summaryOf(components) {
    var earnings = 0;
    var deductions = 0;
    components.forEach(function (component) {
      var amount = Utils.numberOrZero(component.amount);
      if (String(component.kind || EARNING).toUpperCase() === DEDUCTION) deductions += amount;
      else earnings += amount;
    });
    return { gross: Utils.round2(earnings), deductions: Utils.round2(deductions), net: Utils.round2(earnings - deductions) };
  }

  function defaultComponents(ctcMonthly) {
    var basicPercent = Settings.number('PAYROLL_DEFAULT_BASIC_PERCENT', 50) / 100;
    var hraPercent = Settings.number('PAYROLL_DEFAULT_HRA_PERCENT', 40) / 100;
    var daPercent = Settings.number('PAYROLL_DEFAULT_DA_PERCENT', 0) / 100;
    var basic = Utils.round2(ctcMonthly * basicPercent);
    var hra = Utils.round2(basic * hraPercent);
    var da = Utils.round2(basic * daPercent);
    var special = Utils.round2(ctcMonthly - basic - hra - da);
    return [
      { name: 'Basic', kind: EARNING, amount: basic, taxable: true, statutoryWage: true },
      { name: 'HRA', kind: EARNING, amount: hra, taxable: true, statutoryWage: false },
      { name: 'DA', kind: EARNING, amount: da, taxable: true, statutoryWage: true },
      { name: 'Special Allowance', kind: EARNING, amount: Math.max(0, special), taxable: true, statutoryWage: false }
    ];
  }

  function normalizeComponents(input) {
    if (!Array.isArray(input) || !input.length) Utils.fail('VALIDATION', 'At least one salary component is required.');
    if (input.length > 40) Utils.fail('VALIDATION', 'Too many salary components.');
    return input.map(function (component) {
      var name = Utils.requireString(component, 'name', { max: 80 });
      var kind = Utils.requireEnum(component.kind || EARNING, [EARNING, DEDUCTION], 'Component type');
      return {
        name: name,
        kind: kind,
        amount: Utils.requireNumber(component.amount, name + ' amount', { min: 0, max: 100000000 }),
        taxable: component.taxable !== false,
        statutoryWage: component.statutoryWage === true,
        note: Utils.cleanString(component.note).slice(0, 200)
      };
    });
  }

  /** Salary structure screen + save. */
  function salaryIndex(authentication, payload) {
    var actor = authentication.actor;
    var employees = Repo.activeEmployees();
    if (payload.departmentId) employees = employees.filter(function (row) { return row.department_id === payload.departmentId; });
    if (payload.branchId) employees = employees.filter(function (row) { return row.branch_id === payload.branchId; });
    var search = Utils.containsText(payload.search);
    if (search) {
      employees = employees.filter(function (row) {
        return [row.display_name, Repo.employeeKey(row), row.department].some(function (value) {
          return String(value || '').toLowerCase().indexOf(search) >= 0;
        });
      });
    }
    var items = employees.map(function (employee) {
      var structure = structureFor(Repo.employeeKey(employee), Utils.today());
      var components = componentsOf(structure);
      var totals = summaryOf(components);
      return {
        employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '',
        department: employee.department || '', designation: employee.designation || '', branch: employee.branch || '',
        joiningDate: String(employee.joining_date || '').slice(0, 10),
        hasStructure: Boolean(structure),
        structureId: structure ? structure.id : '',
        effectiveFrom: structure ? String(structure.effective_from).slice(0, 10) : '',
        salaryType: structure ? structure.salary_type : '',
        gross: totals.gross, net: totals.net, componentCount: components.length,
        ctcAnnual: structure ? Utils.round2(totals.gross * 12) : ''
      };
    });
    var paged = Utils.paginate(items, payload, {
      searchFields: ['displayName', 'employeeId', 'department', 'designation'],
      sortFields: ['displayName', 'employeeId', 'gross', 'department'],
      maxPageSize: 300
    });
    var missing = items.filter(function (item) { return !item.hasStructure; }).length;
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      stats: { total: items.length, configured: items.length - missing, missing: missing, monthlyGross: Utils.round2(items.reduce(function (total, item) { return total + item.gross; }, 0)) },
      template: { basicPercent: Settings.number('PAYROLL_DEFAULT_BASIC_PERCENT', 50), hraPercent: Settings.number('PAYROLL_DEFAULT_HRA_PERCENT', 40), daPercent: Settings.number('PAYROLL_DEFAULT_DA_PERCENT', 0) },
      statutory: statutoryFlags()
    };
  }

  function statutoryFlags() {
    var current = statutory();
    return {
      pfEnabled: Boolean(current.pf && current.pf.enabled),
      esiEnabled: Boolean(current.esi && current.esi.enabled),
      ptEnabled: Boolean(current.pt && current.pt.enabled),
      tdsEnabled: Boolean(current.tds && current.tds.enabled),
      caVerified: current.caVerified,
      requireCaVerification: Settings.bool('PAYROLL_REQUIRE_CA_VERIFICATION', true)
    };
  }

  function structureDetail(authentication, payload) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var employee = Repo.requireEmployee(employeeId);
    var rows = Database.getAllCached('Salary_Structure').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var components = componentsOf(row);
      return {
        id: row.id, effectiveFrom: String(row.effective_from).slice(0, 10),
        effectiveTo: String(row.effective_to || '').slice(0, 10), salaryType: row.salary_type,
        components: components, totals: summaryOf(components),
        createdAt: Utils.toIso(row.created_at)
      };
    }).sort(function (left, right) { return right.effectiveFrom.localeCompare(left.effectiveFrom); });
    var revisions = Database.getAllCached('Salary_Revisions').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      return { id: row.id, effectiveFrom: String(row.effective_from).slice(0, 10), structureId: row.structure_id, arrears: Utils.safeParseJson(row.arrears_json, {}) };
    });
    return {
      employee: Repo.employeeSummary(employee),
      structures: rows,
      current: rows.length ? rows[0] : null,
      revisions: revisions,
      components: Database.getAllCached('Salary_Components').filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; }).map(function (row) {
        return { id: row.id, code: row.code, name: row.name, componentType: row.component_type, taxable: Utils.asBoolean(row.taxable) };
      })
    };
  }

  function saveStructure(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    Repo.requireEmployee(employeeId);
    var effectiveFrom = Utils.requireDate(payload.effectiveFrom, 'Effective from');
    var salaryType = Utils.requireEnum(payload.salaryType || 'MONTHLY', ['MONTHLY', 'DAILY', 'HOURLY', 'ANNUAL_CTC'], 'Salary type');
    var components = normalizeComponents(payload.components);
    if (salaryType === 'ANNUAL_CTC') {
      components = components.map(function (component) { return { name: component.name, kind: component.kind, amount: Utils.round2(component.amount / 12), taxable: component.taxable, statutoryWage: component.statutoryWage, note: component.note }; });
      salaryType = 'MONTHLY';
    }
    var totals = summaryOf(components);
    if (totals.gross <= 0) Utils.fail('VALIDATION', 'The gross salary must be greater than zero.');
    var requiresApproval = actor.isSuperAdmin === false && Permissions.isFeatureEnabled('workflow');
    var overlapping = Database.getAllCached('Salary_Structure').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE' &&
        String(row.effective_from).slice(0, 10) === effectiveFrom;
    });
    if (overlapping.length) Utils.fail('CONFLICT', 'A salary structure already starts on this date. Edit that structure instead.');
    var record = Database.insert('Salary_Structure', {
      employee_id: employeeId, effective_from: effectiveFrom, effective_to: '',
      salary_type: salaryType, payable_days_divisor: Utils.numberOrZero(payload.payableDaysDivisor) || 0,
      components_json: JSON.stringify(components)
    }, actor.employeeId);
    Database.updateMany('Salary_Structure', function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE' &&
        (!row.effective_to || String(row.effective_to).slice(0, 10) >= effectiveFrom) && row.id !== record.id &&
        String(row.effective_from).slice(0, 10) < effectiveFrom;
    }, { effective_to: Utils.addDays(effectiveFrom, -1) }, actor.employeeId);
    Database.invalidateCache('Salary_Structure');
    Audit.logEvent('SALARY_STRUCTURE_SAVED', actor.employeeId, 'Salary_Structure', record.id, 'SUCCESS', {
      employeeId: employeeId, gross: totals.gross, effectiveFrom: effectiveFrom, approvalRequired: requiresApproval
    }, {});
    return { structureId: record.id, totals: totals, approvalRequired: requiresApproval };
  }

  function salaryRevision(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    Repo.requireEmployee(employeeId);
    var effectiveFrom = Utils.requireDate(payload.effectiveFrom, 'Effective from');
    var components = normalizeComponents(payload.components);
    var totals = summaryOf(components);
    var record = Database.insert('Salary_Revisions', {
      employee_id: employeeId, structure_id: '', effective_from: effectiveFrom,
      arrears_json: JSON.stringify({ components: components, gross: totals.gross, note: Utils.cleanString(payload.note).slice(0, 1000) }),
      status: 'PENDING'
    }, actor.employeeId);
    Workflow.start(authentication, 'salary_revision', record.id, { gross: totals.gross, effectiveFrom: effectiveFrom }, {
      summary: 'Salary revision to ' + totals.gross + ' from ' + effectiveFrom
    });
    Audit.logEvent('SALARY_REVISION_REQUESTED', actor.employeeId, 'Salary_Revisions', record.id, 'SUCCESS', { employeeId: employeeId, gross: totals.gross }, {});
    return { revisionId: record.id };
  }

  function onRevisionDecision(approval, state, authentication) {
    var revision = Repo.find('Salary_Revisions', approval.request_id);
    if (!revision) return;
    if (state !== 'APPROVED') {
      Database.update('Salary_Revisions', revision.id, { status: state }, authentication.actor.employeeId);
      return;
    }
    var data = Utils.safeParseJson(revision.arrears_json, {});
    var record = Database.insert('Salary_Structure', {
      employee_id: revision.employee_id, effective_from: String(revision.effective_from).slice(0, 10),
      effective_to: '', salary_type: 'MONTHLY', payable_days_divisor: 0,
      components_json: JSON.stringify(data.components || [])
    }, authentication.actor.employeeId);
    Database.update('Salary_Revisions', revision.id, { status: 'APPROVED', structure_id: record.id, approval_id: approval.id }, authentication.actor.employeeId);
    Database.invalidateCache('Salary_Structure');
  }

  /** Statutory computation with fully configurable rates. */
  function computeStatutory(employee, components, gross, period) {
    var config = statutory();
    var wageComponents = [];
    var pfWage = 0;
    var esiWage = 0;
    var pfIncluded = (config.pf && config.pf.includeComponents) || ['Basic', 'DA'];
    var esiIncluded = (config.esi && config.esi.includeComponents) || ['Basic', 'DA', 'HRA'];
    components.forEach(function (component) {
      if (String(component.kind || EARNING).toUpperCase() === DEDUCTION) return;
      var name = String(component.name || '').toLowerCase();
      if (pfIncluded.some(function (item) { return String(item).toLowerCase() === name; })) pfWage += Utils.numberOrZero(component.amount);
      if (esiIncluded.some(function (item) { return String(item).toLowerCase() === name; })) esiWage += Utils.numberOrZero(component.amount);
      if (component.statutoryWage) wageComponents.push(component);
    });
    pfWage = Utils.round2(pfWage);
    esiWage = Utils.round2(esiWage);
    var lines = [];
    var employer = [];
    var flags = [];

    if (config.pf && config.pf.enabled) {
      var pfBase = pfWage;
      if (config.pf.restrictToCeiling && Utils.numberOrZero(config.pf.wageCeiling) > 0) pfBase = Math.min(pfBase, Utils.numberOrZero(config.pf.wageCeiling));
      var employeePf = Utils.round2(pfBase * Utils.numberOrZero(config.pf.employeeRate) / 100);
      var employerPf = Utils.round2(pfBase * Utils.numberOrZero(config.pf.employerRate) / 100);
      var epsWage = Math.min(pfBase, Utils.numberOrZero(config.pf.epsWageCeiling));
      var eps = Utils.round2(epsWage * Utils.numberOrZero(config.pf.epsRate) / 100);
      var edli = Utils.round2(pfBase * Utils.numberOrZero(config.pf.edliRate) / 100);
      var admin = Utils.round2(pfBase * Utils.numberOrZero(config.pf.adminRate) / 100);
      if (employeePf > 0) lines.push({ code: 'PF_EE', name: 'Provident Fund (Employee)', amount: employeePf, category: 'STATUTORY' });
      employer.push({ code: 'PF_ER', name: 'Provident Fund (Employer)', amount: employerPf });
      employer.push({ code: 'EPS', name: 'Pension Scheme (Employer)', amount: eps });
      employer.push({ code: 'EDLI', name: 'EDLI (Employer)', amount: edli });
      employer.push({ code: 'PF_ADMIN', name: 'PF Administration (Employer)', amount: admin });
      if (!employee[config.pf.employeeField || 'pf_uan']) flags.push('MISSING_PF_UAN');
    } else {
      flags.push('PF_NOT_CONFIGURED');
    }

    if (config.esi && config.esi.enabled) {
      var ceiling = Utils.numberOrZero(config.esi.wageCeiling);
      if (ceiling <= 0 || esiWage <= ceiling) {
        var employeeEsi = Utils.round2(esiWage * Utils.numberOrZero(config.esi.employeeRate) / 100);
        var employerEsi = Utils.round2(esiWage * Utils.numberOrZero(config.esi.employerRate) / 100);
        if (employeeEsi > 0) lines.push({ code: 'ESI_EE', name: 'ESI (Employee)', amount: employeeEsi, category: 'STATUTORY' });
        employer.push({ code: 'ESI_ER', name: 'ESI (Employer)', amount: employerEsi });
        if (!employee[config.esi.employeeField || 'esi_number']) flags.push('MISSING_ESI_NUMBER');
      }
    } else {
      flags.push('ESI_NOT_CONFIGURED');
    }

    if (config.pt && config.pt.enabled) {
      var slabs = Array.isArray(config.pt.slabs) ? config.pt.slabs : [];
      if (!slabs.length) flags.push('PT_SLABS_MISSING');
      var monthly = gross;
      var ptAmount = 0;
      slabs.forEach(function (slab) {
        var from = Utils.numberOrZero(slab.from);
        var to = Utils.numberOrZero(slab.to) || Number.MAX_SAFE_INTEGER;
        if (monthly >= from && monthly <= to) ptAmount = Utils.numberOrZero(slab.amount);
      });
      if (ptAmount > 0) lines.push({ code: 'PT', name: 'Professional Tax', amount: Utils.round2(ptAmount), category: 'STATUTORY' });
    }

    if (config.tds && config.tds.enabled) {
      var annualGross = Utils.round2(gross * 12);
      var standardDeduction = Utils.numberOrZero(config.tds.standardDeduction);
      var taxableIncome = Math.max(0, annualGross - standardDeduction);
      var annualTax = 0;
      var tdsSlabs = Array.isArray(config.tds.slabs) ? config.tds.slabs : [];
      if (!tdsSlabs.length) flags.push('TDS_SLABS_MISSING');
      tdsSlabs.forEach(function (slab) {
        var from = Utils.numberOrZero(slab.from);
        var to = Utils.numberOrZero(slab.to) || Number.MAX_SAFE_INTEGER;
        var rate = Utils.numberOrZero(slab.rate);
        if (taxableIncome > from) annualTax += (Math.min(taxableIncome, to) - from) * rate / 100;
      });
      var rebateLimit = Utils.numberOrZero(config.tds.rebateLimit);
      if (rebateLimit > 0 && taxableIncome <= rebateLimit) annualTax = Math.max(0, annualTax - Utils.numberOrZero(config.tds.rebateAmount));
      annualTax += annualTax * Utils.numberOrZero(config.tds.cessRate) / 100;
      var monthlyTax = Utils.round2(annualTax / 12);
      if (monthlyTax > 0) lines.push({ code: 'TDS', name: 'Income Tax (TDS)', amount: monthlyTax, category: 'STATUTORY' });
      if (!employee[config.tds.employeeField || 'pan_number']) flags.push('MISSING_PAN');
    }

    var totalDeduction = Utils.round2(lines.reduce(function (total, line) { return total + line.amount; }, 0));
    return {
      lines: lines, employer: employer, flags: Utils.csvUnique(flags),
      employeeDeduction: totalDeduction,
      employerCost: Utils.round2(employer.reduce(function (total, line) { return total + line.amount; }, 0)),
      pfWage: pfWage, esiWage: esiWage
    };
  }

  /** Monthly run lifecycle. */
  function runs(authentication, payload) {
    var items = Database.getAllCached('Payroll_Runs').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var records = Database.getAllCached('Payroll').filter(function (pay) { return pay.run_id === row.id; });
      return {
        id: row.id, period: row.period, state: String(row.run_state || row.status).toUpperCase(),
        preparedBy: row.prepared_by || '', preparedName: Repo.employeeName(row.prepared_by),
        verifiedBy: row.verified_by || '', verifiedName: Repo.employeeName(row.verified_by),
        approvedBy: row.approved_by || '', approvedName: Repo.employeeName(row.approved_by),
        releasedBy: row.released_by || '', releasedName: Repo.employeeName(row.released_by),
        employeeCount: records.length,
        gross: Utils.round2(records.reduce(function (total, pay) { return total + Utils.numberOrZero(pay.gross_pay); }, 0)),
        net: Utils.round2(records.reduce(function (total, pay) { return total + Utils.numberOrZero(pay.net_pay); }, 0)),
        createdAt: Utils.toIso(row.created_at), reopenReason: row.reopen_reason || ''
      };
    }).sort(function (left, right) { return right.period.localeCompare(left.period); });
    var current = Utils.monthOf(payload.month);
    var stats = { runs: items.length, released: items.filter(function (item) { return item.state === 'RELEASED' || item.state === 'CLOSED'; }).length };
    return {
      items: items, stats: stats,
      suggestedPeriod: current,
      canPrepare: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.prepare') >= 0,
      canVerify: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.verify') >= 0,
      canApprove: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.approve') >= 0,
      canRelease: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.release') >= 0,
      statutory: statutoryFlags(),
      attendanceLocked: Attendance.monthLock(Utils.addDays(Utils.monthRange(current).start, -1).slice(0, 7)).locked
    };
  }

  function eligibleEmployees(period) {
    var range = Utils.monthRange(period);
    return Repo.activeEmployees().filter(function (employee) {
      var joining = String(employee.joining_date || '').slice(0, 10);
      if (joining && joining > range.end) return false;
      var exitDate = String(employee.exit_date || employee.last_working_date || '').slice(0, 10);
      if (exitDate && exitDate < range.start) return false;
      return Boolean(structureFor(Repo.employeeKey(employee), range.end));
    });
  }

  function prepare(authentication, payload) {
    var actor = authentication.actor;
    var period = Utils.monthOf(payload.period);
    var existing = Database.getAllCached('Payroll_Runs').filter(function (row) {
      return row.period === period && String(row.status).toUpperCase() !== 'DELETED' && ['RELEASED', 'CLOSED'].indexOf(String(row.run_state).toUpperCase()) >= 0;
    });
    if (existing.length) Utils.fail('CONFLICT', 'Payroll for ' + period + ' has already been released.');
    if (Settings.bool('PAYROLL_REQUIRE_ATTENDANCE_LOCK', true)) {
      // The salary month must be closed (attendance locked) before it can be run.
      if (!Attendance.monthLock(period).locked) {
        Utils.fail('VALIDATION', 'Lock attendance for ' + period + ' before preparing payroll. Use Attendance → Month close.');
      }
    }
    var flags = statutoryFlags();
    if (flags.requireCaVerification && !flags.caVerified) {
      Utils.fail('CONFLICT', 'Statutory values are not marked CA-verified. Update the statutory settings and tick verification before running payroll.');
    }
    var employees = eligibleEmployees(period);
    if (!employees.length) Utils.fail('VALIDATION', 'No employee has a salary structure covering ' + period + '.');
    var run = Database.findOne('Payroll_Runs', function (row) {
      return row.period === period && ['DRAFT', 'PREPARED', 'VERIFIED', 'APPROVED', 'REOPENED'].indexOf(String(row.run_state).toUpperCase()) >= 0 &&
        String(row.status).toUpperCase() !== 'DELETED';
    }, { cached: true });
    if (!run) {
      run = Database.insert('Payroll_Runs', {
        period: period, run_state: 'DRAFT', prepared_by: actor.employeeId,
        processing_cursor: 0, status: 'ACTIVE'
      }, actor.employeeId);
    } else {
      Database.update('Payroll_Runs', run.id, { run_state: 'DRAFT', prepared_by: actor.employeeId }, actor.employeeId);
      Database.updateMany('Payroll', function (row) { return row.run_id === run.id; }, { status: 'DELETED' }, actor.employeeId);
    }
    var divisorMode = Settings.text('PAYROLL_PAYABLE_DAYS_DIVISOR', 'calendar');
    var range = Utils.monthRange(period);
    var calendarDays = Utils.dayDiff(range.start, range.end) + 1;
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var workingDaysInMonth = 0;
    for (var cursor = range.start; cursor <= range.end; cursor = Utils.addDays(cursor, 1)) {
      if (workweek.indexOf(Utils.dayOfWeek(cursor)) >= 0) workingDaysInMonth += 1;
    }
    var divisor = divisorMode === 'fixed30' ? 30 : (divisorMode === 'working' ? workingDaysInMonth : calendarDays);
    var results = [];
    var totals = { gross: 0, deductions: 0, net: 0, employerCost: 0 };
    employees.forEach(function (employee) {
      var employeeId = Repo.employeeKey(employee);
      var structure = structureFor(employeeId, range.end);
      var components = componentsOf(structure);
      var attendanceSummary = Attendance.summarizeMonth(employee, period);
      var paidDays = Math.min(divisor, Utils.numberOrZero(attendanceSummary.paidDays));
      if (String(employee.joining_date || '').slice(0, 7) === period) paidDays = Math.min(paidDays, calendarDays - (Number(String(employee.joining_date).slice(8, 10)) - 1));
      var payableRatio = divisor > 0 ? paidDays / divisor : 1;
      var earnings = components.filter(function (component) { return String(component.kind || EARNING).toUpperCase() !== DEDUCTION; }).map(function (component) {
        var full = Utils.numberOrZero(component.amount);
        var amount = Utils.round2(full * payableRatio);
        return {
          code: component.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), name: component.name,
          amount: amount, fullAmount: full, taxable: component.taxable !== false,
          statutoryWage: component.statutoryWage === true, kind: EARNING
        };
      });
      var gross = Utils.round2(earnings.reduce(function (total, line) { return total + line.amount; }, 0));
      var fixedDeductions = components.filter(function (component) { return String(component.kind || EARNING).toUpperCase() === DEDUCTION; }).map(function (component) {
        return { code: component.name.toUpperCase().replace(/[^A-Z0-9]+/g, '_'), name: component.name, amount: Utils.round2(Utils.numberOrZero(component.amount) * payableRatio), fullAmount: Utils.numberOrZero(component.amount), kind: DEDUCTION };
      });
      var statutoryResult = computeStatutory(employee, earnings, gross, period);
      var loanDeduction = loanEmiFor(employeeId, period);
      var deductions = fixedDeductions.concat(statutoryResult.lines);
      if (loanDeduction > 0) deductions.push({ code: 'LOAN_EMI', name: 'Loan / advance instalment', amount: loanDeduction, category: 'LOAN' });
      var totalDeductions = Utils.round2(deductions.reduce(function (total, line) { return total + Utils.numberOrZero(line.amount); }, 0));
      var net = Utils.round2(gross - totalDeductions);
      net = roundNet(net);
      totals.gross += gross;
      totals.deductions += totalDeductions;
      totals.net += net;
      totals.employerCost += statutoryResult.employerCost;
      results.push({
        run_id: run.id, employee_id: employeeId, period: period,
        paid_days: paidDays, lop_days: attendanceSummary.lopDays,
        earnings_json: JSON.stringify(earnings), deductions_json: JSON.stringify(deductions),
        gross_pay: gross, total_deductions: totalDeductions, net_pay: net,
        calculation_json: JSON.stringify({
          divisor: divisor, divisorMode: divisorMode, payableRatio: payableRatio,
          attendance: attendanceSummary, employerContributions: statutoryResult.employer,
          unmarkedDays: attendanceSummary.notMarkedDays,
          flags: statutoryResult.flags, pfWage: statutoryResult.pfWage, esiWage: statutoryResult.esiWage,
          generatedAt: Utils.nowIso()
        })
      });
    });
    if (results.length) Database.appendRows('Payroll', results, actor.employeeId);
    Database.update('Payroll_Runs', run.id, { run_state: 'PREPARED', prepared_by: actor.employeeId, processing_cursor: results.length }, actor.employeeId);
    Audit.logEvent('PAYROLL_PREPARED', actor.employeeId, 'Payroll_Runs', run.id, 'SUCCESS', {
      period: period, employees: results.length, net: Utils.round2(totals.net)
    }, {});
    return {
      runId: run.id, period: period, state: 'PREPARED', employeeCount: results.length,
      totals: { gross: Utils.round2(totals.gross), deductions: Utils.round2(totals.deductions), net: Utils.round2(totals.net), employerCost: Utils.round2(totals.employerCost) }
    };
  }

  function roundNet(value) {
    var mode = Settings.text('PAYROLL_ROUNDING', 'nearest_rupee');
    if (mode === 'nearest_10') return Utils.round2(Math.round(value / 10) * 10);
    if (mode === 'nearest_rupee') return Utils.round2(Math.round(value));
    return Utils.round2(value);
  }

  function loanEmiFor(employeeId, period) {
    var loans = Database.getAllCached('Loans_Advances').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE' &&
        String(row.request_type).toUpperCase() === 'LOAN' && String(row.approval_state || '').toUpperCase() === 'APPROVED';
    });
    var total = 0;
    loans.forEach(function (loan) {
      var ledger = Utils.safeParseJson(loan.ledger_json, { instalments: [] });
      var outstanding = Utils.numberOrZero(loan.disbursed_amount) - (ledger.instalments || []).reduce(function (sum, entry) { return sum + Utils.numberOrZero(entry.amount); }, 0);
      if (outstanding > 0 && (ledger.instalments || []).indexOf(period) < 0) total += Math.min(Utils.numberOrZero(loan.emi_amount), outstanding);
    });
    return Utils.round2(total);
  }

  function runDetail(authentication, payload) {
    var run = Repo.requireRecord('Payroll_Runs', payload.runId, 'Payroll run');
    var records = Database.getAllCached('Payroll').filter(function (row) {
      return row.run_id === run.id && String(row.status).toUpperCase() !== 'DELETED';
    });
    var search = Utils.containsText(payload.search);
    var items = records.filter(function (row) {
      if (!search) return true;
      return [Repo.employeeName(row.employee_id), row.employee_id].some(function (value) {
        return String(value || '').toLowerCase().indexOf(search) >= 0;
      });
    }).map(function (row) {
      var calculation = Utils.safeParseJson(row.calculation_json, {});
      return {
        payrollId: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
        department: (Repo.employee(row.employee_id) || {}).department || '',
        paidDays: Utils.numberOrZero(row.paid_days), lopDays: Utils.numberOrZero(row.lop_days),
        gross: Utils.numberOrZero(row.gross_pay), deductions: Utils.numberOrZero(row.total_deductions),
        net: Utils.numberOrZero(row.net_pay), flags: calculation.flags || [],
        earnings: Utils.safeParseJson(row.earnings_json, []),
        deductionLines: Utils.safeParseJson(row.deductions_json, []),
        employerContributions: calculation.employerContributions || [],
        attendance: calculation.attendance || {}
      };
    });
    items.sort(function (left, right) { return left.employeeName.localeCompare(right.employeeName); });
    var totals = {
      gross: Utils.round2(items.reduce(function (total, item) { return total + item.gross; }, 0)),
      deductions: Utils.round2(items.reduce(function (total, item) { return total + item.deductions; }, 0)),
      net: Utils.round2(items.reduce(function (total, item) { return total + item.net; }, 0)),
      employerCost: Utils.round2(items.reduce(function (total, item) {
        return total + (item.employerContributions || []).reduce(function (sum, line) { return sum + Utils.numberOrZero(line.amount); }, 0);
      }, 0))
    };
    var flagCounts = {};
    items.forEach(function (item) { item.flags.forEach(function (flag) { flagCounts[flag] = (flagCounts[flag] || 0) + 1; }); });
    return {
      run: {
        id: run.id, period: run.period, state: String(run.run_state || run.status).toUpperCase(),
        preparedBy: Repo.employeeName(run.prepared_by), verifiedBy: Repo.employeeName(run.verified_by),
        approvedBy: Repo.employeeName(run.approved_by), releasedBy: Repo.employeeName(run.released_by),
        reopenReason: run.reopen_reason || '', createdAt: Utils.toIso(run.created_at)
      },
      items: items, totals: totals, flags: flagCounts,
      statutory: statutory(),
      runFlags: statutoryFlags(),
      canVerify: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.verify') >= 0,
      canApprove: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.approve') >= 0,
      canRelease: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payroll.release') >= 0
    };
  }

  function transition(authentication, payload) {
    var actor = authentication.actor;
    var run = Repo.requireRecord('Payroll_Runs', payload.runId, 'Payroll run');
    var target = Utils.requireEnum(payload.state, ['VERIFIED', 'APPROVED', 'RELEASED', 'CLOSED', 'REOPENED'], 'Target state');
    var current = String(run.run_state || run.status).toUpperCase();
    var changes = {};
    var strict = Settings.bool('PAYROLL_SOD_STRICT', true);
    var sodMessage = 'Separation of duties: the user who prepared this run cannot also verify or approve it. ' +
      'Assign the Payroll Approver role (or payroll.verify permission) to a second user, or switch off strict separation in Settings → Payroll.';
    if (target === 'VERIFIED') {
      if (current !== 'PREPARED') Utils.fail('CONFLICT', 'Only a prepared run can be verified.');
      if (run.prepared_by === actor.employeeId && strict) Utils.fail('FORBIDDEN', sodMessage);
      if (run.prepared_by === actor.employeeId) auditSodOverride(actor.employeeId, run, 'VERIFIED');
      changes = { run_state: 'VERIFIED', verified_by: actor.employeeId };
    } else if (target === 'APPROVED') {
      if (current !== 'VERIFIED') Utils.fail('CONFLICT', 'Verify the run before approving it.');
      if (run.verified_by === actor.employeeId && strict) Utils.fail('FORBIDDEN', sodMessage);
      if (run.verified_by === actor.employeeId) auditSodOverride(actor.employeeId, run, 'APPROVED');
      changes = { run_state: 'APPROVED', approved_by: actor.employeeId };
    } else if (target === 'RELEASED') {
      if (current !== 'APPROVED') Utils.fail('CONFLICT', 'Only an approved run can be released.');
      changes = { run_state: 'RELEASED', released_by: actor.employeeId };
    } else if (target === 'CLOSED') {
      if (['RELEASED', 'APPROVED'].indexOf(current) < 0) Utils.fail('CONFLICT', 'Only a released run can be closed.');
      changes = { run_state: 'CLOSED' };
    } else {
      if (['RELEASED', 'CLOSED'].indexOf(current) < 0) Utils.fail('CONFLICT', 'Only a released run can be reopened.');
      var reason = Utils.requireString(payload, 'reason', { max: 4000, min: 10 });
      changes = { run_state: 'REOPENED', reopen_reason: reason };
    }
    Database.update('Payroll_Runs', run.id, changes, actor.employeeId);
    if (target === 'RELEASED') releasePayslips(authentication, run);
    Audit.logEvent('PAYROLL_' + target, actor.employeeId, 'Payroll_Runs', run.id, 'SUCCESS', { period: run.period, from: current }, {});
    return { runId: run.id, state: target };
  }

  function auditSodOverride(actorId, run, state) {
    Audit.logEvent('PAYROLL_SOD_OVERRIDE', actorId, 'Payroll_Runs', run.id, 'SUCCESS', {
      period: run.period, state: state, note: 'Strict separation of duties is switched off in payroll settings.'
    }, {});
  }

  function releasePayslips(authentication, run) {
    var records = Database.getAllCached('Payroll').filter(function (row) {
      return row.run_id === run.id && String(row.status).toUpperCase() !== 'DELETED';
    });
    var released = 0;
    records.forEach(function (record) {
      var existing = Database.findOne('Payslips', function (row) {
        return row.payroll_id === record.id && String(row.status).toUpperCase() === 'ACTIVE';
      }, { cached: true });
      if (!existing) {
        Database.insert('Payslips', {
          run_id: run.id, payroll_id: record.id, employee_id: record.employee_id,
          period: run.period, file_id: '', released_at: Utils.nowIso(),
          document_number: payslipNumber(run.period, record.employee_id)
        }, authentication.actor.employeeId);
        released += 1;
        if (Settings.bool('NOTIFY_PAYSLIP_RELEASED', true) && typeof Notifications !== 'undefined') {
          Notifications.push(record.employee_id, 'PAYROLL', 'Payslip available for ' + run.period,
            'Your payslip for ' + run.period + ' is ready to view and download.', 'payslips');
        }
      }
    });
    return released;
  }

  function payslipNumber(period, employeeId) {
    var format = Settings.text('PAYROLL_PAYSLIP_NUMBER_FORMAT', 'PS/{YYYY}/{MM}/{SEQ}');
    var parts = period.split('-');
    var sequence = String(Database.getAllCached('Payslips').length + 1).padStart(5, '0');
    return format.replace('{YYYY}', parts[0]).replace('{MM}', parts[1]).replace('{SEQ}', sequence).replace('{EMP}', employeeId);
  }

  /** Employee payslip list and printable detail. */
  function myPayslips(authentication, payload) {
    var employeeId = payload.employeeId && authentication.actor.isSuperAdmin ? Utils.normalizeEmployeeId(payload.employeeId) : authentication.actor.employeeId;
    var items = Database.getAllCached('Payslips').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE';
    }).map(function (row) {
      var pay = Repo.find('Payroll', row.payroll_id) || {};
      return {
        id: row.id, period: row.period, releasedAt: Utils.toIso(row.released_at),
        documentNumber: row.document_number || '', gross: Utils.numberOrZero(pay.gross_pay),
        net: Utils.numberOrZero(pay.net_pay), payrollId: row.payroll_id
      };
    }).sort(function (left, right) { return right.period.localeCompare(left.period); });
    return {
      items: items,
      total: items.length,
      ytd: {
        gross: Utils.round2(items.reduce(function (total, item) { return total + item.gross; }, 0)),
        net: Utils.round2(items.reduce(function (total, item) { return total + item.net; }, 0))
      }
    };
  }

  function payslip(authentication, payload) {
    var payslipRow = Repo.requireRecord('Payslips', payload.payslipId, 'Payslip');
    var isOwner = payslipRow.employee_id === authentication.actor.employeeId;
    var isPrivileged = authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('payslip.view') >= 0 || authentication.actor.permissions.indexOf('payroll.view') >= 0;
    if (!isOwner && !isPrivileged) Utils.fail('FORBIDDEN', 'You cannot view this payslip.');
    var pay = Repo.requireRecord('Payroll', payslipRow.payroll_id, 'Payroll record');
    var employee = Repo.employee(payslipRow.employee_id) || {};
    var calculation = Utils.safeParseJson(pay.calculation_json, {});
    var run = Repo.find('Payroll_Runs', pay.run_id) || {};
    var company = {
      name: Settings.text('COMPANY_NAME', 'FOCUSON HRMS'),
      address: Settings.text('COMPANY_ADDRESS', ''),
      logoUrl: Settings.text('COMPANY_LOGO_URL', ''),
      watermark: Settings.text('DOCUMENT_WATERMARK_TEXT', ''),
      headerNote: Settings.text('PAYSLIP_HEADER_NOTE', ''),
      footerNote: Settings.text('PAYSLIP_FOOTER_NOTE', ''),
      currency: Settings.text('CURRENCY_SYMBOL', '₹'),
      pfCode: Settings.text('COMPANY_PF_CODE', ''),
      esiCode: Settings.text('COMPANY_ESI_CODE', '')
    };
    Audit.logEvent(isOwner ? 'PAYSLIP_VIEWED' : 'PAYSLIP_VIEWED_BY_HR', authentication.actor.employeeId, 'Payslips', payslipRow.id, 'SUCCESS', { employeeId: payslipRow.employee_id, period: payslipRow.period }, {});
    return {
      payslip: {
        id: payslipRow.id, number: payslipRow.document_number || '', period: payslipRow.period,
        releasedAt: Utils.toIso(payslipRow.released_at), runState: String(run.run_state || '').toUpperCase(),
        employee: {
          employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '',
          department: employee.department || '', designation: employee.designation || '',
          branch: employee.branch || '', joiningDate: String(employee.joining_date || '').slice(0, 10),
          panNumber: Settings.bool('SHOW_EMPLOYEE_ID_ON_PAYSLIP', true) ? (employee.pan_number || '') : '',
          pfUan: employee.pf_uan || '', esiNumber: employee.esi_number || '',
          bankAccountNumber: employee.bank_account_number ? String(employee.bank_account_number).slice(-4) : '',
          bankName: employee.bank_name || ''
        },
        paidDays: Utils.numberOrZero(pay.paid_days), lopDays: Utils.numberOrZero(pay.lop_days),
        earnings: Utils.safeParseJson(pay.earnings_json, []),
        deductions: Utils.safeParseJson(pay.deductions_json, []),
        employerContributions: calculation.employerContributions || [],
        gross: Utils.numberOrZero(pay.gross_pay),
        totalDeductions: Utils.numberOrZero(pay.total_deductions),
        net: Utils.numberOrZero(pay.net_pay),
        attendance: calculation.attendance || {}
      },
      company: company
    };
  }

  /** Statutory register for a released run (PF, ESI, PT, TDS). */
  function statutoryReport(authentication, payload) {
    var run = Repo.requireRecord('Payroll_Runs', payload.runId, 'Payroll run');
    var records = Database.getAllCached('Payroll').filter(function (row) {
      return row.run_id === run.id && String(row.status).toUpperCase() !== 'DELETED';
    });
    var config = statutory();
    var rows = records.map(function (record) {
      var employee = Repo.employee(record.employee_id) || {};
      var calculation = Utils.safeParseJson(record.calculation_json, {});
      var deductions = Utils.safeParseJson(record.deductions_json, []);
      var employer = calculation.employerContributions || [];
      function pick(list, code) {
        var found = list.filter(function (line) { return line.code === code; });
        return found.length ? Utils.numberOrZero(found[0].amount) : 0;
      }
      return {
        employeeId: record.employee_id, employeeName: employee.display_name || '',
        pfUan: employee.pf_uan || '', esiNumber: employee.esi_number || '', pan: employee.pan_number || '',
        pfWage: Utils.numberOrZero(calculation.pfWage), esiWage: Utils.numberOrZero(calculation.esiWage),
        pfEmployee: pick(deductions, 'PF_EE'), pfEmployer: pick(employer, 'PF_ER'),
        eps: pick(employer, 'EPS'), edli: pick(employer, 'EDLI'), pfAdmin: pick(employer, 'PF_ADMIN'),
        esiEmployee: pick(deductions, 'ESI_EE'), esiEmployer: pick(employer, 'ESI_ER'),
        pt: pick(deductions, 'PT'), tds: pick(deductions, 'TDS'),
        gross: Utils.numberOrZero(record.gross_pay), net: Utils.numberOrZero(record.net_pay),
        flags: calculation.flags || []
      };
    });
    var totals = {};
    ['pfEmployee', 'pfEmployer', 'eps', 'edli', 'pfAdmin', 'esiEmployee', 'esiEmployer', 'pt', 'tds', 'gross', 'net'].forEach(function (key) {
      totals[key] = Utils.round2(rows.reduce(function (sum, row) { return sum + row[key]; }, 0));
    });
    return {
      period: run.period, rows: rows, totals: totals,
      config: {
        pfEnabled: Boolean(config.pf && config.pf.enabled), esiEnabled: Boolean(config.esi && config.esi.enabled),
        ptEnabled: Boolean(config.pt && config.pt.enabled), tdsEnabled: Boolean(config.tds && config.tds.enabled),
        caVerified: config.caVerified
      }
    };
  }

  /** Reports module reads from these helpers. */
  function payrollSummary(period) {
    var rows = Database.getAllCached('Payroll').filter(function (row) {
      return row.period === period && String(row.status).toUpperCase() !== 'DELETED';
    });
    return {
      period: period, count: rows.length,
      gross: Utils.round2(rows.reduce(function (total, row) { return total + Utils.numberOrZero(row.gross_pay); }, 0)),
      net: Utils.round2(rows.reduce(function (total, row) { return total + Utils.numberOrZero(row.net_pay); }, 0))
    };
  }

  return {
    statutory: statutory,
    structureFor: structureFor,
    summaryOf: summaryOf,
    salaryIndex: salaryIndex,
    structureDetail: structureDetail,
    saveStructure: saveStructure,
    salaryRevision: salaryRevision,
    onRevisionDecision: onRevisionDecision,
    runs: runs,
    prepare: prepare,
    runDetail: runDetail,
    transition: transition,
    myPayslips: myPayslips,
    payslip: payslip,
    statutoryReport: statutoryReport,
    computeStatutory: computeStatutory,
    payrollSummary: payrollSummary,
    defaultComponents: defaultComponents
  };
})();
