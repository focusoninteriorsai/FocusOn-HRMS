/**
 * FOCUSON HRMS - Access Control Engine (Google Apps Script)
 * Implements strict 9-step evaluation order: Default Deny, Explicit DENY beats ALLOW,
 * recursive team downlines, field masking, and maker-checker segregation of duties.
 */

var Permissions = (function() {
  /**
   * Resolves effective permissions for a user:
   * Union of assigned roles + active ALLOW overrides + active delegations,
   * minus explicit DENY overrides.
   */
  function resolveEffectivePermissions(employeeId) {
    if (!employeeId) return { permissions: [], isSuperAdmin: false, roleIds: [] };

    // Check user active status
    var users = Database.getAllCached('Users');
    var user = null;
    for (var u = 0; u < users.length; u++) {
      if (users[u].employee_id === employeeId && users[u].status === 'ACTIVE') {
        user = users[u];
        break;
      }
    }
    if (!user) return { permissions: [], isSuperAdmin: false, roleIds: [] };

    // Check Super Admin flag
    var isSuperAdmin = (user.is_super_admin === true || String(user.is_super_admin).toLowerCase() === 'true');

    // 1. Get assigned active roles
    var userRoles = Database.getAllCached('User_Role_Map');
    var activeRoleIds = [];
    for (var r = 0; r < userRoles.length; r++) {
      if (userRoles[r].employee_id === employeeId && userRoles[r].status === 'ACTIVE') {
        activeRoleIds.push(userRoles[r].role_id);
      }
    }

    // 2. Fetch role permissions
    var rolePermissions = Database.getAllCached('Role_Permissions');
    var grantedPermissions = new Set();
    for (var rp = 0; rp < rolePermissions.length; rp++) {
      if (activeRoleIds.indexOf(rolePermissions[rp].role_id) !== -1 && rolePermissions[rp].status === 'ACTIVE') {
        grantedPermissions.add(rolePermissions[rp].permission_key);
      }
    }

    // 3. Add active delegations where this user is the delegate
    var nowIso = Utils.nowIso();
    var delegations = Database.getAllCached('Delegations');
    for (var d = 0; d < delegations.length; d++) {
      var del = delegations[d];
      if (del.delegate_employee_id === employeeId && del.status === 'ACTIVE') {
        if (del.start_date <= nowIso && del.end_date >= nowIso) {
          if (del.permissions_csv) {
            var delKeys = del.permissions_csv.split(',');
            for (var k = 0; k < delKeys.length; k++) {
              grantedPermissions.add(delKeys[k].trim());
            }
          }
        }
      }
    }

    // 4. Process User Overrides (ALLOW & DENY)
    var overrides = Database.getAllCached('User_Permission_Overrides');
    var denyOverrides = new Set();
    var allowOverrides = new Set();

    for (var o = 0; o < overrides.length; o++) {
      var ov = overrides[o];
      if (ov.employee_id === employeeId && ov.status === 'ACTIVE') {
        // Check override expiry
        if (!ov.expiry_date || ov.expiry_date >= nowIso) {
          if (ov.effect === 'DENY') {
            denyOverrides.add(ov.permission_key);
          } else if (ov.effect === 'ALLOW') {
            allowOverrides.add(ov.permission_key);
          }
        }
      }
    }

    // Merge ALLOW overrides
    allowOverrides.forEach(function(perm) {
      grantedPermissions.add(perm);
    });

    // Remove explicit DENY overrides (Deny beats allow)
    denyOverrides.forEach(function(perm) {
      grantedPermissions.delete(perm);
    });

    return {
      permissions: Array.from(grantedPermissions),
      isSuperAdmin: isSuperAdmin,
      roleIds: activeRoleIds,
      denyOverrides: Array.from(denyOverrides)
    };
  }

  /**
   * Resolves reporting downline recursively for a manager.
   */
  function getDownlineEmployeeIds(managerEmpId) {
    var employees = Database.getAllCached('Employees');
    var downline = new Set();
    var queue = [managerEmpId];

    while (queue.length > 0) {
      var currentMgr = queue.shift();
      for (var i = 0; i < employees.length; i++) {
        var emp = employees[i];
        if (emp.reporting_manager_id === currentMgr && emp.status === 'ACTIVE') {
          if (!downline.has(emp.id)) {
            downline.add(emp.id);
            queue.push(emp.id);
          }
        }
      }
    }

    return downline;
  }

  /**
   * Evaluates if the actor is within the permitted scope for the target record.
   * Scopes: 'Self', 'Direct reports', 'Team', 'Department', 'Branch', 'Company', 'Custom list'.
   */
  function evaluateScope(actor, scopeType, targetRecord) {
    if (!scopeType || scopeType === 'Company') return true;
    if (actor.isSuperAdmin) return true;
    if (!targetRecord) return true;

    var targetEmpId = targetRecord.employee_id || targetRecord.id;

    if (scopeType === 'Self') {
      return targetEmpId === actor.employeeId;
    }

    if (scopeType === 'Direct reports') {
      var employees = Database.getAllCached('Employees');
      for (var i = 0; i < employees.length; i++) {
        if (employees[i].id === targetEmpId && employees[i].reporting_manager_id === actor.employeeId) {
          return true;
        }
      }
      return false;
    }

    if (scopeType === 'Team') {
      var downline = getDownlineEmployeeIds(actor.employeeId);
      return downline.has(targetEmpId) || targetEmpId === actor.employeeId;
    }

    if (scopeType === 'Department') {
      return targetRecord.department_id === actor.departmentId || targetRecord.department === actor.department;
    }

    if (scopeType === 'Branch') {
      return targetRecord.branch_id === actor.branchId || targetRecord.branch === actor.branch;
    }

    return false;
  }

  /**
   * Checks whether a feature switch is active.
   */
  function isFeatureEnabled(featureKey) {
    var flags = Database.getAllCached('Feature_Flags');
    for (var i = 0; i < flags.length; i++) {
      if (flags[i].feature_key === featureKey) {
        return flags[i].enabled === true || String(flags[i].enabled).toLowerCase() === 'true';
      }
    }
    return true; // Default enabled unless explicitly disabled
  }

  /**
   * The Master 9-Step Evaluation Engine.
   * Throws typed error on denial; returns true on pass.
   */
  function check(actor, permissionKey, targetRecord, options) {
    options = options || {};

    // Step 1: Session valid & user active
    if (!actor || !actor.employeeId) {
      throw { code: 'AUTH_REQUIRED', message: 'Valid authentication session required.' };
    }

    // Super Admin bypasses normal catalog checks, but still subject to maker-checker SoD
    if (actor.isSuperAdmin) {
      if (options.makerCheckerTarget) {
        if (options.makerCheckerTarget.prepared_by === actor.employeeId) {
          throw { code: 'FORBIDDEN', message: 'Segregation of duties: The person who prepared cannot verify or approve the same record.' };
        }
      }
      return true;
    }

    var effective = resolveEffectivePermissions(actor.employeeId);

    // Step 2: Explicit DENY override check
    if (effective.denyOverrides && effective.denyOverrides.indexOf(permissionKey) !== -1) {
      Audit.logEvent('ACCESS_DENIED_EXPLICIT_DENY', actor.employeeId, options.entity || '', targetRecord ? targetRecord.id : '', 'DENIED', { permission: permissionKey });
      throw { code: 'FORBIDDEN', message: 'Access denied by explicit policy override.' };
    }

    // Step 3 & 4: Permission key presence in effective permissions
    if (effective.permissions.indexOf(permissionKey) === -1) {
      Audit.logEvent('ACCESS_DENIED_MISSING_PERMISSION', actor.employeeId, options.entity || '', targetRecord ? targetRecord.id : '', 'DENIED', { permission: permissionKey });
      throw { code: 'FORBIDDEN', message: 'Permission ' + permissionKey + ' not granted.' };
    }

    // Step 5: Scope check
    var scopeType = options.scope || 'Company';
    if (!evaluateScope(actor, scopeType, targetRecord)) {
      Audit.logEvent('ACCESS_DENIED_OUT_OF_SCOPE', actor.employeeId, options.entity || '', targetRecord ? targetRecord.id : '', 'DENIED', { permission: permissionKey, scope: scopeType });
      throw { code: 'FORBIDDEN', message: 'Record is outside your permitted access scope (' + scopeType + ').' };
    }

    // Step 6: Feature-switch check
    if (options.featureKey && !isFeatureEnabled(options.featureKey)) {
      throw { code: 'FORBIDDEN', message: 'Feature is currently disabled in system settings.' };
    }

    // Step 7: Maker-Checker / Segregation of Duties check
    if (options.makerCheckerTarget) {
      var preparer = options.makerCheckerTarget.prepared_by || options.makerCheckerTarget.created_by;
      if (preparer === actor.employeeId) {
        Audit.logEvent('ACCESS_DENIED_MAKER_CHECKER', actor.employeeId, options.entity || '', targetRecord ? targetRecord.id : '', 'DENIED', { rule: 'Maker cannot approve' });
        throw { code: 'FORBIDDEN', message: 'Segregation of duties violation: You cannot verify or approve a record you prepared.' };
      }
    }

    // Step 8: Condition check (e.g. max approval amount)
    if (options.amount && options.maxAllowedAmount && options.amount > options.maxAllowedAmount) {
      throw { code: 'FORBIDDEN', message: 'Approval amount exceeds your configured ceiling limit.' };
    }

    return true;
  }

  /**
   * Field-level protection: Masks sensitive fields (salary, bank, tax IDs)
   * if the actor lacks the corresponding view permission.
   */
  function maskSensitiveFields(employeeRecord, actor) {
    if (!employeeRecord) return employeeRecord;
    var sanitized = Object.assign({}, employeeRecord);

    var hasSalaryView = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.salary.view') !== -1);
    var hasBankView = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.bank.view') !== -1);
    var hasGovtIdView = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.govtid.view') !== -1);
    var hasMedicalView = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.medical.view') !== -1);

    if (!hasSalaryView) {
      delete sanitized.ctc_annual;
      delete sanitized.basic_salary;
      delete sanitized.gross_salary;
      sanitized.salary_masked = true;
    } else {
      Audit.logSensitiveAccess(actor.employeeId, 'salary', sanitized.id);
    }

    if (!hasBankView) {
      if (sanitized.bank_account_number) {
        var str = String(sanitized.bank_account_number);
        sanitized.bank_account_number = '••••••••' + str.slice(-4);
      }
      delete sanitized.bank_ifsc;
    } else {
      Audit.logSensitiveAccess(actor.employeeId, 'bank', sanitized.id);
    }

    if (!hasGovtIdView) {
      if (sanitized.pan_number) sanitized.pan_number = '•••••' + String(sanitized.pan_number).slice(-4);
      if (sanitized.aadhaar_number) sanitized.aadhaar_number = '••••••••' + String(sanitized.aadhaar_number).slice(-4);
      if (sanitized.pf_uan) sanitized.pf_uan = '••••••••' + String(sanitized.pf_uan).slice(-4);
    }

    if (!hasMedicalView) {
      delete sanitized.medical_history;
      delete sanitized.blood_group;
    }

    return sanitized;
  }

  return {
    resolveEffectivePermissions: resolveEffectivePermissions,
    evaluateScope: evaluateScope,
    isFeatureEnabled: isFeatureEnabled,
    check: check,
    maskSensitiveFields: maskSensitiveFields
  };
})();
