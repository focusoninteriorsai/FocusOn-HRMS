/**
 * In-app notification centre. Delivery is deliberately in-app only: no external
 * mail or SMS provider is assumed, so nothing leaves the company account.
 */
var Notifications = (function () {
  var MAX_PER_EVENT = 200;

  function enabled() {
    return Settings.bool('NOTIFY_APPROVAL_ASSIGNED', true) || true;
  }

  function push(employeeId, notificationType, title, body, actionUrl) {
    try {
      var id = String(employeeId || '').toUpperCase();
      if (!id || !Repo.employee(id)) return null;
      if (!Permissions.isFeatureEnabled('notifications')) return null;
      var recent = Database.getAllCached('Notifications');
      var duplicates = recent.filter(function (row) {
        return row.employee_id === id && row.title === String(title).slice(0, 300) &&
          String(row.status).toUpperCase() === 'ACTIVE' && Utils.toIso(row.created_at) > Utils.addSeconds(new Date(), -120);
      });
      if (duplicates.length) return null;
      return Database.insert('Notifications', {
        employee_id: id,
        notification_type: Utils.cleanString(notificationType || 'GENERAL').slice(0, 100),
        title: Utils.cleanString(title).slice(0, 300),
        body: Utils.cleanString(body).slice(0, 4000),
        action_url: Utils.cleanString(actionUrl || '').slice(0, 500),
        read_at: ''
      }, 'SYSTEM');
    } catch (error) {
      // Notification delivery never blocks the business action.
      return null;
    }
  }

  function pushMany(employeeIds, notificationType, title, body, actionUrl) {
    Utils.csvUnique(employeeIds || []).forEach(function (employeeId) {
      push(employeeId, notificationType, title, body, actionUrl);
    });
  }

  function list(authentication, payload) {
    var employeeId = authentication.actor.employeeId;
    var filter = Utils.cleanString(payload.filter || 'all').toLowerCase();
    var rows = Database.getAllCached('Notifications').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE';
    });
    if (filter === 'unread') rows = rows.filter(function (row) { return !row.read_at; });
    rows.sort(function (left, right) { return String(right.created_at).localeCompare(String(left.created_at)); });
    rows = rows.slice(0, 300);
    var items = rows.map(function (row) {
      return {
        id: row.id, type: row.notification_type, title: row.title, body: row.body,
        read: Boolean(row.read_at), readAt: Utils.toIso(row.read_at),
        actionUrl: row.action_url || '', createdAt: Utils.toIso(row.created_at)
      };
    });
    var all = Database.getAllCached('Notifications').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE';
    });
    return {
      items: items,
      unreadCount: all.filter(function (row) { return !row.read_at; }).length,
      total: all.length
    };
  }

  function unreadCount(employeeId) {
    return Database.getAllCached('Notifications').filter(function (row) {
      return row.employee_id === employeeId && String(row.status).toUpperCase() === 'ACTIVE' && !row.read_at;
    }).length;
  }

  function markRead(authentication, payload) {
    var ids = Array.isArray(payload.ids) ? payload.ids.slice(0, 200).map(String) : [];
    var approveList = payload.all === true;
    var changed = Database.updateMany('Notifications', function (row) {
      if (row.employee_id !== authentication.actor.employeeId || row.read_at) return false;
      if (approveList) return true;
      return ids.indexOf(String(row.id)) >= 0;
    }, { read_at: Utils.nowIso() }, authentication.actor.employeeId);
    return { marked: changed.length, unreadCount: unreadCount(authentication.actor.employeeId) };
  }

  function cleanup() {
    var retentionDays = Settings.number('NOTIFICATION_RETENTION_DAYS', 180);
    var cutoff = Utils.addSeconds(new Date(), -retentionDays * 86400);
    var changed = Database.updateMany('Notifications', function (row) {
      return String(row.status).toUpperCase() === 'ACTIVE' && Utils.toIso(row.created_at) < cutoff;
    }, { status: 'DELETED' }, 'SYSTEM');
    return changed.length;
  }

  return {
    push: push,
    pushMany: pushMany,
    list: list,
    unreadCount: unreadCount,
    markRead: markRead,
    cleanup: cleanup
  };
})();
