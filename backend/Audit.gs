/**
 * FOCUSON HRMS - Audit Logging Engine (Google Apps Script)
 * Immutably records security events, login attempts, sensitive field views, approvals, and role updates.
 */

var Audit = (function() {
  /**
   * Logs a security or operational event to Audit_Logs.
   */
  function logEvent(action, actorId, targetEntity, targetId, status, details, clientMeta) {
    try {
      clientMeta = clientMeta || {};
      var now = Utils.nowIso();
      var record = {
        id: 'aud_' + Utilities.getUuid().replace(/-/g, '').substring(0, 18),
        created_at: now,
        updated_at: now,
        created_by: actorId || 'SYSTEM',
        updated_by: actorId || 'SYSTEM',
        status: status || 'SUCCESS',
        action: action,
        actor_id: actorId || 'ANONYMOUS',
        target_entity: targetEntity || '',
        target_id: targetId || '',
        ip_hash: clientMeta.ipHash || '',
        user_agent_hash: clientMeta.uaHash || '',
        details_json: typeof details === 'string' ? details : JSON.stringify(details || {})
      };

      // Append directly without waiting on general lock
      var sheet = Database.getSheet('Audit_Logs');
      if (sheet) {
        var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
        var row = [];
        for (var i = 0; i < headers.length; i++) {
          var h = headers[i];
          row.push(Utils.sanitizeForSheet(record[h] !== undefined ? record[h] : ''));
        }
        sheet.appendRow(row);
      }
    } catch (err) {
      console.error('Failed to write audit log:', err);
    }
  }

  /**
   * Specialized audit helper for sensitive data views (salary, bank details, govt IDs).
   */
  function logSensitiveAccess(actorId, fieldName, targetEmployeeId, clientMeta) {
    logEvent('SENSITIVE_FIELD_VIEW', actorId, 'Employees', targetEmployeeId, 'ACCESSED', {
      field: fieldName
    }, clientMeta);
  }

  return {
    logEvent: logEvent,
    logSensitiveAccess: logSensitiveAccess
  };
})();
