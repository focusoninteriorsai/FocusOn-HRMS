/**
 * Versioned, multi-step approval engine. Workflow definitions and step rules are
 * data owned by the Super Admin; the engine only interprets them.
 */
var Workflow = (function () {
  var ACTIONS = ['APPROVE', 'REJECT', 'RETURN', 'CANCEL'];
  var OPEN_STATES = ['PENDING', 'RETURNED'];

  function definitionFor(requestType) {
    var definitions = Database.getAllCached('Workflow_Definitions').filter(function (row) {
      return row.request_type === requestType && String(row.status).toUpperCase() === 'ACTIVE';
    });
    definitions.sort(function (left, right) {
      return Utils.numberOrZero(right.version) - Utils.numberOrZero(left.version);
    });
    return definitions.length ? definitions[0] : null;
  }

  function stepsFor(workflowId) {
    var steps = Database.getAllCached('Workflow_Steps').filter(function (row) {
      return row.workflow_id === workflowId && String(row.status).toUpperCase() === 'ACTIVE';
    });
    steps.sort(function (left, right) {
      return Utils.numberOrZero(left.step_number) - Utils.numberOrZero(right.step_number);
    });
    return steps;
  }

  function defaultRule(requestType) {
    var settingsRule = Database.getSetting('WORKFLOW_DEFAULT_' + String(requestType).toUpperCase().replace(/[^A-Z0-9]/g, '_'), '');
    if (settingsRule) {
      var parsed = Utils.safeParseJson(settingsRule, null);
      if (parsed && parsed.type) return parsed;
    }
    var map = {
      leave: { type: 'reporting_manager', fallbackRole: 'HR_MANAGER' },
      regularization: { type: 'reporting_manager', fallbackRole: 'HR_MANAGER' },
      expense: { type: 'reporting_manager', fallbackRole: 'FINANCE_MANAGER' },
      advance: { type: 'reporting_manager', fallbackRole: 'FINANCE_MANAGER' },
      salary_revision: { type: 'permission', permission: 'salary.revise' },
      payroll: { type: 'permission', permission: 'payroll.approve' },
      document: { type: 'permission', permission: 'document.generate' },
      offer: { type: 'permission', permission: 'recruitment.approve' },
      performance: { type: 'reporting_manager', fallbackRole: 'HR_MANAGER' },
      exit: { type: 'reporting_manager', fallbackRole: 'HR_MANAGER' },
      employee_change: { type: 'permission', permission: 'employee.edit' },
      asset: { type: 'permission', permission: 'org.edit' }
    };
    return map[requestType] || { type: 'permission', permission: 'workflow.override' };
  }

  function prefixMatch(value, rules, separator) {
    var parts = String(value || '').split(separator || '-');
    for (var i = 0; i < rules.length; i++) {
      if (parts.length > rules[i].length && parts.slice(0, rules[i].length).join(separator || '-') === rules[i].join(separator || '-')) return true;
    }
    return false;
  }

  function resolveApproverIds(rule, requester, context) {
    rule = rule || {};
    context = context || {};
    var ids = [];
    var type = rule.type || 'reporting_manager';
    var requesterRow = Repo.employee(requester);

    if (type === 'reporting_manager') {
      var managerId = requesterRow ? String(requesterRow.reporting_manager_id || '') : '';
      if (managerId && managerId !== requester) ids.push(managerId);
      if (!ids.length && rule.fallbackRole) ids = Repo.employeeIdsWithRole(rule.fallbackRole);
      if (!ids.length && rule.fallbackPermission) ids = Repo.employeeIdsWithPermission(rule.fallbackPermission);
    } else if (type === 'employee') {
      (rule.employeeIds || []).forEach(function (id) { ids.push(String(id).toUpperCase()); });
    } else if (type === 'role') {
      ids = Repo.employeeIdsWithRole(rule.roleCode);
    } else if (type === 'permission') {
      ids = Repo.employeeIdsWithPermission(rule.permission);
    } else if (type === 'department_head') {
      var departmentId = context.departmentId || (requesterRow ? requesterRow.department_id : '');
      var department = Repo.find('Departments', departmentId);
      if (department && department.head_employee_id) ids.push(department.head_employee_id);
      if (!ids.length && rule.fallbackRole) ids = Repo.employeeIdsWithRole(rule.fallbackRole);
    } else if (type === 'branch_head') {
      var branchId = context.branchId || (requesterRow ? requesterRow.branch_id : '');
      var branch = Repo.find('Branches', branchId);
      if (branch && branch.head_employee_id) ids.push(branch.head_employee_id);
      if (!ids.length && rule.fallbackRole) ids = Repo.employeeIdsWithRole(rule.fallbackRole);
    } else if (type === 'skip') {
      ids = [];
    }

    ids = Utils.csvUnique(ids.filter(function (id) { return id && id !== 'UNDEFINED'; }));
    if (rule.excludeRequester !== false) ids = ids.filter(function (id) { return id !== requester; });
    if (!ids.length && rule.fallbackRole !== 'SKIP') {
      // Last resort: another Super Admin can always decide, so approvals never dead-end.
      ids = Repo.employeeIdsWithRole('SUPER_ADMIN').filter(function (id) { return id !== requester; });
    }
    if (!ids.length) return ids;

    // Apply active approval delegations: the delegate acts for the delegator.
    var now = Utils.nowIso();
    var delegations = Database.getAllCached('Delegations').filter(function (row) {
      return ids.indexOf(row.delegator_employee_id) >= 0 && String(row.status).toUpperCase() === 'ACTIVE' &&
        (!row.starts_at || Utils.toIso(row.starts_at) <= now) && (!row.ends_at || Utils.toIso(row.ends_at) > now);
    });
    if (delegations.length) {
      var replacements = [];
      ids.forEach(function (id) {
        var delegation = null;
        delegations.forEach(function (row) { if (row.delegator_employee_id === id) delegation = row; });
        if (delegation && String(delegation.workflow_define).toUpperCase() !== 'FALSE') replacements.push(delegation.delegate_employee_id);
        else replacements.push(id);
      });
      ids = Utils.csvUnique(replacements);
    }
    return ids;
  }

  function stepRule(step, requestType) {
    if (!step) return defaultRule(requestType);
    var rule = Utils.safeParseJson(step.approver_rule_json, null);
    return rule && rule.type ? rule : defaultRule(requestType);
  }

  /** Creates the approval record and freezes the resolved step list in the payload. */
  function start(authentication, requestType, requestId, requestPayload, options) {
    options = options || {};
    var actor = authentication.actor;
    if (!requestId) Utils.fail('VALIDATION', 'A request identifier is required to start an approval.');
    var definition = definitionFor(requestType);
    var steps = definition ? stepsFor(definition.id) : [];
    var rule = steps.length ? stepRule(steps[0], requestType) : defaultRule(requestType);
    var approvers = resolveApproverIds(rule, actor.employeeId, options);
    if (!approvers.length) {
      if (Settings.bool('WORKFLOW_ALLOW_SELF_APPROVAL', false) || options.allowSelfApproval || actor.isSuperAdmin) {
        approvers = [actor.employeeId];
      } else {
        Utils.fail('CONFLICT', 'No approver could be resolved for this request. Ask the Super Admin to configure the ' + requestType + ' workflow or set an approver.');
      }
    }
    var slaHours = Utils.numberOrZero(steps.length ? steps[0].sla_hours : 0) || Settings.number('WORKFLOW_DEFAULT_SLA_HOURS', 48);
    var now = new Date();
    var record = Database.insert('Approvals', {
      request_type: requestType,
      request_id: requestId,
      workflow_id: definition ? definition.id : 'default_' + requestType,
      workflow_version: definition ? Utils.numberOrZero(definition.version) : 1,
      requester_employee_id: actor.employeeId,
      current_step: 1,
      payload_json: JSON.stringify({
        approvers: approvers,
        steps: steps.map(function (step) {
          return {
            step: Utils.numberOrZero(step.step_number),
            type: step.step_type || 'APPROVAL',
            rule: stepRule(step, requestType),
            slaHours: Utils.numberOrZero(step.sla_hours),
            conditions: Utils.safeParseJson(step.conditions_json, {})
          };
        }),
        request: requestPayload || {},
        summary: options.summary || ''
      }),
      due_at: Utils.addSeconds(now, slaHours * 3600),
      status: 'PENDING'
    }, actor.employeeId);
    Audit.logEvent('APPROVAL_STARTED', actor.employeeId, 'Approvals', record.id, 'SUCCESS', {
      requestType: requestType, requestId: requestId, approvers: approvers
    }, options.context || {});
    notifyApprovers(approvers, record, requestType, options.summary);
    return record;
  }

  function notifyApprovers(approvers, approval, requestType, summary) {
    if (typeof Notifications === 'undefined' || !Settings.bool('NOTIFY_APPROVAL_ASSIGNED', true)) return;
    approvers.forEach(function (employeeId) {
      Notifications.push(employeeId, 'APPROVAL', 'Approval needed: ' + humanType(requestType), summary || 'A new request needs your decision.', 'inbox');
    });
    notifyApproversViaGoogle(approvers, requestType, summary, approval);
  }

  /**
   * Google delivery for an approval assignment: Gmail when enabled, and a Google
   * Chat card when a webhook is configured. Both are best-effort: a delivery
   * failure is audited and never blocks the request.
   */
  function notifyApproversViaGoogle(approvers, requestType, summary, approval) {
    try {
      if (typeof Google === 'undefined') return;
      var title = 'Approval needed: ' + humanType(requestType);
      var body = String(summary || 'A new request needs your decision.');
      if (Google.mailEnabled()) {
        var prefix = Settings.text('MAIL_SUBJECT_PREFIX', '[FOCUSON HRMS]') + ' ';
        var link = Google.appLink('/workflow');
        approvers.forEach(function (employeeId) {
          var to = Google.employeeEmail(employeeId);
          if (!to) return;
          Google.sendMail(to, title, [
            Repo.employeeName(employeeId) + ',',
            '',
            body,
            '',
            'Open the approval inbox: ' + (link || 'the HRMS approval inbox'),
            '',
            'This message was sent automatically by ' + Settings.text('COMPANY_NAME', 'FOCUSON HRMS') + '.'
          ].join('\n'), { prefix: prefix });
        });
      }
      if (Google.chatEnabled()) {
        Google.chatSend('*' + title + '*\n' + body, {
          cards: Google.chatApprovalCard(title, [{ label: humanType(requestType), value: body }], '/workflow')
        });
      }
      if (Google.tasksEnabled()) {
        var due = approvalDue(approval);
        approvers.slice(0, 10).forEach(function (employeeId) {
          Google.addTask(title, body, due);
        });
      }
    } catch (error) {
      Audit.logEvent('APPROVAL_GOOGLE_NOTIFY_FAILED', 'SYSTEM', 'Approvals', String(requestType || ''), 'FAILED',
        { message: String(error && error.message).slice(0, 300) }, {});
    }
  }

  /** Due date for a task created from an approval, when one is known. */
  function approvalDue(approval) {
    return approval && approval.due_at ? Utils.toIso(approval.due_at) : '';
  }

  function humanType(requestType) {
    return String(requestType || '').replace(/_/g, ' ').replace(/\b\w/g, function (letter) { return letter.toUpperCase(); });
  }

  function openForApprover(employeeId) {
    return Database.getAllCached('Approvals').filter(function (row) {
      if (OPEN_STATES.indexOf(String(row.status).toUpperCase()) < 0) return false;
      var payload = Utils.safeParseJson(row.payload_json, {});
      return (payload.approvers || []).indexOf(employeeId) >= 0;
    });
  }

  function inbox(authentication, payload) {
    var employeeId = authentication.actor.employeeId;
    var filter = Utils.cleanString(payload.filter || 'pending').toLowerCase();
    var rows = Database.getAllCached('Approvals');
    var names = {};
    var items = [];
    rows.forEach(function (row) {
      var requestPayload = Utils.safeParseJson(row.payload_json, {});
      var approvers = requestPayload.approvers || [];
      var isApprover = approvers.indexOf(employeeId) >= 0;
      var isRequester = row.requester_employee_id === employeeId;
      var state = String(row.status).toUpperCase();
      var matches = false;
      if (filter === 'pending') matches = isApprover && OPEN_STATES.indexOf(state) >= 0;
      else if (filter === 'mine') matches = isRequester;
      else if (filter === 'history') matches = isApprover && OPEN_STATES.indexOf(state) < 0;
      else if (filter === 'all') matches = isApprover || isRequester;
      if (!matches) return;
      if (payload.requestType && row.request_type !== payload.requestType) return;
      if (!names[row.requester_employee_id]) names[row.requester_employee_id] = Repo.employeeName(row.requester_employee_id);
      items.push({
        approvalId: row.id,
        requestType: row.request_type,
        requestTypeLabel: humanType(row.request_type),
        requestId: row.request_id,
        requesterEmployeeId: row.requester_employee_id,
        requesterName: names[row.requester_employee_id],
        step: Utils.numberOrZero(row.current_step),
        state: state,
        dueAt: Utils.toIso(row.due_at),
        overdue: Boolean(row.due_at) && Utils.toIso(row.due_at) < Utils.nowIso() && OPEN_STATES.indexOf(state) >= 0,
        summary: requestPayload.summary || '',
        createdAt: Utils.toIso(row.created_at),
        canAct: isApprover && OPEN_STATES.indexOf(state) >= 0,
        isRequester: isRequester
      });
    });
    items.sort(function (left, right) {
      if (left.overdue !== right.overdue) return left.overdue ? -1 : 1;
      return String(left.dueAt).localeCompare(String(right.dueAt));
    });
    var counts = { pending: 0, mine: 0, history: 0, all: items.length };
    rows.forEach(function (row) {
      var requestPayload = Utils.safeParseJson(row.payload_json, {});
      var state = String(row.status).toUpperCase();
      if ((requestPayload.approvers || []).indexOf(employeeId) >= 0 && OPEN_STATES.indexOf(state) >= 0) counts.pending += 1;
      if (row.requester_employee_id === employeeId) counts.mine += 1;
      if ((requestPayload.approvers || []).indexOf(employeeId) >= 0 && OPEN_STATES.indexOf(state) < 0) counts.history += 1;
    });
    var paged = Utils.paginate(items, payload, { searchFields: ['requesterName', 'summary', 'requestTypeLabel'], maxPageSize: 100 });
    return { items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total, counts: counts };
  }

  function detail(authentication, payload) {
    var approval = Repo.requireRecord('Approvals', payload.approvalId, 'Approval');
    var requestPayload = Utils.safeParseJson(approval.payload_json, {});
    var canSee = approval.requester_employee_id === authentication.actor.employeeId ||
      (requestPayload.approvers || []).indexOf(authentication.actor.employeeId) >= 0 ||
      authentication.actor.isSuperAdmin;
    if (!canSee) Utils.fail('FORBIDDEN', 'You do not have access to this approval.');
    var actions = Database.getAllCached('Approval_Actions').filter(function (row) {
      return row.approval_id === approval.id && String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      return {
        step: Utils.numberOrZero(row.step_number), approverEmployeeId: row.approver_employee_id,
        approverName: Repo.employeeName(row.approver_employee_id), action: row.action,
        comment: row.comment || '', actedAt: Utils.toIso(row.acted_at)
      };
    });
    return {
      approval: {
        approvalId: approval.id, requestType: approval.request_type, requestTypeLabel: humanType(approval.request_type),
        requestId: approval.request_id, requesterEmployeeId: approval.requester_employee_id,
        requesterName: Repo.employeeName(approval.requester_employee_id),
        state: String(approval.status).toUpperCase(), step: Utils.numberOrZero(approval.current_step),
        approvers: (requestPayload.approvers || []).map(function (id) { return { employeeId: id, displayName: Repo.employeeName(id) }; }),
        summary: requestPayload.summary || '', payload: requestPayload.request || {},
        dueAt: Utils.toIso(approval.due_at), createdAt: Utils.toIso(approval.created_at),
        canAct: (requestPayload.approvers || []).indexOf(authentication.actor.employeeId) >= 0 && OPEN_STATES.indexOf(String(approval.status).toUpperCase()) >= 0,
        steps: requestPayload.steps || []
      },
      actions: actions
    };
  }

  function decide(authentication, payload) {
    var actor = authentication.actor;
    var action = Utils.requireEnum(payload.action, ACTIONS, 'Action');
    var approval = Repo.requireRecord('Approvals', payload.approvalId, 'Approval');
    var state = String(approval.status).toUpperCase();
    if (OPEN_STATES.indexOf(state) < 0) Utils.fail('CONFLICT', 'This request has already been decided.');
    var requestPayload = Utils.safeParseJson(approval.payload_json, {});
    var approvers = requestPayload.approvers || [];
    var isAssigned = approvers.indexOf(actor.employeeId) >= 0;
    var comment = Utils.cleanString(payload.comment).slice(0, 4000);
    var isOverride = false;

    if (action === 'CANCEL') {
      if (approval.requester_employee_id !== actor.employeeId && !actor.isSuperAdmin) Utils.fail('FORBIDDEN', 'Only the requester or an administrator can cancel this request.');
    } else if (!isAssigned) {
      var override = Permissions.check(actor, 'workflow.override', approval, {
        entity: 'Approvals', write: true, featureKey: 'workflow_override', context: {}
      });
      isOverride = Boolean(override);
    }
    if (action === 'REJECT' || action === 'RETURN' || isOverride) {
      if (comment.length < 5) Utils.fail('VALIDATION', 'A reason of at least 5 characters is required for this decision.');
    }
    if (approval.requester_employee_id === actor.employeeId && approval.request_type === 'payroll') {
      Utils.fail('FORBIDDEN', 'You cannot approve your own payroll run.');
    }

    var newState = 'PENDING';
    var nextStep = Utils.numberOrZero(approval.current_step);
    var steps = requestPayload.steps || [];
    if (action === 'APPROVE') {
      var remaining = steps.filter(function (step) { return Utils.numberOrZero(step.step) > nextStep; });
      if (remaining.length) {
        nextStep = Utils.numberOrZero(remaining[0].step);
        var nextRule = remaining[0].rule || defaultRule(approval.request_type);
        var nextApprovers = resolveApproverIds(nextRule, approval.requester_employee_id, {});
        if (!nextApprovers.length) {
          if (!Settings.bool('WORKFLOW_ALLOW_SELF_APPROVAL', false)) Utils.fail('CONFLICT', 'The next approval step has no approver configured.');
          nextApprovers = [approval.requester_employee_id];
        }
        requestPayload.approvers = nextApprovers;
        var slaHours = Utils.numberOrZero(remaining[0].slaHours) || Settings.number('WORKFLOW_DEFAULT_SLA_HOURS', 48);
        Database.update('Approvals', approval.id, {
          current_step: nextStep,
          payload_json: JSON.stringify(requestPayload),
          due_at: Utils.addSeconds(new Date(), slaHours * 3600)
        }, actor.employeeId);
        notifyApprovers(nextApprovers, approval, approval.request_type, requestPayload.summary);
      } else {
        newState = 'APPROVED';
        Database.update('Approvals', approval.id, { status: 'APPROVED', payload_json: JSON.stringify(requestPayload) }, actor.employeeId);
      }
    } else if (action === 'REJECT') {
      newState = 'REJECTED';
      Database.update('Approvals', approval.id, { status: 'REJECTED' }, actor.employeeId);
    } else if (action === 'RETURN') {
      newState = 'RETURNED';
      Database.update('Approvals', approval.id, { status: 'RETURNED' }, actor.employeeId);
    } else {
      newState = 'CANCELLED';
      Database.update('Approvals', approval.id, { status: 'CANCELLED' }, actor.employeeId);
    }
    Database.insert('Approval_Actions', {
      approval_id: approval.id,
      step_number: Utils.numberOrZero(approval.current_step),
      approver_employee_id: actor.employeeId,
      action: action + (isOverride ? '_OVERRIDE' : ''),
      comment: comment,
      acted_at: Utils.nowIso()
    }, actor.employeeId);
    Audit.logEvent('APPROVAL_' + action, actor.employeeId, 'Approvals', approval.id, 'SUCCESS', {
      requestType: approval.request_type, requestId: approval.request_id, override: isOverride, comment: comment
    }, {});

    if (newState !== 'PENDING') {
      applyDecision(approval, newState, authentication, comment);
    } else if (typeof Notifications !== 'undefined') {
      Notifications.push(approval.requester_employee_id, 'APPROVAL', 'Request moved to the next step', humanType(approval.request_type) + ' is still awaiting approval.', 'requests');
    }
    return { approvalId: approval.id, state: newState, step: nextStep };
  }

  /** Module hooks keep business effects out of the engine. */
  function applyDecision(approval, state, authentication, comment) {
    var handler = null;
    if (approval.request_type === 'leave' && typeof Leave !== 'undefined' && Leave.onDecision) handler = Leave.onDecision;
    else if (approval.request_type === 'regularization' && typeof Attendance !== 'undefined' && Attendance.onDecision) handler = Attendance.onDecision;
    else if (approval.request_type === 'expense' && typeof Money !== 'undefined' && Money.onExpenseDecision) handler = Money.onExpenseDecision;
    else if (approval.request_type === 'advance' && typeof Money !== 'undefined' && Money.onAdvanceDecision) handler = Money.onAdvanceDecision;
    else if (approval.request_type === 'document' && typeof Documents !== 'undefined' && Documents.onDecision) handler = Documents.onDecision;
    else if (approval.request_type === 'offer' && typeof Recruitment !== 'undefined' && Recruitment.onOfferDecision) handler = Recruitment.onOfferDecision;
    else if (approval.request_type === 'exit' && typeof Exit !== 'undefined' && Exit.onDecision) handler = Exit.onDecision;
    else if (approval.request_type === 'employee_change' && typeof Employees !== 'undefined' && Employees.onDecision) handler = Employees.onDecision;
    else if (approval.request_type === 'salary_revision' && typeof Payroll !== 'undefined' && Payroll.onRevisionDecision) handler = Payroll.onRevisionDecision;
    if (handler) {
      try {
        handler(approval, state, authentication, comment);
      } catch (error) {
        // The decision is already recorded; a side-effect failure is logged for follow-up.
        Audit.logEvent('APPROVAL_SIDE_EFFECT_FAILED', authentication.actor.employeeId, 'Approvals', approval.id, 'FAILED', {
          requestType: approval.request_type, message: String(error && error.message || error)
        }, {});
      }
    }
    if (typeof Notifications !== 'undefined') {
      var labels = { APPROVED: 'approved', REJECTED: 'rejected', RETURNED: 'returned for changes', CANCELLED: 'cancelled' };
      Notifications.push(approval.requester_employee_id, 'APPROVAL',
        'Request ' + (labels[state] || state.toLowerCase()),
        humanType(approval.request_type) + ' was ' + (labels[state] || state.toLowerCase()) + '.' + (comment ? ' Note: ' + comment : ''),
        'requests');
    }
  }

  function cancelForRequest(requestType, requestId, actorId) {
    Database.updateMany('Approvals', function (row) {
      return row.request_type === requestType && String(row.request_id) === String(requestId) && OPEN_STATES.indexOf(String(row.status).toUpperCase()) >= 0;
    }, { status: 'CANCELLED' }, actorId || 'SYSTEM');
  }

  function statusFor(requestType, requestId) {
    var rows = Database.getAllCached('Approvals').filter(function (row) {
      return row.request_type === requestType && String(row.request_id) === String(requestId) && String(row.status).toUpperCase() !== 'DELETED';
    });
    if (!rows.length) return null;
    rows.sort(function (left, right) { return String(right.created_at).localeCompare(String(left.created_at)); });
    return rows[0];
  }

  function definitions(authentication, payload) {
    var definitionsRows = Database.getAllCached('Workflow_Definitions').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(function (row) {
      var steps = stepsFor(row.id).map(function (step) {
        return {
          step: Utils.numberOrZero(step.step_number), type: step.step_type || 'APPROVAL',
          rule: Utils.safeParseJson(step.approver_rule_json, {}), slaHours: Utils.numberOrZero(step.sla_hours)
        };
      });
      return {
        id: row.id, requestType: row.request_type, version: Utils.numberOrZero(row.version),
        name: row.name, publishedAt: Utils.toIso(row.published_at), steps: steps,
        active: String(row.status).toUpperCase() === 'ACTIVE'
      };
    });
    var types = Utils.csvUnique(definitionsRows.map(function (row) { return row.requestType; }));
    var requestTypes = ['leave', 'regularization', 'expense', 'advance', 'salary_revision', 'payroll', 'document', 'offer', 'exit', 'employee_change', 'performance', 'asset'];
    return { definitions: definitionsRows, requestTypes: Utils.csvUnique(requestTypes.concat(types)) };
  }

  function saveDefinition(authentication, payload) {
    var requestType = Utils.requireString(payload, 'requestType', { max: 100, pattern: /^[a-z][a-z0-9_]{1,60}$/ });
    var name = Utils.requireString(payload, 'name', { max: 160 });
    var steps = payload.steps;
    if (!Array.isArray(steps) || !steps.length || steps.length > 10) Utils.fail('VALIDATION', 'Between one and ten approval steps are required.');
    var existing = definitionFor(requestType);
    var version = existing && String(payload.replaceActive).toUpperCase() === 'TRUE' ? Utils.numberOrZero(existing.version) : Utils.numberOrZero(existing ? existing.version : 0) + 1;
    if (existing && version === Utils.numberOrZero(existing.version)) {
      Database.update('Workflow_Definitions', existing.id, { name: name, published_at: Utils.nowIso() }, authentication.actor.employeeId);
      Database.updateMany('Workflow_Steps', function (row) { return row.workflow_id === existing.id; }, { status: 'DELETED' }, authentication.actor.employeeId);
      writeSteps(existing.id, steps, authentication.actor.employeeId);
      Audit.logEvent('WORKFLOW_UPDATED', authentication.actor.employeeId, 'Workflow_Definitions', existing.id, 'SUCCESS', { requestType: requestType, version: version }, {});
      return { workflowId: existing.id, version: version };
    }
    var record = Database.insert('Workflow_Definitions', {
      request_type: requestType, version: version, name: name,
      definition_json: JSON.stringify({ steps: steps }), published_at: Utils.nowIso(), status: 'ACTIVE'
    }, authentication.actor.employeeId);
    writeSteps(record.id, steps, authentication.actor.employeeId);
    Audit.logEvent('WORKFLOW_PUBLISHED', authentication.actor.employeeId, 'Workflow_Definitions', record.id, 'SUCCESS', { requestType: requestType, version: version, steps: steps.length }, {});
    return { workflowId: record.id, version: version };
  }

  function writeSteps(workflowId, steps, actorId) {
    steps.forEach(function (step, index) {
      var rule = step.rule && typeof step.rule === 'object' ? step.rule : { type: 'permission', permission: 'workflow.override' };
      Database.insert('Workflow_Steps', {
        workflow_id: workflowId,
        step_number: index + 1,
        step_type: Utils.cleanString(step.type) || 'APPROVAL',
        approver_rule_json: JSON.stringify(rule),
        conditions_json: JSON.stringify(step.conditions || {}),
        sla_hours: Utils.requireNumber(step.slaHours === undefined ? Settings.number('WORKFLOW_DEFAULT_SLA_HOURS', 48) : step.slaHours, 'SLA hours', { min: 1, max: 720 }),
        escalation_json: JSON.stringify(step.escalation || {})
      }, actorId);
    });
  }

  return {
    ACTIONS: ACTIONS,
    definitionFor: definitionFor,
    stepsFor: stepsFor,
    resolveApproverIds: resolveApproverIds,
    start: start,
    inbox: inbox,
    detail: detail,
    decide: decide,
    cancelForRequest: cancelForRequest,
    statusFor: statusFor,
    definitions: definitions,
    saveDefinition: saveDefinition,
    openForApprover: openForApprover,
    humanType: humanType,
    defaultRule: defaultRule
  };
})();
