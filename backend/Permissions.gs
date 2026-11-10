/**
 * Default-deny authorization engine. Role, scope, condition, override and
 * delegation definitions are data; only the built-in Super Admin role is code.
 */
var Permissions = (function () {
  var VALID_SCOPES = ['Self', 'Direct reports', 'Team', 'Department', 'Branch', 'Company', 'Custom list'];
  var SCOPE_RANK = { 'Self': 0, 'Custom list': 1, 'Direct reports': 2, 'Team': 3, 'Department': 4, 'Branch': 5, 'Company': 6 };
  var FIELD_RULES = {
    ctc_annual: 'field.salary.view', basic_salary: 'field.salary.view', gross_salary: 'field.salary.view',
    bank_account_number: 'field.bank.view', bank_ifsc: 'field.bank.view', bank_name: 'field.bank.view',
    pan_number: 'field.govtid.view', aadhaar_number: 'field.govtid.view', pf_uan: 'field.govtid.view', esi_number: 'field.govtid.view',
    uan_number: 'field.govtid.view', esi_ip_number: 'field.govtid.view',
    medical_notes: 'field.medical.view', blood_group: 'field.medical.view'
  };

  function activeAt(row, now, startKey, endKey) {
    if (String(row.status).toUpperCase() !== 'ACTIVE') return false;
    var start = row[startKey || 'valid_from'];
    var end = row[endKey || 'valid_until'];
    if (start && Utils.toIso(start) > now) return false;
    if (end && Utils.toIso(end) <= now) return false;
    return true;
  }

  function parseConditions(value) {
    var parsed = Utils.safeParseJson(value, {});
    return parsed && !Array.isArray(parsed) && typeof parsed === 'object' ? parsed : {};
  }

  function resolveEffectivePermissions(employeeId) {
    var now = Utils.nowIso();
    var roles = Database.getAllCached('Roles');
    var roleById = {};
    roles.forEach(function (role) {
      if (String(role.status).toUpperCase() === 'ACTIVE') roleById[role.id] = role;
    });

    var roleIds = [];
    var isSuperAdmin = false;
    Database.getAllCached('User_Role_Map').forEach(function (mapping) {
      if (mapping.employee_id !== employeeId || !activeAt(mapping, now, 'valid_from', 'valid_until')) return;
      var role = roleById[mapping.role_id];
      if (!role) return;
      roleIds.push(role.id);
      if (role.role_code === 'SUPER_ADMIN' && Utils.asBoolean(role.built_in)) isSuperAdmin = true;
    });

    var grants = [];
    Database.getAllCached('Role_Permissions').forEach(function (grant) {
      if (String(grant.status).toUpperCase() !== 'ACTIVE' || roleIds.indexOf(grant.role_id) < 0) return;
      var role = roleById[grant.role_id];
      grants.push({
        key: grant.permission_key,
        scope: VALID_SCOPES.indexOf(role.scope_type) >= 0 ? role.scope_type : 'Self',
        conditions: mergeConditions(parseConditions(role.conditions_json), parseConditions(grant.conditions_json)),
        source: 'ROLE', sourceId: role.id
      });
    });

    var denyOverrides = [];
    Database.getAllCached('User_Permission_Overrides').forEach(function (override) {
      if (override.employee_id !== employeeId || String(override.status).toUpperCase() !== 'ACTIVE') return;
      if (!override.expires_at || Utils.toIso(override.expires_at) <= now || !override.reason) return;
      if (override.effect === 'DENY') {
        denyOverrides.push(override.permission_key);
      } else if (override.effect === 'ALLOW') {
        grants.push({
          key: override.permission_key,
          scope: VALID_SCOPES.indexOf(override.scope_type) >= 0 ? override.scope_type : 'Self',
          conditions: parseConditions(override.conditions_json),
          source: 'OVERRIDE', sourceId: override.id
        });
      }
    });

    if (isSuperAdmin) {
      Database.getAllCached('Permissions_Catalog').forEach(function (permission) {
        if (String(permission.status).toUpperCase() === 'ACTIVE' && denyOverrides.indexOf(permission.permission_key) < 0) {
          grants.push({ key: permission.permission_key, scope: 'Company', conditions: {}, source: 'SUPER_ADMIN', sourceId: 'role_super_admin' });
        }
      });
    }

    Database.getAllCached('Delegations').forEach(function (delegation) {
      if (delegation.delegate_employee_id !== employeeId || !activeAt(delegation, now, 'starts_at', 'ends_at')) return;
      var delegated = Utils.safeParseJson(delegation.permissions_json, []);
      if (!Array.isArray(delegated)) return;
      delegated.forEach(function (entry) {
        var key = typeof entry === 'string' ? entry : entry.permissionKey;
        if (!key) return;
        var entryScope = typeof entry === 'object' && VALID_SCOPES.indexOf(entry.scope) >= 0 ? entry.scope : delegation.scope_type;
        grants.push({
          key: key,
          scope: VALID_SCOPES.indexOf(entryScope) >= 0 ? entryScope : 'Self',
          conditions: typeof entry === 'object' ? parseConditions(JSON.stringify(entry.conditions || {})) : {},
          source: 'DELEGATION', sourceId: delegation.id
        });
      });
    });

    grants = grants.filter(function (grant) { return denyOverrides.indexOf(grant.key) < 0; });
    var permissions = Utils.csvUnique(grants.map(function (grant) { return grant.key; }));
    var scopes = {};
    permissions.forEach(function (key) {
      scopes[key] = Utils.csvUnique(grants.filter(function (grant) { return grant.key === key; }).map(function (grant) { return grant.scope; }));
    });
    return {
      permissions: permissions,
      scopes: scopes,
      grants: grants,
      isSuperAdmin: isSuperAdmin,
      roleIds: Utils.csvUnique(roleIds),
      denyOverrides: Utils.csvUnique(denyOverrides)
    };
  }

  function mergeConditions(roleConditions, grantConditions) {
    var merged = {};
    Object.keys(roleConditions).forEach(function (key) { merged[key] = roleConditions[key]; });
    Object.keys(grantConditions).forEach(function (key) {
      if (key === 'amount_max' || key === 'days_max') {
        var left = Number(merged[key]);
        var right = Number(grantConditions[key]);
        merged[key] = merged[key] === undefined ? right : Math.min(left, right);
      } else {
        merged[key] = grantConditions[key];
      }
    });
    return merged;
  }

  function employeeKey(employee) {
    return String(employee.employee_id || employee.id || '');
  }

  function getDownlineEmployeeIds(managerEmployeeId) {
    var employees = Database.getAllCached('Employees');
    var visited = {};
    var downline = [];
    var queue = [managerEmployeeId];
    visited[managerEmployeeId] = true;
    while (queue.length) {
      var manager = queue.shift();
      employees.forEach(function (employee) {
        var id = employeeKey(employee);
        if (String(employee.status).toUpperCase() === 'ACTIVE' && employee.reporting_manager_id === manager && !visited[id]) {
          visited[id] = true;
          downline.push(id);
          queue.push(id);
        }
      });
    }
    return downline;
  }

  function targetEmployeeId(targetRecord) {
    if (!targetRecord) return '';
    return String(targetRecord.employee_id || targetRecord.requester_employee_id || targetRecord.id || '');
  }

  function evaluateScope(actor, scopeType, targetRecord, conditions) {
    if (scopeType === 'Company') return true;
    if (!targetRecord) return false;
    var targetId = targetEmployeeId(targetRecord);
    if (scopeType === 'Self') return targetId === actor.employeeId;
    if (scopeType === 'Custom list') {
      var ids = conditions && Array.isArray(conditions.employee_ids) ? conditions.employee_ids : [];
      return ids.map(String).indexOf(targetId) >= 0;
    }
    var targetEmployee = null;
    var employees = Database.getAllCached('Employees');
    for (var i = 0; i < employees.length; i++) {
      if (employeeKey(employees[i]) === targetId) { targetEmployee = employees[i]; break; }
    }
    if (scopeType === 'Direct reports') return Boolean(targetEmployee && targetEmployee.reporting_manager_id === actor.employeeId);
    if (scopeType === 'Team') return targetId === actor.employeeId || getDownlineEmployeeIds(actor.employeeId).indexOf(targetId) >= 0;
    if (scopeType === 'Department') {
      return Boolean(targetEmployee && actor.departmentId && targetEmployee.department_id === actor.departmentId) ||
        (targetRecord.department_id && targetRecord.department_id === actor.departmentId) ||
        (targetEmployee && actor.department && targetEmployee.department === actor.department);
    }
    if (scopeType === 'Branch') {
      return Boolean(targetEmployee && actor.branchId && targetEmployee.branch_id === actor.branchId) ||
        (targetRecord.branch_id && targetRecord.branch_id === actor.branchId) ||
        (targetEmployee && actor.branch && targetEmployee.branch === actor.branch);
    }
    return false;
  }

  function conditionsAllow(conditions, actual) {
    if (!conditions || Object.keys(conditions).length === 0) return true;
    actual = actual || {};
    var allowed = true;
    Object.keys(conditions).forEach(function (key) {
      if (key === 'employee_ids') return;
      if (key === 'amount_max') {
        var maximum = Number(conditions[key]);
        var amount = Number(actual.amount);
        if (!isFinite(maximum) || maximum < 0 || actual.amount === undefined || !isFinite(amount) || amount > maximum) allowed = false;
      } else if (key === 'days_max') {
        var maximumDays = Number(conditions[key]);
        var days = Number(actual.days);
        if (!isFinite(maximumDays) || maximumDays < 0 || actual.days === undefined || !isFinite(days) || days > maximumDays) allowed = false;
      } else if (key === 'leave_type_ids') {
        if (!Array.isArray(conditions[key]) || conditions[key].map(String).indexOf(String(actual.leaveTypeId)) < 0) allowed = false;
      } else {
        allowed = false;
      }
    });
    return allowed;
  }

  function scopeMatches(flag, actor) {
    var type = String(flag.scope_type || 'GLOBAL').toUpperCase();
    if (!actor) return false;
    if (type === 'EMPLOYEE') return String(flag.scope_id) === String(actor.employeeId);
    if (type === 'BRANCH') return Boolean(actor.branchId) && String(flag.scope_id) === String(actor.branchId);
    if (type === 'DEPARTMENT') return Boolean(actor.departmentId) && String(flag.scope_id) === String(actor.departmentId);
    return false;
  }

  /** Resolution order: EMPLOYEE, BRANCH, DEPARTMENT override, then the global switch. */
  function isFeatureEnabled(featureKey, actor) {
    if (!featureKey) return true;
    if (typeof actor === 'string') actor = { employeeId: actor, branchId: actor, departmentId: actor };
    var flags = Database.getAllCached('Feature_Flags');
    var global = null;
    var employeeScope = null;
    var branchScope = null;
    var departmentScope = null;
    for (var i = 0; i < flags.length; i++) {
      var flag = flags[i];
      if (flag.feature_key !== featureKey || String(flag.status).toUpperCase() !== 'ACTIVE') continue;
      var type = String(flag.scope_type || 'GLOBAL').toUpperCase();
      if (type === 'GLOBAL' || !flag.scope_id) global = flag;
      else if (type === 'EMPLOYEE' && scopeMatches(flag, actor)) employeeScope = flag;
      else if (type === 'BRANCH' && scopeMatches(flag, actor)) branchScope = flag;
      else if (type === 'DEPARTMENT' && scopeMatches(flag, actor)) departmentScope = flag;
    }
    var resolved = employeeScope || branchScope || departmentScope || global;
    return resolved ? Utils.asBoolean(resolved.enabled) : false;
  }

  /** Effective feature switches for the shell, including explicit scoped entries. */
  function featureMap(actor) {
    var output = {};
    Database.getAllCached('Feature_Flags').forEach(function (flag) {
      if (String(flag.status).toUpperCase() !== 'ACTIVE') return;
      var type = String(flag.scope_type || 'GLOBAL').toUpperCase();
      if (type === 'GLOBAL' || !flag.scope_id) output[flag.feature_key] = Utils.asBoolean(flag.enabled);
      else output[flag.feature_key + '@' + type + ':' + flag.scope_id] = Utils.asBoolean(flag.enabled);
    });
    return output;
  }

  function scopeCeiling(first, second) {
    return (SCOPE_RANK[first] === undefined ? 0 : SCOPE_RANK[first]) <= (SCOPE_RANK[second] === undefined ? 0 : SCOPE_RANK[second]) ? first : second;
  }

  function checkFields(actor, effective, fields, write, context) {
    (fields || []).forEach(function (field) {
      var viewPermission = FIELD_RULES[field];
      if (!viewPermission) return;
      var required = write ? viewPermission.replace('.view', '.edit') : viewPermission;
      if (!hasPermissionFromEffective(actor, effective, required)) {
        deny(actor, required, null, { reason: 'FIELD', entity: 'Employees', context: context });
      }
      if (!write) Audit.logSensitiveAccess(actor.employeeId, field, actor.employeeId, context);
    });
  }

  function hasPermissionFromEffective(actor, effective, permissionKey) {
    if (effective.denyOverrides.indexOf(permissionKey) >= 0) return false;
    return actor.isSuperAdmin || effective.permissions.indexOf(permissionKey) >= 0;
  }

  function deny(actor, permissionKey, targetRecord, options) {
    options = options || {};
    Audit.logEvent('ACCESS_DENIED', actor.employeeId, options.entity || '', targetRecord ? targetRecord.id : '', 'DENIED', {
      permission: permissionKey,
      stage: options.reason || 'PERMISSION'
    }, options.context);
    Utils.fail('FORBIDDEN', 'You do not have permission to perform this action.');
  }

  /** Implements the specified evaluation order, including Super Admin SoD. */
  function check(actor, permissionKey, targetRecord, options) {
    options = options || {};
    if (!actor || !actor.sessionValidated || !actor.employeeId) Utils.fail('AUTH_REQUIRED', 'Authentication is required.');
    var effective = resolveEffectivePermissions(actor.employeeId);
    actor.isSuperAdmin = effective.isSuperAdmin;

    if (effective.denyOverrides.indexOf(permissionKey) >= 0) deny(actor, permissionKey, targetRecord, { reason: 'EXPLICIT_DENY', entity: options.entity, context: options.context });

    if (!actor.isSuperAdmin && effective.permissions.indexOf(permissionKey) < 0) {
      deny(actor, permissionKey, targetRecord, { reason: 'PERMISSION', entity: options.entity, context: options.context });
    }

    var scopedGrants;
    if (actor.isSuperAdmin) {
      scopedGrants = [{ key: permissionKey, scope: 'Company', conditions: {} }];
    } else {
      scopedGrants = effective.grants.filter(function (grant) {
        return grant.key === permissionKey && evaluateScope(actor, grant.scope, targetRecord, grant.conditions);
      });
      if (!scopedGrants.length) {
        // Administrative entry points act on collections, not on one record. For
        // modules the actor is allowed to administer, a grant at any scope is
        // enough to reach the screen; row-level filtering still applies inside
        // the handlers because canSeeEmployee() is checked per record.
        var anyGrant = effective.grants.some(function (grant) { return grant.key === permissionKey; });
        if (!anyGrant || !options.collection) deny(actor, permissionKey, targetRecord, { reason: 'SCOPE', entity: options.entity, context: options.context });
        scopedGrants = [{ key: permissionKey, scope: 'Self', conditions: {} }];
      }
    }

    checkFields(actor, effective, options.fields || [], Boolean(options.write), options.context);
    if (!isFeatureEnabled(options.featureKey, actor)) deny(actor, permissionKey, targetRecord, { reason: 'FEATURE', entity: options.entity, context: options.context });

    if (options.makerChecker && targetRecord) {
      var maker = targetRecord.prepared_by || targetRecord.created_by;
      if (maker && maker === actor.employeeId) deny(actor, permissionKey, targetRecord, { reason: 'MAKER_CHECKER', entity: options.entity, context: options.context });
    }

    if (!scopedGrants.some(function (grant) { return conditionsAllow(grant.conditions, options.condition); })) {
      deny(actor, permissionKey, targetRecord, { reason: 'CONDITION', entity: options.entity, context: options.context });
    }
    return { effective: effective, grants: scopedGrants };
  }

  /** Every permission the actor holds, for UI gating only (never authorisation). */
  function permissionSet(actor) {
    if (!actor || !actor.employeeId) return { isSuperAdmin: false, permissions: [] };
    var effective = resolveEffectivePermissions(actor.employeeId);
    return { isSuperAdmin: effective.isSuperAdmin, permissions: effective.permissions };
  }

  function maskSensitiveFields(record, actor, context) {
    if (!record) return record;
    var output = {};
    Object.keys(record).forEach(function (key) { output[key] = record[key]; });
    var effective = resolveEffectivePermissions(actor.employeeId);
    var masked = [];
    var visibleSensitive = [];
    Object.keys(FIELD_RULES).forEach(function (field) {
      if (output[field] === '' || output[field] === null || output[field] === undefined) return;
      if (!hasPermissionFromEffective(actor, effective, FIELD_RULES[field])) {
        delete output[field];
        masked.push(field);
      } else {
        visibleSensitive.push(field);
      }
    });
    if (masked.length) output.masked_fields = masked;
    if (visibleSensitive.length) Audit.logSensitiveAccess(actor.employeeId, visibleSensitive, targetEmployeeId(record), context);
    return output;
  }

  return {
    FIELD_RULES: FIELD_RULES,
    resolveEffectivePermissions: resolveEffectivePermissions,
    evaluateScope: evaluateScope,
    getDownlineEmployeeIds: getDownlineEmployeeIds,
    isFeatureEnabled: isFeatureEnabled,
    featureMap: featureMap,
    scopeCeiling: scopeCeiling,
    VALID_SCOPES: VALID_SCOPES,
    check: check,
    permissionSet: permissionSet,
    maskSensitiveFields: maskSensitiveFields
  };
})();
