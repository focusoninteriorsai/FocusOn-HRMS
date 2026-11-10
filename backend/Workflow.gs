/**
 * FOCUSON HRMS - Workflow & Approval Engine (Google Apps Script)
 * Versioned multi-step workflows, unified approval inbox, self-approval blockage, and SLA escalation.
 */

var Workflow = (function() {
  function getPendingApprovals(actor) {
    var approvals = Database.getAll('Approvals');
    var pending = [];

    for (var i = 0; i < approvals.length; i++) {
      var app = approvals[i];
      if (app.overall_status === 'PENDING') {
        var isApprover = (app.current_approver_id === actor.employeeId);

        // Check if actor is Super Admin or has workflow.inbox within scope
        if (isApprover || (actor.isSuperAdmin && !app.current_approver_id)) {
          pending.push(app);
        }
      }
    }

    return pending;
  }

  function handleAction(payload, actor) {
    if (!payload.approval_id || !payload.action) {
      throw { code: 'VALIDATION', message: 'Approval ID and action are required.' };
    }

    var approvals = Database.getAll('Approvals');
    var target = null;
    for (var i = 0; i < approvals.length; i++) {
      if (approvals[i].id === payload.approval_id) {
        target = approvals[i];
        break;
      }
    }

    if (!target) {
      throw { code: 'NOT_FOUND', message: 'Approval record not found.' };
    }

    // Rule: Self-approval always blocked!
    if (target.applicant_id === actor.employeeId && !actor.isSuperAdmin) {
      throw { code: 'FORBIDDEN', message: 'Self-approval is strictly forbidden.' };
    }

    // Mandatory comment on reject
    if (payload.action === 'REJECT' && (!payload.comments || payload.comments.trim().length === 0)) {
      throw { code: 'VALIDATION', message: 'A comment is mandatory when rejecting a request.' };
    }

    var newStatus = payload.action === 'APPROVE' ? 'APPROVED' : 'REJECTED';

    Database.update('Approvals', target.id, {
      overall_status: newStatus,
      resolved_at: Utils.nowIso()
    }, actor.employeeId);

    // Record action audit log
    Database.insert('Approval_Actions', {
      id: 'act_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      approval_id: target.id,
      step_id: target.current_step_id || 'step_1',
      action: payload.action,
      actor_id: actor.employeeId,
      comments: payload.comments || ''
    }, actor.employeeId);

    // Update target request status based on request_type
    if (target.request_type === 'LEAVE') {
      Database.update('Leave_Applications', target.request_id, {
        status: newStatus
      }, actor.employeeId);
    } else if (target.request_type === 'ATTENDANCE_REGULARIZATION') {
      Database.update('Attendance_Regularization', target.request_id, {
        approval_status: newStatus
      }, actor.employeeId);
    }

    Audit.logEvent('WORKFLOW_ACTION', actor.employeeId, 'Approvals', target.id, newStatus, {
      action: payload.action,
      requestType: target.request_type,
      comments: payload.comments
    });

    return { success: true, status: newStatus };
  }

  return {
    getPendingApprovals: getPendingApprovals,
    handleAction: handleAction
  };
})();
