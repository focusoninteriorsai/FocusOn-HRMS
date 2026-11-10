/**
 * Reporting and analytics. Every figure is aggregated from real stored records;
 * nothing is estimated unless a payroll default is explicitly configured.
 */
var Reports = (function () {
  function headcountReport(payload) {
    var employees = Repo.activeEmployees();
    var byDepartment = {};
    var byBranch = {};
    var byDesignation = {};
    var byType = {};
    var byGender = {};
    employees.forEach(function (employee) {
      var department = employee.department || 'Unassigned';
      var branch = employee.branch || 'Unassigned';
      var designation = employee.designation || 'Unassigned';
      byDepartment[department] = (byDepartment[department] || 0) + 1;
      byBranch[branch] = (byBranch[branch] || 0) + 1;
      byDesignation[designation] = (byDesignation[designation] || 0) + 1;
      byType[employee.employment_type || 'FULL_TIME'] = (byType[employee.employment_type || 'FULL_TIME'] || 0) + 1;
      var gender = employee.gender || 'Not specified';
      byGender[gender] = (byGender[gender] || 0) + 1;
    });
    var today = Utils.today();
    var joiners = employees.filter(function (employee) {
      return String(employee.joining_date || '').slice(0, 7) === Utils.monthOf(payload.month);
    });
    var exited = Database.getAllCached('Exit_Records').filter(function (row) {
      return String(row.exit_state).toUpperCase() === 'COMPLETED' && String(row.last_working_date || '').slice(0, 7) === Utils.monthOf(payload.month);
    });
    var tenure = employees.map(function (employee) {
      return employee.joining_date ? Utils.dayDiff(String(employee.joining_date).slice(0, 10), today) / 365.25 : 0;
    }).filter(function (value) { return value > 0; });
    return {
      report: 'headcount',
      generatedAt: Utils.nowIso(),
      total: employees.length,
      active: employees.filter(function (employee) { return String(employee.status).toUpperCase() === 'ACTIVE'; }).length,
      probation: employees.filter(function (employee) { return String(employee.employment_status || '').toUpperCase() === 'PROBATION'; }).length,
      notice: employees.filter(function (employee) { return String(employee.employment_status || '').toUpperCase() === 'NOTICE'; }).length,
      joiners: joiners.length,
      exits: exited.length,
      attritionPercent: employees.length ? Utils.round2(exited.length / employees.length * 100) : 0,
      averageTenureYears: tenure.length ? Utils.round2(tenure.reduce(function (sum, value) { return sum + value; }, 0) / tenure.length) : 0,
      newHires: joiners.map(function (employee) { return Repo.employeeSummary(employee); }),
      byDepartment: series(byDepartment), byBranch: series(byBranch),
      byDesignation: series(byDesignation), byType: series(byType), byGender: series(byGender),
      month: Utils.monthOf(payload.month)
    };
  }

  function series(map, limit) {
    var rows = Object.keys(map).map(function (key) { return { label: key, value: map[key] }; });
    rows.sort(function (left, right) { return right.value - left.value; });
    return limit ? rows.slice(0, limit) : rows;
  }

  function attendanceReport(payload) {
    var period = Utils.monthOf(payload.month);
    var employees = Repo.activeEmployees();
    var summaries = employees.map(function (employee) {
      var summary = Attendance.summarizeMonth(employee, period);
      return {
        employeeId: summary.employeeId, displayName: Repo.employeeName(summary.employeeId),
        department: employee.department || '', branch: employee.branch || '',
        presentDays: summary.presentDays, absentDays: summary.absentDays, leaveDays: summary.leaveDays,
        halfDays: summary.halfDays, lopDays: summary.lopDays, lateCount: summary.lateCount,
        workHours: Utils.round2(summary.totalWorkMinutes / 60), overtimeHours: Utils.round2(summary.overtimeMinutes / 60),
        workingDays: summary.workingDays
      };
    });
    summaries.sort(function (left, right) { return left.displayName.localeCompare(right.displayName); });
    var totals = {
      present: summaries.reduce(function (sum, row) { return sum + row.presentDays; }, 0),
      absent: summaries.reduce(function (sum, row) { return sum + row.absentDays; }, 0),
      leave: summaries.reduce(function (sum, row) { return sum + row.leaveDays; }, 0),
      lop: Utils.round2(summaries.reduce(function (sum, row) { return sum + row.lopDays; }, 0)),
      late: summaries.reduce(function (sum, row) { return sum + row.lateCount; }, 0),
      workHours: Utils.round2(summaries.reduce(function (sum, row) { return sum + row.workHours; }, 0))
    };
    var attendanceRate = totals.present + totals.absent > 0
      ? Utils.round2(totals.present / (totals.present + totals.absent) * 100) : 0;
    return { report: 'attendance', period: period, rows: summaries, totals: totals, attendanceRate: attendanceRate, lock: Attendance.monthLock(period), generatedAt: Utils.nowIso() };
  }

  function leaveReport(payload) {
    var year = Utils.numberOrZero(payload.year) || Leave.leaveYearFor(Utils.today());
    var types = Leave.leaveTypes();
    var applications = Database.getAllCached('Leave_Applications').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED' && String(row.start_date).slice(0, 4) === String(year);
    });
    var byType = {};
    var byDepartment = {};
    var byMonth = {};
    applications.forEach(function (row) {
      var approval = Workflow.statusFor('leave', row.id);
      var state = approval ? String(approval.status).toUpperCase() : String(row.status).toUpperCase();
      if (state !== 'APPROVED') return;
      var type = Repo.label('Leave_Types', row.leave_type_id) || 'Unknown';
      byType[type] = (byType[type] || 0) + Utils.numberOrZero(row.total_days);
      var employee = Repo.employee(row.employee_id) || {};
      var department = employee.department || 'Unassigned';
      byDepartment[department] = (byDepartment[department] || 0) + Utils.numberOrZero(row.total_days);
      var month = String(row.start_date).slice(0, 7);
      byMonth[month] = (byMonth[month] || 0) + Utils.numberOrZero(row.total_days);
    });
    var balances = [];
    Repo.activeEmployees().forEach(function (employee) {
      balances.push({ employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '', balances: Leave.balancesFor(Repo.employeeKey(employee), year) });
    });
    return {
      report: 'leave', year: year,
      byType: series(byType), byDepartment: series(byDepartment),
      byMonth: Object.keys(byMonth).sort().map(function (key) { return { label: key, value: Utils.round2(byMonth[key]) }; }),
      totalApprovedDays: Utils.round2(Object.keys(byType).reduce(function (sum, key) { return sum + byType[key]; }, 0)),
      applications: applications.length,
      balances: balances, leaveTypes: types, generatedAt: Utils.nowIso()
    };
  }

  function payrollReport(authentication, payload) {
    var period = Utils.monthOf(payload.month);
    var rows = Database.getAllCached('Payroll').filter(function (row) {
      return row.period === period && String(row.status).toUpperCase() !== 'DELETED';
    });
    var byDepartment = {};
    var componentTotals = {};
    var details = rows.map(function (row) {
      var employee = Repo.employee(row.employee_id) || {};
      var department = employee.department || 'Unassigned';
      byDepartment[department] = (byDepartment[department] || 0) + Utils.numberOrZero(row.net_pay);
      var earnings = Utils.safeParseJson(row.earnings_json, []);
      earnings.forEach(function (line) {
        componentTotals[line.name] = (componentTotals[line.name] || 0) + Utils.numberOrZero(line.amount);
      });
      return {
        employeeId: row.employee_id, displayName: employee.display_name || '',
        department: department, gross: Utils.numberOrZero(row.gross_pay),
        deductions: Utils.numberOrZero(row.total_deductions), net: Utils.numberOrZero(row.net_pay)
      };
    });
    details.sort(function (left, right) { return right.net - left.net; });
    return {
      report: 'payroll', period: period,
      rows: details,
      totals: {
        employees: details.length,
        gross: Utils.round2(details.reduce(function (sum, row) { return sum + row.gross; }, 0)),
        deductions: Utils.round2(details.reduce(function (sum, row) { return sum + row.deductions; }, 0)),
        net: Utils.round2(details.reduce(function (sum, row) { return sum + row.net; }, 0))
      },
      byDepartment: series(byDepartment), componentTotals: series(componentTotals, 20),
      run: Database.getAllCached('Payroll_Runs').filter(function (row) { return row.period === period; }).map(function (row) {
        return { id: row.id, state: String(row.run_state).toUpperCase() };
      })[0] || null,
      generatedAt: Utils.nowIso()
    };
  }

  function expiryReport(payload) {
    var employees = Repo.activeEmployees();
    var today = Utils.today();
    var probation = employees.filter(function (employee) {
      var end = String(employee.probation_end_date || '').slice(0, 10);
      return end && end >= today && end <= Utils.addDays(today, 60);
    }).map(function (employee) {
      var end = String(employee.probation_end_date).slice(0, 10);
      return { employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '', date: end, daysLeft: Utils.dayDiff(today, end) };
    });
    var confirmations = employees.filter(function (employee) {
      var end = String(employee.confirmation_date || '').slice(0, 10);
      return end && end >= today && end <= Utils.addDays(today, 60);
    }).map(function (employee) {
      var end = String(employee.confirmation_date).slice(0, 10);
      return { employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '', date: end, daysLeft: Utils.dayDiff(today, end) };
    });
    var documents = Documents.expiring({}, {}).items;
    var birthdays = employees.filter(function (employee) {
      var birth = String(employee.date_of_birth || '').slice(0, 10);
      if (!birth) return false;
      var thisYear = today.slice(0, 4) + birth.slice(4);
      return thisYear >= today && thisYear <= Utils.addDays(today, 30);
    }).map(function (employee) {
      var birth = String(employee.date_of_birth).slice(0, 10);
      return { employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '', date: today.slice(0, 4) + birth.slice(4) };
    });
    var anniversaries = employees.filter(function (employee) {
      var joining = String(employee.joining_date || '').slice(0, 10);
      if (!joining) return false;
      var thisYear = today.slice(0, 4) + joining.slice(4);
      return thisYear >= today && thisYear <= Utils.addDays(today, 30);
    }).map(function (employee) {
      var joining = String(employee.joining_date).slice(0, 10);
      return {
        employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '',
        date: today.slice(0, 4) + joining.slice(4),
        years: Number(today.slice(0, 4)) - Number(joining.slice(0, 4))
      };
    });
    return { report: 'expiry', probation: probation, confirmations: confirmations, documents: documents, birthdays: birthdays, anniversaries: anniversaries, generatedAt: Utils.nowIso() };
  }

  function dashboardSummary(authentication, payload) {
    var actor = authentication.actor;
    var employees = Repo.activeEmployees();
    var canSeeAll = actor.isSuperAdmin || actor.permissions.indexOf('employee.view') >= 0;
    var month = Utils.monthOf(payload.month);
    var today = Utils.today();
    var myToday = Attendance.today(authentication);
    var myLeave = Leave.myLeave(authentication, {});
    var announcements = Permissions.isFeatureEnabled('announcements') ? Announcements.list(authentication, {}).items.slice(0, 4) : [];
    var pendingApprovals = (actor.isSuperAdmin || actor.permissions.indexOf('workflow.inbox') >= 0) ? Workflow.openForApprover(actor.employeeId) : [];
    var myPayslips = Permissions.isFeatureEnabled('payslips') ? Payroll.myPayslips(authentication, {}).items.slice(0, 3) : [];
    var money = Permissions.isFeatureEnabled('expenses') || Permissions.isFeatureEnabled('advances') ? Money.overview(authentication) : null;
    var summary = {
      employee: { displayName: actor.displayName, employeeId: actor.employeeId, department: actor.department, designation: actor.designation, branch: actor.branch },
      today: myToday.day,
      shift: myToday.shift,
      leave: {
        balances: myLeave.balances.slice(0, 5),
        pending: myLeave.pendingCount,
        upcoming: myLeave.upcoming.slice(0, 3)
      },
      announcements: announcements,
      pendingApprovals: pendingApprovals.slice(0, 5).map(function (row) {
        var requestPayload = Utils.safeParseJson(row.payload_json, {});
        return {
          approvalId: row.id, requestType: row.request_type, requestTypeLabel: Workflow.humanType(row.request_type),
          requesterName: Repo.employeeName(row.requester_employee_id), summary: requestPayload.summary || '',
          dueAt: Utils.toIso(row.due_at)
        };
      }),
      pendingApprovalCount: pendingApprovals.length,
      payslips: myPayslips,
      money: money,
      quickLinks: quickLinks(actor)
    };
    if (canSeeAll) {
      summary.company = {
        headcount: employees.length,
        newJoiners: employees.filter(function (employee) { return String(employee.joining_date || '').slice(0, 7) === month; }).length,
        onLeaveToday: Repo.activeEmployees().filter(function (employee) {
          return Database.getAllCached('Leave_Applications').some(function (row) {
            return row.employee_id === Repo.employeeKey(employee) && String(row.status).toUpperCase() === 'APPROVED' &&
              String(row.start_date).slice(0, 10) <= today && String(row.end_date).slice(0, 10) >= today;
          });
        }).length,
        presentToday: Database.getAllCached('Attendance').filter(function (row) {
          return String(row.attendance_date).slice(0, 10) === today && row.check_in_at && String(row.status).toUpperCase() !== 'DELETED';
        }).length,
        openPositions: Permissions.isFeatureEnabled('recruitment')
          ? Database.getAllCached('Recruitment').filter(function (row) { return String(row.opening_status).toUpperCase() === 'OPEN'; }).length : 0,
        monthlyPayrollNet: (actor.isSuperAdmin || actor.permissions.indexOf('payroll.view') >= 0) ? Payroll.payrollSummary(month).net : null,
        pendingApprovalsAll: Database.getAllCached('Approvals').filter(function (row) { return String(row.status).toUpperCase() === 'PENDING'; }).length
      };
    }
    return summary;
  }

  function quickLinks(actor) {
    var links = [
      { path: '/attendance', label: 'Attendance', feature: 'attendance' },
      { path: '/leave', label: 'Leave', feature: 'leave' },
      { path: '/profile', label: 'My profile', feature: null },
      { path: '/payslips', label: 'Payslips', feature: 'payslips' },
      { path: '/requests', label: 'Approvals', feature: null },
      { path: '/documents', label: 'Documents', feature: 'documents' }
    ];
    return links.filter(function (link) { return !link.feature || Permissions.isFeatureEnabled(link.feature); });
  }

  function generate(authentication, payload) {
    var type = Utils.requireEnum(payload.type, ['headcount', 'attendance', 'leave', 'payroll', 'expiry'], 'Report type');
    var result;
    if (type === 'headcount') result = headcountReport(payload);
    else if (type === 'attendance') result = attendanceReport(payload);
    else if (type === 'leave') result = leaveReport(payload);
    else if (type === 'payroll') result = payrollReport(authentication, payload);
    else result = expiryReport(payload);
    result.type = type;
    return result;
  }

  function exportCsv(authentication, payload) {
    var type = Utils.requireEnum(payload.type, ['headcount', 'attendance', 'leave', 'payroll', 'expiry'], 'Report type');
    var data = generate(authentication, payload);
    var columns = [];
    var rows = [];
    if (type === 'headcount') {
      columns = [{ key: 'label', label: 'Department' }, { key: 'value', label: 'Headcount' }];
      rows = data.byDepartment;
    } else if (type === 'attendance') {
      columns = [
        { key: 'employeeId', label: 'Employee ID' }, { key: 'displayName', label: 'Name' },
        { key: 'department', label: 'Department' }, { key: 'presentDays', label: 'Present' },
        { key: 'absentDays', label: 'Absent' }, { key: 'leaveDays', label: 'Leave' },
        { key: 'lopDays', label: 'LOP' }, { key: 'lateCount', label: 'Late' },
        { key: 'workHours', label: 'Work hours' }
      ];
      rows = data.rows;
    } else if (type === 'leave') {
      columns = [{ key: 'label', label: 'Leave type' }, { key: 'value', label: 'Approved days' }];
      rows = data.byType;
    } else if (type === 'payroll') {
      columns = [
        { key: 'employeeId', label: 'Employee ID' }, { key: 'displayName', label: 'Name' },
        { key: 'department', label: 'Department' }, { key: 'gross', label: 'Gross' },
        { key: 'deductions', label: 'Deductions' }, { key: 'net', label: 'Net pay' }
      ];
      rows = data.rows;
    } else {
      columns = [{ key: 'employeeId', label: 'Employee ID' }, { key: 'displayName', label: 'Name' }, { key: 'date', label: 'Date' }];
      rows = data.probation.concat(data.confirmations);
    }
    var csv = Utils.toCsv(columns, rows);
    Audit.logEvent('REPORT_EXPORTED', authentication.actor.employeeId, 'Reports', type, 'SUCCESS', { rows: rows.length }, {});
    return { fileName: type + '-' + Utils.today() + '.csv', csv: csv, base64: Utils.toBase64(csv), rows: rows.length };
  }

  return {
    generate: generate,
    exportCsv: exportCsv,
    dashboardSummary: dashboardSummary,
    headcountReport: headcountReport,
    attendanceReport: attendanceReport,
    leaveReport: leaveReport,
    payrollReport: payrollReport,
    expiryReport: expiryReport
  };
})();
