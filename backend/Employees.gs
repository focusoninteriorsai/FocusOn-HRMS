/** Employee master: directory, profile, onboarding, CSV import/export, change requests. */
var Employees = (function () {
  var STANDARD_FIELDS = [
    'employee_id', 'display_name', 'first_name', 'last_name', 'work_email', 'personal_email', 'mobile',
    'department_id', 'department', 'designation_id', 'designation', 'branch_id', 'branch',
    'reporting_manager_id', 'work_location_type', 'attendance_policy_id', 'shift_id', 'joining_date',
    'date_of_birth', 'gender', 'employment_type', 'probation_end_date', 'confirmation_date', 'exit_date',
    'notice_period_days', 'blood_group', 'emergency_contact_name', 'emergency_contact_phone',
    'emergency_contact_relation', 'current_address', 'permanent_address', 'qualification',
    'date_of_marriage', 'spouse_name', 'father_name', 'mother_name', 'nationality',
    'bank_account_number', 'bank_ifsc', 'bank_name', 'bank_branch', 'pan_number', 'aadhaar_number',
    'pf_uan', 'esi_number', 'uan_number', 'esi_ip_number', 'tax_regime',
    'ctc_annual', 'basic_salary', 'gross_salary', 'medical_notes', 'notes'
  ];
  var SENSITIVE = ['bank_account_number', 'bank_ifsc', 'bank_name', 'bank_branch', 'pan_number', 'aadhaar_number', 'pf_uan', 'esi_number', 'uan_number', 'esi_ip_number', 'ctc_annual', 'basic_salary', 'gross_salary', 'medical_notes', 'blood_group'];
  var EMPLOYMENT_TYPES = ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN', 'CONSULTANT', 'APPRENTICE'];
  var GENDERS = ['', 'MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY'];
  var LOCATION_TYPES = ['OFFICE', 'SITE', 'REMOTE', 'HYBRID', 'FIELD', 'UNASSIGNED'];

  function codeFor(prefix, count) {
    var settings = Settings.text('EMPLOYEE_ID_PREFIX_MODE', 'MANUAL');
    return prefix + String(count).padStart(4, '0');
  }

  function nextEmployeeId() {
    var results = Database.getAllCached('Employees').map(function (row) { return Repo.employeeKey(row); });
    var prefix = Settings.text('EMPLOYEE_ID_PREFIX', 'EMP');
    var highest = 0;
    results.forEach(function (id) {
      var match = new RegExp('^' + prefix + '(\\d+)$', 'i').exec(id);
      if (match) highest = Math.max(highest, Number(match[1]));
    });
    return prefix + String(highest + 1).padStart(4, '0');
  }

  function canReadSensitive(actor) {
    if (actor.isSuperAdmin) return true;
    var effective = Permissions.resolveEffectivePermissions(actor.employeeId);
    return ['field.salary.view', 'field.bank.view', 'field.govtid.view', 'field.medical.view'].some(function (key) {
      return effective.permissions.indexOf(key) >= 0;
    });
  }

  function shape(row, actor, options) {
    options = options || {};
    var output = {
      id: row.id,
      employeeId: Repo.employeeKey(row),
      displayName: row.display_name || '',
      firstName: row.first_name || '',
      lastName: row.last_name || '',
      workEmail: row.work_email || '',
      personalEmail: options.full ? (row.personal_email || '') : undefined,
      mobile: row.mobile || '',
      departmentId: row.department_id || '',
      department: row.department || Repo.label('Departments', row.department_id),
      designationId: row.designation_id || '',
      designation: row.designation || Repo.label('Designations', row.designation_id),
      branchId: row.branch_id || '',
      branch: row.branch || Repo.label('Branches', row.branch_id),
      reportingManagerId: row.reporting_manager_id || '',
      reportingManagerName: Repo.employeeName(row.reporting_manager_id),
      workLocationType: row.work_location_type || 'UNASSIGNED',
      attendancePolicyId: row.attendance_policy_id || '',
      shiftId: row.shift_id || '',
      employmentType: row.employment_type || 'FULL_TIME',
      joiningDate: String(row.joining_date || '').slice(0, 10),
      confirmationDate: String(row.confirmation_date || '').slice(0, 10),
      probationEndDate: String(row.probation_end_date || '').slice(0, 10),
      exitDate: String(row.exit_date || '').slice(0, 10),
      noticePeriodDays: Utils.numberOrZero(row.notice_period_days),
      gender: row.gender || '',
      dateOfBirth: String(row.date_of_birth || '').slice(0, 10),
      status: String(row.status).toUpperCase() === 'ACTIVE' ? 'ACTIVE' : (row.status || 'ACTIVE'),
      photoFileId: row.photo_file_id || '',
      notes: row.notes || ''
    };
    if (!options.full) return output;
    output.emergencyContactName = row.emergency_contact_name || '';
    output.emergencyContactPhone = row.emergency_contact_phone || '';
    output.emergencyContactRelation = row.emergency_contact_relation || '';
    output.currentAddress = row.current_address || '';
    output.permanentAddress = row.permanent_address || '';
    output.qualification = row.qualification || '';
    output.nationality = row.nationality || '';
    output.fatherName = row.father_name || '';
    output.motherName = row.mother_name || '';
    output.spouseName = row.spouse_name || '';
    output.dateOfMarriage = String(row.date_of_marriage || '').slice(0, 10);
    output.taxRegime = row.tax_regime || 'new';
    var masked = [];
    SENSITIVE.forEach(function (field) {
      var permission = Permissions.FIELD_RULES[field];
      var allowed = !permission || actor.isSuperAdmin || Permissions.resolveEffectivePermissions(actor.employeeId).permissions.indexOf(permission) >= 0;
      var key = toCamel(field);
      if (allowed) output[key] = row[field] === undefined || row[field] === null ? '' : row[field];
      else if (row[field] !== '' && row[field] !== undefined && row[field] !== null) {
        output[key] = '';
        masked.push(key);
      }
    });
    if (masked.length) output.maskedFields = masked;
    return output;
  }

  function toCamel(value) {
    return String(value).replace(/_([a-z])/g, function (match, letter) { return letter.toUpperCase(); });
  }

  function list(authentication, payload) {
    var actor = authentication.actor;
    var search = Utils.containsText(payload.search);
    var rows = Repo.employees();
    var ids = {};
    if (!actor.isSuperAdmin) {
      var effective = Permissions.resolveEffectivePermissions(actor.employeeId);
      var scopes = effective.scopes['employee.view'] || [];
      ids[actor.employeeId] = true;
      if (scopes.indexOf('Company') >= 0) {
        rows.forEach(function (row) { ids[Repo.employeeKey(row)] = true; });
      } else {
        if (scopes.indexOf('Department') >= 0) {
          rows.forEach(function (row) {
            if (actor.departmentId && row.department_id === actor.departmentId) ids[Repo.employeeKey(row)] = true;
          });
        }
        if (scopes.indexOf('Branch') >= 0) {
          rows.forEach(function (row) {
            if (actor.branchId && row.branch_id === actor.branchId) ids[Repo.employeeKey(row)] = true;
          });
        }
        if (scopes.indexOf('Team') >= 0 || scopes.indexOf('Direct reports') >= 0) {
          Permissions.getDownlineEmployeeIds(actor.employeeId).forEach(function (id) { ids[id] = true; });
          if (scopes.indexOf('Direct reports') >= 0 && scopes.indexOf('Team') < 0) {
            Object.keys(ids).forEach(function (id) {
              var row = Repo.employee(id);
              if (row && String(row.reporting_manager_id) !== actor.employeeId && id !== actor.employeeId) delete ids[id];
            });
          }
        }
      }
    } else {
      rows.forEach(function (row) { ids[Repo.employeeKey(row)] = true; });
    }
    var filtered = rows.filter(function (row) { return ids[Repo.employeeKey(row)]; });
    if (payload.status === 'ACTIVE') filtered = filtered.filter(function (row) { return String(row.status).toUpperCase() === 'ACTIVE'; });
    if (payload.status === 'INACTIVE') filtered = filtered.filter(function (row) { return String(row.status).toUpperCase() !== 'ACTIVE'; });
    if (payload.departmentId) filtered = filtered.filter(function (row) { return row.department_id === payload.departmentId; });
    if (payload.branchId) filtered = filtered.filter(function (row) { return row.branch_id === payload.branchId; });
    if (payload.designationId) filtered = filtered.filter(function (row) { return row.designation_id === payload.designationId; });
    if (payload.managerId) filtered = filtered.filter(function (row) { return row.reporting_manager_id === payload.managerId; });
    if (payload.locationType) filtered = filtered.filter(function (row) { return row.work_location_type === payload.locationType; });
    if (payload.joinedFrom) filtered = filtered.filter(function (row) { return String(row.joining_date || '') >= payload.joinedFrom; });
    if (payload.joinedTo) filtered = filtered.filter(function (row) { return String(row.joining_date || '') <= payload.joinedTo; });
    if (search) {
      filtered = filtered.filter(function (row) {
        return [row.display_name, Repo.employeeKey(row), row.work_email, row.mobile, row.department, row.designation, row.branch].some(function (value) {
          return String(value || '').toLowerCase().indexOf(search) >= 0;
        });
      });
    }
    var all = filtered.map(function (row) { return shape(row, actor, { full: false }); });
    var paged = Utils.paginate(all, payload, {
      searchFields: ['displayName', 'employeeId', 'workEmail', 'mobile', 'department', 'designation', 'branch'],
      sortFields: ['displayName', 'employeeId', 'joiningDate', 'department', 'designation', 'branch', 'status'],
      maxPageSize: 500
    });
    var stats = { total: all.length, active: 0, inactive: 0, onboarding: 0 };
    all.forEach(function (item) {
      if (item.status === 'ACTIVE') stats.active += 1; else stats.inactive += 1;
      if (item.joiningDate && Utils.dayDiff(item.joiningDate, Utils.today()) <= 30 && Utils.dayDiff(item.joiningDate, Utils.today()) >= 0) stats.onboarding += 1;
    });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total, stats: stats,
      canEdit: actor.isSuperAdmin || actor.permissions.indexOf('employee.edit') >= 0,
      canCreate: actor.isSuperAdmin || actor.permissions.indexOf('employee.create') >= 0,
      canViewSensitive: canReadSensitive(actor),
      nextEmployeeId: nextEmployeeId()
    };
  }

  function detail(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || actor.employeeId);
    if (!Repo.canSeeEmployee(actor, employeeId) && employeeId !== actor.employeeId) {
      Permissions.check(actor, 'employee.view', { employee_id: employeeId }, { entity: 'Employees', context: {} });
    }
    var row = Repo.requireEmployee(employeeId);
    var account = Repo.user(employeeId);
    var effective = Permissions.resolveEffectivePermissions(employeeId);
    var mapping = Database.getAllCached('User_Role_Map').filter(function (role) {
      return role.employee_id === employeeId && String(role.status).toUpperCase() === 'ACTIVE';
    }).map(function (role) {
      var definition = Repo.find('Roles', role.role_id) || {};
      return { mappingId: role.id, roleId: role.role_id, name: definition.name || '', code: definition.role_code || '', scopeType: definition.scope_type || '' };
    });
    var directReports = Repo.activeEmployees().filter(function (report) { return report.reporting_manager_id === employeeId; }).map(function (report) {
      return Repo.employeeSummary(report);
    });
    var documents = Database.getAllCached('Documents').filter(function (doc) {
      return doc.employee_id === employeeId && String(doc.status).toUpperCase() !== 'DELETED';
    }).map(function (doc) {
      return { id: doc.id, category: doc.category, documentNumber: doc.document_number, createdAt: Utils.toIso(doc.created_at) };
    });
    var assets = Database.getAllCached('Assets').filter(function (asset) {
      return asset.assigned_employee_id === employeeId && !asset.returned_at && String(asset.status).toUpperCase() === 'ACTIVE';
    }).map(function (asset) {
      return { id: asset.id, code: asset.asset_code, name: asset.name, category: asset.category, assignedAt: String(asset.assigned_at || '').slice(0, 10) };
    });
    var pendingChanges = Database.getAllCached('Employee_Change_Requests').filter(function (request) {
      return request.employee_id === employeeId && String(request.status).toUpperCase() === 'ACTIVE';
    }).map(function (request) {
      return { id: request.id, changeType: request.change_type, requested: Utils.safeParseJson(request.change_json, {}), createdAt: Utils.toIso(request.created_at) };
    });
    var canViewSalary = actor.isSuperAdmin || actor.permissions.indexOf('salary.view') >= 0;
    var salary = null;
    if (canViewSalary) {
      var structures = Database.getAllCached('Salary_Structure').filter(function (structure) {
        return structure.employee_id === employeeId && String(structure.status).toUpperCase() === 'ACTIVE';
      });
      structures.sort(function (left, right) { return String(right.effective_from).localeCompare(String(left.effective_from)); });
      salary = structures.length ? {
        structureId: structures[0].id, effectiveFrom: String(structures[0].effective_from || '').slice(0, 10),
        salaryType: structures[0].salary_type, components: Utils.safeParseJson(structures[0].components_json, []),
        gross: currencyTotal(Utils.safeParseJson(structures[0].components_json, []))
      } : null;
    }
    return {
      employee: shape(row, actor, { full: true }),
      account: account ? {
        userId: account.id, status: String(account.status).toUpperCase(), mustChangePassword: Utils.asBoolean(account.must_change_password),
        lastLoginAt: Utils.toIso(account.last_login_at), passwordChangedAt: Utils.toIso(account.password_changed_at)
      } : null,
      roles: mapping,
      effective: { isSuperAdmin: effective.isSuperAdmin, permissions: effective.permissions, scopes: effective.scopes },
      directReports: directReports,
      documents: documents,
      assets: assets,
      pendingChanges: pendingChanges,
      salary: salary,
      canEdit: actor.isSuperAdmin || actor.permissions.indexOf('employee.edit') >= 0,
      canManageAccess: actor.isSuperAdmin || actor.permissions.indexOf('role.assign') >= 0,
      options: options(actor)
    };
  }

  function currencyTotal(components) {
    var total = 0;
    (components || []).forEach(function (component) {
      if (String(component.kind || 'EARNING').toUpperCase() !== 'EARNING') return;
      total += Utils.numberOrZero(component.amount);
    });
    return Utils.round2(total);
  }

  function options(actor) {
    return {
      departments: Database.getAllCached('Departments').filter(alive).map(function (row) { return { id: row.id, name: row.name }; }),
      designations: Database.getAllCached('Designations').filter(alive).map(function (row) { return { id: row.id, name: row.name }; }),
      branches: Database.getAllCached('Branches').filter(alive).map(function (row) { return { id: row.id, name: row.name }; }),
      managers: Repo.activeEmployees().map(function (row) { return { employeeId: Repo.employeeKey(row), displayName: row.display_name || '' }; }).sort(function (left, right) { return left.displayName.localeCompare(right.displayName); }),
      employmentTypes: EMPLOYMENT_TYPES,
      genders: GENDERS.filter(Boolean),
      locationTypes: LOCATION_TYPES,
      policies: Database.getAllCached('Attendance_Policies').filter(alive).map(function (row) { return { id: row.id, name: row.name }; }),
      shifts: Database.getAllCached('Shifts').filter(alive).map(function (row) { return { id: row.id, name: row.name }; })
    };
  }

  function alive(row) {
    return String(row.status).toUpperCase() !== 'DELETED';
  }

  function sanitizeInput(payload, actor, existing) {
    var changes = {};
    function setString(key, field, maximum, options) {
      if (payload[key] === undefined) return;
      var value = Utils.cleanString(payload[key]).slice(0, maximum || 1000);
      if (options && options.required && !value) Utils.fail('VALIDATION', options.label + ' is required.');
      if (options && options.pattern && value && !options.pattern.test(value)) Utils.fail('VALIDATION', options.label + ' has an invalid format.');
      changes[field] = value;
    }
    setString('displayName', 'display_name', 160, { required: true, label: 'Full name' });
    setString('firstName', 'first_name', 100);
    setString('lastName', 'last_name', 100);
    setString('workEmail', 'work_email', 254);
    if (payload.workEmail !== undefined && payload.workEmail) changes.work_email = Utils.requireEmail(payload.workEmail, 'Work email', true);
    setString('personalEmail', 'personal_email', 254);
    if (payload.personalEmail !== undefined && payload.personalEmail) changes.personal_email = Utils.requireEmail(payload.personalEmail, 'Personal email', true);
    setString('mobile', 'mobile', 32);
    if (payload.mobile !== undefined && payload.mobile) changes.mobile = Utils.requireMobile(payload.mobile, 'Mobile number', true);
    setString('reportingManagerId', 'reporting_manager_id', 64);
    if (changes.reporting_manager_id) {
      changes.reporting_manager_id = Utils.normalizeEmployeeId(changes.reporting_manager_id);
      if ((existing && changes.reporting_manager_id === Repo.employeeKey(existing))) Utils.fail('VALIDATION', 'An employee cannot report to themselves.');
      if (!Repo.employee(changes.reporting_manager_id)) Utils.fail('VALIDATION', 'The reporting manager does not exist.');
    }
    if (payload.departmentId !== undefined) {
      changes.department_id = Utils.cleanString(payload.departmentId);
      changes.department = changes.department_id ? Repo.label('Departments', changes.department_id) : '';
    }
    if (payload.designationId !== undefined) {
      changes.designation_id = Utils.cleanString(payload.designationId);
      changes.designation = changes.designation_id ? Repo.label('Designations', changes.designation_id) : '';
    }
    if (payload.branchId !== undefined) {
      changes.branch_id = Utils.cleanString(payload.branchId);
      changes.branch = changes.branch_id ? Repo.label('Branches', changes.branch_id) : '';
    }
    if (payload.workLocationType !== undefined) changes.work_location_type = Utils.requireEnum(payload.workLocationType || 'UNASSIGNED', LOCATION_TYPES, 'Work location type');
    setString('attendancePolicyId', 'attendance_policy_id', 128);
    setString('shiftId', 'shift_id', 128);
    if (payload.employmentType !== undefined) changes.employment_type = Utils.requireEnum(payload.employmentType || 'FULL_TIME', EMPLOYMENT_TYPES, 'Employment type');
    if (payload.gender !== undefined) changes.gender = Utils.optionalEnum(payload.gender, GENDERS, 'Gender');
    ['joiningDate:joining_date', 'dateOfBirth:date_of_birth', 'probationEndDate:probation_end_date', 'confirmationDate:confirmation_date', 'exitDate:exit_date', 'dateOfMarriage:date_of_marriage'].forEach(function (pair) {
      var parts = pair.split(':');
      if (payload[parts[0]] === undefined || payload[parts[0]] === '') return;
      changes[parts[1]] = Utils.requireDate(payload[parts[0]], parts[0]);
    });
    if (payload.noticePeriodDays !== undefined && payload.noticePeriodDays !== '') {
      changes.notice_period_days = Utils.requireNumber(payload.noticePeriodDays, 'Notice period', { min: 0, max: 365 });
    }
    ['emergencyContactName:emergency_contact_name', 'emergencyContactPhone:emergency_contact_phone', 'emergencyContactRelation:emergency_contact_relation',
      'currentAddress:current_address', 'permanentAddress:permanent_address', 'qualification:qualification', 'nationality:nationality',
      'fatherName:father_name', 'motherName:mother_name', 'spouseName:spouse_name', 'bankBranch:bank_branch',
      'bloodGroup:blood_group', 'notes:notes', 'taxRegime:tax_regime'].forEach(function (pair) {
      var parts = pair.split(':');
      if (payload[parts[0]] === undefined) return;
      changes[parts[1]] = Utils.cleanString(payload[parts[0]]).slice(0, parts[1] === 'notes' ? 4000 : 160);
    });
    if (payload.emergencyContactPhone) changes.emergency_contact_phone = Utils.requireMobile(payload.emergencyContactPhone, 'Emergency contact number', true);

    // Sensitive fields require the matching edit permission.
    var sensitiveInput = {
      bankAccountNumber: ['bank_account_number', 'field.bank.edit'],
      bankIfsc: ['bank_ifsc', 'field.bank.edit'],
      bankName: ['bank_name', 'field.bank.edit'],
      panNumber: ['pan_number', 'field.govtid.edit'],
      aadhaarNumber: ['aadhaar_number', 'field.govtid.edit'],
      pfUan: ['pf_uan', 'field.govtid.edit'],
      esiNumber: ['esi_number', 'field.govtid.edit'],
      uanNumber: ['uan_number', 'field.govtid.edit'],
      esiIpNumber: ['esi_ip_number', 'field.govtid.edit'],
      ctcAnnual: ['ctc_annual', 'field.salary.edit'],
      basicSalary: ['basic_salary', 'field.salary.edit'],
      grossSalary: ['gross_salary', 'field.salary.edit'],
      medicalNotes: ['medical_notes', 'field.medical.edit']
    };
    Object.keys(sensitiveInput).forEach(function (key) {
      if (payload[key] === undefined) return;
      var field = sensitiveInput[key][0];
      var permission = sensitiveInput[key][1];
      var allowed = actor.isSuperAdmin || actor.permissions.indexOf(permission) >= 0 ||
        Permissions.resolveEffectivePermissions(actor.employeeId).permissions.indexOf(permission) >= 0;
      if (!allowed) Utils.fail('FORBIDDEN', 'You do not have permission to change protected payroll or identity fields.');
      if (field === 'ctc_annual' || field === 'basic_salary' || field === 'gross_salary') {
        changes[field] = payload[key] === '' ? '' : Utils.requireNumber(payload[key], key, { min: 0, max: 100000000 });
      } else {
        changes[field] = Utils.cleanString(payload[key]).slice(0, field === 'medical_notes' ? 4000 : 128);
      }
    });
    return changes;
  }

  function save(authentication, payload) {
    var actor = authentication.actor;
    var id = Utils.cleanString(payload.id);
    if (id) {
      var existing = Repo.requireEmployee(Utils.normalizeEmployeeId(payload.employeeId));
      var changes = sanitizeInput(payload, actor, existing);
      if (!Object.keys(changes).length) Utils.fail('VALIDATION', 'No change was supplied.');
      if (changes.display_name === '') Utils.fail('VALIDATION', 'Full name is required.');
      var updated = Database.update('Employees', existing.id, changes, actor.employeeId);
      Database.invalidateCache('Employees');
      Audit.logEvent('EMPLOYEE_UPDATED', actor.employeeId, 'Employees', updated.id, 'SUCCESS', { fields: Object.keys(changes) }, {});
      return { id: updated.id, employee: shape(updated, actor, { full: true }) };
    }
    var employeeId = payload.employeeId ? Utils.normalizeEmployeeId(payload.employeeId) : nextEmployeeId();
    if (Repo.employee(employeeId)) Utils.fail('CONFLICT', 'This Employee ID already exists.');
    var created = sanitizeInput(payload, actor, null);
    if (!created.display_name) Utils.fail('VALIDATION', 'Full name is required.');
    created.id = employeeId;
    created.employee_id = employeeId;
    created.work_location_type = created.work_location_type || 'OFFICE';
    created.employment_type = created.employment_type || 'FULL_TIME';
    created.joining_date = created.joining_date || Utils.today();
    if (!created.work_email && payload.workEmail === undefined) created.work_email = '';
    var record = Database.insert('Employees', created, actor.employeeId);
    if (payload.createAccount === true) {
      Access.createUser(authentication, {
        employeeId: employeeId, displayName: created.display_name,
        departmentId: created.department_id, department: created.department,
        designationId: created.designation_id, designation: created.designation,
        branchId: created.branch_id, branch: created.branch,
        roleIds: Array.isArray(payload.roleIds) ? payload.roleIds : [], reason: 'Created with employee record'
      });
    }
    Audit.logEvent('EMPLOYEE_CREATED', actor.employeeId, 'Employees', record.id, 'SUCCESS', { employeeId: employeeId, account: payload.createAccount === true }, {});
    return { id: record.id, employeeId: employeeId, employee: shape(record, actor, { full: true }) };
  }

  function setStatus(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    var status = Utils.requireEnum(payload.status, ['ACTIVE', 'INACTIVE', 'PROBATION', 'NOTICE', 'EXITED'], 'Status');
    var reason = Utils.requireString(payload, 'reason', { max: 1000, min: 5 });
    if (employeeId === actor.employeeId && status !== 'ACTIVE') Utils.fail('FORBIDDEN', 'You cannot deactivate your own employee record.');
    var employee = Repo.requireEmployee(employeeId);
    var changes = { status: status === 'NOTICE' || status === 'PROBATION' ? 'ACTIVE' : status, employment_status: status };
    if (status === 'EXITED') changes.exit_date = Utils.cleanString(payload.effectiveDate) ? Utils.requireDate(payload.effectiveDate, 'Exit date') : Utils.today();
    var updated = Database.update('Employees', employee.id, changes, actor.employeeId);
    if (status === 'EXITED' || status === 'INACTIVE') Auth.revokeUserSessions(employeeId, null);
    Audit.logEvent('EMPLOYEE_STATUS_CHANGED', actor.employeeId, 'Employees', employee.id, 'SUCCESS', { status: status, reason: reason }, {});
    return { employeeId: employeeId, status: status, employee: shape(updated, actor, {}) };
  }

  function generateNextId(authentication) {
    return { employeeId: nextEmployeeId() };
  }

  /** Bulk CSV import with per-row validation and a dry-run mode. */
  function importCsv(authentication, payload) {
    var actor = authentication.actor;
    var text = String(payload.csv || '');
    if (!text) Utils.fail('VALIDATION', 'Paste or upload a CSV file first.');
    if (text.length > 500000) Utils.fail('VALIDATION', 'The file is too large. Split it into smaller imports.');
    var maxRows = Settings.number('IMPORT_MAX_ROWS', 500);
    var parsed = parseCsv(text);
    if (!parsed.headers.length) Utils.fail('VALIDATION', 'The header row is missing.');
    if (parsed.rows.length > maxRows) Utils.fail('VALIDATION', 'This file has ' + parsed.rows.length + ' rows; the limit is ' + maxRows + '.');
    var mapping = {};
    parsed.headers.forEach(function (header) {
      var key = headerToField(header);
      if (key) mapping[key] = header;
    });
    if (!mapping.display_name && !mapping.first_name) Utils.fail('VALIDATION', 'The file needs a "Full name" or "First name" column.');
    var dryRun = payload.dryRun === true;
    var departments = indexByName(Database.getAllCached('Departments'));
    var designations = indexByName(Database.getAllCached('Designations'));
    var branches = indexByName(Database.getAllCached('Branches'));
    var results = { created: 0, updated: 0, skipped: 0, errors: [], preview: [] };
    var existing = Database.getAllCached('Employees');
    var byCode = {};
    existing.forEach(function (row) { byCode[Repo.employeeKey(row).toUpperCase()] = row; });
    var newRows = [];
    parsed.rows.forEach(function (cells, index) {
      var lineNumber = index + 2;
      // parseCsv() returns positional cells; index them by header so mapping works.
      var row = {};
      parsed.headers.forEach(function (header, column) { row[header] = cells[column] === undefined ? '' : cells[column]; });
      try {
        var input = {};
        Object.keys(mapping).forEach(function (field) {
          var value = Utils.cleanString(row[mapping[field]]);
          if (value) input[field] = value;
        });
        if (input.joinDate) input.joining_date = input.joinDate;
        if (!input.display_name) input.display_name = [input.first_name, input.last_name].filter(Boolean).join(' ').trim();
        if (!input.display_name) throw new Error('Full name is required.');
        input.department_id = departments[(input.department || '').toLowerCase()] || '';
        input.designation_id = designations[(input.designation || '').toLowerCase()] || '';
        input.branch_id = branches[(input.branch || '').toLowerCase()] || '';
        ['joining_date', 'date_of_birth', 'probation_end_date'].forEach(function (field) {
          if (input[field] && !/^\d{4}-\d{2}-\d{2}$/.test(input[field])) input[field] = normalizeDate(input[field]);
        });
        var employeeId = (input.employee_id || '').toUpperCase();
        var record = {};
        STANDARD_FIELDS.forEach(function (field) {
          if (input[field] === undefined) return;
          record[field] = input[field];
        });
        if (!record.work_location_type) record.work_location_type = 'UNASSIGNED';
        if (!record.employment_type) record.employment_type = 'FULL_TIME';
        if (record.ctc_annual) record.ctc_annual = Utils.requireNumber(record.ctc_annual, 'CTC', { min: 0 });
        if (record.gross_salary) record.gross_salary = Utils.requireNumber(record.gross_salary, 'Gross salary', { min: 0 });
        if (record.basic_salary) record.basic_salary = Utils.requireNumber(record.basic_salary, 'Basic salary', { min: 0 });
        if (byCode[employeeId]) {
          if (!dryRun) {
            Database.update('Employees', byCode[employeeId].id, record, actor.employeeId);
            results.updated += 1;
          } else results.preview.push({ employeeId: employeeId, action: 'UPDATE', displayName: record.display_name });
        } else {
          var id = employeeId || nextEmployeeId();
          record.id = id;
          record.employee_id = id;
          if (!dryRun) {
            Database.insert('Employees', record, actor.employeeId);
            byCode[id.toUpperCase()] = { id: id, employee_id: id, display_name: record.display_name };
            newRows.push(id);
            results.created += 1;
            results.preview.push({ employeeId: id, action: 'CREATE', displayName: record.display_name });
          } else {
            results.skipped += 1;
            results.preview.push({ employeeId: id, action: 'CREATE', displayName: record.display_name });
          }
        }
      } catch (error) {
        results.errors.push({ line: lineNumber, message: error && error.message ? error.message : 'This row could not be read.' });
      }
    });
    if (!dryRun) {
      Database.invalidateCache('Employees');
      Audit.logEvent('EMPLOYEES_IMPORTED', actor.employeeId, 'Employees', '', 'SUCCESS', {
        created: results.created, updated: results.updated, errors: results.errors.length
      }, {});
    }
    results.preview = results.preview.slice(0, 100);
    results.errors = results.errors.slice(0, 100);
    return results;
  }

  function normalizeDate(value) {
    var text = String(value).trim();
    var match = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(text);
    if (match) return match[3] + '-' + match[2].padStart(2, '0') + '-' + match[1].padStart(2, '0');
    match = /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/.exec(text);
    if (match) return match[1] + '-' + match[2].padStart(2, '0') + '-' + match[3].padStart(2, '0');
    return text;
  }

  function headerToField(header) {
    var normalized = String(header || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    var map = {
      employeeid: 'employee_id', id: 'employee_id', code: 'employee_id',
      fullname: 'display_name', name: 'display_name', employeename: 'display_name',
      firstname: 'first_name', lastname: 'last_name',
      workemail: 'work_email', email: 'work_email', officialemail: 'work_email',
      personalemail: 'personal_email', mobile: 'mobile', phone: 'mobile', contact: 'mobile',
      department: 'department', designation: 'designation', branch: 'branch', location: 'branch',
      reportingmanager: 'reporting_manager_id', manager: 'reporting_manager_id', reportingto: 'reporting_manager_id',
      worklocationtype: 'work_location_type', employmenttype: 'employment_type',
      joiningdate: 'joining_date', dateofjoining: 'joining_date', doj: 'joining_date', joindate: 'joinDate',
      dateofbirth: 'date_of_birth', dob: 'date_of_birth', gender: 'gender',
      probationenddate: 'probation_end_date', confirmationdate: 'confirmation_date',
      noticeperioddays: 'notice_period_days', bloodgroup: 'blood_group',
      emergencycontactname: 'emergency_contact_name', emergencycontactphone: 'emergency_contact_phone',
      emergencycontactrelation: 'emergency_contact_relation',
      currentaddress: 'current_address', permanentaddress: 'permanent_address', qualification: 'qualification',
      bankaccountnumber: 'bank_account_number', accountnumber: 'bank_account_number',
      bankifsc: 'bank_ifsc', ifsc: 'bank_ifsc', bankname: 'bank_name',
      pannumber: 'pan_number', pan: 'pan_number', aadhaarnumber: 'aadhaar_number', aadhaar: 'aadhaar_number',
      pfuan: 'pf_uan', esinumber: 'esi_number', uan: 'uan_number',
      ctc: 'ctc_annual', ctcannual: 'ctc_annual', basicsalary: 'basic_salary', basic: 'basic_salary',
      grosssalary: 'gross_salary', gross: 'gross_salary'
    };
    return map[normalized] || '';
  }

  function indexByName(rows) {
    var map = {};
    rows.forEach(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return;
      map[String(row.name || '').toLowerCase()] = row.id;
      map[String(row.code || '').toLowerCase()] = row.id;
    });
    return map;
  }

  function parseCsv(text) {
    var rows = [];
    var current = [];
    var value = '';
    var inQuotes = false;
    for (var i = 0; i < text.length; i++) {
      var character = text.charAt(i);
      if (inQuotes) {
        if (character === '"' && text.charAt(i + 1) === '"') { value += '"'; i++; }
        else if (character === '"') inQuotes = false;
        else value += character;
      } else if (character === '"') inQuotes = true;
      else if (character === ',') { current.push(value); value = ''; }
      else if (character === '\n') { current.push(value); rows.push(current); current = []; value = ''; }
      else if (character === '\r') { /* ignored */ }
      else value += character;
    }
    if (value || current.length) { current.push(value); rows.push(current); }
    var nonEmpty = rows.filter(function (row) { return row.some(function (cell) { return String(cell).trim(); }); });
    if (!nonEmpty.length) return { headers: [], rows: [] };
    var headers = nonEmpty[0].map(function (header) { return String(header).replace(/^\uFEFF/, '').trim(); });
    return { headers: headers, rows: nonEmpty.slice(1) };
  }

  function exportCsv(authentication, payload) {
    var actor = authentication.actor;
    var listResult = list(authentication, { pageSize: Settings.number('EXPORT_MAX_ROWS', 5000), page: 1, status: payload.status || '', departmentId: payload.departmentId || '', branchId: payload.branchId || '', search: payload.search || '' });
    var includeSensitive = payload.includeSensitive === true && canReadSensitive(actor);
    var columns = [
      { key: 'employeeId', label: 'Employee ID' }, { key: 'displayName', label: 'Full name' },
      { key: 'workEmail', label: 'Work email' }, { key: 'mobile', label: 'Mobile' },
      { key: 'department', label: 'Department' }, { key: 'designation', label: 'Designation' },
      { key: 'branch', label: 'Branch' }, { key: 'reportingManagerName', label: 'Reporting manager' },
      { key: 'employmentType', label: 'Employment type' }, { key: 'joiningDate', label: 'Joining date' },
      { key: 'status', label: 'Status' }
    ];
    var rows = listResult.items;
    if (includeSensitive) {
      var full = listResult.items.map(function (item) {
        var row = Repo.employee(item.employeeId);
        var data = shape(row, actor, { full: true });
        return data;
      });
      columns = columns.concat([
        { key: 'panNumber', label: 'PAN' }, { key: 'aadhaarNumber', label: 'Aadhaar' },
        { key: 'bankAccountNumber', label: 'Bank account' }, { key: 'bankIfsc', label: 'IFSC' },
        { key: 'ctcAnnual', label: 'CTC' }, { key: 'grossSalary', label: 'Gross salary' }
      ]);
      rows = full;
    }
    var csv = Utils.toCsv(columns, rows);
    Audit.logEvent('EMPLOYEE_EXPORT', actor.employeeId, 'Employees', '', 'SUCCESS', { rows: rows.length, sensitive: includeSensitive }, {});
    return { fileName: 'employees-' + Utils.today() + '.csv', csv: csv, base64: Utils.toBase64(csv), rows: rows.length };
  }

  /** Employee-raised change requests that need approval before writing to the master. */
  function requestChange(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || actor.employeeId);
    if (employeeId !== actor.employeeId && !actor.isSuperAdmin) {
      Permissions.check(actor, 'employee.edit', { employee_id: employeeId }, { entity: 'Employees', context: {} });
    }
    var allowed = ['mobile', 'personal_email', 'current_address', 'permanent_address', 'emergency_contact_name',
      'emergency_contact_phone', 'emergency_contact_relation', 'bank_account_number', 'bank_ifsc', 'bank_name',
      'bank_branch', 'blood_group', 'qualification', 'date_of_marriage', 'spouse_name', 'photo_file_id', 'medical_notes'];
    var changes = {};
    Object.keys(payload.changes || {}).forEach(function (key) {
      var field = key.replace(/([A-Z])/g, '_$1').toLowerCase();
      if (allowed.indexOf(field) < 0) Utils.fail('VALIDATION', 'This field cannot be changed through self service: ' + key + '.');
      changes[field] = Utils.cleanString(payload.changes[key]).slice(0, field === 'medical_notes' ? 4000 : 254);
    });
    if (!Object.keys(changes).length) Utils.fail('VALIDATION', 'Choose at least one field to change.');
    var request = Database.insert('Employee_Change_Requests', {
      employee_id: employeeId, change_type: 'PROFILE', target_entity: 'Employees', target_id: Repo.employee(employeeId).id,
      change_json: JSON.stringify(changes)
    }, actor.employeeId);
    if (Permissions.isFeatureEnabled('workflow')) {
      Workflow.start(authentication, 'employee_change', request.id, changes, { summary: 'Profile change for ' + Repo.employeeName(employeeId) });
    } else {
      applyChangeRequest(request, authentication);
    }
    Audit.logEvent('EMPLOYEE_CHANGE_REQUESTED', actor.employeeId, 'Employee_Change_Requests', request.id, 'SUCCESS', { fields: Object.keys(changes) }, {});
    return { requestId: request.id };
  }

  function applyChangeRequest(request, authentication) {
    var changes = Utils.safeParseJson(request.change_json, {});
    var employee = Repo.employee(request.employee_id);
    if (!employee) return;
    var allowedChanges = {};
    Object.keys(changes).forEach(function (key) {
      if (ALLOWED_COLUMNS[key]) allowedChanges[key] = changes[key];
    });
    if (Object.keys(allowedChanges).length) Database.update('Employees', employee.id, allowedChanges, authentication ? authentication.actor.employeeId : 'SYSTEM');
    Database.update('Employee_Change_Requests', request.id, { applied_at: Utils.nowIso(), status: 'APPLIED' }, authentication ? authentication.actor.employeeId : 'SYSTEM');
    Database.invalidateCache('Employees');
  }

  var ALLOWED_COLUMNS = {
    mobile: true, personal_email: true, current_address: true, permanent_address: true,
    emergency_contact_name: true, emergency_contact_phone: true, emergency_contact_relation: true,
    bank_account_number: true, bank_ifsc: true, bank_name: true, bank_branch: true, blood_group: true,
    qualification: true, date_of_marriage: true, spouse_name: true, photo_file_id: true, medical_notes: true
  };

  function onDecision(approval, state, authentication) {
    var request = Repo.find('Employee_Change_Requests', approval.request_id);
    if (!request) return;
    if (state === 'APPROVED') applyChangeRequest(request, authentication);
    else if (state === 'REJECTED') Database.update('Employee_Change_Requests', request.id, { status: 'REJECTED' }, authentication.actor.employeeId);
  }

  function myChanges(authentication) {
    var items = Database.getAllCached('Employee_Change_Requests').filter(function (row) {
      return row.employee_id === authentication.actor.employeeId && String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var approval = Workflow.statusFor('employee_change', row.id);
      return {
        id: row.id, changeType: row.change_type, changes: Utils.safeParseJson(row.change_json, {}),
        state: String(row.status).toUpperCase(), approvalState: approval ? String(approval.status).toUpperCase() : '',
        createdAt: Utils.toIso(row.created_at), appliedAt: Utils.toIso(row.applied_at)
      };
    });
    return { items: items };
  }

  /** Directory lookup used by pickers across modules. */
  function picker(authentication, payload) {
    var search = Utils.containsText(payload.search);
    var items = Repo.activeEmployees().filter(function (row) {
      if (!search) return true;
      return [row.display_name, Repo.employeeKey(row), row.department, row.designation].some(function (value) {
        return String(value || '').toLowerCase().indexOf(search) >= 0;
      });
    }).slice(0, 50).map(function (row) { return Repo.employeeSummary(row); });
    return { items: items };
  }

  return {
    STANDARD_FIELDS: STANDARD_FIELDS,
    list: list,
    detail: detail,
    save: save,
    setStatus: setStatus,
    generateNextId: generateNextId,
    importCsv: importCsv,
    exportCsv: exportCsv,
    requestChange: requestChange,
    onDecision: onDecision,
    myChanges: myChanges,
    picker: picker,
    nextEmployeeId: nextEmployeeId,
    shape: shape,
    toCamel: toCamel
  };
})();
