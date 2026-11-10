/** Expenses, loans and salary advances with approval and disbursement tracking. */
var Money = (function () {
  var EXPENSE_CATEGORIES = ['TRAVEL', 'FOOD', 'ACCOMMODATION', 'LOCAL_TRANSPORT', 'COMMUNICATION', 'OFFICE_SUPPLIES', 'TRAINING', 'MEDICAL', 'CLIENT_ENTERTAINMENT', 'OTHER'];

  function expenseShape(row) {
    var approval = Workflow.statusFor('expense', row.id);
    var stored = String(row.approval_state || '').toUpperCase();
    // A recorded payment outranks the approval decision that led to it.
    var state = stored === 'PAID' ? 'PAID'
      : (approval ? String(approval.status).toUpperCase() : (stored || String(row.status || 'PENDING').toUpperCase()));
    return {
      id: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
      expenseDate: String(row.expense_date).slice(0, 10), category: row.category,
      amount: Utils.numberOrZero(row.amount), description: row.description || '',
      receiptAttached: Boolean(row.receipt_file_id), state: state,
      paidAt: Utils.toIso(row.paid_at), paymentReference: row.payment_reference || '',
      createdAt: Utils.toIso(row.created_at)
    };
  }

  function expenseList(authentication, payload) {
    var actor = authentication.actor;
    var scope = Utils.cleanString(payload.scope || 'mine');
    var items = Database.getAllCached('Expenses').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (scope === 'mine') return row.employee_id === actor.employeeId;
      if (scope === 'team') return Repo.canSeeEmployee(actor, row.employee_id);
      return actor.isSuperAdmin || actor.permissions.indexOf('expense.view') >= 0 || Repo.canSeeEmployee(actor, row.employee_id);
    }).map(expenseShape);
    if (payload.state) items = items.filter(function (item) { return item.state === String(payload.state).toUpperCase(); });
    if (payload.month) items = items.filter(function (item) { return item.expenseDate.slice(0, 7) === payload.month; });
    items.sort(function (left, right) { return right.expenseDate.localeCompare(left.expenseDate); });
    var totals = {
      pending: Utils.round2(items.filter(function (item) { return item.state === 'PENDING'; }).reduce(function (sum, item) { return sum + item.amount; }, 0)),
      approved: Utils.round2(items.filter(function (item) { return item.state === 'APPROVED'; }).reduce(function (sum, item) { return sum + item.amount; }, 0)),
      paid: Utils.round2(items.filter(function (item) { return item.state === 'PAID'; }).reduce(function (sum, item) { return sum + item.amount; }, 0)),
      rejected: Utils.round2(items.filter(function (item) { return item.state === 'REJECTED'; }).reduce(function (sum, item) { return sum + item.amount; }, 0))
    };
    var paged = Utils.paginate(items, payload, { searchFields: ['employeeName', 'description', 'category'], sortFields: ['expenseDate', 'amount', 'state'], maxPageSize: 300 });
    var loans = loanList(authentication, { scope: scope === 'mine' ? 'mine' : 'all' });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      totals: totals, categories: EXPENSE_CATEGORIES, loans: loans.items, loanStats: loans.stats,
      canApprove: actor.isSuperAdmin || actor.permissions.indexOf('expense.approve') >= 0,
      canPay: actor.isSuperAdmin || actor.permissions.indexOf('advance.disburse') >= 0,
      canRequestLoan: actor.isSuperAdmin || actor.permissions.indexOf('advance.apply') >= 0
    };
  }

  function submitExpense(authentication, payload) {
    var actor = authentication.actor;
    if (!Permissions.isFeatureEnabled('expenses')) Utils.fail('FORBIDDEN', 'Expenses are disabled.');
    var amount = Utils.requireNumber(payload.amount, 'Amount', { min: 1, max: 10000000 });
    var category = Utils.requireEnum(payload.category || 'OTHER', EXPENSE_CATEGORIES, 'Category');
    var expenseDate = Utils.requireDate(payload.expenseDate, 'Expense date', { noFuture: true });
    if (Utils.dayDiff(expenseDate, Utils.today()) > 120) Utils.fail('VALIDATION', 'Expenses older than 120 days cannot be submitted.');
    var receipt = Utils.cleanString(payload.receiptFileId);
    if (amount > 500 && !receipt) Utils.fail('VALIDATION', 'A receipt is required for claims above ₹500.');
    var record = Database.insert('Expenses', {
      employee_id: actor.employeeId, expense_date: expenseDate, category: category, amount: amount,
      description: Utils.requireString(payload, 'description', { max: 4000, min: 5 }),
      receipt_file_id: receipt, approval_state: 'PENDING', status: 'ACTIVE'
    }, actor.employeeId);
    var autoApprove = Settings.number('WORKFLOW_AUTO_APPROVE_SMALL_AMOUNTS', 0);
    if (autoApprove > 0 && amount <= autoApprove) {
      Database.update('Expenses', record.id, { approval_state: 'APPROVED' }, actor.employeeId);
      return { expenseId: record.id, state: 'APPROVED' };
    }
    Workflow.start(authentication, 'expense', record.id, { amount: amount, category: category }, {
      summary: category + ' claim of ₹' + amount
    });
    Audit.logEvent('EXPENSE_SUBMITTED', actor.employeeId, 'Expenses', record.id, 'SUCCESS', { amount: amount, category: category }, {});
    return { expenseId: record.id, state: 'PENDING' };
  }

  function onExpenseDecision(approval, state, authentication) {
    var expense = Repo.find('Expenses', approval.request_id);
    if (!expense) return;
    var changes = { approval_state: state, approval_id: approval.id };
    if (state === 'REJECTED') changes.status = 'REJECTED';
    Database.update('Expenses', expense.id, changes, authentication.actor.employeeId);
  }

  function payExpense(authentication, payload) {
    var expense = Repo.requireRecord('Expenses', payload.expenseId, 'Expense');
    if (String(expense.approval_state).toUpperCase() !== 'APPROVED') Utils.fail('CONFLICT', 'Only an approved claim can be marked paid.');
    var reference = Utils.requireString(payload, 'reference', { max: 128, min: 2 });
    Database.update('Expenses', expense.id, { approval_state: 'PAID', paid_at: Utils.nowIso(), payment_reference: reference }, authentication.actor.employeeId);
    Audit.logEvent('EXPENSE_PAID', authentication.actor.employeeId, 'Expenses', expense.id, 'SUCCESS', { reference: reference, amount: expense.amount }, {});
    return { paid: true };
  }

  function loanShape(row) {
    var approval = Workflow.statusFor('advance', row.id);
    var ledger = Utils.safeParseJson(row.ledger_json, { instalments: [] });
    var repaid = (ledger.instalments || []).reduce(function (sum, entry) { return sum + Utils.numberOrZero(entry.amount); }, 0);
    return {
      id: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
      requestType: String(row.request_type || 'ADVANCE').toUpperCase(),
      principal: Utils.numberOrZero(row.principal_amount), emi: Utils.numberOrZero(row.emi_amount),
      emiCount: Utils.numberOrZero(row.emi_count), disbursed: Utils.numberOrZero(row.disbursed_amount),
      outstanding: Utils.round2(Math.max(0, Utils.numberOrZero(row.disbursed_amount) - repaid)),
      repaid: Utils.round2(repaid), reason: row.reason || '',
      state: approval ? String(approval.status).toUpperCase() : String(row.approval_state || 'PENDING').toUpperCase(),
      instalments: ledger.instalments || [], createdAt: Utils.toIso(row.created_at)
    };
  }

  function loanList(authentication, payload) {
    var actor = authentication.actor;
    var scope = Utils.cleanString(payload.scope || 'mine');
    var items = Database.getAllCached('Loans_Advances').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (scope === 'mine') return row.employee_id === actor.employeeId;
      return actor.isSuperAdmin || actor.permissions.indexOf('advance.view') >= 0 || Repo.canSeeEmployee(actor, row.employee_id);
    }).map(loanShape);
    var stats = {
      outstanding: Utils.round2(items.reduce(function (sum, item) { return sum + item.outstanding; }, 0)),
      disbursed: Utils.round2(items.reduce(function (sum, item) { return sum + item.disbursed; }, 0)),
      pending: items.filter(function (item) { return item.state === 'PENDING'; }).length
    };
    return { items: items, stats: stats };
  }

  function requestLoan(authentication, payload) {
    var actor = authentication.actor;
    if (!Permissions.isFeatureEnabled('advances')) Utils.fail('FORBIDDEN', 'Loans and advances are disabled.');
    var requestType = Utils.requireEnum(payload.requestType || 'ADVANCE', ['ADVANCE', 'LOAN'], 'Request type');
    var principal = Utils.requireNumber(payload.principal, 'Amount', { min: 500, max: 5000000 });
    var emiCount = requestType === 'LOAN' ? Utils.requireNumber(payload.emiCount || 1, 'Instalments', { integer: true, min: 1, max: 60 }) : 1;
    var emi = Utils.round2(principal / emiCount);
    var outstanding = loanList(authentication, { scope: 'mine' }).items.filter(function (item) { return item.state === 'APPROVED'; });
    var totalOutstanding = outstanding.reduce(function (sum, item) { return sum + item.outstanding; }, 0);
    if (totalOutstanding + principal > 500000) Utils.fail('VALIDATION', 'The total outstanding advance cannot exceed ₹5,00,000.');
    var record = Database.insert('Loans_Advances', {
      employee_id: actor.employeeId, request_type: requestType, principal_amount: principal,
      emi_amount: emi, emi_count: emiCount, disbursed_amount: 0,
      reason: Utils.requireString(payload, 'reason', { max: 1000, min: 10 }),
      ledger_json: JSON.stringify({ instalments: [] }), approval_state: 'PENDING', status: 'ACTIVE'
    }, actor.employeeId);
    Workflow.start(authentication, 'advance', record.id, { amount: principal, requestType: requestType }, {
      summary: requestType + ' request of ₹' + principal
    });
    Audit.logEvent('ADVANCE_REQUESTED', actor.employeeId, 'Loans_Advances', record.id, 'SUCCESS', { amount: principal, type: requestType }, {});
    return { loanId: record.id };
  }

  function onAdvanceDecision(approval, state, authentication) {
    var loan = Repo.find('Loans_Advances', approval.request_id);
    if (!loan) return;
    Database.update('Loans_Advances', loan.id, { approval_state: state, approval_id: approval.id }, authentication.actor.employeeId);
  }

  function disburseLoan(authentication, payload) {
    var loan = Repo.requireRecord('Loans_Advances', payload.loanId, 'Loan');
    if (String(loan.approval_state).toUpperCase() !== 'APPROVED') Utils.fail('CONFLICT', 'Only an approved request can be disbursed.');
    if (Utils.numberOrZero(loan.disbursed_amount) > 0) Utils.fail('CONFLICT', 'This request has already been disbursed.');
    var amount = Utils.requireNumber(payload.amount === undefined ? loan.principal_amount : payload.amount, 'Disbursed amount', { min: 1, max: Utils.numberOrZero(loan.principal_amount) });
    var reference = Utils.requireString(payload, 'reference', { max: 128, min: 2 });
    Database.update('Loans_Advances', loan.id, {
      disbursed_amount: amount,
      ledger_json: JSON.stringify({ instalments: [], disbursedAt: Utils.nowIso(), reference: reference })
    }, authentication.actor.employeeId);
    Audit.logEvent('ADVANCE_DISBURSED', authentication.actor.employeeId, 'Loans_Advances', loan.id, 'SUCCESS', { amount: amount, reference: reference }, {});
    return { disbursed: amount };
  }

  /** Quick stats for the employee dashboard. */
  function overview(authentication) {
    var actor = authentication.actor;
    var expenses = Database.getAllCached('Expenses').filter(function (row) {
      return row.employee_id === actor.employeeId && String(row.status).toUpperCase() !== 'DELETED';
    }).map(expenseShape);
    var loans = loanList(authentication, { scope: 'mine' });
    return {
      pendingExpenses: expenses.filter(function (item) { return item.state === 'PENDING'; }).length,
      approvedExpenses: Utils.round2(expenses.filter(function (item) { return item.state === 'APPROVED'; }).reduce(function (sum, item) { return sum + item.amount; }, 0)),
      outstandingAdvance: loans.stats.outstanding,
      categories: EXPENSE_CATEGORIES
    };
  }

  return {
    EXPENSE_CATEGORIES: EXPENSE_CATEGORIES,
    expenseList: expenseList,
    submitExpense: submitExpense,
    onExpenseDecision: onExpenseDecision,
    payExpense: payExpense,
    loanList: loanList,
    requestLoan: requestLoan,
    onAdvanceDecision: onAdvanceDecision,
    disburseLoan: disburseLoan,
    overview: overview
  };
})();
