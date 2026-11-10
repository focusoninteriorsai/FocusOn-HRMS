/**
 * FOCUSON HRMS - Authentication & Session Engine (Google Apps Script)
 * Salted+peppered iterated HMAC-SHA256, brute-force lockout, hashed token storage,
 * and forced password change enforcement.
 */

var Auth = (function() {
  var MAX_FAILED_ATTEMPTS = 5;
  var LOCKOUT_DURATION_SEC = 900; // 15 minutes lockout
  var SESSION_DURATION_HOURS = 12;

  /**
   * Helper: Brute-force rate limiter via CacheService.
   */
  function checkLockout(employeeId) {
    var cache = CacheService.getScriptCache();
    var failCount = parseInt(cache.get('FAIL_COUNT_' + employeeId) || '0', 10);
    if (failCount >= MAX_FAILED_ATTEMPTS) {
      throw {
        code: 'LOCKED',
        message: 'Account temporarily locked due to multiple failed login attempts. Please try again after 15 minutes.'
      };
    }
  }

  function recordFailedAttempt(employeeId, clientMeta) {
    var cache = CacheService.getScriptCache();
    var key = 'FAIL_COUNT_' + employeeId;
    var failCount = parseInt(cache.get(key) || '0', 10) + 1;
    cache.put(key, String(failCount), LOCKOUT_DURATION_SEC);

    Audit.logEvent('LOGIN_FAILED', employeeId, 'Users', employeeId, 'FAILED', {
      attempt: failCount,
      locked: failCount >= MAX_FAILED_ATTEMPTS
    }, clientMeta);
  }

  function clearFailedAttempts(employeeId) {
    var cache = CacheService.getScriptCache();
    cache.remove('FAIL_COUNT_' + employeeId);
  }

  /**
   * Authenticates user with Employee ID + Password.
   */
  function login(employeeId, password, clientMeta) {
    if (!employeeId || !password) {
      throw { code: 'VALIDATION', message: 'Employee ID and password are required.' };
    }

    var cleanEmpId = String(employeeId).trim().toUpperCase();
    checkLockout(cleanEmpId);

    // Fetch user record
    var users = Database.getAll('Users');
    var targetUser = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].employee_id === cleanEmpId && users[i].status !== 'DELETED') {
        targetUser = users[i];
        break;
      }
    }

    // Leaver rule / non-existent user check
    if (!targetUser || targetUser.status !== 'ACTIVE') {
      recordFailedAttempt(cleanEmpId, clientMeta);
      throw { code: 'FORBIDDEN', message: 'Invalid credentials or inactive account.' };
    }

    // Verify password hash
    var computedHash = Utils.hashPassword(password, targetUser.password_salt);
    if (computedHash !== targetUser.password_hash) {
      recordFailedAttempt(cleanEmpId, clientMeta);
      throw { code: 'FORBIDDEN', message: 'Invalid credentials or inactive account.' };
    }

    // Password verified! Clear brute-force counter
    clearFailedAttempts(cleanEmpId);

    // Generate cryptographic session token
    var rawToken = Utils.generateSessionToken();
    var tokenHash = Utils.hashSessionToken(rawToken);

    var now = new Date();
    var expiresAt = new Date(now.getTime() + SESSION_DURATION_HOURS * 3600 * 1000).toISOString();

    Database.insert('Sessions', {
      id: 'sess_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      employee_id: cleanEmpId,
      token_hash: tokenHash,
      expires_at: expiresAt,
      last_seen_at: now.toISOString(),
      user_agent_hash: (clientMeta && clientMeta.uaHash) || '',
      ip_hash: (clientMeta && clientMeta.ipHash) || '',
      status: 'ACTIVE'
    }, cleanEmpId);

    // Fetch employee profile details for shell display
    var employees = Database.getAllCached('Employees');
    var empProfile = null;
    for (var e = 0; e < employees.length; e++) {
      if (employees[e].id === cleanEmpId || employees[e].employee_id === cleanEmpId) {
        empProfile = employees[e];
        break;
      }
    }

    var effective = Permissions.resolveEffectivePermissions(cleanEmpId);

    Audit.logEvent('LOGIN_SUCCESS', cleanEmpId, 'Users', cleanEmpId, 'SUCCESS', {
      mustChangePassword: targetUser.must_change_password === true || String(targetUser.must_change_password).toLowerCase() === 'true'
    }, clientMeta);

    return {
      token: rawToken,
      mustChangePassword: targetUser.must_change_password === true || String(targetUser.must_change_password).toLowerCase() === 'true',
      effectivePermissions: effective.permissions,
      user: {
        employeeId: cleanEmpId,
        name: empProfile ? (empProfile.first_name + ' ' + (empProfile.last_name || '')).trim() : cleanEmpId,
        department: empProfile ? empProfile.department : '',
        designation: empProfile ? empProfile.designation : '',
        branch: empProfile ? empProfile.branch : '',
        reportingManagerId: empProfile ? empProfile.reporting_manager_id : '',
        isSuperAdmin: effective.isSuperAdmin,
        roles: effective.roleIds
      }
    };
  }

  /**
   * Validates a session token, updates last_seen_at, and returns current user context.
   */
  function validateSession(rawToken) {
    if (!rawToken) {
      throw { code: 'AUTH_REQUIRED', message: 'Session token missing.' };
    }

    var tokenHash = Utils.hashSessionToken(rawToken);
    var sessions = Database.getAll('Sessions');
    var activeSession = null;
    var nowIso = Utils.nowIso();

    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].token_hash === tokenHash && sessions[i].status === 'ACTIVE') {
        if (sessions[i].expires_at > nowIso) {
          activeSession = sessions[i];
          break;
        }
      }
    }

    if (!activeSession) {
      throw { code: 'SESSION_EXPIRED', message: 'Your session has expired. Please sign in again.' };
    }

    // Touch last_seen_at
    try {
      Database.update('Sessions', activeSession.id, { last_seen_at: nowIso }, activeSession.employee_id);
    } catch (e) {
      // Non-blocking
    }

    var cleanEmpId = activeSession.employee_id;
    var users = Database.getAll('Users');
    var userRecord = null;
    for (var u = 0; u < users.length; u++) {
      if (users[u].employee_id === cleanEmpId && users[u].status === 'ACTIVE') {
        userRecord = users[u];
        break;
      }
    }

    if (!userRecord) {
      throw { code: 'FORBIDDEN', message: 'User account is deactivated.' };
    }

    var employees = Database.getAllCached('Employees');
    var empProfile = null;
    for (var ep = 0; ep < employees.length; ep++) {
      if (employees[ep].id === cleanEmpId || employees[ep].employee_id === cleanEmpId) {
        empProfile = employees[ep];
        break;
      }
    }

    var effective = Permissions.resolveEffectivePermissions(cleanEmpId);

    return {
      token: rawToken,
      mustChangePassword: userRecord.must_change_password === true || String(userRecord.must_change_password).toLowerCase() === 'true',
      effectivePermissions: effective.permissions,
      user: {
        employeeId: cleanEmpId,
        name: empProfile ? (empProfile.first_name + ' ' + (empProfile.last_name || '')).trim() : cleanEmpId,
        department: empProfile ? empProfile.department : '',
        designation: empProfile ? empProfile.designation : '',
        branch: empProfile ? empProfile.branch : '',
        reportingManagerId: empProfile ? empProfile.reporting_manager_id : '',
        isSuperAdmin: effective.isSuperAdmin,
        roles: effective.roleIds
      }
    };
  }

  /**
   * Changes password for the authenticated user.
   */
  function changePassword(employeeId, currentPassword, newPassword) {
    if (!newPassword || newPassword.length < 8) {
      throw { code: 'VALIDATION', message: 'New password must be at least 8 characters long.' };
    }

    var users = Database.getAll('Users');
    var user = null;
    for (var i = 0; i < users.length; i++) {
      if (users[i].employee_id === employeeId && users[i].status === 'ACTIVE') {
        user = users[i];
        break;
      }
    }

    if (!user) throw { code: 'NOT_FOUND', message: 'User not found.' };

    // Verify current password
    var computedOld = Utils.hashPassword(currentPassword, user.password_salt);
    if (computedOld !== user.password_hash) {
      throw { code: 'FORBIDDEN', message: 'Current password does not match.' };
    }

    // Generate fresh salt and hash
    var newSalt = Utils.generateSalt();
    var newHash = Utils.hashPassword(newPassword, newSalt);

    Database.update('Users', user.id, {
      password_hash: newHash,
      password_salt: newSalt,
      must_change_password: false,
      password_updated_at: Utils.nowIso()
    }, employeeId);

    Audit.logEvent('PASSWORD_CHANGED', employeeId, 'Users', user.id, 'SUCCESS');
    return { success: true };
  }

  /**
   * Invalidates current session.
   */
  function logout(rawToken) {
    if (!rawToken) return { success: true };
    var tokenHash = Utils.hashSessionToken(rawToken);
    var sessions = Database.getAll('Sessions');
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].token_hash === tokenHash) {
        Database.update('Sessions', sessions[i].id, { status: 'EXPIRED' }, sessions[i].employee_id);
        break;
      }
    }
    return { success: true };
  }

  /**
   * Invalidates ALL active sessions for a user (security kill-switch).
   */
  function logoutAll(employeeId) {
    var sessions = Database.getAll('Sessions');
    for (var i = 0; i < sessions.length; i++) {
      if (sessions[i].employee_id === employeeId && sessions[i].status === 'ACTIVE') {
        Database.update('Sessions', sessions[i].id, { status: 'REVOKED' }, employeeId);
      }
    }
    Audit.logEvent('LOGOUT_ALL_SESSIONS', employeeId, 'Sessions', employeeId, 'SUCCESS');
    return { success: true };
  }

  return {
    login: login,
    validateSession: validateSession,
    changePassword: changePassword,
    logout: logout,
    logoutAll: logoutAll
  };
})();
