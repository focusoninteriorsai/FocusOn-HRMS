/**
 * FOCUSON HRMS - Leave Management Engine (Google Apps Script)
 * Leave balances, leave applications, calendar availability, and workflow routing.
 */

var Leave = (function() {
  function getLeaveTypes() {
    return Database.getAllCached('Leave_Types');
  }

  function getMyBalances(employeeId) {
    var year = new Date().getFullYear();
    var balances = Database.getAll('Leave_Balances');
    var results = [];

    for (var i = 0; i < balances.length; i++) {
      if (balances[i].employee_id === employeeId && parseInt(balances[i].year, 10) === year) {
        results.push(balances[i]);
      }
    }

    // If balances not yet initialized for this year, return defaults from Leave_Types
    if (results.length === 0) {
      var types = getLeaveTypes();
      for (var t = 0; t < types.length; t++) {
        var quota = parseFloat(types[t].annual_quota || '12');
        results.push({
          leave_type_code: types[t].code,
          year: year,
          opening: quota,
          accrued: quota,
          consumed: 0,
          balance: quota
        });
      }
    }

    return results;
  }

  function applyLeave(payload, actor) {
    if (!payload.leave_type_code || !payload.start_date || !payload.end_date) {
      throw { code: 'VALIDATION', message: 'Leave type, start date, and end date are required.' };
    }

    var start = new Date(payload.start_date);
    var end = new Date(payload.end_date);
    if (end < start) {
      throw { code: 'VALIDATION', message: 'End date cannot be prior to start date.' };
    }

    var diffDays = Math.round((end - start) / (1000 * 60 * 60 * 24)) + 1;
    var totalDays = payload.is_half_day ? 0.5 : diffDays;

    var appId = 'lv_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);

    Database.insert('Leave_Applications', {
      id: appId,
      employee_id: actor.employeeId,
      leave_type_code: payload.leave_type_code,
      start_date: payload.start_date,
      end_date: payload.end_date,
      total_days: totalDays,
      is_half_day: payload.is_half_day ? 'TRUE' : 'FALSE',
      reason: payload.reason || ''
    }, actor.employeeId);

    // Create approval record
    var emp = null;
    var emps = Database.getAllCached('Employees');
    for (var e = 0; e < emps.length; e++) {
      if (emps[e].id === actor.employeeId) { emp = emps[e]; break; }
    }

    var approverId = (emp && emp.reporting_manager_id) ? emp.reporting_manager_id : 'SUPERADMIN';

    Database.insert('Approvals', {
      id: 'appr_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      request_type: 'LEAVE',
      request_id: appId,
      applicant_id: actor.employeeId,
      current_step_id: 'step_mgr',
      current_approver_id: approverId,
      overall_status: 'PENDING'
    }, actor.employeeId);

    Audit.logEvent('LEAVE_APPLIED', actor.employeeId, 'Leave_Applications', appId, 'PENDING', {
      leaveType: payload.leave_type_code,
      days: totalDays,
      approver: approverId
    });

    return { success: true, applicationId: appId, totalDays: totalDays };
  }

  function getTeamCalendar(monthYear, actor) {
    var applications = Database.getAll('Leave_Applications');
    var calendar = [];

    for (var i = 0; i < applications.length; i++) {
      var app = applications[i];
      if (app.status === 'APPROVED' || app.status === 'ACTIVE') {
        if (app.start_date.startsWith(monthYear) || app.end_date.startsWith(monthYear)) {
          calendar.push({
            employeeId: app.employee_id,
            leaveType: app.leave_type_code,
            startDate: app.start_date,
            endDate: app.end_date,
            totalDays: app.total_days
          });
        }
      }
    }

    return calendar;
  }

  return {
    getLeaveTypes: getLeaveTypes,
    getMyBalances: getMyBalances,
    applyLeave: applyLeave,
    getTeamCalendar: getTeamCalendar
  };
})();
