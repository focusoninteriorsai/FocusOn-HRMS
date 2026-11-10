/**
 * FOCUSON HRMS - Expenses, Advances & Loans Engine (Google Apps Script)
 * Expense claims with receipt storage, EMI tracking, and workflow approvals.
 */

var Expenses = (function() {
  function listExpenses(actor) {
    var all = Database.getAll('Expenses');
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].employee_id === actor.employeeId || actor.isSuperAdmin) {
        filtered.push(all[i]);
      }
    }
    return filtered;
  }

  function applyExpense(payload, actor) {
    if (!payload.amount || !payload.category) {
      throw { code: 'VALIDATION', message: 'Amount and category are required.' };
    }

    var id = 'exp_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16);
    Database.insert('Expenses', {
      id: id,
      employee_id: actor.employeeId,
      category: payload.category,
      amount: parseFloat(payload.amount),
      expense_date: payload.expense_date || Utils.nowIso().substring(0, 10),
      description: payload.description || '',
      receipt_file_id: payload.receipt_file_id || ''
    }, actor.employeeId);

    // Route to approval
    Database.insert('Approvals', {
      id: 'appr_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      request_type: 'EXPENSE',
      request_id: id,
      applicant_id: actor.employeeId,
      current_step_id: 'step_mgr',
      current_approver_id: '',
      overall_status: 'PENDING'
    }, actor.employeeId);

    return { id: id, success: true };
  }

  return {
    listExpenses: listExpenses,
    applyExpense: applyExpense
  };
})();
