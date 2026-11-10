/**
 * FOCUSON HRMS - Reports & Exports Engine (Google Apps Script)
 * Scope-aware muster roll, payroll register, headcount, and CSV exports.
 */

var Reports = (function() {
  function getMusterRoll(monthYear, actor) {
    Permissions.check(actor, 'attendance.export');
    var year = parseInt(monthYear.substring(0, 4), 10);
    var logs = Database.getAll('Attendance', { year: year });
    var emps = Database.getAll('Employees');

    var results = [];
    for (var e = 0; e < emps.length; e++) {
      var emp = emps[e];
      if (emp.status !== 'ACTIVE') continue;

      var dailyMap = {};
      for (var d = 1; d <= 31; d++) {
        var dayStr = (d < 10 ? '0' + d : '' + d);
        dailyMap[dayStr] = '-';
      }

      for (var l = 0; l < logs.length; l++) {
        var log = logs[l];
        if (log.employee_id === emp.id && log.date.startsWith(monthYear)) {
          var day = log.date.substring(8, 10);
          dailyMap[day] = log.status_flag === 'PRESENT' ? 'P' : (log.status_flag === 'HALF_DAY' ? 'HD' : 'F');
        }
      }

      results.push({
        employeeId: emp.id,
        name: (emp.first_name + ' ' + (emp.last_name || '')).trim(),
        department: emp.department,
        attendance: dailyMap
      });
    }

    return results;
  }

  function getHeadcount(actor) {
    var emps = Database.getAllCached('Employees');
    var activeCount = 0;
    var deptCounts = {};

    for (var i = 0; i < emps.length; i++) {
      if (emps[i].status === 'ACTIVE') {
        activeCount++;
        var dept = emps[i].department || 'General';
        deptCounts[dept] = (deptCounts[dept] || 0) + 1;
      }
    }

    return {
      totalActive: activeCount,
      byDepartment: deptCounts
    };
  }

  return {
    getMusterRoll: getMusterRoll,
    getHeadcount: getHeadcount
  };
})();
