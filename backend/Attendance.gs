/**
 * FOCUSON HRMS - Attendance Engine (Google Apps Script)
 * Server-authoritative time, Haversine geo-fencing, optional selfie capture,
 * anomaly detection, month locking, and regularization workflows.
 */

var Attendance = (function() {
  /**
   * Resolves whether selfie is required for an employee.
   * Precedence: Employee Override > Policy > Company Feature Flag.
   */
  function isSelfieRequired(employeeId, policy) {
    // 1. Check company feature switch
    if (!Permissions.isFeatureEnabled('attendance.selfie')) return false;

    // 2. Check employee-level override
    var flags = Database.getAllCached('Feature_Flags');
    var empKey = 'selfie.emp.' + employeeId;
    for (var f = 0; f < flags.length; f++) {
      if (flags[f].feature_key === empKey) {
        return flags[f].enabled === true || String(flags[f].enabled).toLowerCase() === 'true';
      }
    }

    // 3. Policy level
    return policy && (policy.requires_selfie === true || String(policy.requires_selfie).toLowerCase() === 'true');
  }

  /**
   * Helper: Saves base64 selfie image to private Drive folder partitioned by month.
   */
  function saveSelfieFile(base64Data, employeeId) {
    if (!base64Data) return '';
    try {
      var props = PropertiesService.getScriptProperties();
      var folderId = props.getProperty('HRMS_FOLDER_SELFIES_ID');
      if (!folderId) return '';

      var rootFolder = DriveApp.getFolderById(folderId);
      var monthYear = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM');
      var monthFolder = null;
      var existing = rootFolder.getFoldersByName(monthYear);
      if (existing.hasNext()) {
        monthFolder = existing.next();
      } else {
        monthFolder = rootFolder.createFolder(monthYear);
      }

      var cleanBase64 = base64Data.replace(/^data:image\/\w+;base64,/, '');
      var decodedBytes = Utilities.base64Decode(cleanBase64);
      var blob = Utilities.newBlob(decodedBytes, 'image/jpeg', 'selfie_' + employeeId + '_' + Date.now() + '.jpg');
      var file = monthFolder.createFile(blob);
      return file.getId();
    } catch (e) {
      console.error('Failed to save selfie file:', e);
      return '';
    }
  }

  /**
   * Checks in an employee.
   */
  function checkIn(payload, actor) {
    var targetEmpId = payload.employee_id || actor.employeeId;
    var isBehalf = (targetEmpId !== actor.employeeId);

    if (isBehalf) {
      Permissions.check(actor, 'attendance.markothers', { id: targetEmpId });
    }

    var now = new Date();
    var todayStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
    var year = now.getFullYear();

    // Check Month Lock
    var monthKey = todayStr.substring(0, 7);
    var settings = Database.getAllCached('Company_Settings');
    for (var s = 0; s < settings.length; s++) {
      if (settings[s].setting_key === 'ATTENDANCE_LOCKED_MONTH_' + monthKey && settings[s].setting_value === 'LOCKED') {
        throw { code: 'FORBIDDEN', message: 'Attendance for month ' + monthKey + ' is locked.' };
      }
    }

    // Check duplicate check-in today
    var logs = Database.getAll('Attendance', { year: year });
    var existingRecord = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].employee_id === targetEmpId && logs[i].date === todayStr && logs[i].status !== 'DELETED') {
        existingRecord = logs[i];
        break;
      }
    }

    if (existingRecord && existingRecord.check_in_time) {
      throw { code: 'CONFLICT', message: 'Attendance already marked for today (' + existingRecord.check_in_time + ').' };
    }

    // Resolve employee policy
    var emps = Database.getAllCached('Employees');
    var emp = null;
    for (var e = 0; e < emps.length; e++) {
      if (emps[e].id === targetEmpId) { emp = emps[e]; break; }
    }

    var policies = Database.getAllCached('Attendance_Policies');
    var policy = null;
    var policyId = (emp && emp.attendance_policy_id) || 'POL_OFFICE';
    for (var p = 0; p < policies.length; p++) {
      if (policies[p].id === policyId || policies[p].code === policyId) {
        policy = policies[p];
        break;
      }
    }

    var distance = 0;
    var statusFlag = 'PRESENT';
    var anomalyFlags = [];

    // Geo-fencing validation (Only if policy requires it)
    var reqGeofence = policy && (policy.requires_geofence === true || String(policy.requires_geofence).toLowerCase() === 'true');
    if (reqGeofence) {
      if (!payload.latitude || !payload.longitude) {
        throw { code: 'VALIDATION', message: 'GPS coordinates required by your attendance policy.' };
      }

      var clientLat = parseFloat(payload.latitude);
      var clientLng = parseFloat(payload.longitude);
      var clientAccuracy = parseFloat(payload.accuracy || '50');

      // Check against Geofence Locations for branch
      var geofences = Database.getAllCached('Geofence_Locations');
      var matched = false;
      var shortestDistance = 9999999;

      for (var g = 0; g < geofences.length; g++) {
        var geo = geofences[g];
        var d = Utils.haversineDistanceMeters(clientLat, clientLng, parseFloat(geo.latitude), parseFloat(geo.longitude));
        if (d < shortestDistance) shortestDistance = d;
        var radius = parseFloat(geo.radius_meters || '150');
        if (d <= radius) {
          matched = true;
          break;
        }
      }

      distance = Math.round(shortestDistance);

      if (clientAccuracy > 300) {
        anomalyFlags.push('LOW_ACCURACY_' + Math.round(clientAccuracy) + 'M');
      }

      if (!matched) {
        statusFlag = 'FLAGGED_OUTSIDE_GEOFENCE';
        anomalyFlags.push('OUTSIDE_RADIUS_' + distance + 'M');
      }
    }

    // Selfie validation
    var selfieFileId = '';
    if (isSelfieRequired(targetEmpId, policy)) {
      if (!payload.selfie_base64) {
        throw { code: 'VALIDATION', message: 'Selfie photo required by your attendance policy.' };
      }
      selfieFileId = saveSelfieFile(payload.selfie_base64, targetEmpId);
    }

    var recordId = 'att_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    var record = {
      id: recordId,
      employee_id: targetEmpId,
      date: todayStr,
      check_in_time: timeStr,
      check_out_time: '',
      check_in_lat: payload.latitude || '',
      check_in_lng: payload.longitude || '',
      check_in_accuracy: payload.accuracy || '',
      check_in_distance: distance,
      check_in_selfie_file_id: selfieFileId,
      status_flag: statusFlag,
      anomaly_flags: anomalyFlags.join(','),
      total_hours: 0
    };

    Database.insert('Attendance', record, actor.employeeId, { year: year });

    Audit.logEvent('ATTENDANCE_CHECKIN', actor.employeeId, 'Attendance', recordId, statusFlag, {
      targetEmployeeId: targetEmpId,
      distance: distance,
      statusFlag: statusFlag,
      isBehalf: isBehalf
    });

    return {
      success: true,
      recordId: recordId,
      checkInTime: timeStr,
      date: todayStr,
      statusFlag: statusFlag,
      distance: distance
    };
  }

  /**
   * Checks out an employee and computes daily working hours.
   */
  function checkOut(payload, actor) {
    var targetEmpId = payload.employee_id || actor.employeeId;
    var now = new Date();
    var todayStr = Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd');
    var timeStr = Utilities.formatDate(now, 'Asia/Kolkata', 'HH:mm:ss');
    var year = now.getFullYear();

    var logs = Database.getAll('Attendance', { year: year });
    var targetLog = null;
    for (var i = 0; i < logs.length; i++) {
      if (logs[i].employee_id === targetEmpId && logs[i].date === todayStr && logs[i].status !== 'DELETED') {
        targetLog = logs[i];
        break;
      }
    }

    if (!targetLog) {
      throw { code: 'NOT_FOUND', message: 'No check-in record found for today.' };
    }

    // Compute working hours
    var checkInTime = new Date(todayStr + 'T' + targetLog.check_in_time);
    var checkOutTime = new Date(todayStr + 'T' + timeStr);
    var diffMs = checkOutTime.getTime() - checkInTime.getTime();
    var hoursWorked = Math.max(0, +(diffMs / (1000 * 60 * 60)).toFixed(2));

    var updates = {
      check_out_time: timeStr,
      check_out_lat: payload.latitude || '',
      check_out_lng: payload.longitude || '',
      total_hours: hoursWorked
    };

    Database.update('Attendance', targetLog.id, updates, actor.employeeId, { year: year });

    Audit.logEvent('ATTENDANCE_CHECKOUT', actor.employeeId, 'Attendance', targetLog.id, 'SUCCESS', {
      totalHours: hoursWorked
    });

    return {
      success: true,
      checkOutTime: timeStr,
      totalHours: hoursWorked
    };
  }

  /**
   * Retrieves monthly attendance log for an employee.
   */
  function getMyLog(employeeId, monthYear, actor) {
    var isSelf = (employeeId === actor.employeeId);
    if (!isSelf) {
      Permissions.check(actor, 'attendance.view', { id: employeeId });
    }

    var year = parseInt(monthYear.substring(0, 4), 10);
    var logs = Database.getAll('Attendance', { year: year });
    var results = [];

    for (var i = 0; i < logs.length; i++) {
      if (logs[i].employee_id === employeeId && logs[i].date.startsWith(monthYear) && logs[i].status !== 'DELETED') {
        results.push(logs[i]);
      }
    }

    return results;
  }

  /**
   * Submits regularization request for missed punch or incorrect hours.
   */
  function regularize(payload, actor) {
    if (!payload.date || !payload.reason) {
      throw { code: 'VALIDATION', message: 'Date and reason are mandatory for regularization.' };
    }

    var year = parseInt(payload.date.substring(0, 4), 10);
    var reqId = 'reg_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);

    Database.insert('Attendance_Regularization', {
      id: reqId,
      employee_id: actor.employeeId,
      date: payload.date,
      requested_check_in: payload.requested_check_in || '09:30:00',
      requested_check_out: payload.requested_check_out || '18:30:00',
      reason: payload.reason,
      approval_status: 'PENDING'
    }, actor.employeeId, { year: year });

    // Submit into Approvals queue
    Database.insert('Approvals', {
      id: 'appr_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      request_type: 'ATTENDANCE_REGULARIZATION',
      request_id: reqId,
      applicant_id: actor.employeeId,
      current_step_id: 'step_mgr',
      current_approver_id: '',
      overall_status: 'PENDING'
    }, actor.employeeId);

    return { success: true, requestId: reqId };
  }

  return {
    checkIn: checkIn,
    checkOut: checkOut,
    getMyLog: getMyLog,
    regularize: regularize
  };
})();
