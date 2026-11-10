/**
 * FOCUSON HRMS - Payroll & Statutory Engine (Google Apps Script)
 * Maker-checker segregation of duties, CA statutory parameter validation,
 * LOP deduction, and bank transfer export.
 */

var Payroll = (function() {
  var MANDATORY_STATUTORY_KEYS = [
    'STATUTORY_PF_EMPLOYEE_PERCENT',
    'STATUTORY_PF_EMPLOYER_PERCENT',
    'STATUTORY_PF_WAGE_CEILING',
    'STATUTORY_ESI_EMPLOYEE_PERCENT',
    'STATUTORY_ESI_EMPLOYER_PERCENT',
    'STATUTORY_ESI_WAGE_CEILING',
    'STATUTORY_PAYABLE_DAYS_DIVISOR'
  ];

  /**
   * Retrieves CA-configured statutory settings from Company_Settings.
   * Throws detailed error if any mandatory statutory rate is unconfigured.
   */
  function getValidatedStatutorySettings() {
    var settings = Database.getAllCached('Company_Settings');
    var map = {};
    for (var i = 0; i < settings.length; i++) {
      map[settings[i].setting_key] = settings[i].setting_value;
    }

    var missing = [];
    for (var m = 0; m < MANDATORY_STATUTORY_KEYS.length; m++) {
      var k = MANDATORY_STATUTORY_KEYS[m];
      if (map[k] === undefined || map[k] === null || map[k] === '') {
        missing.push(k);
      }
    }

    if (missing.length > 0) {
      throw {
        code: 'VALIDATION',
        message: 'Payroll execution blocked: Missing mandatory statutory configuration (' + missing.join(', ') + '). Super Admin / HR must enter these CA-verified parameters in Settings > Statutory.'
      };
    }

    return {
      pfEmployeeRate: parseFloat(map['STATUTORY_PF_EMPLOYEE_PERCENT']) / 100,
      pfEmployerRate: parseFloat(map['STATUTORY_PF_EMPLOYER_PERCENT']) / 100,
      pfCeiling: parseFloat(map['STATUTORY_PF_WAGE_CEILING']),
      esiEmployeeRate: parseFloat(map['STATUTORY_ESI_EMPLOYEE_PERCENT']) / 100,
      esiEmployerRate: parseFloat(map['STATUTORY_ESI_EMPLOYER_PERCENT']) / 100,
      esiCeiling: parseFloat(map['STATUTORY_ESI_WAGE_CEILING']),
      divisor: parseInt(map['STATUTORY_PAYABLE_DAYS_DIVISOR'], 10) || 30,
      ptFixedAmount: parseFloat(map['STATUTORY_PT_FIXED_AMOUNT'] || '200')
    };
  }

  /**
   * Prepares draft monthly payroll run.
   */
  function prepareRun(monthYear, actor) {
    Permissions.check(actor, 'payroll.prepare');

    // Rule 6: Validate that required statutory parameters are set by CA/Admin
    var stat = getValidatedStatutorySettings();

    // Check existing run for this month
    var runs = Database.getAll('Payroll_Runs');
    var existingRun = null;
    for (var r = 0; r < runs.length; r++) {
      if (runs[r].month_year === monthYear && runs[r].status !== 'DELETED') {
        existingRun = runs[r];
        break;
      }
    }

    if (existingRun && existingRun.run_state !== 'DRAFT') {
      throw { code: 'CONFLICT', message: 'Payroll run for ' + monthYear + ' already exists in state ' + existingRun.run_state + '.' };
    }

    var runId = existingRun ? existingRun.id : ('payrun_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16));
    var nowIso = Utils.nowIso();

    var runRecord = {
      id: runId,
      month_year: monthYear,
      prepared_by: actor.employeeId,
      prepared_at: nowIso,
      verified_by: '',
      verified_at: '',
      approved_by: '',
      approved_at: '',
      released_by: '',
      released_at: '',
      run_state: 'PREPARED'
    };

    if (existingRun) {
      Database.update('Payroll_Runs', existingRun.id, runRecord, actor.employeeId);
    } else {
      Database.insert('Payroll_Runs', runRecord, actor.employeeId);
    }

    // Process employees and compute payable days and prorated earnings
    var emps = Database.getAll('Employees');
    var year = parseInt(monthYear.substring(0, 4), 10);
    var attLogs = Database.getAll('Attendance', { year: year });

    var totalNetPayout = 0;
    var processedCount = 0;

    for (var e = 0; e < emps.length; e++) {
      var emp = emps[e];
      if (emp.status !== 'ACTIVE') continue;

      var monthlyGross = parseFloat(emp.gross_salary || emp.basic_salary || 0);
      if (monthlyGross <= 0) continue;

      // Count present days in month
      var presentDays = 0;
      for (var a = 0; a < attLogs.length; a++) {
        if (attLogs[a].employee_id === emp.id && attLogs[a].date.startsWith(monthYear) && attLogs[a].status !== 'DELETED') {
          if (attLogs[a].status_flag === 'PRESENT' || attLogs[a].status_flag === 'ON_DUTY') {
            presentDays += 1;
          } else if (attLogs[a].status_flag === 'HALF_DAY') {
            presentDays += 0.5;
          }
        }
      }

      // Standard payable days calculation: Default 30 - (30 - present)
      var paidDays = Math.min(stat.divisor, presentDays > 0 ? presentDays : 26); // Default baseline if attendance not locked
      var lopDays = Math.max(0, stat.divisor - paidDays);

      var earnedGross = Math.round((monthlyGross / stat.divisor) * paidDays);
      var basicComponent = Math.round(earnedGross * 0.5); // 50% basic rule

      // PF calculation
      var pfWage = Math.min(basicComponent, stat.pfCeiling);
      var pfDeduction = Math.round(pfWage * stat.pfEmployeeRate);

      // ESI calculation
      var esiDeduction = (earnedGross <= stat.esiCeiling) ? Math.round(earnedGross * stat.esiEmployeeRate) : 0;

      // Professional Tax (PT)
      var ptDeduction = earnedGross > 10000 ? stat.ptFixedAmount : 0;

      var totalDeductions = pfDeduction + esiDeduction + ptDeduction;
      var netPayable = Math.max(0, earnedGross - totalDeductions);

      totalNetPayout += netPayable;
      processedCount++;

      var payItem = {
        id: 'pay_' + runId + '_' + emp.id,
        payroll_run_id: runId,
        employee_id: emp.id,
        paid_days: paidDays,
        lop_days: lopDays,
        gross_earnings: earnedGross,
        total_deductions: totalDeductions,
        net_payable: netPayable
      };

      Database.insert('Payroll', payItem, actor.employeeId);
    }

    Audit.logEvent('PAYROLL_PREPARED', actor.employeeId, 'Payroll_Runs', runId, 'PREPARED', {
      monthYear: monthYear,
      processedEmployees: processedCount,
      totalNetPayout: totalNetPayout
    });

    return {
      runId: runId,
      state: 'PREPARED',
      processedCount: processedCount,
      totalNetPayout: totalNetPayout
    };
  }

  /**
   * Maker-Checker Step 1: Verification
   * Strictly enforces that the preparer cannot verify!
   */
  function verifyRun(runId, actor) {
    Permissions.check(actor, 'payroll.verify');
    var run = Database.getAll('Payroll_Runs');
    var target = null;
    for (var r = 0; r < run.length; r++) {
      if (run[r].id === runId) { target = run[r]; break; }
    }
    if (!target) throw { code: 'NOT_FOUND', message: 'Payroll run ' + runId + ' not found.' };

    // Enforce Segregation of Duties
    if (target.prepared_by === actor.employeeId) {
      Audit.logEvent('SOD_VIOLATION_PAYROLL_VERIFY', actor.employeeId, 'Payroll_Runs', runId, 'BLOCKED');
      throw { code: 'FORBIDDEN', message: 'Segregation of duties violation: The preparer cannot verify the same payroll run.' };
    }

    Database.update('Payroll_Runs', runId, {
      verified_by: actor.employeeId,
      verified_at: Utils.nowIso(),
      run_state: 'VERIFIED'
    }, actor.employeeId);

    Audit.logEvent('PAYROLL_VERIFIED', actor.employeeId, 'Payroll_Runs', runId, 'VERIFIED');
    return { success: true, run_state: 'VERIFIED' };
  }

  /**
   * Maker-Checker Step 2: Approval
   * Strictly enforces that neither the preparer nor the verifier can approve!
   */
  function approveRun(runId, actor) {
    Permissions.check(actor, 'payroll.approve');
    var run = Database.getAll('Payroll_Runs');
    var target = null;
    for (var r = 0; r < run.length; r++) {
      if (run[r].id === runId) { target = run[r]; break; }
    }
    if (!target) throw { code: 'NOT_FOUND', message: 'Payroll run ' + runId + ' not found.' };

    if (target.prepared_by === actor.employeeId || target.verified_by === actor.employeeId) {
      Audit.logEvent('SOD_VIOLATION_PAYROLL_APPROVE', actor.employeeId, 'Payroll_Runs', runId, 'BLOCKED');
      throw { code: 'FORBIDDEN', message: 'Segregation of duties violation: Neither the preparer nor the verifier can approve this payroll run.' };
    }

    Database.update('Payroll_Runs', runId, {
      approved_by: actor.employeeId,
      approved_at: Utils.nowIso(),
      run_state: 'APPROVED'
    }, actor.employeeId);

    Audit.logEvent('PAYROLL_APPROVED', actor.employeeId, 'Payroll_Runs', runId, 'APPROVED');
    return { success: true, run_state: 'APPROVED' };
  }

  /**
   * Release payroll run and publish payslips to employees.
   */
  function releaseRun(runId, actor) {
    Permissions.check(actor, 'payroll.release');
    var run = Database.getAll('Payroll_Runs');
    var target = null;
    for (var r = 0; r < run.length; r++) {
      if (run[r].id === runId) { target = run[r]; break; }
    }
    if (!target) throw { code: 'NOT_FOUND', message: 'Payroll run not found.' };

    if (target.run_state !== 'APPROVED') {
      throw { code: 'FORBIDDEN', message: 'Payroll run must be APPROVED before release.' };
    }

    Database.update('Payroll_Runs', runId, {
      released_by: actor.employeeId,
      released_at: Utils.nowIso(),
      run_state: 'RELEASED'
    }, actor.employeeId);

    Audit.logEvent('PAYROLL_RELEASED', actor.employeeId, 'Payroll_Runs', runId, 'RELEASED');
    return { success: true, run_state: 'RELEASED' };
  }

  /**
   * Generates bank transfer CSV string for disbursement.
   */
  function exportBankCsv(runId, actor) {
    Permissions.check(actor, 'payroll.export');
    var items = Database.getAll('Payroll');
    var emps = Database.getAll('Employees');

    var empMap = {};
    for (var e = 0; e < emps.length; e++) {
      empMap[emps[e].id] = emps[e];
    }

    var lines = ['Employee ID,Beneficiary Name,Bank Name,Account Number,IFSC Code,Amount,Payment Narration'];

    for (var i = 0; i < items.length; i++) {
      if (items[i].payroll_run_id === runId) {
        var emp = empMap[items[i].employee_id] || {};
        var name = (emp.first_name + ' ' + (emp.last_name || '')).trim();
        var acc = emp.bank_account_number || '';
        var ifsc = emp.bank_ifsc || '';
        var bank = emp.bank_name || '';
        var amount = items[i].net_payable || 0;
        lines.push([
          items[i].employee_id,
          '"' + name + '"',
          '"' + bank + '"',
          "'" + acc,
          ifsc,
          amount,
          'Salary ' + items[i].payroll_run_id
        ].join(','));
      }
    }

    return lines.join('\n');
  }

  return {
    prepareRun: prepareRun,
    verifyRun: verifyRun,
    approveRun: approveRun,
    releaseRun: releaseRun,
    exportBankCsv: exportBankCsv
  };
})();
