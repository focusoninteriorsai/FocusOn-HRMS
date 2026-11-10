/** Asset register with allocation, return and history. */
var Assets = (function () {
  var CATEGORIES = ['LAPTOP', 'DESKTOP', 'MONITOR', 'MOBILE', 'TABLET', 'SIM_CARD', 'ACCESS_CARD', 'FURNITURE', 'VEHICLE', 'TOOL', 'SOFTWARE_LICENSE', 'OTHER'];
  var CONDITIONS = ['NEW', 'GOOD', 'FAIR', 'DAMAGED', 'LOST'];

  function shape(row) {
    return {
      id: row.id, code: row.asset_code, name: row.name, category: row.category,
      serialNumber: row.serial_number || '', purchaseDate: String(row.purchase_date || '').slice(0, 10),
      purchaseValue: Utils.numberOrZero(row.purchase_value),
      assignedEmployeeId: row.assigned_employee_id || '',
      assignedTo: Repo.employeeName(row.assigned_employee_id),
      assignedAt: String(row.assigned_at || '').slice(0, 10),
      returnedAt: String(row.returned_at || '').slice(0, 10),
      condition: row.condition || 'GOOD', notes: row.notes || '',
      history: Utils.safeParseJson(row.history_json, []),
      available: !row.assigned_employee_id
    };
  }

  function list(authentication, payload) {
    var items = Database.getAllCached('Assets').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(shape);
    if (payload.category) items = items.filter(function (item) { return item.category === payload.category; });
    if (payload.available === true) items = items.filter(function (item) { return item.available; });
    if (payload.employeeId) items = items.filter(function (item) { return item.assignedEmployeeId === Utils.normalizeEmployeeId(payload.employeeId); });
    var paged = Utils.paginate(items, payload, {
      searchFields: ['code', 'name', 'serialNumber', 'assignedTo', 'category'],
      sortFields: ['code', 'name', 'category', 'assignedTo'], maxPageSize: 300
    });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      categories: CATEGORIES, conditions: CONDITIONS,
      stats: {
        total: items.length,
        assigned: items.filter(function (item) { return !item.available; }).length,
        available: items.filter(function (item) { return item.available; }).length,
        value: Utils.round2(items.reduce(function (sum, item) { return sum + item.purchaseValue; }, 0))
      }
    };
  }

  function save(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var code = Utils.cleanString(payload.code).toUpperCase() || ('AST' + String(Database.getAllCached('Assets').length + 1).padStart(4, '0'));
    var duplicate = Database.getAllCached('Assets').some(function (row) {
      return row.asset_code === code && row.id !== id && String(row.status).toUpperCase() !== 'DELETED';
    });
    if (duplicate) Utils.fail('CONFLICT', 'An asset with this code already exists.');
    var changes = {
      asset_code: code,
      name: Utils.requireString(payload, 'name', { max: 160 }),
      category: Utils.requireEnum(payload.category || 'OTHER', CATEGORIES, 'Category'),
      serial_number: Utils.cleanString(payload.serialNumber).slice(0, 128),
      purchase_date: Utils.cleanString(payload.purchaseDate) ? Utils.requireDate(payload.purchaseDate, 'Purchase date') : '',
      purchase_value: Utils.requireNumber(payload.purchaseValue || 0, 'Purchase value', { min: 0 }),
      condition: Utils.requireEnum(payload.condition || 'GOOD', CONDITIONS, 'Condition'),
      notes: Utils.cleanString(payload.notes).slice(0, 2000)
    };
    var record = id ? Database.update('Assets', Repo.requireRecord('Assets', id, 'Asset').id, changes, authentication.actor.employeeId)
      : Database.insert('Assets', changes, authentication.actor.employeeId);
    Database.invalidateCache('Assets');
    Audit.logEvent('ASSET_SAVED', authentication.actor.employeeId, 'Assets', record.id, 'SUCCESS', { code: code, name: changes.name }, {});
    return { id: record.id, asset: shape(record) };
  }

  function assign(authentication, payload) {
    var asset = Repo.requireRecord('Assets', payload.assetId, 'Asset');
    if (asset.assigned_employee_id) Utils.fail('CONFLICT', 'This asset is already assigned. Return it first.');
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId);
    Repo.requireEmployee(employeeId);
    var history = Utils.safeParseJson(asset.history_json, []);
    history.push({ action: 'ASSIGNED', employeeId: employeeId, at: Utils.nowIso(), by: authentication.actor.employeeId, note: Utils.cleanString(payload.note).slice(0, 500) });
    Database.update('Assets', asset.id, {
      assigned_employee_id: employeeId, assigned_at: Utils.cleanString(payload.assignedAt) ? Utils.requireDate(payload.assignedAt, 'Assigned date') : Utils.today(),
      returned_at: '', history_json: JSON.stringify(history)
    }, authentication.actor.employeeId);
    if (typeof Notifications !== 'undefined') {
      Notifications.push(employeeId, 'ASSET', 'Asset assigned', asset.name + ' (' + asset.asset_code + ') has been assigned to you.', 'assets');
    }
    Audit.logEvent('ASSET_ASSIGNED', authentication.actor.employeeId, 'Assets', asset.id, 'SUCCESS', { employeeId: employeeId }, {});
    return { assigned: true };
  }

  function returnAsset(authentication, payload) {
    var asset = Repo.requireRecord('Assets', payload.assetId, 'Asset');
    if (!asset.assigned_employee_id) Utils.fail('CONFLICT', 'This asset is not assigned to anyone.');
    var history = Utils.safeParseJson(asset.history_json, []);
    history.push({
      action: 'RETURNED', employeeId: asset.assigned_employee_id, at: Utils.nowIso(),
      by: authentication.actor.employeeId, condition: Utils.cleanString(payload.condition) || asset.condition,
      note: Utils.cleanString(payload.note).slice(0, 500)
    });
    Database.update('Assets', asset.id, {
      assigned_employee_id: '', returned_at: Utils.cleanString(payload.returnedAt) ? Utils.requireDate(payload.returnedAt, 'Returned date') : Utils.today(),
      condition: Utils.requireEnum(payload.condition || asset.condition || 'GOOD', CONDITIONS, 'Condition'),
      history_json: JSON.stringify(history)
    }, authentication.actor.employeeId);
    Audit.logEvent('ASSET_RETURNED', authentication.actor.employeeId, 'Assets', asset.id, 'SUCCESS', { employeeId: asset.assigned_employee_id }, {});
    return { returned: true };
  }

  function myAssets(authentication) {
    var items = Database.getAllCached('Assets').filter(function (row) {
      return row.assigned_employee_id === authentication.actor.employeeId && !row.returned_at && String(row.status).toUpperCase() === 'ACTIVE';
    }).map(shape);
    return { items: items, total: items.length };
  }

  return { list: list, save: save, assign: assign, returnAsset: returnAsset, myAssets: myAssets, CATEGORIES: CATEGORIES };
})();
