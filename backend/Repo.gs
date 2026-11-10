/**
 * Read helpers shared by handlers. Only cached table reads are used here so that
 * list rendering stays inside Apps Script execution limits.
 */
var Repo = (function () {
  function active(rows) {
    return (rows || []).filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; });
  }

  function employees() {
    return active(Database.getAllCached('Employees'));
  }

  function activeEmployees() {
    return employees().filter(function (row) { return String(row.status).toUpperCase() === 'ACTIVE'; });
  }

  function employeeKey(row) {
    return String(row.employee_id || row.id || '');
  }

  function employee(employeeId) {
    var id = String(employeeId || '').toUpperCase();
    if (!id) return null;
    var rows = Database.getAllCached('Employees');
    for (var i = 0; i < rows.length; i++) {
      if (employeeKey(rows[i]).toUpperCase() === id) return rows[i];
    }
    return null;
  }

  function requireEmployee(employeeId) {
    var row = employee(employeeId);
    if (!row || String(row.status).toUpperCase() === 'DELETED') Utils.fail('NOT_FOUND', 'Employee record not found.');
    return row;
  }

  function employeeName(employeeId) {
    var row = employee(employeeId);
    return row ? (row.display_name || employeeKey(row)) : '';
  }

  function managerOf(employeeId) {
    var row = employee(employeeId);
    return row ? String(row.reporting_manager_id || '') : '';
  }

  function byId(tabName) {
    var map = {};
    Database.getAllCached(tabName).forEach(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return;
      map[row.id] = row;
    });
    return map;
  }

  function find(tabName, id) {
    if (!id) return null;
    var rows = Database.getAllCached(tabName);
    for (var i = 0; i < rows.length; i++) {
      if (String(rows[i].id) === String(id) && String(rows[i].status).toUpperCase() !== 'DELETED') return rows[i];
    }
    return null;
  }

  function requireRecord(tabName, id, label) {
    var row = find(tabName, id);
    if (!row) Utils.fail('NOT_FOUND', (label || 'Record') + ' not found.');
    return row;
  }

  function label(tabName, id, field) {
    var row = find(tabName, id);
    return row ? (row[field || 'name'] || '') : '';
  }

  function users() {
    return active(Database.getAllCached('Users'));
  }

  function user(employeeId) {
    var rows = Database.getAllCached('Users');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].employee_id === employeeId && String(rows[i].status).toUpperCase() !== 'DELETED') return rows[i];
    }
    return null;
  }

  function roleByCode(code) {
    var rows = Database.getAllCached('Roles');
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].role_code === code && String(rows[i].status).toUpperCase() === 'ACTIVE') return rows[i];
    }
    return null;
  }

  function employeeIdsWithRole(roleCode) {
    var role = roleByCode(roleCode);
    if (!role) return [];
    var now = Utils.nowIso();
    var ids = [];
    Database.getAllCached('User_Role_Map').forEach(function (mapping) {
      if (mapping.role_id !== role.id || String(mapping.status).toUpperCase() !== 'ACTIVE') return;
      if (mapping.valid_from && Utils.toIso(mapping.valid_from) > now) return;
      if (mapping.valid_until && Utils.toIso(mapping.valid_until) <= now) return;
      ids.push(mapping.employee_id);
    });
    return Utils.csvUnique(ids);
  }

  function employeeIdsWithPermission(permissionKey) {
    var ids = [];
    activeEmployees().forEach(function (row) {
      var effective = Permissions.resolveEffectivePermissions(employeeKey(row));
      if (effective.isSuperAdmin || effective.permissions.indexOf(permissionKey) >= 0) ids.push(employeeKey(row));
    });
    return Utils.csvUnique(ids);
  }

  function branches() {
    return active(Database.getAllCached('Branches'));
  }

  function departments() {
    return active(Database.getAllCached('Departments'));
  }

  function designations() {
    return active(Database.getAllCached('Designations'));
  }

  function leaveTypes() {
    return active(Database.getAllCached('Leave_Types')).filter(function (row) { return String(row.status).toUpperCase() === 'ACTIVE'; });
  }

  function holidays(period) {
    var month = period || Utils.today().slice(0, 7);
    return active(Database.getAllCached('Holidays')).filter(function (row) {
      return String(row.holiday_date || '').slice(0, 7) === month;
    });
  }

  function holidayOn(dateText, branchId) {
    return active(Database.getAllCached('Holidays')).filter(function (row) {
      return String(row.holiday_date || '').slice(0, 10) === dateText &&
        (!row.branch_id || !branchId || row.branch_id === branchId);
    });
  }

  function shifts() {
    return active(Database.getAllCached('Shifts'));
  }

  function shiftFor(employeeRow) {
    var shiftId = employeeRow && employeeRow.shift_id;
    var rows = shifts();
    if (shiftId) {
      for (var i = 0; i < rows.length; i++) if (rows[i].id === shiftId) return rows[i];
    }
    for (var j = 0; j < rows.length; j++) if (String(rows[j].is_default).toUpperCase() === 'TRUE' || rows[j].is_default === true) return rows[j];
    return rows.length ? rows[0] : null;
  }

  function workLocationFor(employeeRow) {
    var policyId = employeeRow && employeeRow.attendance_policy_id;
    var rows = active(Database.getAllCached('Attendance_Policies'));
    if (policyId) {
      for (var i = 0; i < rows.length; i++) if (rows[i].id === policyId) return rows[i];
    }
    for (var j = 0; j < rows.length; j++) if (String(rows[j].is_default) === 'TRUE' || rows[j].is_default === true) return rows[j];
    return rows.length ? rows[0] : null;
  }

  function geoFor(branchId) {
    var rows = active(Database.getAllCached('Geofence_Locations'));
    for (var i = 0; i < rows.length; i++) {
      if (rows[i].branch_id && rows[i].branch_id === branchId) return rows[i];
    }
    return null;
  }

  /** True when the record belongs to the caller or the effective scope allows it. */
  function canSeeEmployee(actor, targetEmployeeId) {
    if (!actor) return false;
    if (String(actor.employeeId) === String(targetEmployeeId)) return true;
    if (actor.isSuperAdmin) return true;
    var downline = Permissions.getDownlineEmployeeIds(actor.employeeId);
    if (downline.indexOf(String(targetEmployeeId)) >= 0) return true;
    var target = employee(targetEmployeeId);
    if (!target) return false;
    if (actor.departmentId && target.department_id && actor.departmentId === target.department_id) return true;
    if (actor.branchId && target.branch_id && actor.branchId === target.branch_id) return true;
    return false;
  }

  function employeeSummary(row) {
    if (!row) return null;
    return {
      employeeId: employeeKey(row),
      displayName: row.display_name || '',
      department: row.department || '',
      departmentId: row.department_id || '',
      designation: row.designation || '',
      branch: row.branch || '',
      branchId: row.branch_id || '',
      reportingManagerId: row.reporting_manager_id || '',
      mobile: row.mobile || '',
      workEmail: row.work_email || '',
      joiningDate: row.joining_date || '',
      status: row.status || 'ACTIVE'
    };
  }

  return {
    active: active,
    employees: employees,
    activeEmployees: activeEmployees,
    employeeKey: employeeKey,
    employee: employee,
    requireEmployee: requireEmployee,
    employeeName: employeeName,
    managerOf: managerOf,
    byId: byId,
    find: find,
    requireRecord: requireRecord,
    label: label,
    users: users,
    user: user,
    roleByCode: roleByCode,
    employeeIdsWithRole: employeeIdsWithRole,
    employeeIdsWithPermission: employeeIdsWithPermission,
    branches: branches,
    departments: departments,
    designations: designations,
    leaveTypes: leaveTypes,
    holidays: holidays,
    holidayOn: holidayOn,
    shifts: shifts,
    shiftFor: shiftFor,
    workLocationFor: workLocationFor,
    geoFor: geoFor,
    canSeeEmployee: canSeeEmployee,
    employeeSummary: employeeSummary
  };
})();
