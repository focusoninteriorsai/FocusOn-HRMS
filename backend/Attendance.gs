/**
 * Attendance: self check-in/out with server-side geofence evaluation, employee and
 * HR registers, corrections with maker-checker, month locking and the daily close.
 */
var Attendance = (function () {
  var STATES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE', 'HOLIDAY', 'WEEKEND', 'ON_DUTY', 'WORK_FROM_HOME', 'NOT_MARKED'];
  var SELF_MARK_STATES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'WORK_FROM_HOME', 'ON_DUTY'];
  var OUTSIDE_BEHAVIOURS = ['BLOCK', 'FLAG', 'ALLOW'];

  function currentYear() {
    return Number(Utils.today().slice(0, 4));
  }

  function recordFor(employeeId, dateText, year) {
    var rows = Database.getAllCached('Attendance');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].employee_id === employeeId && String(rows[i].attendance_date).slice(0, 10) === dateText && String(rows[i].status).toUpperCase() !== 'DELETED') return rows[i];
    }
    return null;
  }

  function cacheAttendance() {
    // All attendance reads use the cached table for the current year only.
    return Database.getAllCached('Attendance');
  }

  function stateOf(record) {
    if (!record) return 'NOT_MARKED';
    var raw = String(record.attendance_state || '').toUpperCase();
    if (raw) return raw;
    if (record.check_in_at) return 'PRESENT';
    if (String(record.status).toUpperCase() === 'ABSENT') return 'ABSENT';
    return 'NOT_MARKED';
  }

  function shiftFor(employeeRow) {
    var shift = Repo.shiftFor(employeeRow);
    if (!shift) {
      return { id: '', name: 'Standard', start: '09:30', end: '18:30', breakMinutes: 60, graceMinutes: Settings.number('ATTENDANCE_GRACE_MINUTES', 10) };
    }
    var rules = Utils.safeParseJson(shift.rules_json, {});
    return {
      id: shift.id, name: shift.name || 'Shift',
      start: shift.start_time || '09:30', end: shift.end_time || '18:30',
      breakMinutes: Utils.numberOrZero(shift.break_minutes) || Utils.numberOrZero(rules.breakMinutes) || 0,
      graceMinutes: Utils.numberOrZero(shift.grace_minutes) || Settings.number('ATTENDANCE_GRACE_MINUTES', 10),
      rules: rules
    };
  }

  function haversineMeters(lat1, lng1, lat2, lng2) {
    var toRad = Math.PI / 180;
    var radius = 6371000;
    var dLat = (lat2 - lat1) * toRad;
    var dLng = (lng2 - lng1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * radius * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function geofenceResult(employeeRow, latitude, longitude, accuracy) {
    var enabled = Permissions.isFeatureEnabled('geofence');
    var requireLocation = Settings.bool('ATTENDANCE_REQUIRE_LOCATION', true);
    var geo = null;
    var assignedSite = null;
    var assignments = Database.getAllCached('Employee_Site_Assignment').filter(function (row) {
      return row.employee_id === Repo.employeeKey(employeeRow) && String(row.status).toUpperCase() === 'ACTIVE';
    });
    if (assignments.length) {
      var today = Utils.today();
      var active = assignments.filter(function (row) {
        return (!row.valid_from || String(row.valid_from).slice(0, 10) <= today) && (!row.valid_until || String(row.valid_until).slice(0, 10) >= today);
      });
      if (active.length) {
        var site = Repo.find('Sites', active[0].site_id);
        if (site && site.latitude !== '' && site.longitude !== '') {
          assignedSite = { id: site.id, name: site.name, latitude: Number(site.latitude), longitude: Number(site.longitude), radius: Number(site.radius_meters || Settings.number('GEOFENCE_DEFAULT_RADIUS_METERS', 150)), site: true };
        }
      }
    }
    if (!assignedSite) {
      geo = Repo.geoFor(employeeRow.branch_id);
      if (geo && geo.latitude !== '' && geo.longitude !== '') {
        assignedSite = {
          id: geo.id, name: geo.name || 'Office', latitude: Number(geo.latitude), longitude: Number(geo.longitude),
          radius: Number(geo.radius_meters || Settings.number('GEOFENCE_DEFAULT_RADIUS_METERS', 150)),
          behavior: String(geo.outside_behavior || 'FLAG').toUpperCase(),
          maxAccuracy: Number(geo.minimum_accuracy_meters || Settings.number('GEOFENCE_MAX_ACCURACY_METERS', 120)),
          site: false
        };
      }
    }
    if (!assignedSite) {
      return { required: requireLocation, configured: false, inside: null, distance: null, accuracy: accuracy === undefined ? null : accuracy, blocked: false, reason: 'No office location is configured. Ask HR to set the branch geofence.' };
    }
    if (latitude === undefined || latitude === null || latitude === '' || longitude === undefined || longitude === null || longitude === '') {
      return { required: requireLocation, configured: true, inside: null, distance: null, accuracy: null, blocked: enabled && requireLocation, reason: 'Location is required to mark attendance.', location: assignedSite };
    }
    var latitudeNumber = Utils.requireNumber(latitude, 'Latitude', { min: -90, max: 90 });
    var longitudeNumber = Utils.requireNumber(longitude, 'Longitude', { min: -180, max: 180 });
    var accuracyNumber = Utils.requireNumber(accuracy === '' || accuracy === undefined ? 0 : accuracy, 'GPS accuracy', { min: 0, max: 100000 });
    var distance = Math.round(haversineMeters(latitudeNumber, longitudeNumber, assignedSite.latitude, assignedSite.longitude));
    var inside = distance <= assignedSite.radius;
    var behavior = assignedSite.behavior || 'FLAG';
    var maximumAccuracy = assignedSite.maxAccuracy || Settings.number('GEOFENCE_MAX_ACCURACY_METERS', 120);
    var poorAccuracy = accuracyNumber > maximumAccuracy;
    return {
      required: requireLocation,
      configured: true,
      inside: inside,
      distance: distance,
      accuracy: accuracyNumber,
      poorAccuracy: poorAccuracy,
      blocked: enabled && requireLocation && !inside && behavior === 'BLOCK',
      reason: inside ? '' : 'You are ' + distance + ' m from ' + assignedSite.name + ' (allowed ' + assignedSite.radius + ' m).',
      location: { id: assignedSite.id, name: assignedSite.name, latitude: assignedSite.latitude, longitude: assignedSite.longitude, radius: assignedSite.radius }
    };
  }

  function workMinutes(checkInAt, checkOutAt, shift) {
    if (!checkInAt || !checkOutAt) return 0;
    var start = Utils.dateValue(checkInAt);
    var end = Utils.dateValue(checkOutAt);
    if (!start || !end || end.getTime() <= start.getTime()) return 0;
    var minutes = Math.round((end.getTime() - start.getTime()) / 60000) - Utils.numberOrZero(shift ? shift.breakMinutes : 0);
    return Math.max(0, minutes);
  }

  function classify(record, shift) {
    if (!record) return { state: 'NOT_MARKED', late: false, early: false, overtimeMinutes: 0 };
    var minutes = Utils.numberOrZero(record.work_minutes);
    var fullDay = Settings.number('ATTENDANCE_FULL_DAY_MINUTES', 480);
    var halfDay = Settings.number('ATTENDANCE_HALF_DAY_MINUTES', 240);
    var state = stateOf(record);
    if (['LEAVE', 'HOLIDAY', 'WEEKEND', 'ON_DUTY', 'WORK_FROM_HOME', 'ABSENT'].indexOf(state) >= 0) {
      return { state: state, late: false, early: false, overtimeMinutes: 0 };
    }
    if (!record.check_in_at) return { state: 'ABSENT', late: false, early: false, overtimeMinutes: 0 };
    if (!record.check_out_at) state = 'PRESENT';
    else if (minutes < halfDay) state = 'ABSENT';
    else if (minutes < fullDay) state = 'HALF_DAY';
    else state = 'PRESENT';
    var late = false;
    var early = false;
    if (shift) {
      var shiftStart = Utils.timeToMinutes(shift.start);
      var shiftEnd = Utils.timeToMinutes(shift.end);
      var checkIn = Utils.minutesSinceMidnight(record.check_in_at);
      var checkOut = Utils.minutesSinceMidnight(record.check_out_at);
      late = checkIn > shiftStart + Utils.numberOrZero(shift.graceMinutes);
      early = Boolean(record.check_out_at) && checkOut < shiftEnd - Utils.numberOrZero(shift.graceMinutes);
    }
    var overtimeAfter = Settings.number('ATTENDANCE_OVERTIME_AFTER_MINUTES', 540);
    return { state: state, late: late, early: early, overtimeMinutes: Math.max(0, minutes - overtimeAfter) };
  }

  function dayContext(employeeRow, dateText) {
    var holiday = Repo.holidayOn(dateText, employeeRow.branch_id);
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var leave = activeLeaveOn(Repo.employeeKey(employeeRow), dateText);
    return {
      holiday: holiday.length ? holiday[0] : null,
      isWeekend: workweek.indexOf(Utils.dayOfWeek(dateText)) < 0,
      leave: leave
    };
  }

  function activeLeaveOn(employeeId, dateText) {
    var rows = Database.getAllCached('Leave_Applications');
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      if (row.employee_id !== employeeId) continue;
      if (String(row.status).toUpperCase() !== 'APPROVED') continue;
      if (String(row.start_date).slice(0, 10) <= dateText && String(row.end_date).slice(0, 10) >= dateText) return row;
    }
    return null;
  }

  function dayView(employeeRow, dateText) {
    var record = recordFor(Repo.employeeKey(employeeRow), dateText, Number(dateText.slice(0, 4)));
    var shift = shiftFor(employeeRow);
    var context = dayContext(employeeRow, dateText);
    var classification = classify(record, shift);
    var state = classification.state;
    if (!record || state === 'NOT_MARKED') {
      if (context.holiday) state = 'HOLIDAY';
      else if (context.isWeekend) state = 'WEEKEND';
      else if (context.leave) state = 'LEAVE';
    }
    return {
      date: dateText,
      state: state,
      checkInAt: record ? Utils.toIso(record.check_in_at) : '',
      checkOutAt: record ? Utils.toIso(record.check_out_at) : '',
      workMinutes: record ? Utils.numberOrZero(record.work_minutes) : 0,
      insideGeofence: record ? (record.inside_geofence === '' || record.inside_geofence === undefined ? null : String(record.inside_geofence).toUpperCase() === 'TRUE') : null,
      distanceMeters: record && record.distance_meters !== '' ? Utils.numberOrZero(record.distance_meters) : null,
      flags: record ? Utils.safeParseJson(record.flags_json, []) : [],
      late: classification.late,
      early: classification.early,
      overtimeMinutes: classification.overtimeMinutes,
      holidayName: context.holiday ? context.holiday.name : '',
      leaveTypeId: context.leave ? context.leave.leave_type_id : '',
      markedBy: record ? record.marked_by || '' : '',
      note: record ? record.note || '' : '',
      recordId: record ? record.id : '',
      shift: shift.name
    };
  }

  /** Today panel for the employee dashboard and mobile quick actions. */
  function today(authentication) {
    var employee = authentication.employee;
    var dateText = Utils.today();
    var view = dayView(employee, dateText);
    var geo = Repo.geoFor(employee.branch_id);
    var shift = shiftFor(employee);
    return {
      date: dateText,
      day: view,
      shift: { name: shift.name, start: shift.start, end: shift.end, breakMinutes: shift.breakMinutes },
      geoLocation: geo ? { name: geo.name, latitude: Number(geo.latitude), longitude: Number(geo.longitude), radius: Number(geo.radius_meters) } : null,
      requireLocation: Settings.bool('ATTENDANCE_REQUIRE_LOCATION', true),
      requireSelfie: Settings.bool('ATTENDANCE_REQUIRE_SELFIE', false),
      allowWorkFromHome: true
    };
  }

  function markSelf(authentication, payload) {
    var actor = authentication.actor;
    var employee = authentication.employee;
    if (!Permissions.isFeatureEnabled('attendance')) Utils.fail('FORBIDDEN', 'Attendance is disabled.');
    var dateText = Utils.cleanString(payload.date) ? Utils.requireDate(payload.date, 'Date') : Utils.today();
    if (dateText > Utils.today()) Utils.fail('VALIDATION', 'Attendance cannot be marked for a future date.');
    var windowDays = Settings.number('ATTENDANCE_REGULARIZATION_DAYS', 15);
    if (Utils.dayDiff(dateText, Utils.today()) > windowDays) Utils.fail('VALIDATION', 'Self marking is limited to the last ' + windowDays + ' days. Use a regularization request.');
    var action = Utils.requireEnum(payload.action, ['CHECK_IN', 'CHECK_OUT'], 'Action');
    var kind = Utils.optionalEnum(payload.kind, ['OFFICE', 'WORK_FROM_HOME', 'ON_DUTY'], 'Attendance kind') || 'OFFICE';
    var shift = shiftFor(employee);
    var record = recordFor(actor.employeeId, dateText, Number(dateText.slice(0, 4)));
    var geo = geofenceResult(employee, payload.latitude, payload.longitude, payload.accuracy);
    if (kind === 'OFFICE' && geo.blocked) Utils.fail('FORBIDDEN', 'Check-in rejected: ' + geo.reason);
    var now = new Date();
    var flags = [];
    if (kind === 'OFFICE' && geo.configured && geo.inside === false) flags.push('OUTSIDE_GEOFENCE');
    if (geo.poorAccuracy) flags.push('LOW_GPS_ACCURACY');
    if (payload.selfieBase64 && Permissions.isFeatureEnabled('attendance_selfie')) flags.push('SELFIE_ATTACHED');

    if (action === 'CHECK_IN') {
      if (record && record.check_in_at) Utils.fail('CONFLICT', 'You have already checked in today.');
      var selfieId = '';
      if (payload.selfieBase64 && Permissions.isFeatureEnabled('attendance_selfie')) {
        selfieId = saveSelfie(actor.employeeId, dateText, payload.selfieBase64);
      }
      var base = {
        employee_id: actor.employeeId, attendance_date: dateText, shift_id: shift.id,
        check_in_at: now.toISOString(), check_out_at: '', work_minutes: 0,
        inside_geofence: geo.inside === null || geo.inside === undefined ? '' : (geo.inside ? 'TRUE' : 'FALSE'),
        distance_meters: geo.distance === null || geo.distance === undefined ? '' : geo.distance,
        accuracy_meters: geo.accuracy === null || geo.accuracy === undefined ? '' : geo.accuracy,
        raw_latitude: payload.latitude === undefined || payload.latitude === '' ? '' : Utils.requireNumber(payload.latitude, 'Latitude', { min: -90, max: 90 }),
        raw_longitude: payload.longitude === undefined || payload.longitude === '' ? '' : Utils.requireNumber(payload.longitude, 'Longitude', { min: -180, max: 180 }),
        selfie_file_id: selfieId,
        flags_json: JSON.stringify(flags),
        marked_by: actor.employeeId, attendance_state: 'PRESENT', note: Utils.cleanString(payload.note).slice(0, 500)
      };
      if (kind === 'WORK_FROM_HOME') base.attendance_state = 'WORK_FROM_HOME';
      if (kind === 'ON_DUTY') base.attendance_state = 'ON_DUTY';
      if (record) {
        var updated = Database.update('Attendance', record.id, base, actor.employeeId);
        Audit.logEvent('ATTENDANCE_CHECK_IN', actor.employeeId, 'Attendance', updated.id, 'SUCCESS', { kind: kind, inside: geo.inside, distance: geo.distance }, {});
        return { record: dayView(employee, dateText), message: 'Checked in at ' + Utils.formatTime(base.check_in_at) + '.' };
      }
      var created = Database.insert('Attendance', base, actor.employeeId);
      Audit.logEvent('ATTENDANCE_CHECK_IN', actor.employeeId, 'Attendance', created.id, 'SUCCESS', { kind: kind, inside: geo.inside, distance: geo.distance }, {});
      return { record: dayView(employee, dateText), message: 'Checked in at ' + Utils.formatTime(base.check_in_at) + '.' };
    }

    if (!record || !record.check_in_at) Utils.fail('CONFLICT', 'Check in before checking out.');
    if (record.check_out_at) Utils.fail('CONFLICT', 'You have already checked out today.');
    var minutes = workMinutes(record.check_in_at, now.toISOString(), shift);
    var checkOutFlags = Utils.safeParseJson(record.flags_json, []);
    if (kind === 'OFFICE' && geo.configured && geo.inside === false) checkOutFlags.push('CHECKOUT_OUTSIDE_GEOFENCE');
    var updatedRecord = Database.update('Attendance', record.id, {
      check_out_at: now.toISOString(), work_minutes: minutes,
      flags_json: JSON.stringify(Utils.csvUnique(checkOutFlags)),
      inside_geofence: geo.inside === null ? (record.inside_geofence || '') : (geo.inside ? 'TRUE' : 'FALSE')
    }, actor.employeeId);
    Audit.logEvent('ATTENDANCE_CHECK_OUT', actor.employeeId, 'Attendance', updatedRecord.id, 'SUCCESS', { minutes: minutes }, {});
    return {
      record: dayView(employee, dateText),
      message: 'Checked out. ' + Math.floor(minutes / 60) + 'h ' + (minutes % 60) + 'm recorded.'
    };
  }

  function saveSelfie(employeeId, dateText, base64) {
    var text = String(base64);
    var match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(text);
    if (!match) Utils.fail('VALIDATION', 'The selfie image could not be read.');
    var payload = match[2];
    if (payload.length > 900000) Utils.fail('VALIDATION', 'The selfie image is too large.');
    var folderId = PropertiesService.getScriptProperties().getProperty('HRMS_FOLDER_SELFIES_ID');
    if (!folderId) Utils.fail('SERVER', 'Private selfie storage is not configured. Run setupSystem().');
    var folder = DriveApp.getFolderById(folderId);
    var blob = Utilities.newBlob(Utilities.base64Decode(payload), 'image/' + match[1], employeeId + '_' + dateText + '_' + Date.now() + '.' + match[1]);
    var file = folder.createFile(blob);
    return file.getId();
  }

  function register(authentication, payload) {
    var actor = authentication.actor;
    var period = Utils.monthOf(payload.month);
    var range = Utils.monthRange(period);
    var singleDate = Utils.cleanString(payload.date);
    if (singleDate) Utils.requireDate(singleDate, 'Date');
    var rows = Repo.activeEmployees();
    var targetIds = [];
    if (payload.employeeId) {
      var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
      if (!Repo.canSeeEmployee(actor, employeeId) && !actor.isSuperAdmin) {
        Permissions.check(actor, 'attendance.view', { employee_id: employeeId }, { entity: 'Attendance', context: {} });
      }
      targetIds = [employeeId];
    } else if (actor.isSuperAdmin || actor.permissions.indexOf('attendance.markothers') >= 0 || actor.permissions.indexOf('attendance.view') >= 0) {
      var scopeIds = actor.isSuperAdmin ? null : (Repo.employeeIdsWithPermission('attendance.markothers').concat(Repo.employeeIdsWithPermission('attendance.view')));
      rows.forEach(function (row) {
        var id = Repo.employeeKey(row);
        if (id === actor.employeeId) { targetIds.push(id); return; }
        if (!scopeIds) { targetIds.push(id); return; }
        if (scopeIds.indexOf(id) >= 0) targetIds.push(id);
        else if (Repo.canSeeEmployee(actor, id)) targetIds.push(id);
      });
    } else {
      targetIds = [actor.employeeId];
    }
    if (payload.departmentId) targetIds = targetIds.filter(function (id) { var row = Repo.employee(id); return row && row.department_id === payload.departmentId; });
    if (payload.branchId) targetIds = targetIds.filter(function (id) { var row = Repo.employee(id); return row && row.branch_id === payload.branchId; });
    targetIds = Utils.csvUnique(targetIds);
    var pagination = Utils.paginate(targetIds.map(function (id) { return Repo.employee(id); }), payload, {
      searchFields: ['display_name', 'employee_id', 'department', 'designation'],
      sortFields: ['display_name', 'employee_id', 'department'],
      maxPageSize: 300
    });
    var dates = [];
    if (singleDate) dates = [singleDate];
    else {
      var start = range.start;
      var end = range.end;
      for (var cursor = start; cursor <= end; cursor = Utils.addDays(cursor, 1)) dates.push(cursor);
    }
    var attendanceRows = cacheAttendance();
    var leaveRows = Database.getAllCached('Leave_Applications');
    var holidaysRows = Database.getAllCached('Holidays');
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var employees = [];
    var summary = { present: 0, absent: 0, halfDay: 0, leave: 0, holiday: 0, weekend: 0, notMarked: 0, late: 0 };
    pagination.items.forEach(function (employeeRow) {
      if (!employeeRow) return;
      var employeeId = Repo.employeeKey(employeeRow);
      var shift = shiftFor(employeeRow);
      var days = dates.map(function (dateText) {
        var record = null;
        for (var i = 0; i < attendanceRows.length; i++) {
          var row = attendanceRows[i];
          if (row.employee_id === employeeId && String(row.attendance_date).slice(0, 10) === dateText && String(row.status).toUpperCase() !== 'DELETED') { record = row; break; }
        }
        var holiday = null;
        for (var h = 0; h < holidaysRows.length; h++) {
          if (String(holidaysRows[h].holiday_date).slice(0, 10) === dateText && (!holidaysRows[h].branch_id || holidaysRows[h].branch_id === employeeRow.branch_id)) { holiday = holidaysRows[h]; break; }
        }
        var leave = null;
        for (var l = 0; l < leaveRows.length; l++) {
          var leaveRow = leaveRows[l];
          if (leaveRow.employee_id === employeeId && String(leaveRow.status).toUpperCase() === 'APPROVED' &&
            String(leaveRow.start_date).slice(0, 10) <= dateText && String(leaveRow.end_date).slice(0, 10) >= dateText) { leave = leaveRow; break; }
        }
        var classification = classify(record, shift);
        var state = classification.state;
        if (!record || state === 'NOT_MARKED') {
          if (holiday) state = 'HOLIDAY';
          else if (workweek.indexOf(Utils.dayOfWeek(dateText)) < 0) state = 'WEEKEND';
          else if (leave) state = 'LEAVE';
        }
        if (state === 'PRESENT') summary.present += 1;
        else if (state === 'ABSENT') summary.absent += 1;
        else if (state === 'HALF_DAY') summary.halfDay += 1;
        else if (state === 'LEAVE') summary.leave += 1;
        else if (state === 'HOLIDAY') summary.holiday += 1;
        else if (state === 'WEEKEND') summary.weekend += 1;
        else summary.notMarked += 1;
        if (classification.late) summary.late += 1;
        return {
          date: dateText, state: state,
          checkInAt: record ? Utils.toIso(record.check_in_at) : '',
          checkOutAt: record ? Utils.toIso(record.check_out_at) : '',
          workMinutes: record ? Utils.numberOrZero(record.work_minutes) : 0,
          late: classification.late, overtimeMinutes: classification.overtimeMinutes,
          flags: record ? Utils.safeParseJson(record.flags_json, []) : [],
          distanceMeters: record && record.distance_meters !== '' ? Utils.numberOrZero(record.distance_meters) : null,
          recordId: record ? record.id : '',
          note: holiday ? holiday.name : (leave ? Repo.label('Leave_Types', leave.leave_type_id) : '')
        };
      });
      employees.push({
        employeeId: employeeId, displayName: employeeRow.display_name || employeeId,
        department: employeeRow.department || '', designation: employeeRow.designation || '',
        branch: employeeRow.branch || '', shift: shift.name, days: days,
        totals: totalsFromDays(days)
      });
    });
    return {
      period: singleDate || period,
      from: dates.length ? dates[0] : '',
      to: dates.length ? dates[dates.length - 1] : '',
      dates: dates,
      employees: employees,
      summary: summary,
      canMarkOthers: actor.isSuperAdmin || actor.permissions.indexOf('attendance.markothers') >= 0,
      canCorrect: actor.isSuperAdmin || actor.permissions.indexOf('attendance.correct') >= 0,
      canLock: actor.isSuperAdmin || actor.permissions.indexOf('attendance.lock') >= 0,
      lock: monthLock(period),
      page: pagination.page, pageCount: pagination.pageCount, total: pagination.total
    };
  }

  function totalsFromDays(days) {
    var totals = { present: 0, halfDay: 0, absent: 0, leave: 0, holiday: 0, weekend: 0, notMarked: 0, workMinutes: 0, overtimeMinutes: 0, late: 0, paidDays: 0 };
    days.forEach(function (day) {
      if (day.state === 'PRESENT') totals.present += 1;
      else if (day.state === 'HALF_DAY') totals.halfDay += 1;
      else if (day.state === 'ABSENT') totals.absent += 1;
      else if (day.state === 'LEAVE') totals.leave += 1;
      else if (day.state === 'HOLIDAY') totals.holiday += 1;
      else if (day.state === 'WEEKEND') totals.weekend += 1;
      else totals.notMarked += 1;
      totals.workMinutes += Utils.numberOrZero(day.workMinutes);
      totals.overtimeMinutes += Utils.numberOrZero(day.overtimeMinutes);
      if (day.late) totals.late += 1;
    });
    totals.paidDays = Utils.round2(totals.present + totals.halfDay * 0.5 + totals.leave + totals.holiday);
    return totals;
  }

  function monthLock(period) {
    var rows = Database.getAllCached('Attendance_Month_Locks').filter(function (row) {
      return row.period === period && String(row.status).toUpperCase() === 'ACTIVE';
    });
    if (!rows.length) return { locked: false, period: period };
    return { locked: true, period: period, lockedBy: rows[0].locked_by, lockedAt: Utils.toIso(rows[0].locked_at), id: rows[0].id };
  }

  /** HR manual marking and corrections. Maker-checker applies to finalized days. */
  function mark(authentication, payload) {
    var actor = authentication.actor;
    if (!Permissions.isFeatureEnabled('attendance')) Utils.fail('FORBIDDEN', 'Attendance is disabled.');
    if (!Settings.bool('ATTENDANCE_ALLOW_MANUAL', true) && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Manual marking is disabled in settings.');
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var employee = Repo.requireEmployee(employeeId);
    var dateText = Utils.requireDate(payload.date, 'Date');
    if (dateText > Utils.today()) Utils.fail('VALIDATION', 'Future attendance cannot be marked.');
    var state = Utils.requireEnum(payload.state, STATES, 'Attendance state');
    if (!actor.isSuperAdmin && employeeId !== actor.employeeId) {
      Permissions.check(actor, 'attendance.markothers', { employee_id: employeeId }, { entity: 'Attendance', write: true, context: {} });
    }
    var lock = monthLock(dateText.slice(0, 7));
    if (lock.locked && !payload.regularization) Utils.fail('CONFLICT', 'This month is locked. Reopen it or use a regularization request.');
    var shift = shiftFor(employee);
    var checkIn = Utils.cleanString(payload.checkInAt);
    var checkOut = Utils.cleanString(payload.checkOutAt);
    if (checkIn && !Utils.dateValue(checkIn)) Utils.fail('VALIDATION', 'The check-in time is invalid.');
    if (checkOut && !Utils.dateValue(checkOut)) Utils.fail('VALIDATION', 'The check-out time is invalid.');
    var minutes = checkIn && checkOut ? workMinutes(checkIn, checkOut, shift) : 0;
    var existing = recordFor(employeeId, dateText, Number(dateText.slice(0, 4)));
    var changes = {
      employee_id: employeeId, attendance_date: dateText, shift_id: shift.id,
      check_in_at: checkIn ? Utils.toIso(checkIn) : '', check_out_at: checkOut ? Utils.toIso(checkOut) : '',
      work_minutes: minutes, attendance_state: state, marked_by: actor.employeeId,
      note: Utils.cleanString(payload.note).slice(0, 500),
      inside_geofence: '', distance_meters: '', accuracy_meters: '', raw_latitude: '', raw_longitude: '',
      flags_json: JSON.stringify([actor.isSuperAdmin ? 'ADMIN_ENTRY' : 'HR_ENTRY'])
    };
    var record;
    if (existing) record = Database.update('Attendance', existing.id, changes, actor.employeeId);
    else record = Database.insert('Attendance', changes, actor.employeeId);
    Audit.logEvent('ATTENDANCE_MARKED', actor.employeeId, 'Attendance', record.id, 'SUCCESS', {
      employeeId: employeeId, date: dateText, state: state, checkIn: changes.check_in_at, checkOut: changes.check_out_at
    }, {});
    return { record: dayView(employee, dateText) };
  }

  /** Employee regularization request routed through the approval workflow. */
  function requestRegularization(authentication, payload) {
    var actor = authentication.actor;
    var dateText = Utils.requireDate(payload.date, 'Date');
    if (dateText > Utils.today()) Utils.fail('VALIDATION', 'Regularization cannot be requested for a future date.');
    var windowDays = Settings.number('ATTENDANCE_REGULARIZATION_DAYS', 15);
    if (Utils.dayDiff(dateText, Utils.today()) > windowDays) Utils.fail('VALIDATION', 'Regularization is only available for the last ' + windowDays + ' days.');
    var reason = Utils.requireString(payload, 'reason', { max: 4000, min: 10 });
    var checkIn = Utils.cleanString(payload.checkInAt);
    var checkOut = Utils.cleanString(payload.checkOutAt);
    if (!checkIn && !checkOut) Utils.fail('VALIDATION', 'Provide the corrected check-in or check-out time.');
    var request = Database.insert('Attendance_Regularization', {
      employee_id: actor.employeeId, attendance_date: dateText,
      requested_check_in_at: checkIn ? Utils.toIso(checkIn) : '',
      requested_check_out_at: checkOut ? Utils.toIso(checkOut) : '',
      reason: reason
    }, actor.employeeId);
    Workflow.start(authentication, 'regularization', request.id, { date: dateText, reason: reason }, {
      summary: 'Regularization for ' + dateText + ' — ' + reason.slice(0, 120)
    });
    Audit.logEvent('REGULARIZATION_REQUESTED', actor.employeeId, 'Attendance_Regularization', request.id, 'SUCCESS', { date: dateText }, {});
    return { requestId: request.id };
  }

  function myRegularizations(authentication) {
    var items = Database.getAllCached('Attendance_Regularization').filter(function (row) {
      return row.employee_id === authentication.actor.employeeId && String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var approval = Workflow.statusFor('regularization', row.id);
      return {
        id: row.id, date: String(row.attendance_date).slice(0, 10), reason: row.reason,
        checkInAt: Utils.toIso(row.requested_check_in_at), checkOutAt: Utils.toIso(row.requested_check_out_at),
        state: approval ? String(approval.status).toUpperCase() : String(row.status).toUpperCase(),
        createdAt: Utils.toIso(row.created_at)
      };
    });
    return { items: items, regularizationDays: Settings.number('ATTENDANCE_REGULARIZATION_DAYS', 15) };
  }

  function onDecision(approval, state, authentication) {
    var request = Repo.find('Attendance_Regularization', approval.request_id);
    if (!request) return;
    if (state !== 'APPROVED') {
      Database.update('Attendance_Regularization', request.id, { status: state === 'REJECTED' ? 'REJECTED' : state }, authentication.actor.employeeId);
      return;
    }
    mark(authentication, {
      employeeId: request.employee_id, date: String(request.attendance_date).slice(0, 10),
      checkInAt: request.requested_check_in_at, checkOutAt: request.requested_check_out_at,
      state: 'PRESENT', note: 'Regularized: ' + request.reason, regularization: true
    });
    Database.update('Attendance_Regularization', request.id, { status: 'APPROVED', approval_id: approval.id, month_lock_id: '' }, authentication.actor.employeeId);
  }

  /** Builds the monthly summary rows used by payroll and reports. */
  function summarizeMonth(employeeRow, period) {
    var range = Utils.monthRange(period);
    var employeeId = Repo.employeeKey(employeeRow);
    var rows = cacheAttendance();
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    var shift = shiftFor(employeeRow);
    var totals = { present: 0, halfDay: 0, absent: 0, leave: 0, holiday: 0, weekend: 0, notMarked: 0, workMinutes: 0, overtimeMinutes: 0, late: 0 };
    var leaveRows = Database.getAllCached('Leave_Applications');
    var holidayRows = Database.getAllCached('Holidays');
    for (var cursor = range.start; cursor <= range.end; cursor = Utils.addDays(cursor, 1)) {
      if (cursor > Utils.today()) break;
      var record = null;
      for (var i = 0; i < rows.length; i++) {
        if (rows[i].employee_id === employeeId && String(rows[i].attendance_date).slice(0, 10) === cursor) { record = rows[i]; break; }
      }
      var classification = classify(record, shift);
      var state = classification.state;
      if (!record || state === 'NOT_MARKED') {
        var holiday = holidayRows.some(function (row) { return String(row.holiday_date).slice(0, 10) === cursor && (!row.branch_id || row.branch_id === employeeRow.branch_id); });
        var leave = leaveRows.some(function (row) {
          return row.employee_id === employeeId && String(row.status).toUpperCase() === 'APPROVED' &&
            String(row.start_date).slice(0, 10) <= cursor && String(row.end_date).slice(0, 10) >= cursor;
        });
        if (holiday) state = 'HOLIDAY';
        else if (workweek.indexOf(Utils.dayOfWeek(cursor)) < 0) state = 'WEEKEND';
        else if (leave) state = 'LEAVE';
      }
      if (state === 'PRESENT') totals.present += 1;
      else if (state === 'HALF_DAY') totals.halfDay += 1;
      else if (state === 'ABSENT') totals.absent += 1;
      else if (state === 'LEAVE') totals.leave += 1;
      else if (state === 'HOLIDAY') totals.holiday += 1;
      else if (state === 'WEEKEND') totals.weekend += 1;
      else totals.notMarked += 1;
      totals.workMinutes += Utils.numberOrZero(record ? record.work_minutes : 0);
      if (classification.late) totals.late += 1;
      totals.overtimeMinutes += Utils.numberOrZero(classification.overtimeMinutes);
    }
    var workingDays = 0;
    var calendarDays = Utils.dayDiff(range.start, range.end) + 1;
    for (var day = range.start; day <= range.end; day = Utils.addDays(day, 1)) {
      if (workweek.indexOf(Utils.dayOfWeek(day)) >= 0) workingDays += 1;
    }
    var holidayCount = holidayRows.filter(function (row) {
      return String(row.holiday_date).slice(0, 7) === range.month && workweek.indexOf(Utils.dayOfWeek(String(row.holiday_date).slice(0, 10))) >= 0;
    }).length;
    // Days that were never marked are treated as payable and reported separately, so
    // payroll never silently cuts pay for missing data. Loss of pay is only applied to
    // days an administrator or the daily close explicitly marked absent.
    var lop = totals.absent;
    var paidDays = Math.max(0, Utils.round2(totals.present + totals.halfDay * 0.5 + totals.leave + Math.max(0, holidayCount) + totals.notMarked));
    return {
      employeeId: employeeId, period: range.month,
      presentDays: totals.present, absentDays: totals.absent, leaveDays: totals.leave, halfDays: totals.halfDay,
      holidayDays: holidayCount, weekendDays: totals.weekend, notMarkedDays: totals.notMarked,
      lopDays: Utils.round2(lop), paidDays: paidDays, lateCount: totals.late,
      totalWorkMinutes: totals.workMinutes, overtimeMinutes: totals.overtimeMinutes,
      workingDays: workingDays, calendarDays: calendarDays
    };
  }

  function monthly(authentication, payload) {
    var period = Utils.monthOf(payload.month);
    var employeeId = payload.employeeId ? Utils.normalizeEmployeeId(payload.employeeId) : authentication.actor.employeeId;
    if (employeeId !== authentication.actor.employeeId && !authentication.actor.isSuperAdmin) {
      Permissions.check(authentication.actor, 'attendance.view', { employee_id: employeeId }, { entity: 'Attendance', context: {} });
    }
    var employee = Repo.requireEmployee(employeeId);
    var summary = summarizeMonth(employee, period);
    var range = Utils.monthRange(period);
    var days = [];
    for (var cursor = range.start; cursor <= range.end; cursor = Utils.addDays(cursor, 1)) {
      if (cursor > Utils.today()) break;
      days.push(dayView(employee, cursor));
    }
    return { summary: summary, days: days, lock: monthLock(period), employee: Repo.employeeSummary(employee) };
  }

  function lockMonth(authentication, payload) {
    var actor = authentication.actor;
    var period = Utils.monthOf(payload.period);
    var existing = monthLock(period);
    if (existing.locked) Utils.fail('CONFLICT', 'This month is already locked.');
    var record = Database.insert('Attendance_Month_Locks', {
      period: period, locked_by: actor.employeeId, locked_at: Utils.nowIso()
    }, actor.employeeId);
    if (Settings.bool('ATTENDANCE_MONTHLY_SUMMARY', true)) {
      var employees = Repo.activeEmployees();
      employees.forEach(function (employee) {
        var summary = summarizeMonth(employee, period);
        var existingSummary = Database.findOne('Monthly_Attendance_Summary', function (row) {
          return row.employee_id === summary.employeeId && row.period === period && String(row.status).toUpperCase() === 'ACTIVE';
        }, { cached: true });
        var payloadRow = {
          employee_id: summary.employeeId, period: period,
          present_days: summary.presentDays, absent_days: summary.absentDays, leave_days: summary.leaveDays,
          half_days: summary.halfDays, holiday_days: summary.holidayDays, weekend_days: summary.weekendDays,
          lop_days: summary.lopDays, paid_days: summary.paidDays, late_count: summary.lateCount,
          total_work_minutes: summary.totalWorkMinutes, overtime_minutes: summary.overtimeMinutes,
          generated_at: Utils.nowIso()
        };
        if (existingSummary) Database.update('Monthly_Attendance_Summary', existingSummary.id, payloadRow, actor.employeeId);
        else Database.insert('Monthly_Attendance_Summary', payloadRow, actor.employeeId);
      });
    }
    Audit.logEvent('ATTENDANCE_MONTH_LOCKED', actor.employeeId, 'Attendance_Month_Locks', record.id, 'SUCCESS', { period: period }, {});
    return { locked: true, period: period };
  }

  function unlockMonth(authentication, payload) {
    var actor = authentication.actor;
    var period = Utils.monthOf(payload.period);
    var existing = monthLock(period);
    if (!existing.locked) Utils.fail('CONFLICT', 'This month is not locked.');
    var reason = Utils.requireString(payload, 'reason', { max: 4000, min: 10 });
    Database.update('Attendance_Month_Locks', existing.id, { status: 'DELETED', unlock_reason: reason }, actor.employeeId);
    Audit.logEvent('ATTENDANCE_MONTH_UNLOCKED', actor.employeeId, 'Attendance_Month_Locks', existing.id, 'SUCCESS', { period: period, reason: reason }, {});
    return { locked: false, period: period };
  }

  /** Nightly self-test-friendly close: marks unmarked working days absent. */
  function autoMarkAbsent(dateText) {
    if (!Settings.bool('ATTENDANCE_AUTO_MARK_ABSENT', true)) return { marked: 0 };
    var date = dateText || Utils.addDays(Utils.today(), -1);
    var workweek = Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]);
    if (workweek.indexOf(Utils.dayOfWeek(date)) < 0) return { marked: 0, reason: 'weekend' };
    var marked = 0;
    Repo.activeEmployees().forEach(function (employee) {
      var employeeId = Repo.employeeKey(employee);
      var holiday = Repo.holidayOn(date, employee.branch_id);
      if (holiday.length) return;
      if (activeLeaveOn(employeeId, date)) return;
      var record = recordFor(employeeId, date, Number(date.slice(0, 4)));
      if (record) return;
      Database.insert('Attendance', {
        employee_id: employeeId, attendance_date: date, attendance_state: 'ABSENT',
        check_in_at: '', check_out_at: '', work_minutes: 0, marked_by: 'SYSTEM',
        flags_json: JSON.stringify(['AUTO_ABSENT']), note: 'Marked absent by the daily close.'
      }, 'SYSTEM');
      marked += 1;
    });
    Audit.logEvent('ATTENDANCE_AUTO_CLOSE', 'SYSTEM', 'Attendance', '', 'SUCCESS', { date: date, marked: marked }, {});
    return { marked: marked };
  }

  return {
    STATES: STATES,
    today: today,
    markSelf: markSelf,
    register: register,
    mark: mark,
    requestRegularization: requestRegularization,
    myRegularizations: myRegularizations,
    onDecision: onDecision,
    monthly: monthly,
    summarizeMonth: summarizeMonth,
    lockMonth: lockMonth,
    unlockMonth: unlockMonth,
    monthLock: monthLock,
    autoMarkAbsent: autoMarkAbsent,
    geofenceResult: geofenceResult,
    dayView: dayView,
    shiftFor: shiftFor
  };
})();
