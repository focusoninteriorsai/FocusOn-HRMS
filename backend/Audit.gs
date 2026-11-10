/**
 * Append-only application audit trail. The Sheets tab is protected by Setup;
 * details are redacted before storage and no request credentials are accepted.
 */
var Audit = (function () {
  function logEvent(eventType, actorId, targetEntity, targetId, outcome, details, context) {
    context = context || {};
    var record = {
      event_type: String(eventType).slice(0, 120),
      actor_id: String(actorId || 'ANONYMOUS').slice(0, 64),
      target_entity: String(targetEntity || '').slice(0, 100),
      target_id: String(targetId || '').slice(0, 128),
      outcome: String(outcome || 'SUCCESS').slice(0, 40),
      req_id: String(context.reqId || '').slice(0, 128),
      device_hash: String(context.deviceHash || '').slice(0, 128),
      details_json: JSON.stringify(Utils.safeAuditDetails(details || {}))
    };
    return Database.insert('Audit_Logs', record, actorId || 'SYSTEM');
  }

  function logSensitiveAccess(actorId, fieldName, targetEmployeeId, context) {
    return logEvent('SENSITIVE_FIELD_VIEW', actorId, 'Employees', targetEmployeeId, 'SUCCESS', {
      fields: Array.isArray(fieldName) ? fieldName : [fieldName]
    }, context);
  }

  return {
    logEvent: logEvent,
    logSensitiveAccess: logSensitiveAccess
  };
})();
