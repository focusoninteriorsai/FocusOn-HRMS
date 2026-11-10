/** Recruitment pipeline: openings, candidates, configurable stages, offers, hire. */
var Recruitment = (function () {
  function stages() {
    var configured = Settings.json('RECRUITMENT_STAGES', ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected']);
    return Array.isArray(configured) && configured.length ? configured.map(String) : ['Applied', 'Screening', 'Interview', 'Offer', 'Hired', 'Rejected'];
  }

  function openingShape(row) {
    var candidates = Database.getAllCached('Candidates').filter(function (candidate) {
      return candidate.opening_id === row.id && String(candidate.status).toUpperCase() !== 'DELETED';
    });
    return {
      id: row.id, code: row.opening_code, title: row.title,
      departmentId: row.department_id || '', department: Repo.label('Departments', row.department_id),
      designationId: row.designation_id || '', designation: Repo.label('Designations', row.designation_id),
      branchId: row.branch_id || '', branch: Repo.label('Branches', row.branch_id),
      headcount: Utils.numberOrZero(row.headcount) || 1,
      employmentType: row.employment_type || 'FULL_TIME',
      experienceMin: Utils.numberOrZero(row.experience_min), experienceMax: Utils.numberOrZero(row.experience_max),
      salaryMin: Utils.numberOrZero(row.salary_min), salaryMax: Utils.numberOrZero(row.salary_max),
      openingDate: String(row.opening_date || '').slice(0, 10),
      closingDate: String(row.closing_date || '').slice(0, 10),
      hiringManagerId: row.hiring_manager_id || '', hiringManager: Repo.employeeName(row.hiring_manager_id),
      description: row.description || '', requirements: row.requirements || '',
      priority: row.priority || 'NORMAL',
      state: String(row.opening_status || 'OPEN').toUpperCase(),
      candidateCount: candidates.length,
      hiredCount: candidates.filter(function (candidate) { return String(candidate.stage).toUpperCase() === 'HIRED'; }).length,
      description2: ''
    };
  }

  function candidateShape(row) {
    var interview = Utils.safeParseJson(row.interview_json, {});
    return {
      id: row.id, openingId: row.opening_id,
      openingTitle: (Repo.find('Recruitment', row.opening_id) || {}).title || '',
      name: row.name, email: row.email || '', phone: row.phone || '',
      stage: row.stage || 'Applied', source: row.source || '',
      experienceYears: Utils.numberOrZero(row.experience_years),
      currentCompany: row.current_company || '', currentCtc: Utils.numberOrZero(row.current_ctc),
      expectedCtc: Utils.numberOrZero(row.expected_ctc), noticePeriod: Utils.numberOrZero(row.notice_period_days),
      resumeFileId: row.resume_file_id || '', notes: row.notes || '',
      appliedAt: Utils.toIso(row.created_at),
      interviews: Array.isArray(interview.list) ? interview.list : [],
      offer: Utils.safeParseJson(row.onboarding_json, {}),
      rating: Utils.numberOrZero(row.rating)
    };
  }

  function list(authentication, payload) {
    var openings = Database.getAllCached('Recruitment').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(openingShape);
    if (payload.state) openings = openings.filter(function (item) { return item.state === String(payload.state).toUpperCase(); });
    if (payload.departmentId) openings = openings.filter(function (item) { return item.departmentId === payload.departmentId; });
    var candidates = Database.getAllCached('Candidates').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED';
    }).map(candidateShape);
    if (payload.openingId) candidates = candidates.filter(function (item) { return item.openingId === payload.openingId; });
    var stageList = stages();
    var pipeline = stageList.map(function (stage) {
      return { stage: stage, count: candidates.filter(function (item) { return item.stage === stage; }).length };
    });
    var paged = Utils.paginate(candidates, payload, {
      searchFields: ['name', 'email', 'phone', 'openingTitle', 'stage'],
      sortFields: ['name', 'stage', 'appliedAt'], maxPageSize: 300
    });
    return {
      openings: openings,
      candidates: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      stages: stageList, pipeline: pipeline,
      sources: Settings.json('RECRUITMENT_SOURCES', ['Referral', 'Job portal', 'Walk-in', 'Campus', 'Agency']),
      stats: {
        openPositions: openings.filter(function (item) { return item.state === 'OPEN'; }).length,
        totalHeadcount: openings.filter(function (item) { return item.state === 'OPEN'; }).reduce(function (sum, item) { return sum + item.headcount; }, 0),
        candidates: candidates.length,
        hired: candidates.filter(function (item) { return item.stage === 'Hired'; }).length
      },
      canEdit: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('recruitment.edit') >= 0,
      canApprove: authentication.actor.isSuperAdmin || authentication.actor.permissions.indexOf('recruitment.approve') >= 0
    };
  }

  function saveOpening(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var changes = {
      opening_code: Utils.cleanString(payload.code).toUpperCase() || ('OPN' + String(Database.getAllCached('Recruitment').length + 1).padStart(4, '0')),
      title: Utils.requireString(payload, 'title', { max: 200 }),
      department_id: Utils.cleanString(payload.departmentId),
      designation_id: Utils.cleanString(payload.designationId),
      branch_id: Utils.cleanString(payload.branchId),
      headcount: Utils.requireNumber(payload.headcount === '' || payload.headcount === undefined ? 1 : payload.headcount, 'Headcount', { integer: true, min: 1, max: 200 }),
      employment_type: Utils.requireEnum(payload.employmentType || 'FULL_TIME', ['FULL_TIME', 'PART_TIME', 'CONTRACT', 'INTERN'], 'Employment type'),
      experience_min: Utils.requireNumber(payload.experienceMin || 0, 'Minimum experience', { min: 0, max: 50 }),
      experience_max: Utils.requireNumber(payload.experienceMax || 0, 'Maximum experience', { min: 0, max: 50 }),
      salary_min: Utils.requireNumber(payload.salaryMin || 0, 'Minimum salary', { min: 0 }),
      salary_max: Utils.requireNumber(payload.salaryMax || 0, 'Maximum salary', { min: 0 }),
      opening_date: Utils.cleanString(payload.openingDate) ? Utils.requireDate(payload.openingDate, 'Opening date') : Utils.today(),
      closing_date: Utils.cleanString(payload.closingDate) ? Utils.requireDate(payload.closingDate, 'Closing date') : '',
      hiring_manager_id: Utils.cleanString(payload.hiringManagerId).toUpperCase(),
      description: Utils.cleanString(payload.description).slice(0, 4000),
      requirements: Utils.cleanString(payload.requirements).slice(0, 4000),
      priority: Utils.requireEnum(payload.priority || 'NORMAL', ['LOW', 'NORMAL', 'HIGH', 'URGENT'], 'Priority'),
      opening_status: Utils.requireEnum(payload.state || 'OPEN', ['OPEN', 'ON_HOLD', 'CLOSED', 'CANCELLED'], 'Opening state')
    };
    if (changes.experience_max && changes.experience_max < changes.experience_min) Utils.fail('VALIDATION', 'Maximum experience must be at least the minimum.');
    if (changes.salary_max && changes.salary_max < changes.salary_min) Utils.fail('VALIDATION', 'Maximum salary must be at least the minimum.');
    var record = id ? Database.update('Recruitment', Repo.requireRecord('Recruitment', id, 'Opening').id, changes, authentication.actor.employeeId)
      : Database.insert('Recruitment', changes, authentication.actor.employeeId);
    Database.invalidateCache('Recruitment');
    Audit.logEvent('OPENING_SAVED', authentication.actor.employeeId, 'Recruitment', record.id, 'SUCCESS', { title: changes.title, headcount: changes.headcount }, {});
    return { id: record.id, opening: openingShape(record) };
  }

  function saveCandidate(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var openingId = Utils.cleanString(payload.openingId);
    if (!id) Repo.requireRecord('Recruitment', openingId, 'Opening');
    var stage = Utils.cleanString(payload.stage) || stages()[0];
    if (stages().indexOf(stage) < 0) Utils.fail('VALIDATION', 'Unknown selection stage.');
    var changes = {
      opening_id: openingId,
      name: Utils.requireString(payload, 'name', { max: 160 }),
      email: Utils.requireEmail(payload.email, 'Email', true),
      phone: Utils.requireMobile(payload.phone, 'Phone', true),
      stage: stage,
      source: Utils.cleanString(payload.source).slice(0, 120),
      experience_years: Utils.requireNumber(payload.experienceYears || 0, 'Experience', { min: 0, max: 60 }),
      current_company: Utils.cleanString(payload.currentCompany).slice(0, 160),
      current_ctc: Utils.requireNumber(payload.currentCtc || 0, 'Current CTC', { min: 0 }),
      expected_ctc: Utils.requireNumber(payload.expectedCtc || 0, 'Expected CTC', { min: 0 }),
      notice_period_days: Utils.requireNumber(payload.noticePeriod || 0, 'Notice period', { min: 0, max: 365 }),
      resume_file_id: Utils.cleanString(payload.resumeFileId).slice(0, 256),
      notes: Utils.cleanString(payload.notes).slice(0, 4000),
      rating: Utils.requireNumber(payload.rating || 0, 'Rating', { min: 0, max: 10 }),
      interview_json: JSON.stringify({ list: payload.interviews || [] }),
      onboarding_json: JSON.stringify(payload.offer || {})
    };
    var record = id ? Database.update('Candidates', Repo.requireRecord('Candidates', id, 'Candidate').id, changes, authentication.actor.employeeId)
      : Database.insert('Candidates', changes, authentication.actor.employeeId);
    Database.invalidateCache('Candidates');
    Audit.logEvent('CANDIDATE_SAVED', authentication.actor.employeeId, 'Candidates', record.id, 'SUCCESS', { name: changes.name, stage: stage }, {});
    return { id: record.id, candidate: candidateShape(record) };
  }

  function moveStage(authentication, payload) {
    var candidate = Repo.requireRecord('Candidates', payload.candidateId, 'Candidate');
    var stage = Utils.requireEnum(payload.stage, stages(), 'Stage');
    Database.update('Candidates', candidate.id, { stage: stage }, authentication.actor.employeeId);
    Audit.logEvent('CANDIDATE_STAGE_CHANGED', authentication.actor.employeeId, 'Candidates', candidate.id, 'SUCCESS', { from: candidate.stage, to: stage }, {});
    return { candidateId: candidate.id, stage: stage };
  }

  function scheduleInterview(authentication, payload) {
    var candidate = Repo.requireRecord('Candidates', payload.candidateId, 'Candidate');
    var interview = {
      round: Utils.cleanString(payload.round).slice(0, 80) || 'Interview',
      scheduledAt: Utils.toIso(Utils.requireString(payload, 'scheduledAt', { max: 40 })),
      mode: Utils.requireEnum(payload.mode || 'ONLINE', ['ONLINE', 'IN_PERSON', 'PHONE'], 'Mode'),
      interviewerEmployeeId: Utils.cleanString(payload.interviewerEmployeeId).toUpperCase(),
      location: Utils.cleanString(payload.location).slice(0, 300),
      notes: Utils.cleanString(payload.notes).slice(0, 1000),
      status: 'SCHEDULED'
    };
    var existing = Utils.safeParseJson(candidate.interview_json, { list: [] });
    var list = Array.isArray(existing.list) ? existing.list : [];
    list.push(interview);
    Database.update('Candidates', candidate.id, { interview_json: JSON.stringify({ list: list }) }, authentication.actor.employeeId);
    if (interview.interviewerEmployeeId && typeof Notifications !== 'undefined') {
      Notifications.push(interview.interviewerEmployeeId, 'RECRUITMENT', 'Interview scheduled: ' + candidate.name,
        interview.round + ' · ' + interview.scheduledAt, 'recruitment');
    }
    Audit.logEvent('INTERVIEW_SCHEDULED', authentication.actor.employeeId, 'Candidates', candidate.id, 'SUCCESS', { round: interview.round }, {});
    return { candidateId: candidate.id, interviews: list };
  }

  /** Offer release: optionally routed for approval before it becomes effective. */
  function releaseOffer(authentication, payload) {
    var candidate = Repo.requireRecord('Candidates', payload.candidateId, 'Candidate');
    if (String(candidate.stage) === 'Hired') Utils.fail('CONFLICT', 'This candidate is already hired.');
    var offer = {
      designationId: Utils.cleanString(payload.designationId),
      departmentId: Utils.cleanString(payload.departmentId),
      branchId: Utils.cleanString(payload.branchId),
      ctc: Utils.requireNumber(payload.ctc, 'Offered CTC', { min: 1 }),
      joiningDate: Utils.requireDate(payload.joiningDate, 'Joining date'),
      probationMonths: Utils.requireNumber(payload.probationMonths || 0, 'Probation', { min: 0, max: 24 }),
      notes: Utils.cleanString(payload.notes).slice(0, 2000),
      releasedAt: Utils.nowIso(),
      state: 'PENDING'
    };
    Database.update('Candidates', candidate.id, {
      stage: 'Offer', onboarding_json: JSON.stringify(offer)
    }, authentication.actor.employeeId);
    if (Settings.bool('RECRUITMENT_REQUIRE_OFFER_APPROVAL', true) && Permissions.isFeatureEnabled('workflow')) {
      Workflow.start(authentication, 'offer', candidate.id, { ctc: offer.ctc, joiningDate: offer.joiningDate }, {
        summary: 'Offer for ' + candidate.name + ' at ₹' + offer.ctc
      });
    } else {
      offer.state = 'RELEASED';
      Database.update('Candidates', candidate.id, { onboarding_json: JSON.stringify(offer) }, authentication.actor.employeeId);
    }
    Audit.logEvent('OFFER_RELEASED', authentication.actor.employeeId, 'Candidates', candidate.id, 'SUCCESS', { ctc: offer.ctc }, {});
    return { candidateId: candidate.id, offer: offer };
  }

  function onOfferDecision(approval, state, authentication) {
    var candidate = Repo.find('Candidates', approval.request_id);
    if (!candidate) return;
    var offer = Utils.safeParseJson(candidate.onboarding_json, {});
    offer.state = state === 'APPROVED' ? 'RELEASED' : state;
    Database.update('Candidates', candidate.id, {
      onboarding_json: JSON.stringify(offer),
      stage: state === 'APPROVED' ? 'Offer' : 'Interview'
    }, authentication.actor.employeeId);
  }

  /** Creates the employee record (and optional login) from a hired candidate. */
  function convertToEmployee(authentication, payload) {
    var candidate = Repo.requireRecord('Candidates', payload.candidateId, 'Candidate');
    var offer = Utils.safeParseJson(candidate.onboarding_json, {});
    if (String(offer.state).toUpperCase() !== 'RELEASED' && !authentication.actor.isSuperAdmin) {
      Utils.fail('CONFLICT', 'The offer must be released before conversion.');
    }
    if (candidate.converted_employee_id) Utils.fail('CONFLICT', 'This candidate has already been converted.');
    var employeeId = Utils.cleanString(payload.employeeId).toUpperCase() || Employees.nextEmployeeId();
    if (Repo.employee(employeeId)) Utils.fail('CONFLICT', 'This Employee ID is already in use.');
    var record = Database.insert('Employees', {
      id: employeeId, employee_id: employeeId, display_name: candidate.name,
      first_name: String(candidate.name).split(' ')[0], last_name: String(candidate.name).split(' ').slice(1).join(' '),
      work_email: candidate.email || '', mobile: candidate.phone || '',
      department_id: offer.departmentId || '', department: Repo.label('Departments', offer.departmentId),
      designation_id: offer.designationId || '', designation: Repo.label('Designations', offer.designationId),
      branch_id: offer.branchId || '', branch: Repo.label('Branches', offer.branchId),
      joining_date: offer.joiningDate || Utils.today(), employment_type: 'FULL_TIME',
      work_location_type: 'OFFICE', ctc_annual: Utils.numberOrZero(offer.ctc), status: 'ACTIVE'
    }, authentication.actor.employeeId);
    Database.update('Candidates', candidate.id, {
      stage: 'Hired', converted_employee_id: employeeId
    }, authentication.actor.employeeId);
    if (Utils.numberOrZero(offer.ctc) > 0) {
      var monthly = Utils.round2(Utils.numberOrZero(offer.ctc) / 12);
      Database.insert('Salary_Structure', {
        employee_id: employeeId, effective_from: offer.joiningDate || Utils.today(), effective_to: '',
        salary_type: 'MONTHLY', payable_days_divisor: 0,
        components_json: JSON.stringify(Payroll.defaultComponents(monthly))
      }, authentication.actor.employeeId);
      Database.invalidateCache('Salary_Structure');
    }
    Audit.logEvent('CANDIDATE_HIRED', authentication.actor.employeeId, 'Candidates', candidate.id, 'SUCCESS', { employeeId: employeeId, ctc: offer.ctc }, {});
    return { employeeId: employeeId };
  }

  function openingDetail(authentication, payload) {
    var row = Repo.requireRecord('Recruitment', payload.openingId, 'Opening');
    return {
      opening: openingShape(row),
      candidates: Database.getAllCached('Candidates').filter(function (candidate) {
        return candidate.opening_id === row.id && String(candidate.status).toUpperCase() !== 'DELETED';
      }).map(candidateShape)
    };
  }

  return {
    list: list,
    saveOpening: saveOpening,
    saveCandidate: saveCandidate,
    moveStage: moveStage,
    scheduleInterview: scheduleInterview,
    releaseOffer: releaseOffer,
    onOfferDecision: onOfferDecision,
    convertToEmployee: convertToEmployee,
    openingDetail: openingDetail,
    stages: stages
  };
})();
