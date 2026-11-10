/** Organization setup: departments, designations, branches, sites and holidays. */
var Organization = (function () {
  function clean(rows) {
    return rows.filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; });
  }

  function counts() {
    var employees = Repo.activeEmployees();
    var byDepartment = {};
    var byBranch = {};
    empleadoCount(employees, 'department_id', byDepartment);
    empleadoCount(employees, 'branch_id', byBranch);
    return { byDepartment: byDepartment, byBranch: byBranch, headcount: employees.length };
  }

  function empleadoCount(rows, field, target) {
    rows.forEach(function (row) {
      var key = row[field] || '';
      if (!key) return;
      target[key] = (target[key] || 0) + 1;
    });
  }

  function list(authentication, payload) {
    var entity = Utils.requireEnum(payload.entity, ['departments', 'designations', 'branches', 'sites', 'holidays'], 'Entity');
    var tab = { departments: 'Departments', designations: 'Designations', branches: 'Branches', sites: 'Sites', holidays: 'Holidays' }[entity];
    var stats = counts();
    var items = clean(Database.getAllCached(tab)).map(function (row) {
      return decorate(tab, row, stats);
    });
    if (payload.branchId) items = items.filter(function (item) { return !item.branchId || item.branchId === payload.branchId; });
    if (payload.year) items = items.filter(function (item) { return !item.holidayDate || String(item.holidayDate).slice(0, 4) === String(payload.year); });
    if (payload.month) items = items.filter(function (item) { return !item.holidayDate || String(item.holidayDate).slice(0, 7) === String(payload.month); });
    var paged = Utils.paginate(items, payload, {
      searchFields: ['name', 'code', 'city', 'state', 'address'],
      sortFields: ['name', 'code', 'headcount', 'holidayDate', 'level', 'created_at'],
      maxPageSize: 500
    });
    var employees = Repo.activeEmployees().map(function (row) { return Repo.employeeSummary(row); });
    return {
      entity: entity,
      items: paged.items,
      page: paged.page,
      pageCount: paged.pageCount,
      total: paged.total,
      employees: employees,
      departments: clean(Database.getAllCached('Departments')).map(function (row) { return { id: row.id, name: row.name, code: row.code }; }),
      branches: clean(Database.getAllCached('Branches')).map(function (row) { return { id: row.id, name: row.name, code: row.code }; }),
      headcount: stats.headcount
    };
  }

  function decorate(tab, row, stats) {
    if (tab === 'Departments') {
      return {
        id: row.id, code: row.code, name: row.name, headEmployeeId: row.head_employee_id || '',
        headName: Repo.employeeName(row.head_employee_id), branchId: row.branch_id || '',
        branchName: Repo.label('Branches', row.branch_id), description: row.description || '',
        headcount: stats.byDepartment[row.id] || 0, headcountBasis: 'department_id', active: String(row.status).toUpperCase() === 'ACTIVE',
        createdAt: Utils.toIso(row.created_at)
      };
    }
    if (tab === 'Designations') {
      return {
        id: row.id, code: row.code, name: row.name, level: Utils.numberOrZero(row.level),
        description: row.description || '', active: String(row.status).toUpperCase() === 'ACTIVE',
        createdAt: Utils.toIso(row.created_at)
      };
    }
    if (tab === 'Branches') {
      return {
        id: row.id, code: row.code, name: row.name, address: row.address || '', city: row.city || '',
        state: row.state || '', pincode: row.pincode || '', timezone: row.timezone || 'Asia/Kolkata',
        headEmployeeId: row.head_employee_id || '', headName: Repo.employeeName(row.head_employee_id),
        phone: row.phone || '', email: row.email || '',
        headcount: stats.byBranch[row.id] || 0, active: String(row.status).toUpperCase() === 'ACTIVE',
        createdAt: Utils.toIso(row.created_at)
      };
    }
    if (tab === 'Sites') {
      return {
        id: row.id, code: row.code, name: row.name, branchId: row.branch_id || '',
        branchName: Repo.label('Branches', row.branch_id), address: row.address || '',
        latitude: row.latitude === '' ? null : Utils.numberOrZero(row.latitude),
        longitude: row.longitude === '' ? null : Utils.numberOrZero(row.longitude),
        radiusMeters: row.radius_meters === '' ? null : Utils.numberOrZero(row.radius_meters),
        clientName: row.client_name || '', contactPerson: row.contact_person || '', contactPhone: row.contact_phone || '',
        active: String(row.status).toUpperCase() === 'ACTIVE', createdAt: Utils.toIso(row.created_at)
      };
    }
    return {
      id: row.id, name: row.name, holidayDate: String(row.holiday_date || '').slice(0, 10),
      holidayType: row.holiday_type || 'PUBLIC', branchId: row.branch_id || '',
      branchName: Repo.label('Branches', row.branch_id) || 'All branches',
      description: row.description || '', active: String(row.status).toUpperCase() === 'ACTIVE',
      createdAt: Utils.toIso(row.created_at)
    };
  }

  function save(authentication, payload) {
    var entity = Utils.requireEnum(payload.entity, ['departments', 'designations', 'branches', 'sites', 'holidays'], 'Entity');
    var actor = authentication.actor;
    var id = Utils.cleanString(payload.id);
    var changes = build(authentication, entity, payload);
    var tab = { departments: 'Departments', designations: 'Designations', branches: 'Branches', sites: 'Sites', holidays: 'Holidays' }[entity];
    uniqueCheck(tab, entity, changes, id);
    var record;
    if (id) {
      record = Repo.requireRecord(tab, id, 'Record');
      record = Database.update(tab, record.id, changes, actor.employeeId);
    } else {
      record = Database.insert(tab, changes, actor.employeeId);
    }
    Database.invalidateCache(tab);
    Audit.logEvent('ORG_' + (id ? 'UPDATED' : 'CREATED'), actor.employeeId, tab, record.id, 'SUCCESS', { entity: entity, name: changes.name || changes.code }, {});
    return { id: record.id, entity: entity };
  }

  function build(authentication, entity, payload) {
    if (entity === 'departments') {
      return {
        code: Utils.requireString(payload, 'code', { max: 64 }).toUpperCase(),
        name: Utils.requireString(payload, 'name', { max: 160 }),
        head_employee_id: validEmployeeId(payload.headEmployeeId),
        branch_id: Utils.cleanString(payload.branchId),
        description: Utils.cleanString(payload.description).slice(0, 1000),
        status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
      };
    }
    if (entity === 'designations') {
      return {
        code: Utils.requireString(payload, 'code', { max: 64 }).toUpperCase(),
        name: Utils.requireString(payload, 'name', { max: 160 }),
        level: Utils.requireNumber(payload.level === undefined || payload.level === '' ? 1 : payload.level, 'Level', { integer: true, min: 1, max: 20 }),
        description: Utils.cleanString(payload.description).slice(0, 1000),
        status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
      };
    }
    if (entity === 'branches') {
      return {
        code: Utils.requireString(payload, 'code', { max: 64 }).toUpperCase(),
        name: Utils.requireString(payload, 'name', { max: 160 }),
        address: Utils.cleanString(payload.address).slice(0, 1000),
        city: Utils.cleanString(payload.city).slice(0, 120),
        state: Utils.cleanString(payload.state).slice(0, 120),
        pincode: Utils.cleanString(payload.pincode).slice(0, 20),
        timezone: Utils.cleanString(payload.timezone || 'Asia/Kolkata').slice(0, 80),
        head_employee_id: validEmployeeId(payload.headEmployeeId),
        phone: Utils.cleanString(payload.phone).slice(0, 32),
        email: Utils.requireEmail(payload.email, 'Branch email', true),
        status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
      };
    }
    if (entity === 'sites') {
      var site = {
        code: Utils.requireString(payload, 'code', { max: 64 }).toUpperCase(),
        name: Utils.requireString(payload, 'name', { max: 160 }),
        branch_id: Utils.cleanString(payload.branchId),
        address: Utils.cleanString(payload.address).slice(0, 1000),
        client_name: Utils.cleanString(payload.clientName).slice(0, 160),
        contact_person: Utils.cleanString(payload.contactPerson).slice(0, 160),
        contact_phone: Utils.cleanString(payload.contactPhone).slice(0, 32),
        latitude: coordinate(payload.latitude, 'Latitude', -90, 90),
        longitude: coordinate(payload.longitude, 'Longitude', -180, 180),
        radius_meters: Utils.requireNumber(payload.radiusMeters === '' || payload.radiusMeters === undefined ? Settings.number('GEOFENCE_DEFAULT_RADIUS_METERS', 150) : payload.radiusMeters, 'Radius', { min: 25, max: 5000 }),
        status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
      };
      return site;
    }
    var dateText = Utils.requireDate(payload.holidayDate, 'Holiday date');
    return {
      name: Utils.requireString(payload, 'name', { max: 160 }),
      holiday_date: dateText,
      holiday_type: Utils.requireEnum(payload.holidayType || 'PUBLIC', ['PUBLIC', 'RESTRICTED', 'COMPANY', 'OPTIONAL'], 'Holiday type'),
      branch_id: Utils.cleanString(payload.branchId),
      description: Utils.cleanString(payload.description).slice(0, 1000),
      status: 'ACTIVE'
    };
  }

  function coordinate(value, label, minimum, maximum) {
    if (value === '' || value === null || value === undefined) return '';
    return Utils.requireNumber(value, label, { min: minimum, max: maximum });
  }

  function validEmployeeId(value) {
    var id = Utils.cleanString(value).toUpperCase();
    if (!id) return '';
    if (!Repo.employee(id)) Utils.fail('VALIDATION', 'The selected employee does not exist.');
    return id;
  }

  function uniqueCheck(tab, entity, changes, id) {
    var rows = clean(Database.getAllCached(tab));
    rows.forEach(function (row) {
      if (id && row.id === id) return;
      if (changes.code && String(row.code).toUpperCase() === changes.code) Utils.fail('CONFLICT', 'This code is already in use.');
      if (entity === 'holidays' && String(row.holiday_date).slice(0, 10) === changes.holiday_date && String(row.branch_id || '') === String(changes.branch_id || '')) {
        Utils.fail('CONFLICT', 'A holiday already exists on this date for the selected branch.');
      }
    });
  }

  function remove(authentication, payload) {
    var entity = Utils.requireEnum(payload.entity, ['departments', 'designations', 'branches', 'sites', 'holidays'], 'Entity');
    var tab = { departments: 'Departments', designations: 'Designations', branches: 'Branches', sites: 'Sites', holidays: 'Holidays' }[entity];
    var record = Repo.requireRecord(tab, payload.id, 'Record');
    var employees = Repo.activeEmployees();
    var inUse = 0;
    if (entity === 'departments') inUse = employees.filter(function (row) { return row.department_id === record.id; }).length;
    if (entity === 'branches') inUse = employees.filter(function (row) { return row.branch_id === record.id; }).length;
    if (entity === 'designations') inUse = employees.filter(function (row) { return row.designation_id === record.id; }).length;
    if (inUse) Utils.fail('CONFLICT', 'This record is used by ' + inUse + ' employee(s). Reassign them first.');
    Database.softDelete(tab, record.id, authentication.actor.employeeId);
    Database.invalidateCache(tab);
    Audit.logEvent('ORG_DELETED', authentication.actor.employeeId, tab, record.id, 'SUCCESS', { entity: entity }, {});
    return { deleted: true };
  }

  function tree(authentication) {
    var stats = counts();
    var branches = clean(Database.getAllCached('Branches')).map(function (row) {
      var departmentRows = clean(Database.getAllCached('Departments')).filter(function (dept) {
        return !dept.branch_id || dept.branch_id === row.id;
      });
      return {
        id: row.id, name: row.name, code: row.code, city: row.city || '', headcount: stats.byBranch[row.id] || 0,
        headName: Repo.employeeName(row.head_employee_id),
        departments: departmentRows.map(function (dept) {
          return {
            id: dept.id, name: dept.name, code: dept.code, headcount: stats.byDepartment[dept.id] || 0,
            headName: Repo.employeeName(dept.head_employee_id)
          };
        })
      };
    });
    return { branches: branches, headcount: stats.headcount };
  }

  return {
    list: list,
    save: save,
    remove: remove,
    tree: tree,
    counts: counts
  };
})();
