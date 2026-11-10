/** Performance cycles, goals, self review and manager review with weighted scoring. */
var Performance = (function () {
  function scale() {
    return Settings.number('PERFORMANCE_RATING_SCALE', 5);
  }

  function cycleShape(row, actors) {
    var goals = Utils.safeParseJson(row.goals_json, {});
    var review = Utils.safeParseJson(row.review_json, {});
    return {
      id: row.id, cycleId: row.cycle_id || '', cycleName: row.cycle_name,
      employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
      department: (Repo.employee(row.employee_id) || {}).department || '',
      reviewerEmployeeId: row.reviewer_employee_id || '',
      reviewerName: Repo.employeeName(row.reviewer_employee_id),
      goals: Array.isArray(goals.items) ? goals.items : [],
      selfReview: review.self || null,
      managerReview: review.manager || null,
      state: String(row.review_state || 'GOALS_SET').toUpperCase(),
      selfRating: Utils.numberOrZero(review.self ? review.self.overallRating : 0),
      managerRating: Utils.numberOrZero(review.manager ? review.manager.overallRating : 0),
      finalRating: Utils.numberOrZero(review.finalRating),
      createdAt: Utils.toIso(row.created_at)
    };
  }

  function list(authentication, payload) {
    var actor = authentication.actor;
    var scope = Utils.cleanString(payload.scope || 'mine');
    var rows = Database.getAllCached('Performance').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (scope === 'mine') return row.employee_id === actor.employeeId;
      if (scope === 'review') return row.reviewer_employee_id === actor.employeeId;
      return actor.isSuperAdmin || actor.permissions.indexOf('performance.view') >= 0 || Repo.canSeeEmployee(actor, row.employee_id);
    });
    if (payload.cycleName) rows = rows.filter(function (row) { return row.cycle_name === payload.cycleName; });
    if (payload.state) rows = rows.filter(function (row) { return String(row.review_state).toUpperCase() === String(payload.state).toUpperCase(); });
    var items = rows.map(function (row) { return cycleShape(row, actor); });
    var cycles = Utils.csvUnique(items.map(function (item) { return item.cycleName; }));
    var paged = Utils.paginate(items, payload, { searchFields: ['employeeName', 'cycleName', 'state'], sortFields: ['employeeName', 'cycleName', 'state'], maxPageSize: 300 });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      cycles: cycles, scale: scale(),
      stats: {
        total: items.length,
        goalsSet: items.filter(function (item) { return item.state === 'GOALS_SET'; }).length,
        selfDone: items.filter(function (item) { return item.state === 'SELF_REVIEW'; }).length,
        managerDone: items.filter(function (item) { return item.state === 'MANAGER_REVIEW'; }).length,
        completed: items.filter(function (item) { return item.state === 'COMPLETED'; }).length
      },
      maxGoals: Settings.number('PERFORMANCE_MAX_GOALS', 8),
      requireSelfReview: Settings.bool('PERFORMANCE_REQUIRE_SELF_REVIEW', true),
      selfWeight: Settings.number('PERFORMANCE_REVIEW_WEIGHT', 20)
    };
  }

  function ensureRecord(authentication, payload) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || authentication.actor.employeeId);
    var cycleName = Utils.requireString(payload, 'cycleName', { max: 160 });
    var existing = Database.findOne('Performance', function (row) {
      return row.employee_id === employeeId && row.cycle_name === cycleName && String(row.status).toUpperCase() !== 'DELETED';
    }, { cached: true });
    if (existing) return existing;
    var employee = Repo.requireEmployee(employeeId);
    return Database.insert('Performance', {
      cycle_id: Utils.shortId('cycle', 10), cycle_name: cycleName, employee_id: employeeId,
      reviewer_employee_id: employee.reporting_manager_id || '',
      goals_json: JSON.stringify({ items: [] }), review_json: JSON.stringify({}), review_state: 'GOALS_SET'
    }, authentication.actor.employeeId);
  }

  function openCycle(authentication, payload) {
    var cycleName = Utils.requireString(payload, 'cycleName', { max: 160 });
    var employeeIds = Array.isArray(payload.employeeIds) && payload.employeeIds.length
      ? payload.employeeIds.map(function (id) { return Utils.normalizeEmployeeId(id); })
      : Repo.activeEmployees().map(function (row) { return Repo.employeeKey(row); });
    if (employeeIds.length > 1000) Utils.fail('VALIDATION', 'Too many employees for one cycle.');
    var created = 0;
    employeeIds.forEach(function (employeeId) {
      var already = Database.findOne('Performance', function (row) {
        return row.employee_id === employeeId && row.cycle_name === cycleName && String(row.status).toUpperCase() !== 'DELETED';
      }, { cached: true });
      if (already) return;
      ensureRecord(authentication, { employeeId: employeeId, cycleName: cycleName });
      created += 1;
    });
    Audit.logEvent('PERFORMANCE_CYCLE_OPENED', authentication.actor.employeeId, 'Performance', cycleName, 'SUCCESS', { created: created }, {});
    return { cycleName: cycleName, created: created };
  }

  function saveGoals(authentication, payload) {
    var record = Repo.requireRecord('Performance', payload.id, 'Review');
    var actor = authentication.actor;
    if (record.employee_id !== actor.employeeId && record.reviewer_employee_id !== actor.employeeId && !actor.isSuperAdmin) {
      Utils.fail('FORBIDDEN', 'You cannot change these goals.');
    }
    if (['COMPLETED'].indexOf(String(record.review_state).toUpperCase()) >= 0) Utils.fail('CONFLICT', 'This review is already completed.');
    var goals = payload.goals;
    if (!Array.isArray(goals)) Utils.fail('VALIDATION', 'Goals must be a list.');
    if (goals.length > Settings.number('PERFORMANCE_MAX_GOALS', 8)) Utils.fail('VALIDATION', 'At most ' + Settings.number('PERFORMANCE_MAX_GOALS', 8) + ' goals are allowed.');
    var clean = goals.map(function (goal) {
      return {
        id: Utils.cleanString(goal.id) || Utils.shortId('goal', 8),
        title: Utils.requireString(goal, 'title', { max: 200 }),
        description: Utils.cleanString(goal.description).slice(0, 1000),
        weight: Utils.requireNumber(goal.weight === '' || goal.weight === undefined ? 0 : goal.weight, 'Weight', { min: 0, max: 100 }),
        target: Utils.cleanString(goal.target).slice(0, 300),
        achievement: Utils.cleanString(goal.achievement).slice(0, 300),
        selfRating: Utils.requireNumber(goal.selfRating || 0, 'Self rating', { min: 0, max: scale() }),
        managerRating: Utils.requireNumber(goal.managerRating || 0, 'Manager rating', { min: 0, max: scale() }),
        status: Utils.cleanString(goal.status) || 'IN_PROGRESS'
      };
    });
    var totalWeight = clean.reduce(function (sum, goal) { return sum + goal.weight; }, 0);
    if (clean.length && totalWeight > 0 && Math.abs(totalWeight - 100) > 0.01) Utils.fail('VALIDATION', 'Goal weights must total 100%.');
    Database.update('Performance', record.id, { goals_json: JSON.stringify({ items: clean }) }, actor.employeeId);
    Audit.logEvent('PERFORMANCE_GOALS_SAVED', actor.employeeId, 'Performance', record.id, 'SUCCESS', { goals: clean.length }, {});
    return { id: record.id, goals: clean };
  }

  function submitSelfReview(authentication, payload) {
    var record = Repo.requireRecord('Performance', payload.id, 'Review');
    if (record.employee_id !== authentication.actor.employeeId) Utils.fail('FORBIDDEN', 'Only the employee can submit this self review.');
    var rating = Utils.requireNumber(payload.rating, 'Overall rating', { min: 1, max: scale() });
    var review = Utils.safeParseJson(record.review_json, {});
    review.self = {
      overallRating: rating,
      strengths: Utils.cleanString(payload.strengths).slice(0, 4000),
      improvements: Utils.cleanString(payload.improvements).slice(0, 4000),
      achievements: Utils.cleanString(payload.achievements).slice(0, 4000),
      submittedAt: Utils.nowIso()
    };
    Database.update('Performance', record.id, { review_json: JSON.stringify(review), review_state: 'SELF_REVIEW' }, authentication.actor.employeeId);
    if (record.reviewer_employee_id && typeof Notifications !== 'undefined') {
      Notifications.push(record.reviewer_employee_id, 'PERFORMANCE', 'Self review submitted',
        (Repo.employeeName(record.employee_id) || '') + ' submitted a self review for ' + record.cycle_name, 'performance');
    }
    Audit.logEvent('PERFORMANCE_SELF_REVIEW', authentication.actor.employeeId, 'Performance', record.id, 'SUCCESS', { rating: rating }, {});
    return { id: record.id, state: 'SELF_REVIEW' };
  }

  function submitManagerReview(authentication, payload) {
    var record = Repo.requireRecord('Performance', payload.id, 'Review');
    var actor = authentication.actor;
    if (record.reviewer_employee_id !== actor.employeeId && !actor.isSuperAdmin && actor.permissions.indexOf('performance.approve') < 0) {
      Utils.fail('FORBIDDEN', 'You are not the reviewer for this employee.');
    }
    if (Settings.bool('PERFORMANCE_REQUIRE_SELF_REVIEW', true) && String(record.review_state).toUpperCase() === 'GOALS_SET') {
      Utils.fail('CONFLICT', 'The employee must submit a self review first.');
    }
    var rating = Utils.requireNumber(payload.rating, 'Overall rating', { min: 1, max: scale() });
    var review = Utils.safeParseJson(record.review_json, {});
    review.manager = {
      overallRating: rating,
      strengths: Utils.cleanString(payload.strengths).slice(0, 4000),
      improvements: Utils.cleanString(payload.improvements).slice(0, 4000),
      comments: Utils.cleanString(payload.comments).slice(0, 4000),
      recommendedForPromotion: payload.recommendedForPromotion === true,
      submittedAt: Utils.nowIso(),
      reviewerEmployeeId: actor.employeeId
    };
    var weight = Settings.number('PERFORMANCE_REVIEW_WEIGHT', 20) / 100;
    var selfRating = Utils.numberOrZero(review.self ? review.self.overallRating : rating);
    review.finalRating = Utils.round2(rating * (1 - weight) + selfRating * weight);
    var state = payload.complete === true ? 'COMPLETED' : 'MANAGER_REVIEW';
    Database.update('Performance', record.id, { review_json: JSON.stringify(review), review_state: state }, actor.employeeId);
    if (typeof Notifications !== 'undefined') {
      Notifications.push(record.employee_id, 'PERFORMANCE', 'Review ' + state.toLowerCase().replace('_', ' '),
        'Your ' + record.cycle_name + ' review has been updated.', 'performance');
    }
    Audit.logEvent('PERFORMANCE_MANAGER_REVIEW', actor.employeeId, 'Performance', record.id, 'SUCCESS', { rating: rating, finalRating: review.finalRating }, {});
    return { id: record.id, state: state, finalRating: review.finalRating };
  }

  function detail(authentication, payload) {
    var record = Repo.requireRecord('Performance', payload.id, 'Review');
    var actor = authentication.actor;
    var isOwner = record.employee_id === actor.employeeId;
    var canReview = record.reviewer_employee_id === actor.employeeId || actor.isSuperAdmin || actor.permissions.indexOf('performance.approve') >= 0;
    if (!isOwner && !canReview && actor.permissions.indexOf('performance.view') < 0) Utils.fail('FORBIDDEN', 'You cannot view this review.');
    return { review: cycleShape(record, actor), canReview: canReview, isOwner: isOwner, scale: scale() };
  }

  return {
    list: list,
    openCycle: openCycle,
    saveGoals: saveGoals,
    submitSelfReview: submitSelfReview,
    submitManagerReview: submitManagerReview,
    detail: detail,
    ensureRecord: ensureRecord
  };
})();
