/** Company announcements with audience targeting and expiry. */
var Announcements = (function () {
  var AUDIENCES = ['ALL', 'DEPARTMENT', 'BRANCH', 'MANAGERS'];

  function visible(row, actor) {
    if (String(row.status).toUpperCase() !== 'ACTIVE') return false;
    if (row.expires_at && Utils.toIso(row.expires_at) < Utils.nowIso()) return false;
    var audience = String(row.audience || 'ALL').toUpperCase();
    if (audience === 'ALL' || audience === 'MANAGERS') {
      if (audience === 'MANAGERS') {
        var isManager = Repo.activeEmployees().some(function (employee) { return employee.reporting_manager_id === actor.employeeId; });
        return isManager || actor.isSuperAdmin;
      }
      return true;
    }
    if (audience === 'DEPARTMENT') return !row.audience_id || row.audience_id === actor.departmentId;
    if (audience === 'BRANCH') return !row.audience_id || row.audience_id === actor.branchId;
    return true;
  }

  function shape(row) {
    return {
      id: row.id, title: row.title, body: row.body,
      audience: row.audience || 'ALL', audienceId: row.audience_id || '',
      audienceName: row.audience_id ? (Repo.label('Departments', row.audience_id) || Repo.label('Branches', row.audience_id)) : '',
      publishedAt: Utils.toIso(row.published_at), expiresAt: Utils.toIso(row.expires_at),
      pinned: Utils.asBoolean(row.pinned), publishedBy: Repo.employeeName(row.created_by),
      active: String(row.status).toUpperCase() === 'ACTIVE'
    };
  }

  function list(authentication, payload) {
    var actor = authentication.actor;
    var manage = actor.isSuperAdmin || actor.permissions.indexOf('announcement.manage') >= 0;
    var items = Database.getAllCached('Announcements').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (manage && payload.all === true) return true;
      return visible(row, actor);
    }).map(shape).sort(function (left, right) {
      if (left.pinned !== right.pinned) return left.pinned ? -1 : 1;
      return String(right.publishedAt).localeCompare(String(left.publishedAt));
    });
    return {
      items: items.slice(0, 100), total: items.length,
      canManage: manage, audiences: AUDIENCES,
      departments: Database.getAllCached('Departments').filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; }).map(function (row) { return { id: row.id, name: row.name }; }),
      branches: Database.getAllCached('Branches').filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; }).map(function (row) { return { id: row.id, name: row.name }; })
    };
  }

  function save(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var audience = Utils.requireEnum(payload.audience || 'ALL', AUDIENCES, 'Audience');
    var changes = {
      title: Utils.requireString(payload, 'title', { max: 300 }),
      body: Utils.requireString(payload, 'body', { max: 4000, min: 5 }),
      audience: audience,
      audience_id: audience === 'DEPARTMENT' || audience === 'BRANCH' ? Utils.requireString(payload, 'audienceId', { max: 128 }) : '',
      published_at: Utils.cleanString(payload.publishedAt) ? Utils.toIso(payload.publishedAt) : Utils.nowIso(),
      expires_at: Utils.cleanString(payload.expiresAt) ? Utils.toIso(payload.expiresAt) : '',
      pinned: payload.pinned === true
    };
    var record = id ? Database.update('Announcements', Repo.requireRecord('Announcements', id, 'Announcement').id, changes, authentication.actor.employeeId)
      : Database.insert('Announcements', changes, authentication.actor.employeeId);
    Database.invalidateCache('Announcements');
    if (!id && Settings.bool('NOTIFY_ANNOUNCEMENT', true) && typeof Notifications !== 'undefined') {
      var recipients = Repo.activeEmployees();
      if (audience === 'DEPARTMENT') recipients = recipients.filter(function (row) { return row.department_id === changes.audience_id; });
      if (audience === 'BRANCH') recipients = recipients.filter(function (row) { return row.branch_id === changes.audience_id; });
      Notifications.pushMany(recipients.map(function (row) { return Repo.employeeKey(row); }), 'ANNOUNCEMENT', changes.title, changes.body.slice(0, 300), 'announcements');
    }
    Audit.logEvent('ANNOUNCEMENT_SAVED', authentication.actor.employeeId, 'Announcements', record.id, 'SUCCESS', { title: changes.title, audience: audience }, {});
    return { id: record.id };
  }

  function remove(authentication, payload) {
    var record = Repo.requireRecord('Announcements', payload.id, 'Announcement');
    Database.update('Announcements', record.id, { status: 'DELETED' }, authentication.actor.employeeId);
    Audit.logEvent('ANNOUNCEMENT_DELETED', authentication.actor.employeeId, 'Announcements', record.id, 'SUCCESS', {}, {});
    return { deleted: true };
  }

  return { list: list, save: save, remove: remove, AUDIENCES: AUDIENCES };
})();
