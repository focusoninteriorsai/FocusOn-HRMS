/** Scheduled jobs: session cleanup, accruals, auto attendance close, backups, reminders. */
var Maintenance = (function () {
  function run(actorId) {
    var actor = actorId || 'SYSTEM';
    var results = {};
    results.sessions = Auth.cleanupExpiredSessions();
    results.notifications = typeof Notifications !== 'undefined' ? Notifications.cleanup() : 0;
    results.attendanceClose = typeof Attendance !== 'undefined' ? Attendance.autoMarkAbsent(Utils.addDays(Utils.today(), -1)) : { marked: 0 };
    results.backup = Settings.bool('BACKUP_AUTO_DAILY', true) ? Backup.autoDaily() : { created: false };
    results.attendanceYear = ensureAttendanceYear(new Date().getFullYear()).getId() ? 'READY' : 'FAILED';
    Audit.logEvent('MAINTENANCE_RUN', actor, 'System', '', 'SUCCESS', results, {});
    return results;
  }

  function daily() {
    var results = {};
    results.sessions = Auth.cleanupExpiredSessions();
    results.notifications = typeof Notifications !== 'undefined' ? Notifications.cleanup() : 0;
    results.attendanceClose = typeof Attendance !== 'undefined' ? Attendance.autoMarkAbsent(Utils.addDays(Utils.today(), -1)) : { marked: 0 };
    results.backup = Backup.autoDaily();
    ensureAttendanceYear(new Date().getFullYear());
    Audit.logEvent('DAILY_MAINTENANCE', 'SYSTEM', 'System', '', 'SUCCESS', results, {});
    return results;
  }

  function monthlyAccrual() {
    var accrual = typeof Leave !== 'undefined' ? Leave.runAccrual('SYSTEM') : { credited: 0 };
    Audit.logEvent('MONTHLY_ACCRUAL', 'SYSTEM', 'Leave_Balances', '', 'SUCCESS', accrual, {});
    return accrual;
  }

  /** Reminds payroll owners when a month has no run, and flags missing check-outs. */
  function payrollReminder() {
    var period = Utils.addDays(Utils.today(), -1).slice(0, 7);
    var runs = Database.getAllCached('Payroll_Runs').filter(function (row) {
      return row.period === period && ['RELEASED', 'CLOSED'].indexOf(String(row.run_state).toUpperCase()) >= 0;
    });
    if (runs.length) return { reminded: 0 };
    var owners = Repo.employeeIdsWithPermission('payroll.prepare').concat(Repo.employeeIdsWithRole('SUPER_ADMIN'));
    if (typeof Notifications !== 'undefined') {
      Notifications.pushMany(owners, 'PAYROLL', 'Payroll pending for ' + period,
        'Attendance for ' + period + ' is ready to be closed and payroll prepared.', 'payroll');
    }
    var yesterday = Utils.addDays(Utils.today(), -1);
    var openRecords = Database.getAllCached('Attendance').filter(function (row) {
      return String(row.attendance_date).slice(0, 10) === yesterday && row.check_in_at && !row.check_out_at;
    });
    if (typeof Notifications !== 'undefined' && Settings.bool('NOTIFY_ATTENDANCE_MISSING', true)) {
      Notifications.pushMany(openRecords.map(function (row) { return row.employee_id; }), 'ATTENDANCE',
        'Missing check-out', 'You did not check out yesterday. Raise a regularization request if this is incorrect.', 'attendance');
    }
    return { reminded: owners.length, missingCheckOuts: openRecords.length };
  }

  function autoLockPreviousMonth() {
    var today = Utils.today();
    if (Number(today.slice(8, 10)) !== Settings.number('ATTENDANCE_LOCK_DAY', 5)) return { locked: false };
    var previous = Utils.addDays(Utils.monthRange(today).start, -1).slice(0, 7);
    var lock = Attendance.monthLock(previous);
    if (lock.locked) return { locked: false, reason: 'already locked' };
    var record = Database.insert('Attendance_Month_Locks', {
      period: previous, locked_by: 'SYSTEM', locked_at: Utils.nowIso()
    }, 'SYSTEM');
    Audit.logEvent('ATTENDANCE_AUTO_LOCKED', 'SYSTEM', 'Attendance_Month_Locks', record.id, 'SUCCESS', { period: previous }, {});
    return { locked: true, period: previous };
  }

  return {
    run: run,
    daily: daily,
    monthlyAccrual: monthlyAccrual,
    payrollReminder: payrollReminder,
    autoLockPreviousMonth: autoLockPreviousMonth
  };
})();
