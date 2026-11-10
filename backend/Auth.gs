/**
 * Employee-ID authentication, configurable password policy, brute-force defense,
 * idle+absolute sessions and logout-all. Raw passwords/tokens are never stored.
 */
var Auth = (function () {
  function securitySettings() {
    return {
      idleSeconds: boundedSetting('SESSION_IDLE_MINUTES', 30, 5, 480) * 60,
      absoluteSeconds: boundedSetting('SESSION_ABSOLUTE_HOURS', 12, 1, 168) * 3600,
      maxFailures: boundedSetting('LOGIN_MAX_FAILED_ATTEMPTS', 5, 3, 20),
      lockSeconds: boundedSetting('LOGIN_LOCK_MINUTES', 15, 1, 1440) * 60,
      globalPerMinute: boundedSetting('LOGIN_GLOBAL_MAX_PER_MINUTE', 100, 20, 1000),
      passwordMinLength: boundedSetting('PASSWORD_MIN_LENGTH', 12, 8, 64),
      passwordComplexity: String(Database.getSetting('PASSWORD_REQUIRE_COMPLEXITY', 'TRUE')).toUpperCase() !== 'FALSE'
    };
  }

  function boundedSetting(key, fallback, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, Utils.asNumber(Database.getSetting(key, fallback), fallback)));
  }

  function failureKey(employeeId) {
    return 'LOGIN_FAIL_V1_' + Utils.sha256(employeeId);
  }

  function globalKey() {
    return 'LOGIN_GLOBAL_V1_' + Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmm');
  }

  function checkLoginRate(employeeId, settings) {
    var cache = CacheService.getScriptCache();
    var lockedUntil = Number(cache.get(failureKey(employeeId) + '_LOCK') || 0);
    if (lockedUntil > Date.now()) {
      Utils.fail('RATE_LIMITED', 'Too many sign-in attempts. Try again later.', { retryAfterSeconds: Math.ceil((lockedUntil - Date.now()) / 1000) });
    }
  }

  function countGlobalAttempt(settings) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(2000)) Utils.fail('LOCKED', 'Authentication is busy. Retry shortly.', { retryAfterSeconds: 2 });
    try {
      var cache = CacheService.getScriptCache();
      var key = globalKey();
      var count = Number(cache.get(key) || 0) + 1;
      cache.put(key, String(count), 120);
      if (count > settings.globalPerMinute) Utils.fail('RATE_LIMITED', 'Too many sign-in attempts. Try again later.', { retryAfterSeconds: 60 });
    } finally {
      lock.releaseLock();
    }
  }

  function recordFailure(employeeId, settings) {
    var lock = LockService.getScriptLock();
    var result = { count: 1, locked: false };
    if (!lock.tryLock(2000)) Utils.fail('LOCKED', 'Authentication is busy. Retry shortly.', { retryAfterSeconds: 2 });
    try {
      var cache = CacheService.getScriptCache();
      var key = failureKey(employeeId);
      var count = Number(cache.get(key) || 0) + 1;
      cache.put(key, String(count), settings.lockSeconds);
      if (count >= settings.maxFailures) {
        cache.put(key + '_LOCK', String(Date.now() + settings.lockSeconds * 1000), settings.lockSeconds);
        cache.remove(key);
        result.locked = true;
      }
      result.count = count;
      return result;
    } finally {
      lock.releaseLock();
    }
  }

  function clearFailures(employeeId) {
    var cache = CacheService.getScriptCache();
    cache.remove(failureKey(employeeId));
    cache.remove(failureKey(employeeId) + '_LOCK');
  }

  function findUser(employeeId) {
    return Database.findOne('Users', function (user) {
      return user.employee_id === employeeId && String(user.status).toUpperCase() !== 'DELETED';
    });
  }

  function findEmployee(employeeId) {
    return Database.findOne('Employees', function (employee) {
      return String(employee.employee_id || employee.id) === employeeId && String(employee.status).toUpperCase() !== 'DELETED';
    }, { cached: true });
  }

  function login(payload, context) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    if (typeof payload.password !== 'string' || !payload.password || payload.password.length > 128) {
      Utils.fail('VALIDATION', 'Employee ID and password are required.');
    }
    var settings = securitySettings();
    countGlobalAttempt(settings);
    checkLoginRate(employeeId, settings);

    var user = findUser(employeeId);
    var employee = user ? findEmployee(employeeId) : null;
    var iterations = user ? user.password_iterations : Utils.configuredHashIterations();
    var salt = user ? user.password_salt : Utils.sha256('UNKNOWN-ACCOUNT:' + employeeId + ':' + Utils.getServerPepper());
    var expectedHash = user ? user.password_hash : '';
    var actualHash = Utils.hashPassword(payload.password, salt, iterations);
    var passwordMatches = Boolean(user) && Utils.constantTimeEquals(actualHash, expectedHash);
    var accountActive = Boolean(user && employee && String(user.status).toUpperCase() === 'ACTIVE' && String(employee.status).toUpperCase() === 'ACTIVE');

    if (!passwordMatches || !accountActive) {
      var failure = recordFailure(employeeId, settings);
      Audit.logEvent('LOGIN_FAILED', employeeId, 'Users', user ? user.id : '', 'DENIED', {
        locked: failure.locked,
        reason: 'INVALID_CREDENTIALS'
      }, context);
      Utils.fail('AUTH_REQUIRED', 'Invalid Employee ID or password.');
    }

    clearFailures(employeeId);
    var rawToken = Utils.generateSessionToken();
    var now = new Date();
    var sessionRecord = Database.insert('Sessions', {
      employee_id: employeeId,
      token_hash: Utils.hashSessionToken(rawToken),
      last_seen_at: now.toISOString(),
      expires_at: Utils.addSeconds(now, settings.absoluteSeconds),
      device_hash: context.deviceHash || '',
      status: 'ACTIVE'
    }, employeeId);
    var response = buildSessionResponse(user, employee, sessionRecord, settings, false);
    response.token = rawToken;
    Audit.logEvent('LOGIN_SUCCESS', employeeId, 'Users', user.id, 'SUCCESS', {
      mustChangePassword: response.mustChangePassword
    }, context);
    return response;
  }

  function authenticate(rawToken, context) {
    if (!rawToken || typeof rawToken !== 'string') Utils.fail('AUTH_REQUIRED', 'Authentication is required.');
    if (rawToken.length > 160) Utils.fail('SESSION_EXPIRED', 'Your session is no longer valid.');
    var tokenHash = Utils.hashSessionToken(rawToken);
    var session = Database.findOne('Sessions', function (row) {
      return row.token_hash === tokenHash && String(row.status).toUpperCase() === 'ACTIVE';
    });
    if (!session) Utils.fail('SESSION_EXPIRED', 'Your session has expired. Sign in again.');

    var settings = securitySettings();
    var now = new Date();
    var absoluteExpiry = Utils.dateValue(session.expires_at);
    var lastSeen = Utils.dateValue(session.last_seen_at || session.created_at);
    var idleExpired = !lastSeen || now.getTime() - lastSeen.getTime() >= settings.idleSeconds * 1000;
    if (!absoluteExpiry || absoluteExpiry.getTime() <= now.getTime() || idleExpired) {
      Database.update('Sessions', session.id, { status: 'EXPIRED', revoked_at: now.toISOString() }, session.employee_id);
      Utils.fail('SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    }
    if (session.device_hash && session.device_hash !== (context.deviceHash || '')) {
      Database.update('Sessions', session.id, { status: 'REVOKED', revoked_at: now.toISOString() }, session.employee_id);
      Utils.fail('SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    }

    var user = findUser(session.employee_id);
    var employee = user ? findEmployee(user.employee_id) : null;
    if (!user || !employee || String(user.status).toUpperCase() !== 'ACTIVE' || String(employee.status).toUpperCase() !== 'ACTIVE') {
      Database.update('Sessions', session.id, { status: 'REVOKED', revoked_at: now.toISOString() }, session.employee_id);
      Utils.fail('SESSION_EXPIRED', 'Your session has expired. Sign in again.');
    }

    if (now.getTime() - lastSeen.getTime() >= 60000) {
      session = Database.update('Sessions', session.id, { last_seen_at: now.toISOString() }, session.employee_id);
    }
    var effective = Permissions.resolveEffectivePermissions(user.employee_id);
    var actor = {
      sessionValidated: true,
      sessionId: session.id,
      employeeId: user.employee_id,
      displayName: employee.display_name || user.employee_id,
      departmentId: employee.department_id || '',
      department: employee.department || '',
      branchId: employee.branch_id || '',
      branch: employee.branch || '',
      designation: employee.designation || '',
      isSuperAdmin: effective.isSuperAdmin,
      permissions: effective.permissions,
      userId: user.id,
      mustChangePassword: Utils.asBoolean(user.must_change_password),
      rawTokenHash: tokenHash
    };
    return { actor: actor, user: user, employee: employee, sessionRecord: session, settings: settings, effective: effective };
  }

  function buildSessionResponse(user, employee, sessionRecord, settings, includeToken) {
    var effective = Permissions.resolveEffectivePermissions(user.employee_id);
    return {
      mustChangePassword: Utils.asBoolean(user.must_change_password),
      effectivePermissions: effective.permissions,
      scopes: effective.scopes,
      user: {
        employeeId: user.employee_id,
        displayName: employee.display_name || user.employee_id,
        departmentId: employee.department_id || '',
        department: employee.department || '',
        designation: employee.designation || '',
        branchId: employee.branch_id || '',
        branch: employee.branch || '',
        reportingManagerId: employee.reporting_manager_id || '',
        isSuperAdmin: effective.isSuperAdmin,
        roles: effective.roleIds,
        language: user.language || 'en',
        theme: user.theme || 'light',
        simpleMode: Utils.asBoolean(user.simple_mode)
      },
      session: {
        idleTimeoutSeconds: settings.idleSeconds,
        absoluteExpiresAt: Utils.toIso(sessionRecord.expires_at),
        lastSeenAt: Utils.toIso(sessionRecord.last_seen_at || sessionRecord.created_at),
        passwordPolicy: {
          minLength: settings.passwordMinLength,
          requireComplexity: settings.passwordComplexity
        }
      }
    };
  }

  function sessionResponse(authentication) {
    return buildSessionResponse(authentication.user, authentication.employee, authentication.sessionRecord, authentication.settings, false);
  }

  function validateNewPassword(currentPassword, newPassword, settings) {
    if (typeof currentPassword !== 'string' || typeof newPassword !== 'string' || !currentPassword || !newPassword) {
      Utils.fail('VALIDATION', 'Current and new passwords are required.');
    }
    if (currentPassword.length > 128 || newPassword.length > 128) Utils.fail('VALIDATION', 'Passwords cannot exceed 128 characters.');
    if (newPassword.length < settings.passwordMinLength) Utils.fail('VALIDATION', 'The new password does not meet the configured minimum length.', { minLength: settings.passwordMinLength });
    if (settings.passwordComplexity && !(/[a-z]/.test(newPassword) && /[A-Z]/.test(newPassword) && /[0-9]/.test(newPassword) && /[^A-Za-z0-9]/.test(newPassword))) {
      Utils.fail('VALIDATION', 'The new password does not meet the configured complexity policy.');
    }
    if (Utils.constantTimeEquals(currentPassword, newPassword)) Utils.fail('VALIDATION', 'The new password must be different from the current password.');
  }

  function changePassword(authentication, payload, context) {
    var user = authentication.user;
    validateNewPassword(payload.currentPassword, payload.newPassword, authentication.settings);
    var actual = Utils.hashPassword(payload.currentPassword, user.password_salt, user.password_iterations);
    if (!Utils.constantTimeEquals(actual, user.password_hash)) {
      Audit.logEvent('PASSWORD_CHANGE_FAILED', user.employee_id, 'Users', user.id, 'DENIED', { reason: 'CURRENT_PASSWORD' }, context);
      Utils.fail('FORBIDDEN', 'The current password is incorrect.');
    }
    var salt = Utils.generateSalt();
    var iterations = Utils.configuredHashIterations();
    var hash = Utils.hashPassword(payload.newPassword, salt, iterations);
    Database.update('Users', user.id, {
      password_salt: salt,
      password_iterations: iterations,
      password_hash: hash,
      must_change_password: false,
      password_changed_at: Utils.nowIso()
    }, user.employee_id);
    revokeUserSessions(user.employee_id, authentication.actor.rawTokenHash);
    Audit.logEvent('PASSWORD_CHANGED', user.employee_id, 'Users', user.id, 'SUCCESS', { otherSessionsRevoked: true }, context);
    return { changed: true };
  }

  function updatePreferences(authentication, payload, context) {
    var changes = {};
    if (Object.prototype.hasOwnProperty.call(payload, 'language')) {
      if (['en', 'hi'].indexOf(payload.language) < 0) Utils.fail('VALIDATION', 'Language is not supported.');
      changes.language = payload.language;
    }
    if (Object.prototype.hasOwnProperty.call(payload, 'theme')) {
      if (['light', 'dark'].indexOf(payload.theme) < 0) Utils.fail('VALIDATION', 'Theme is not supported.');
      changes.theme = payload.theme;
    }
    if (!Object.keys(changes).length) Utils.fail('VALIDATION', 'No supported preference was supplied.');
    var updated = Database.update('Users', authentication.user.id, changes, authentication.actor.employeeId);
    Audit.logEvent('PREFERENCES_CHANGED', authentication.actor.employeeId, 'Users', authentication.user.id, 'SUCCESS', changes, context);
    return { language: updated.language || 'en', theme: updated.theme || 'light' };
  }

  function revokeUserSessions(employeeId, exceptTokenHash) {
    return Database.updateMany('Sessions', function (session) {
      return session.employee_id === employeeId && String(session.status).toUpperCase() === 'ACTIVE' && session.token_hash !== exceptTokenHash;
    }, { status: 'REVOKED', revoked_at: Utils.nowIso() }, employeeId);
  }

  function logout(authentication, context) {
    Database.update('Sessions', authentication.sessionRecord.id, { status: 'REVOKED', revoked_at: Utils.nowIso() }, authentication.actor.employeeId);
    Audit.logEvent('LOGOUT', authentication.actor.employeeId, 'Sessions', authentication.sessionRecord.id, 'SUCCESS', {}, context);
    return { loggedOut: true };
  }

  function logoutAll(authentication, context) {
    var revoked = revokeUserSessions(authentication.actor.employeeId, null);
    Audit.logEvent('LOGOUT_ALL', authentication.actor.employeeId, 'Users', authentication.user.id, 'SUCCESS', { revokedCount: revoked.length }, context);
    return { loggedOut: true, revokedCount: revoked.length };
  }

  function cleanupExpiredSessions() {
    var now = new Date();
    var retentionCutoff = now.getTime() - 30 * 86400000;
    return Database.updateMany('Sessions', function (session) {
      var expiry = Utils.dateValue(session.expires_at);
      var updated = Utils.dateValue(session.updated_at || session.created_at);
      var activeExpired = String(session.status).toUpperCase() === 'ACTIVE' && expiry && expiry.getTime() <= now.getTime();
      var oldInactive = ['REVOKED', 'EXPIRED'].indexOf(String(session.status).toUpperCase()) >= 0 && updated && updated.getTime() < retentionCutoff;
      return activeExpired || oldInactive;
    }, function (session) {
      if (String(session.status).toUpperCase() === 'ACTIVE') return { status: 'EXPIRED', revoked_at: now.toISOString() };
      return { status: 'DELETED' };
    }, 'SYSTEM').length;
  }

  return {
    login: login,
    authenticate: authenticate,
    sessionResponse: sessionResponse,
    changePassword: changePassword,
    updatePreferences: updatePreferences,
    logout: logout,
    logoutAll: logoutAll,
    cleanupExpiredSessions: cleanupExpiredSessions,
    securitySettings: securitySettings
  };
})();
