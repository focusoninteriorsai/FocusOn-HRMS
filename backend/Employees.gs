/**
 * FOCUSON HRMS - Employee Management Engine (Google Apps Script)
 * Comprehensive employee profiles, auto user provisioning, leaver rule, and field-level masking.
 */

var Employees = (function() {
  function listEmployees(actor, filters) {
    Permissions.check(actor, 'employee.view', null, { scope: 'Company' });
    filters = filters || {};

    var allEmps = Database.getAllCached('Employees');
    var filtered = [];

    for (var i = 0; i < allEmps.length; i++) {
      var emp = allEmps[i];
      if (filters.status && emp.status !== filters.status) continue;
      if (filters.department && emp.department !== filters.department) continue;
      if (filters.branch && emp.branch !== filters.branch) continue;

      // Check scope
      if (!actor.isSuperAdmin && !Permissions.evaluateScope(actor, 'Company', emp)) {
        if (!Permissions.evaluateScope(actor, 'Team', emp) && !Permissions.evaluateScope(actor, 'Department', emp)) {
          continue;
        }
      }

      filtered.push(Permissions.maskSensitiveFields(emp, actor));
    }

    return filtered;
  }

  function getEmployee(empId, actor) {
    Permissions.check(actor, 'employee.view', null, { scope: 'Company' });
    var allEmps = Database.getAllCached('Employees');
    for (var i = 0; i < allEmps.length; i++) {
      if (allEmps[i].id === empId || allEmps[i].employee_id === empId) {
        if (!Permissions.evaluateScope(actor, 'Company', allEmps[i]) &&
            !Permissions.evaluateScope(actor, 'Team', allEmps[i]) &&
            !Permissions.evaluateScope(actor, 'Self', allEmps[i])) {
          throw { code: 'FORBIDDEN', message: 'Employee profile is outside your permitted scope.' };
        }
        return Permissions.maskSensitiveFields(allEmps[i], actor);
      }
    }
    throw { code: 'NOT_FOUND', message: 'Employee ' + empId + ' not found.' };
  }

  function saveEmployee(data, actor) {
    if (data.id) {
      Permissions.check(actor, 'employee.edit', { id: data.id });
    } else {
      Permissions.check(actor, 'employee.create');
    }

    if (!data.employee_id || !data.first_name) {
      throw { code: 'VALIDATION', message: 'Employee ID and first name are mandatory.' };
    }

    var cleanEmpId = String(data.employee_id).trim().toUpperCase();

    // Check sensitive fields permission if salary or bank details provided
    var hasSalaryEdit = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.salary.edit') !== -1);
    var hasBankEdit = actor.isSuperAdmin || (actor.permissions && actor.permissions.indexOf('field.bank.edit') !== -1);

    var empRecord = {
      first_name: data.first_name,
      last_name: data.last_name || '',
      email: data.email || '',
      phone: data.phone || '',
      department_id: data.department_id || '',
      department: data.department || '',
      designation_id: data.designation_id || '',
      designation: data.designation || '',
      branch_id: data.branch_id || '',
      branch: data.branch || '',
      reporting_manager_id: data.reporting_manager_id || '',
      work_location_type: data.work_location_type || 'Office',
      attendance_policy_id: data.attendance_policy_id || 'POL_OFFICE',
      date_of_joining: data.date_of_joining || '',
      date_of_birth: data.date_of_birth || '',
      gender: data.gender || '',
      emergency_contact: data.emergency_contact || '',
      blood_group: data.blood_group || '',
      pan_number: data.pan_number || '',
      aadhaar_number: data.aadhaar_number || '',
      pf_uan: data.pf_uan || ''
    };

    if (hasSalaryEdit) {
      empRecord.basic_salary = data.basic_salary || 0;
      empRecord.gross_salary = data.gross_salary || 0;
      empRecord.ctc_annual = data.ctc_annual || 0;
    }

    if (hasBankEdit) {
      empRecord.bank_account_number = data.bank_account_number || '';
      empRecord.bank_ifsc = data.bank_ifsc || '';
      empRecord.bank_name = data.bank_name || '';
    }

    if (data.id) {
      Database.update('Employees', data.id, empRecord, actor.employeeId);
      Audit.logEvent('EMPLOYEE_UPDATED', actor.employeeId, 'Employees', data.id, 'SUCCESS');
      return { id: data.id, success: true };
    } else {
      empRecord.id = cleanEmpId;
      empRecord.employee_id = cleanEmpId;
      Database.insert('Employees', empRecord, actor.employeeId);

      // Auto-provision login account in Users sheet
      var tempPassword = data.initial_password || ('Init#' + Utilities.getUuid().substring(0, 8));
      var salt = Utils.generateSalt();
      var hash = Utils.hashPassword(tempPassword, salt);

      Database.insert('Users', {
        id: 'usr_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
        employee_id: cleanEmpId,
        password_hash: hash,
        password_salt: salt,
        is_super_admin: false,
        must_change_password: true,
        password_updated_at: Utils.nowIso(),
        status: 'ACTIVE'
      }, actor.employeeId);

      // Assign default Staff role
      Database.insert('User_Role_Map', {
        id: 'urm_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
        employee_id: cleanEmpId,
        role_id: 'role_staff',
        status: 'ACTIVE'
      }, actor.employeeId);

      Audit.logEvent('EMPLOYEE_CREATED', actor.employeeId, 'Employees', cleanEmpId, 'SUCCESS', {
        tempPasswordGenerated: true
      });

      return { id: cleanEmpId, initialPassword: tempPassword, success: true };
    }
  }

  /**
   * Leaver Rule: Deactivates employee, revokes active login sessions, and reassigns pending approvals.
   */
  function deactivateEmployee(empId, reason, actor) {
    Permissions.check(actor, 'employee.delete', { id: empId });

    // 1. Soft delete / deactivate employee record
    Database.update('Employees', empId, { status: 'INACTIVE', deactivation_reason: reason }, actor.employeeId);

    // 2. Deactivate user account
    var users = Database.getAll('Users');
    for (var u = 0; u < users.length; u++) {
      if (users[u].employee_id === empId) {
        Database.update('Users', users[u].id, { status: 'INACTIVE' }, actor.employeeId);
      }
    }

    // 3. Revoke all active sessions
    Auth.logoutAll(empId);

    // 4. Reassign pending approvals where this employee is the approver
    var pending = Database.getAll('Approvals');
    var reassignedCount = 0;
    for (var a = 0; a < pending.length; a++) {
      if (pending[a].current_approver_id === empId && pending[a].overall_status === 'PENDING') {
        // Fallback to HR or direct admin
        Database.update('Approvals', pending[a].id, {
          current_approver_id: actor.employeeId,
          reassigned_reason: 'Approver ' + empId + ' deactivated. Reassigned to ' + actor.employeeId
        }, actor.employeeId);
        reassignedCount++;
      }
    }

    Audit.logEvent('EMPLOYEE_DEACTIVATED', actor.employeeId, 'Employees', empId, 'SUCCESS', {
      reason: reason,
      reassignedApprovals: reassignedCount
    });

    return { success: true, reassignedApprovals: reassignedCount };
  }

  return {
    listEmployees: listEmployees,
    getEmployee: getEmployee,
    saveEmployee: saveEmployee,
    deactivateEmployee: deactivateEmployee
  };
})();
