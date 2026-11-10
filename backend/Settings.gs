/**
 * FOCUSON HRMS - Settings, Roles & Branding Engine (Google Apps Script)
 * Role Builder, Permission Catalog, User Access inspector, Feature Switches, and Branding Studio.
 */

var Settings = (function() {
  function getSystemSettings(actor) {
    var raw = Database.getAllCached('Company_Settings');
    var map = {};
    for (var i = 0; i < raw.length; i++) {
      map[raw[i].setting_key] = raw[i].setting_value;
    }
    return map;
  }

  function saveSystemSetting(key, value, category, actor) {
    Permissions.check(actor, 'settings.edit');
    var settings = Database.getAll('Company_Settings');
    var found = false;

    for (var i = 0; i < settings.length; i++) {
      if (settings[i].setting_key === key) {
        Database.update('Company_Settings', settings[i].id, {
          setting_value: value,
          category: category || settings[i].category
        }, actor.employeeId);
        found = true;
        break;
      }
    }

    if (!found) {
      Database.insert('Company_Settings', {
        id: 'set_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
        setting_key: key,
        setting_value: value,
        category: category || 'GENERAL'
      }, actor.employeeId);
    }

    Audit.logEvent('SETTING_UPDATED', actor.employeeId, 'Company_Settings', key, 'SUCCESS', { value: value });
    return { success: true };
  }

  function getRoles(actor) {
    return Database.getAllCached('Roles');
  }

  function getPermissionsCatalog(actor) {
    return Database.getAllCached('Permissions_Catalog');
  }

  function getRolePermissions(roleId, actor) {
    var all = Database.getAllCached('Role_Permissions');
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].role_id === roleId && all[i].status === 'ACTIVE') {
        filtered.push(all[i].permission_key);
      }
    }
    return filtered;
  }

  function saveRole(payload, actor) {
    Permissions.check(actor, 'role.define');
    if (!payload.name || !payload.code) {
      throw { code: 'VALIDATION', message: 'Role code and name are required.' };
    }

    var roleId = payload.id;
    if (roleId) {
      Database.update('Roles', roleId, {
        name: payload.name,
        description: payload.description || ''
      }, actor.employeeId);
    } else {
      roleId = 'role_' + payload.code.toLowerCase().replace(/[^a-z0-9]/g, '');
      Database.insert('Roles', {
        id: roleId,
        code: payload.code.toUpperCase(),
        name: payload.name,
        description: payload.description || '',
        is_built_in: 'FALSE'
      }, actor.employeeId);
    }

    // Update permissions
    if (Array.isArray(payload.permissions)) {
      // Soft-delete existing role permissions
      var existing = Database.getAll('Role_Permissions');
      for (var e = 0; e < existing.length; e++) {
        if (existing[e].role_id === roleId && existing[e].status === 'ACTIVE') {
          Database.softDelete('Role_Permissions', existing[e].id, actor.employeeId);
        }
      }

      // Add new permissions
      for (var p = 0; p < payload.permissions.length; p++) {
        Database.insert('Role_Permissions', {
          id: 'rp_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
          role_id: roleId,
          permission_key: payload.permissions[p],
          scope: payload.scope || 'Company'
        }, actor.employeeId);
      }
    }

    Audit.logEvent('ROLE_SAVED', actor.employeeId, 'Roles', roleId, 'SUCCESS');
    return { id: roleId, success: true };
  }

  function assignUserRole(employeeId, roleId, actor) {
    Permissions.check(actor, 'role.assign');
    var id = 'urm_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    Database.insert('User_Role_Map', {
      id: id,
      employee_id: employeeId,
      role_id: roleId
    }, actor.employeeId);
    Audit.logEvent('ROLE_ASSIGNED', actor.employeeId, 'User_Role_Map', id, 'SUCCESS', {
      targetEmployeeId: employeeId,
      roleId: roleId
    });
    return { success: true };
  }

  return {
    getSystemSettings: getSystemSettings,
    saveSystemSetting: saveSystemSetting,
    getRoles: getRoles,
    getPermissionsCatalog: getPermissionsCatalog,
    getRolePermissions: getRolePermissions,
    saveRole: saveRole,
    assignUserRole: assignUserRole
  };
})();
