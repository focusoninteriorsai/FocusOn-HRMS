/**
 * Access administration: login accounts, roles, per-user overrides, delegations,
 * scoped feature switches and the audit trail. All of it is Super-Admin editable.
 */
var Access = (function () {
  var SCOPES = Permissions.VALID_SCOPES;

  function temporaryPassword() {
    var upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
    var lower = 'abcdefghijkmnopqrstuvwxyz';
    var digits = '23456789';
    var symbols = '!@#$%*?';
    var all = upper + lower + digits + symbols;
    var value = [
      upper.charAt(Math.floor(Math.random() * upper.length)),
      lower.charAt(Math.floor(Math.random() * lower.length)),
      digits.charAt(Math.floor(Math.random() * digits.length)),
      symbols.charAt(Math.floor(Math.random() * symbols.length))
    ].join('');
    while (value.length < 14) value += all.charAt(Math.floor(Math.random() * all.length));
    return value;
  }

  function superAdminCount() {
    return Repo.employeeIdsWithRole('SUPER_ADMIN').length;
  }

  function isSuperAdmin(employeeId) {
    return Repo.employeeIdsWithRole('SUPER_ADMIN').indexOf(String(employeeId)) >= 0;
  }

  function listUsers(authentication, payload) {
    var users = Repo.users();
    var employees = Repo.byId('Employees');
    var roleMap = {};
    Database.getAllCached('Roles').forEach(function (role) { roleMap[role.id] = role; });
    var rolesByEmployee = {};
    var now = Utils.nowIso();
    Database.getAllCached('User_Role_Map').forEach(function (mapping) {
      if (String(mapping.status).toUpperCase() !== 'ACTIVE') return;
      if (mapping.valid_from && Utils.toIso(mapping.valid_from) > now) return;
      if (mapping.valid_until && Utils.toIso(mapping.valid_until) <= now) return;
      if (!rolesByEmployee[mapping.employee_id]) rolesByEmployee[mapping.employee_id] = [];
      var role = roleMap[mapping.role_id];
      if (role) rolesByEmployee[mapping.employee_id].push({ id: role.id, name: role.name, code: role.role_code, scope: role.scope_type });
    });
    var items = users.map(function (user) {
      var employee = employees[user.employee_id] || Repo.employee(user.employee_id) || {};
      return {
        userId: user.id,
        employeeId: user.employee_id,
        displayName: employee.display_name || user.employee_id,
        department: employee.department || '',
        designation: employee.designation || '',
        workEmail: employee.work_email || '',
        status: String(user.status).toUpperCase(),
        mustChangePassword: Utils.asBoolean(user.must_change_password),
        passwordChangedAt: Utils.toIso(user.password_changed_at),
        lastLoginAt: Utils.toIso(user.last_login_at),
        roles: rolesByEmployee[user.employee_id] || [],
        isSuperAdmin: (rolesByEmployee[user.employee_id] || []).some(function (role) { return role.code === 'SUPER_ADMIN'; })
      };
    });
    if (payload.status) items = items.filter(function (item) { return item.status === String(payload.status).toUpperCase(); });
    if (payload.roleId) items = items.filter(function (item) { return item.roles.some(function (role) { return role.id === payload.roleId; }); });
    if (payload.withoutAccount) {
      var ids = {};
      users.forEach(function (user) { ids[user.employee_id] = true; });
      var pending = Repo.employees().filter(function (employee) { return !ids[Repo.employeeKey(employee)]; }).map(function (employee) {
        return {
          userId: '', employeeId: Repo.employeeKey(employee), displayName: employee.display_name || '',
          department: employee.department || '', designation: employee.designation || '',
          workEmail: employee.work_email || '', status: 'NO_ACCOUNT', mustChangePassword: false,
          passwordChangedAt: '', lastLoginAt: '', roles: [], isSuperAdmin: false
        };
      });
      items = items.concat(pending);
    }
    items.sort(function (left, right) { return String(left.displayName).localeCompare(String(right.displayName)); });
    var paged = Utils.paginate(items, payload, { searchFields: ['displayName', 'employeeId', 'workEmail', 'department'], maxPageSize: 300 });
    return { items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total, superAdminCount: superAdminCount() };
  }

  function createUser(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var existingUser = Repo.user(employeeId);
    if (existingUser) Utils.fail('CONFLICT', 'A login account already exists for this Employee ID.');
    var employee = Repo.employee(employeeId);
    if (!employee) {
      var displayName = Utils.requireString(payload, 'displayName', { max: 160 });
      employee = Database.insert('Employees', {
        id: employeeId, employee_id: employeeId, display_name: displayName,
        first_name: displayName, last_name: '', department_id: Utils.cleanString(payload.departmentId),
        department: Utils.cleanString(payload.department), designation_id: Utils.cleanString(payload.designationId),
        designation: Utils.cleanString(payload.designation), branch_id: Utils.cleanString(payload.branchId),
        branch: Utils.cleanString(payload.branch), work_location_type: 'UNASSIGNED'
      }, actor.employeeId);
    }
    var password = Utils.cleanString(payload.password);
    if (password) Auth.assertPasswordPolicy(password);
    else password = temporaryPassword();
    var credential = Auth.buildPasswordCredential(password);
    var user = Database.insert('Users', {
      employee_id: employeeId,
      password_hash: credential.password_hash,
      password_salt: credential.password_salt,
      password_iterations: credential.password_iterations,
      must_change_password: true,
      password_changed_at: Utils.nowIso(),
      language: Settings.text('DEFAULT_LANGUAGE', 'en'),
      theme: Settings.text('DEFAULT_THEME', 'light'),
      simple_mode: Settings.bool('SIMPLE_MODE_DEFAULT', false),
      status: 'ACTIVE'
    }, actor.employeeId);
    var roleIds = Array.isArray(payload.roleIds) ? payload.roleIds.slice(0, 10).map(String) : [];
    roleIds.forEach(function (roleId) { assign(authentication, { reason: payload.reason || 'Account created' }, employeeId, roleId); });
    Audit.logEvent('USER_CREATED', actor.employeeId, 'Users', user.id, 'SUCCESS', { employeeId: employeeId, roles: roleIds.length }, {});
    return { employeeId: employeeId, userId: user.id, temporaryPassword: password, mustChangePassword: true };
  }

  function resetPassword(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var user = Repo.user(employeeId);
    if (!user) Utils.fail('NOT_FOUND', 'Login account not found.');
    if (isSuperAdmin(employeeId) && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can reset a Super Admin password.');
    var password = Utils.cleanString(payload.password);
    if (password) Auth.assertPasswordPolicy(password);
    else password = temporaryPassword();
    var credential = Auth.buildPasswordCredential(password);
    Database.update('Users', user.id, {
      password_hash: credential.password_hash,
      password_salt: credential.password_salt,
      password_iterations: credential.password_iterations,
      must_change_password: true,
      password_changed_at: Utils.nowIso()
    }, actor.employeeId);
    Auth.revokeUserSessions(employeeId, null);
    Audit.logEvent('PASSWORD_RESET_BY_ADMIN', actor.employeeId, 'Users', user.id, 'SUCCESS', { employeeId: employeeId, sessionsRevoked: true }, {});
    return { employeeId: employeeId, temporaryPassword: password, sessionsRevoked: true };
  }

  function setUserStatus(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var status = Utils.requireEnum(payload.status, ['ACTIVE', 'INACTIVE'], 'Status');
    var user = Repo.user(employeeId);
    if (!user) Utils.fail('NOT_FOUND', 'Login account not found.');
    if (employeeId === actor.employeeId) Utils.fail('FORBIDDEN', 'You cannot disable your own account.');
    if (isSuperAdmin(employeeId) && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can change a Super Admin account.');
    Database.update('Users', user.id, { status: status }, actor.employeeId);
    if (status !== 'ACTIVE') Auth.revokeUserSessions(employeeId, null);
    Audit.logEvent('USER_STATUS_CHANGED', actor.employeeId, 'Users', user.id, 'SUCCESS', { employeeId: employeeId, status: status }, {});
    return { employeeId: employeeId, status: status };
  }

  function userSessions(authentication, payload) {
    var employeeId = payload.employeeId ? Utils.normalizeEmployeeId(payload.employeeId) : '';
    var now = Utils.nowIso();
    var items = Database.getAllCached('Sessions').filter(function (row) {
      if (String(row.status).toUpperCase() !== 'ACTIVE') return false;
      if (Utils.toIso(row.expires_at) <= now) return false;
      return !employeeId || row.employee_id === employeeId;
    }).map(function (row) {
      return {
        id: row.id, employeeId: row.employee_id, displayName: Repo.employeeName(row.employee_id),
        lastSeenAt: Utils.toIso(row.last_seen_at), expiresAt: Utils.toIso(row.expires_at),
        createdAt: Utils.toIso(row.created_at), deviceHash: String(row.device_hash || '').slice(0, 12)
      };
    });
    return { items: items, total: items.length };
  }

  function revokeSession(authentication, payload) {
    var session = Repo.requireRecord('Sessions', payload.sessionId, 'Session');
    if (session.employee_id !== authentication.actor.employeeId && !authentication.actor.isSuperAdmin) {
      Utils.fail('FORBIDDEN', 'You cannot revoke another employee session.');
    }
    Database.update('Sessions', session.id, { status: 'REVOKED', revoked_at: Utils.nowIso() }, authentication.actor.employeeId);
    Audit.logEvent('SESSION_REVOKED', authentication.actor.employeeId, 'Sessions', session.id, 'SUCCESS', { employeeId: session.employee_id }, {});
    return { revoked: true };
  }

  function permissionCatalog() {
    return Database.getAllCached('Permissions_Catalog').filter(function (row) {
      return String(row.status).toUpperCase() === 'ACTIVE';
    }).map(function (row) {
      return { key: row.permission_key, module: row.module, action: row.action, description: row.description, sensitive: Utils.asBoolean(row.sensitive) };
    }).sort(function (left, right) {
      return (left.module + left.key).localeCompare(right.module + right.key);
    });
  }

  function listRoles(authentication, payload) {
    var catalog = permissionCatalog();
    var grants = Database.getAllCached('Role_Permissions');
    var assignedCounts = {};
    Database.getAllCached('User_Role_Map').forEach(function (mapping) {
      if (String(mapping.status).toUpperCase() !== 'ACTIVE') return;
      assignedCounts[mapping.role_id] = (assignedCounts[mapping.role_id] || 0) + 1;
    });
    var items = Database.getAllCached('Roles').filter(function (role) {
      return String(role.status).toUpperCase() !== 'DELETED';
    }).map(function (role) {
      var permissions = grants.filter(function (grant) {
        return grant.role_id === role.id && String(grant.status).toUpperCase() === 'ACTIVE';
      }).map(function (grant) {
        return { key: grant.permission_key, conditions: Utils.safeParseJson(grant.conditions_json, {}) };
      });
      return {
        id: role.id, roleCode: role.role_code, name: role.name, description: role.description || '',
        scopeType: role.scope_type, builtIn: Utils.asBoolean(role.built_in),
        active: String(role.status).toUpperCase() === 'ACTIVE',
        permissionCount: permissions.length,
        assignedCount: assignedCounts[role.id] || 0,
        permissions: permissions
      };
    }).sort(function (left, right) { return left.name.localeCompare(right.name); });
    return { roles: items, catalog: catalog, scopes: SCOPES };
  }

  function saveRole(authentication, payload) {
    var actor = authentication.actor;
    var roleId = Utils.cleanString(payload.roleId);
    var name = Utils.requireString(payload, 'name', { max: 160 });
    var scopeType = Utils.requireEnum(payload.scopeType, SCOPES, 'Scope');
    var description = Utils.cleanString(payload.description).slice(0, 1000);
    var role;
    if (roleId) {
      role = Repo.requireRecord('Roles', roleId, 'Role');
      if (Utils.asBoolean(role.built_in) && role.role_code === 'SUPER_ADMIN') {
        Utils.fail('FORBIDDEN', 'The built-in Super Admin role cannot be renamed or rescoped.');
      }
      role = Database.update('Roles', role.id, {
        name: name, description: description, scope_type: scopeType,
        conditions_json: JSON.stringify(validateConditions(payload.conditions))
      }, actor.employeeId);
    } else {
      var code = Utils.cleanString(payload.roleCode || name).toUpperCase().replace(/[^A-Z0-9]+/g, '_').slice(0, 60) || 'ROLE';
      if (Repo.roleByCode(code)) Utils.fail('CONFLICT', 'A role with this code already exists.');
      role = Database.insert('Roles', {
        role_code: code, name: name, description: description, scope_type: scopeType,
        conditions_json: JSON.stringify(validateConditions(payload.conditions)), built_in: false
      }, actor.employeeId);
    }
    if (Array.isArray(payload.permissionKeys)) setRolePermissions(authentication, role.id, payload.permissionKeys, payload.conditions);
    Audit.logEvent(roleId ? 'ROLE_UPDATED' : 'ROLE_CREATED', actor.employeeId, 'Roles', role.id, 'SUCCESS', { name: name, scope: scopeType }, {});
    return { roleId: role.id };
  }

  function validateConditions(conditions) {
    if (!conditions || typeof conditions !== 'object') return {};
    var output = {};
    if (conditions.amount_max !== undefined) output.amount_max = Utils.requireNumber(conditions.amount_max, 'Amount limit', { min: 0, max: 100000000 });
    if (conditions.days_max !== undefined) output.days_max = Utils.requireNumber(conditions.days_max, 'Days limit', { min: 0, max: 730 });
    if (Array.isArray(conditions.employee_ids)) output.employee_ids = conditions.employee_ids.slice(0, 500).map(String);
    if (Array.isArray(conditions.leave_type_ids)) output.leave_type_ids = conditions.leave_type_ids.slice(0, 100).map(String);
    return output;
  }

  function setRolePermissions(authentication, roleId, permissionKeys, conditions) {
    var actor = authentication.actor;
    var known = {};
    permissionCatalog().forEach(function (item) { known[item.key] = true; });
    var keys = Utils.csvUnique((permissionKeys || []).map(String)).filter(function (key) {
      if (!known[key]) Utils.fail('VALIDATION', 'Unknown permission key: ' + key + '.');
      return true;
    });
    if (keys.length > 400) Utils.fail('VALIDATION', 'Too many permissions for one role.');
    Database.updateMany('Role_Permissions', function (row) { return row.role_id === roleId; }, { status: 'DELETED' }, actor.employeeId);
    var existing = Database.getAllCached('Role_Permissions');
    keys.forEach(function (key) {
      var match = null;
      existing.forEach(function (row) { if (row.role_id === roleId && row.permission_key === key) match = row; });
      if (match) {
        Database.update('Role_Permissions', match.id, { status: 'ACTIVE', conditions_json: JSON.stringify(conditions || {}) }, actor.employeeId);
      } else {
        Database.insert('Role_Permissions', {
          role_id: roleId, permission_key: key, conditions_json: JSON.stringify(conditions || {})
        }, actor.employeeId);
      }
    });
    Database.invalidateCache('Role_Permissions');
    return keys.length;
  }

  function saveRolePermissions(authentication, payload) {
    var role = Repo.requireRecord('Roles', payload.roleId, 'Role');
    if (Utils.asBoolean(role.built_in) && role.role_code === 'SUPER_ADMIN') {
      Utils.fail('FORBIDDEN', 'The Super Admin role always has every permission.');
    }
    var count = setRolePermissions(authentication, role.id, payload.permissionKeys, payload.conditions);
    Audit.logEvent('ROLE_PERMISSIONS_CHANGED', authentication.actor.employeeId, 'Roles', role.id, 'SUCCESS', { permissionCount: count }, {});
    return { roleId: role.id, permissionCount: count };
  }

  function deleteRole(authentication, payload) {
    var role = Repo.requireRecord('Roles', payload.roleId, 'Role');
    if (Utils.asBoolean(role.built_in)) Utils.fail('FORBIDDEN', 'A built-in role cannot be deleted.');
    var assigned = Database.getAllCached('User_Role_Map').filter(function (mapping) {
      return mapping.role_id === role.id && String(mapping.status).toUpperCase() === 'ACTIVE';
    });
    if (assigned.length) Utils.fail('CONFLICT', 'Remove this role from its ' + assigned.length + ' user(s) before deleting it.');
    Database.softDelete('Roles', role.id, authentication.actor.employeeId);
    Audit.logEvent('ROLE_DELETED', authentication.actor.employeeId, 'Roles', role.id, 'SUCCESS', { name: role.name }, {});
    return { deleted: true };
  }

  function assign(authentication, payload, explicitEmployeeId, explicitRoleId, explicitReason) {
    var employeeId = explicitEmployeeId || Utils.normalizeEmployeeId(payload.employeeId);
    var roleId = explicitRoleId || Utils.cleanString(payload.roleId);
    if (!roleId) Utils.fail('VALIDATION', 'A role is required.');
    var actor = authentication.actor;
    var role = Repo.requireRecord('Roles', roleId, 'Role');
    var employee = Repo.requireEmployee(employeeId);
    if (role.role_code === 'SUPER_ADMIN' && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can grant the Super Admin role.');
    if (role.role_code === 'SUPER_ADMIN' && !isSuperAdmin(employeeId) && superAdminCount() >= Settings.number('MAX_SUPER_ADMINS', 3)) {
      Utils.fail('CONFLICT', 'The maximum number of Super Admin accounts has been reached.');
    }
    var now = Utils.nowIso();
    var validFrom = Utils.cleanString(payload.validFrom) ? Utils.requireDate(payload.validFrom, 'Valid from') : now;
    var validUntil = Utils.cleanString(payload.validUntil) ? Utils.requireDate(payload.validUntil, 'Valid until') : '';
    if (validUntil && validUntil < Utils.dateOnly(validFrom)) Utils.fail('VALIDATION', 'The end date must follow the start date.');
    var existing = Database.findOne('User_Role_Map', function (row) {
      return row.employee_id === employeeId && row.role_id === role.id && String(row.status).toUpperCase() !== 'DELETED';
    });
    var record;
    if (existing) {
      record = Database.update('User_Role_Map', existing.id, {
        status: 'ACTIVE', valid_from: validFrom, valid_until: validUntil,
        assigned_by: actor.employeeId, reason: Utils.cleanString(payload.reason || 'Role assigned').slice(0, 1000)
      }, actor.employeeId);
    } else {
      record = Database.insert('User_Role_Map', {
        employee_id: employeeId, role_id: role.id, valid_from: validFrom, valid_until: validUntil,
        assigned_by: actor.employeeId, reason: Utils.cleanString(payload.reason || 'Role assigned').slice(0, 1000)
      }, actor.employeeId);
    }
    Database.invalidateCache('User_Role_Map');
    Audit.logEvent('ROLE_ASSIGNED', actor.employeeId, 'User_Role_Map', record.id, 'SUCCESS', {
      employeeId: employeeId, role: role.role_code, validUntil: validUntil, reason: payload.reason
    }, {});
    return { employeeId: employeeId, roleId: role.id, mappingId: record.id };
  }

  function unassign(authentication, payload) {
    var actor = authentication.actor;
    var mapping = Repo.requireRecord('User_Role_Map', payload.mappingId, 'Role assignment');
    if (mapping.employee_id === actor.employeeId && mapping.role_id === (Repo.roleByCode('SUPER_ADMIN') || {}).id) {
      Utils.fail('FORBIDDEN', 'You cannot remove your own Super Admin role.');
    }
    var role = Repo.find('Roles', mapping.role_id);
    if (role && role.role_code === 'SUPER_ADMIN' && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can remove the Super Admin role.');
    Database.update('User_Role_Map', mapping.id, { status: 'DELETED' }, actor.employeeId);
    Audit.logEvent('ROLE_REMOVED', actor.employeeId, 'User_Role_Map', mapping.id, 'SUCCESS', { employeeId: mapping.employee_id }, {});
    return { removed: true };
  }

  function employeeAccess(authentication, payload) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || authentication.actor.employeeId);
    var effective = Permissions.resolveEffectivePermissions(employeeId);
    var roleMap = Repo.byId('Roles');
    var now = Utils.nowIso();
    var assignments = Database.getAllCached('User_Role_Map').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE';
    }).map(function (row) {
      var role = roleMap[row.role_id] || {};
      return {
        mappingId: row.id, roleId: row.role_id, roleName: role.name || '', roleCode: role.role_code || '',
        scopeType: role.scope_type || '', validFrom: Utils.toIso(row.valid_from), validUntil: Utils.toIso(row.valid_until),
        reason: row.reason || '', currentlyActive: (!row.valid_from || Utils.toIso(row.valid_from) <= now) && (!row.valid_until || Utils.toIso(row.valid_until) > now)
      };
    });
    var overrides = Database.getAllCached('User_Permission_Overrides').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE';
    }).map(function (row) {
      return {
        id: row.id, permissionKey: row.permission_key, effect: row.effect, scopeType: row.scope_type,
        reason: row.reason || '', expiresAt: Utils.toIso(row.expires_at), grantedBy: row.granted_by || ''
      };
    });
    var delegations = Database.getAllCached('Delegations').filter(function (row) {
      return (row.delegate_employee_id === employeeId || row.delegator_employee_id === employeeId) && String(row.status).toUpperCase() === 'ACTIVE';
    }).map(function (row) {
      return {
        id: row.id, delegatorEmployeeId: row.delegator_employee_id, delegateEmployeeId: row.delegate_employee_id,
        delegatorName: Repo.employeeName(row.delegator_employee_id), delegateName: Repo.employeeName(row.delegate_employee_id),
        permissions: Utils.safeParseJson(row.permissions_json, []), scopeType: row.scope_type,
        startsAt: Utils.toIso(row.starts_at), endsAt: Utils.toIso(row.ends_at), reason: row.reason || '',
        direction: row.delegate_employee_id === employeeId ? 'IN' : 'OUT'
      };
    });
    return {
      employeeId: employeeId,
      displayName: Repo.employeeName(employeeId),
      assignments: assignments,
      overrides: overrides,
      delegations: delegations,
      effective: {
        isSuperAdmin: effective.isSuperAdmin,
        permissions: effective.permissions,
        scopes: effective.scopes,
        denied: effective.denyOverrides
      }
    };
  }

  function saveOverride(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var permissionKey = Utils.requireString(payload, 'permissionKey', { max: 160 });
    var known = permissionCatalog().some(function (item) { return item.key === permissionKey; });
    if (!known) Utils.fail('VALIDATION', 'Unknown permission key.');
    var effect = Utils.requireEnum(payload.effect, ['ALLOW', 'DENY'], 'Effect');
    var reason = Utils.requireString(payload, 'reason', { max: 1000, min: 5 });
    if (employeeId === actor.employeeId && effect === 'DENY') Utils.fail('FORBIDDEN', 'You cannot deny a permission to yourself.');
    if (isSuperAdmin(employeeId) && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can change a Super Admin access.');
    var scopeType = Utils.cleanString(payload.scopeType);
    if (scopeType && SCOPES.indexOf(scopeType) < 0) Utils.fail('VALIDATION', 'Unknown scope.');
    var expiresAt = Utils.cleanString(payload.expiresAt);
    if (expiresAt) {
      var parsed = new Date(expiresAt);
      if (isNaN(parsed.getTime())) Utils.fail('VALIDATION', 'The expiry must be a valid date and time.');
      if (parsed.getTime() <= Date.now()) Utils.fail('VALIDATION', 'The expiry must be in the future.');
      expiresAt = parsed.toISOString();
    } else if (effect === 'ALLOW') {
      expiresAt = Utils.addSeconds(new Date(), 90 * 86400);
    }
    var record = Database.insert('User_Permission_Overrides', {
      employee_id: employeeId, permission_key: permissionKey, effect: effect,
      scope_type: scopeType || 'Company', conditions_json: JSON.stringify(validateConditions(payload.conditions)),
      reason: reason, expires_at: expiresAt, granted_by: actor.employeeId
    }, actor.employeeId);
    Audit.logEvent('OVERRIDE_GRANTED', actor.employeeId, 'User_Permission_Overrides', record.id, 'SUCCESS', {
      employeeId: employeeId, permissionKey: permissionKey, effect: effect, reason: reason
    }, {});
    return { id: record.id };
  }

  function deleteOverride(authentication, payload) {
    var override = Repo.requireRecord('User_Permission_Overrides', payload.overrideId, 'Override');
    Database.update('User_Permission_Overrides', override.id, { status: 'DELETED' }, authentication.actor.employeeId);
    Audit.logEvent('OVERRIDE_REMOVED', authentication.actor.employeeId, 'User_Permission_Overrides', override.id, 'SUCCESS', {
      employeeId: override.employee_id, permissionKey: override.permission_key
    }, {});
    return { removed: true };
  }

  function saveDelegation(authentication, payload) {
    var actor = authentication.actor;
    var delegator = Utils.normalizeEmployeeId(payload.delegatorEmployeeId || actor.employeeId);
    var delegate = Utils.normalizeEmployeeId(payload.delegateEmployeeId);
    if (delegator === delegate) Utils.fail('VALIDATION', 'Choose another employee as the delegate.');
    if (delegator !== actor.employeeId && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only a Super Admin can delegate on behalf of another employee.');
    Repo.requireEmployee(delegate);
    var permissions = Array.isArray(payload.permissions) ? payload.permissions.slice(0, 100).map(String) : [];
    if (!permissions.length) Utils.fail('VALIDATION', 'Select at least one permission to delegate.');
    var delegatorEffective = Permissions.resolveEffectivePermissions(delegator);
    permissions.forEach(function (key) {
      if (!delegatorEffective.isSuperAdmin && delegatorEffective.permissions.indexOf(key) < 0) {
        Utils.fail('FORBIDDEN', 'A delegator cannot delegate a permission they do not hold: ' + key + '.');
      }
    });
    var startsAt = Utils.cleanString(payload.startsAt);
    var endsAt = Utils.cleanString(payload.endsAt);
    var start = startsAt ? new Date(startsAt) : new Date();
    var end = endsAt ? new Date(endsAt) : new Date(Date.now() + 7 * 86400000);
    if (isNaN(start.getTime()) || isNaN(end.getTime())) Utils.fail('VALIDATION', 'The delegation window is invalid.');
    if (end.getTime() <= start.getTime()) Utils.fail('VALIDATION', 'The end of the delegation must follow the start.');
    if (end.getTime() - start.getTime() > 180 * 86400000) Utils.fail('VALIDATION', 'A delegation cannot exceed 180 days.');
    var scopeType = Utils.cleanString(payload.scopeType) || 'Self';
    if (SCOPES.indexOf(scopeType) < 0) Utils.fail('VALIDATION', 'Unknown scope.');
    var record = Database.insert('Delegations', {
      delegator_employee_id: delegator, delegate_employee_id: delegate,
      permissions_json: JSON.stringify(permissions), scope_type: Permissions.scopeCeiling(scopeType, 'Self') === scopeType ? scopeType : scopeType,
      capability_ceiling_json: JSON.stringify({}), workflow_define: payload.allowWorkflow === true,
      starts_at: start.toISOString(), ends_at: end.toISOString(),
      reason: Utils.requireString(payload, 'reason', { max: 1000, min: 5 })
    }, actor.employeeId);
    Audit.logEvent('DELEGATION_CREATED', actor.employeeId, 'Delegations', record.id, 'SUCCESS', {
      delegator: delegator, delegate: delegate, permissions: permissions
    }, {});
    return { id: record.id };
  }

  function deleteDelegation(authentication, payload) {
    var delegation = Repo.requireRecord('Delegations', payload.delegationId, 'Delegation');
    Database.update('Delegations', delegation.id, { status: 'DELETED' }, authentication.actor.employeeId);
    Audit.logEvent('DELEGATION_REMOVED', authentication.actor.employeeId, 'Delegations', delegation.id, 'SUCCESS', {}, {});
    return { removed: true };
  }

  function auditLog(authentication, payload) {
    var rows = Database.getAllCached('Audit_Logs').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (payload.eventType && row.event_type !== payload.eventType) return false;
      if (payload.actorId && row.actor_id !== String(payload.actorId).toUpperCase()) return false;
      if (payload.outcome && row.outcome !== payload.outcome) return false;
      if (payload.from && Utils.toIso(row.created_at) < payload.from) return false;
      if (payload.to && Utils.toIso(row.created_at) > payload.to) return false;
      return true;
    }).map(function (row) {
      return {
        id: row.id, eventType: row.event_type, actorId: row.actor_id,
        targetEntity: row.target_entity, targetId: row.target_id, outcome: row.outcome,
        reqId: row.req_id, details: Utils.safeParseJson(row.details_json, {}), createdAt: Utils.toIso(row.created_at)
      };
    }).sort(function (left, right) { return String(right.createdAt).localeCompare(String(left.createdAt)); });
    var paged = Utils.paginate(rows, payload, { searchFields: ['eventType', 'actorId', 'targetId'], maxPageSize: 200 });
    return { items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total };
  }

  function featureScopes(authentication, payload) {
    var rows = Database.getAllCached('Feature_Flags').filter(function (row) {
      return String(row.status).toUpperCase() === 'ACTIVE' && String(row.scope_type || 'GLOBAL').toUpperCase() !== 'GLOBAL';
    }).map(function (row) {
      return { id: row.id, featureKey: row.feature_key, enabled: Utils.asBoolean(row.enabled), scopeType: row.scope_type, scopeId: row.scope_id };
    });
    return { items: rows, features: Settings.featureDefinitions() };
  }

  function saveFeatureScope(authentication, payload) {
    var featureKey = Utils.requireString(payload, 'featureKey', { max: 160, pattern: /^[a-z][a-z0-9_]{1,60}$/ });
    var scopeType = Utils.requireEnum(payload.scopeType, ['BRANCH', 'DEPARTMENT', 'EMPLOYEE'], 'Scope type');
    var scopeId = Utils.requireString(payload, 'scopeId', { max: 128 });
    var enabled = payload.enabled === true || String(payload.enabled).toUpperCase() === 'TRUE';
    var existing = Database.findOne('Feature_Flags', function (row) {
      return row.feature_key === featureKey && row.scope_id === scopeId && String(row.scope_type).toUpperCase() === scopeType && String(row.status).toUpperCase() === 'ACTIVE';
    }, { cached: true });
    if (existing) Database.update('Feature_Flags', existing.id, { enabled: enabled }, authentication.actor.employeeId);
    else Database.insert('Feature_Flags', { feature_key: featureKey, enabled: enabled, scope_type: scopeType, scope_id: scopeId }, authentication.actor.employeeId);
    Database.invalidateCache('Feature_Flags');
    Audit.logEvent('FEATURE_SCOPE_CHANGED', authentication.actor.employeeId, 'Feature_Flags', scopeId, 'SUCCESS', { featureKey: featureKey, scopeType: scopeType, enabled: enabled }, {});
    return { saved: true };
  }

  function deleteFeatureScope(authentication, payload) {
    var flag = Repo.requireRecord('Feature_Flags', payload.flagId, 'Feature switch');
    Database.update('Feature_Flags', flag.id, { status: 'DELETED' }, authentication.actor.employeeId);
    Database.invalidateCache('Feature_Flags');
    return { removed: true };
  }

  /** Employee-facing shell data: menu, feature switches and unread count. */
  function bootstrap(authentication) {
    var actor = authentication.actor;
    var features = Permissions.featureMap();
    var unread = typeof Notifications !== 'undefined' ? Notifications.unreadCount(actor.employeeId) : 0;
    var pendingApprovals = 0;
    if (actor.isSuperAdmin || actor.permissions.indexOf('workflow.inbox') >= 0) {
      pendingApprovals = Workflow.openForApprover(actor.employeeId).length;
    }
    return {
      permissions: authentication.effective.permissions,
      scopes: authentication.effective.scopes,
      isSuperAdmin: actor.isSuperAdmin,
      features: features,
      unreadNotifications: unread,
      pendingApprovals: pendingApprovals,
      company: {
        name: Settings.text('COMPANY_NAME', 'FOCUSON HRMS'),
        shortName: Settings.text('COMPANY_SHORT_NAME', '') || Settings.text('COMPANY_NAME', 'FOCUSON HRMS'),
        logoUrl: Settings.text('COMPANY_LOGO_URL', ''),
        currency: Settings.text('CURRENCY_SYMBOL', '₹'),
        dateFormat: Settings.text('DATE_FORMAT', 'dd MMM yyyy'),
        timeFormat: Settings.text('TIME_FORMAT', '24'),
        workweek: Settings.json('WORKWEEK_DAYS', [1, 2, 3, 4, 5]),
        financialYearStart: Settings.number('FINANCIAL_YEAR_START_MONTH', 4)
      },
      employee: {
        employeeId: actor.employeeId,
        displayName: actor.displayName,
        department: actor.department,
        designation: actor.designation,
        branch: actor.branch,
        photoUrl: (authentication.employee && authentication.employee.photo_file_id) ? ('drive:' + authentication.employee.photo_file_id) : ''
      }
    };
  }

  return {
    listUsers: listUsers,
    createUser: createUser,
    resetPassword: resetPassword,
    setUserStatus: setUserStatus,
    userSessions: userSessions,
    revokeSession: revokeSession,
    permissionCatalog: permissionCatalog,
    listRoles: listRoles,
    saveRole: saveRole,
    saveRolePermissions: saveRolePermissions,
    deleteRole: deleteRole,
    assign: assign,
    unassign: unassign,
    employeeAccess: employeeAccess,
    saveOverride: saveOverride,
    deleteOverride: deleteOverride,
    saveDelegation: saveDelegation,
    deleteDelegation: deleteDelegation,
    auditLog: auditLog,
    featureScopes: featureScopes,
    saveFeatureScope: saveFeatureScope,
    deleteFeatureScope: deleteFeatureScope,
    bootstrap: bootstrap,
    superAdminCount: superAdminCount
  };
})();
