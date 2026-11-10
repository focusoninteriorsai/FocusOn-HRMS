/**
 * Employee documents: templates with placeholders, generated letters, uploads to
 * private Drive storage, a register and download links that are authorised again.
 */
var Documents = (function () {
  var CATEGORIES = ['OFFER_LETTER', 'APPOINTMENT_LETTER', 'CONFIRMATION_LETTER', 'EXPERIENCE_LETTER', 'RELIEVING_LETTER', 'SALARY_CERTIFICATE', 'BONAFIDE_LETTER', 'WARNING_LETTER', 'POLICY_ACKNOWLEDGEMENT', 'ID_PROOF', 'EDUCATION', 'OTHER'];

  function numberFor(category, employeeId) {
    var format = Settings.text('DOCUMENT_NUMBER_FORMAT', '{PREFIX}/{TYPE}/{YYYY}/{SEQ}');
    var sequence = String(Database.getAllCached('Documents').length + 1).padStart(4, '0');
    return format
      .replace('{PREFIX}', Settings.text('DOCUMENT_DEFAULT_PREFIX', 'FOCUSON'))
      .replace('{TYPE}', String(category).replace(/_/g, '').slice(0, 6).toUpperCase())
      .replace('{YYYY}', Utils.today().slice(0, 4))
      .replace('{MM}', Utils.today().slice(5, 7))
      .replace('{SEQ}', sequence)
      .replace('{EMP}', employeeId);
  }

  function shape(row) {
    var approval = Workflow.statusFor('document', row.id);
    return {
      id: row.id, employeeId: row.employee_id, employeeName: Repo.employeeName(row.employee_id),
      category: row.category, categoryLabel: String(row.category || '').replace(/_/g, ' '),
      title: row.title || '', documentNumber: row.document_number || '',
      version: Utils.numberOrZero(row.version) || 1, fileId: row.file_id || '',
      templateId: row.template_id || '', watermark: row.watermark || '',
      state: approval ? String(approval.status).toUpperCase() : String(row.status === 'ACTIVE' ? 'ISSUED' : row.status).toUpperCase(),
      issuedAt: Utils.toIso(row.created_at), issuedBy: Repo.employeeName(row.created_by),
      expiresAt: String(row.expires_at || '').slice(0, 10), note: row.note || '',
      hasFile: Boolean(row.file_id)
    };
  }

  function list(authentication, payload) {
    var actor = authentication.actor;
    var scope = Utils.cleanString(payload.scope || 'mine');
    var items = Database.getAllCached('Documents').filter(function (row) {
      if (String(row.status).toUpperCase() === 'DELETED') return false;
      if (scope === 'mine') return row.employee_id === actor.employeeId;
      if (payload.employeeId) return row.employee_id === Utils.normalizeEmployeeId(payload.employeeId);
      return actor.isSuperAdmin || actor.permissions.indexOf('document.view') >= 0 || Repo.canSeeEmployee(actor, row.employee_id);
    }).map(shape);
    if (payload.category) items = items.filter(function (item) { return item.category === payload.category; });
    items.sort(function (left, right) { return String(right.issuedAt).localeCompare(String(left.issuedAt)); });
    var paged = Utils.paginate(items, payload, { searchFields: ['employeeName', 'documentNumber', 'title', 'categoryLabel'], sortFields: ['issuedAt', 'employeeName', 'documentNumber'], maxPageSize: 300 });
    return {
      items: paged.items, page: paged.page, pageCount: paged.pageCount, total: paged.total,
      categories: CATEGORIES,
      templates: Database.getAllCached('Doc_Templates').filter(function (row) { return String(row.status).toUpperCase() !== 'DELETED'; }).map(templateShape),
      employee: payload.employeeId ? Repo.employeeSummary(Repo.employee(payload.employeeId)) : null,
      canGenerate: actor.isSuperAdmin || actor.permissions.indexOf('document.generate') >= 0,
      canManageTemplates: actor.isSuperAdmin || actor.permissions.indexOf('document.template.manage') >= 0,
      watermark: Settings.text('DOCUMENT_WATERMARK_TEXT', ''),
      requireApproval: Settings.bool('DOCUMENT_REQUIRE_APPROVAL', false)
    };
  }

  function templateShape(row) {
    return {
      id: row.id, name: row.name, category: row.category, body: row.body || '',
      placeholders: Utils.safeParseJson(row.placeholders_json, []),
      sensitive: Utils.asBoolean(row.sensitive), googleDocId: row.google_doc_id || '',
      signatoryEmployeeId: row.signatory_employee_id || '',
      active: String(row.status).toUpperCase() === 'ACTIVE'
    };
  }

  function saveTemplate(authentication, payload) {
    var id = Utils.cleanString(payload.id);
    var changes = {
      name: Utils.requireString(payload, 'name', { max: 160 }),
      category: Utils.requireEnum(payload.category, CATEGORIES, 'Category'),
      body: Utils.requireString(payload, 'body', { max: 28000, min: 20 }),
      placeholders_json: JSON.stringify(placeholdersIn(payload.body)),
      sensitive: payload.sensitive === true,
      signatory_employee_id: Utils.cleanString(payload.signatoryEmployeeId).toUpperCase(),
      status: payload.active === false ? 'INACTIVE' : 'ACTIVE'
    };
    var record = id ? Database.update('Doc_Templates', Repo.requireRecord('Doc_Templates', id, 'Template').id, changes, authentication.actor.employeeId)
      : Database.insert('Doc_Templates', changes, authentication.actor.employeeId);
    Database.invalidateCache('Doc_Templates');
    Audit.logEvent('DOCUMENT_TEMPLATE_SAVED', authentication.actor.employeeId, 'Doc_Templates', record.id, 'SUCCESS', { name: changes.name }, {});
    return { id: record.id, template: templateShape(record) };
  }

  function placeholdersIn(body) {
    var found = [];
    var pattern = /\{\{([a-zA-Z0-9_]+)\}\}/g;
    var match;
    while ((match = pattern.exec(String(body || ''))) !== null) found.push(match[1]);
    return Utils.csvUnique(found);
  }

  function valueFor(token, employee, extra) {
    if (extra && Object.prototype.hasOwnProperty.call(extra, token)) return extra[token];
    var map = {
      employee_name: employee.display_name || '',
      employee_id: Repo.employeeKey(employee),
      designation: employee.designation || '',
      department: employee.department || '',
      branch: employee.branch || '',
      joining_date: String(employee.joining_date || '').slice(0, 10),
      work_email: employee.work_email || '',
      mobile: employee.mobile || '',
      reporting_manager: Repo.employeeName(employee.reporting_manager_id),
      pan_number: employee.pan_number || '',
      today: Utils.today(),
      company_name: Settings.text('COMPANY_NAME', 'FOCUSON HRMS'),
      company_address: Settings.text('COMPANY_ADDRESS', ''),
      company_hr_email: Settings.text('COMPANY_HR_EMAIL', ''),
      company_hr_phone: Settings.text('COMPANY_HR_PHONE', ''),
      signatory_name: Repo.employeeName(extra && extra.signatoryEmployeeId),
      gross_salary: employee.gross_salary || '',
      ctc: employee.ctc_annual || ''
    };
    return map[token] === undefined ? '' : map[token];
  }

  function renderText(body, employee, extra) {
    return String(body || '').replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, function (match, token) {
      return String(valueFor(token, employee, extra) || '').replace(/\s+/g, ' ');
    });
  }

  function generate(authentication, payload) {
    var actor = authentication.actor;
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || actor.employeeId);
    if (!actor.isSuperAdmin && employeeId !== actor.employeeId) {
      Permissions.check(actor, 'document.generate', { employee_id: employeeId }, { entity: 'Documents', write: true, featureKey: 'documents', context: {} });
    }
    var employee = Repo.requireEmployee(employeeId);
    var category = Utils.requireEnum(payload.category, CATEGORIES, 'Category');
    var template = payload.templateId ? Repo.find('Doc_Templates', payload.templateId) : null;
    var body = template ? template.body || '' : Utils.requireString(payload, 'body', { max: 28000, min: 20 });
    var text = renderText(body, employee, { signatoryEmployeeId: template ? template.signatory_employee_id : '' });
    var number = numberFor(category, employeeId);
    var watermark = Settings.text('DOCUMENT_WATERMARK_TEXT', '');
    var record = Database.insert('Documents', {
      employee_id: employeeId, category: category, title: Utils.cleanString(payload.title || (template ? template.name : category.replace(/_/g, ' '))).slice(0, 160),
      document_number: number, version: 1, template_id: template ? template.id : '',
      body_text: text, watermark: watermark, note: Utils.cleanString(payload.note).slice(0, 500),
      expires_at: Utils.cleanString(payload.expiresAt) ? Utils.requireDate(payload.expiresAt, 'Expiry date') : '',
      file_id: '', status: 'ACTIVE'
    }, actor.employeeId);
    if (Settings.bool('DOCUMENT_REQUIRE_APPROVAL', false) && Permissions.isFeatureEnabled('workflow')) {
      Workflow.start(authentication, 'document', record.id, { category: category, documentNumber: number }, {
        summary: category.replace(/_/g, ' ') + ' for ' + (employee.display_name || employeeId)
      });
    }
    Audit.logEvent('DOCUMENT_GENERATED', actor.employeeId, 'Documents', record.id, 'SUCCESS', { employeeId: employeeId, category: category, number: number }, {});
    return { documentId: record.id, documentNumber: number, body: text, watermark: watermark };
  }

  function detail(authentication, payload) {
    var document = Repo.requireRecord('Documents', payload.documentId, 'Document');
    var actor = authentication.actor;
    if (!canAccess(actor, document)) Utils.fail('FORBIDDEN', 'You cannot view this document.');
    var employee = Repo.employee(document.employee_id) || {};
    var body = document.body_text || '';
    if (!body && document.template_id) {
      var template = Repo.find('Doc_Templates', document.template_id);
      body = template ? renderText(template.body, employee, {}) : '';
    }
    return {
      document: shape(document),
      body: body,
      company: {
        name: Settings.text('COMPANY_NAME', 'FOCUSON HRMS'),
        address: Settings.text('COMPANY_ADDRESS', ''),
        logoUrl: Settings.text('COMPANY_LOGO_URL', ''),
        hrEmail: Settings.text('COMPANY_HR_EMAIL', ''),
        hrPhone: Settings.text('COMPANY_HR_PHONE', '')
      },
      employee: Repo.employeeSummary(employee)
    };
  }

  /** Records an uploaded file: base64 payload stored in the private Documents folder. */
  function upload(authentication, payload) {
    var employeeId = Utils.normalizeEmployeeId(payload.employeeId || authentication.actor.employeeId);
    if (employeeId !== authentication.actor.employeeId) {
      Permissions.check(authentication.actor, 'document.view', { employee_id: employeeId }, { entity: 'Documents', write: true, context: {} });
    }
    var category = Utils.requireEnum(payload.category || 'OTHER', CATEGORIES, 'Category');
    var base64 = String(payload.fileBase64 || '');
    var match = /^data:([a-zA-Z0-9/+.-]+);base64,([A-Za-z0-9+/=]+)$/.exec(base64);
    if (!match) Utils.fail('VALIDATION', 'The file could not be read. Choose a PDF or image.');
    var allowed = Settings.json('DOCUMENT_ALLOWED_MIME', ['application/pdf', 'image/jpeg', 'image/png']);
    if (Array.isArray(allowed) && allowed.length && allowed.indexOf(match[1]) < 0) Utils.fail('VALIDATION', 'This file type is not allowed.');
    var maxMb = Settings.number('DOCUMENT_MAX_UPLOAD_MB', 10);
    var bytes = Math.floor(match[2].length * 3 / 4);
    if (bytes > maxMb * 1024 * 1024) Utils.fail('VALIDATION', 'The file exceeds the ' + maxMb + ' MB limit.');
    var folderId = PropertiesService.getScriptProperties().getProperty('HRMS_FOLDER_DOCUMENTS_ID');
    if (!folderId) Utils.fail('SERVER', 'Private document storage is not configured. Run setupSystem().');
    var folder = DriveApp.getFolderById(folderId);
    var extension = match[1].split('/')[1] || 'bin';
    var name = employeeId + '_' + category + '_' + Date.now() + '.' + extension;
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(match[2]), match[1], name));
    var record = Database.insert('Documents', {
      employee_id: employeeId, category: category,
      title: Utils.cleanString(payload.title || name).slice(0, 160),
      document_number: numberFor(category, employeeId), version: 1,
      file_id: file.getId(), watermark: '', status: 'ACTIVE',
      note: Utils.cleanString(payload.note).slice(0, 500)
    }, authentication.actor.employeeId);
    Audit.logEvent('DOCUMENT_UPLOADED', authentication.actor.employeeId, 'Documents', record.id, 'SUCCESS', { employeeId: employeeId, category: category }, {});
    return { documentId: record.id };
  }

  /** Category permission plus record scope decide document access. */
  function canAccess(actor, document) {
    if (document.employee_id === actor.employeeId) return true;
    if (actor.isSuperAdmin) return true;
    var permission = categoryPermissionFor(document.category);
    if (actor.permissions.indexOf(permission) < 0) return false;
    return Repo.canSeeEmployee(actor, document.employee_id);
  }

  /** Permission re-checked download URL for a stored file. */
  function download(authentication, payload) {
    var document = Repo.requireRecord('Documents', payload.documentId, 'Document');
    var actor = authentication.actor;
    if (!canAccess(actor, document)) Utils.fail('FORBIDDEN', 'You cannot download this document.');
    if (!document.file_id) Utils.fail('NOT_FOUND', 'This document has no stored file. Use the printable letter view.');
    var file = DriveApp.getFileById(document.file_id);
    Audit.logEvent('DOCUMENT_DOWNLOADED', actor.employeeId, 'Documents', document.id, 'SUCCESS', { employeeId: document.employee_id }, {});
    return {
      fileName: file.getName(),
      mimeType: file.getMimeType(),
      url: 'https://drive.google.com/file/d/' + document.file_id + '/view',
      expiresInSeconds: 300
    };
  }

  function categoryPermissionFor(category) {
    var map = {
      OFFER_LETTER: 'document.hiring.view', APPOINTMENT_LETTER: 'document.hiring.view',
      EXPERIENCE_LETTER: 'document.employment.view', RELIEVING_LETTER: 'document.exit.view',
      SALARY_CERTIFICATE: 'document.payroll.view', WARNING_LETTER: 'document.disciplinary.view',
      POLICY_ACKNOWLEDGEMENT: 'document.employment.view'
    };
    return map[category] || 'document.view';
  }

  function onDecision(approval, state, authentication) {
    var document = Repo.find('Documents', approval.request_id);
    if (!document) return;
    if (state === 'APPROVED') Database.update('Documents', document.id, { status: 'ACTIVE', approval_id: approval.id }, authentication.actor.employeeId);
    else if (state === 'REJECTED') Database.update('Documents', document.id, { status: 'REJECTED' }, authentication.actor.employeeId);
  }

  function expiring(authentication, payload) {
    var days = Settings.number('DOCUMENT_EXPIRY_ALERT_DAYS', 30);
    var cutoff = Utils.addDays(Utils.today(), days);
    var items = Database.getAllCached('Documents').filter(function (row) {
      return String(row.status).toUpperCase() !== 'DELETED' && row.expires_at &&
        String(row.expires_at).slice(0, 10) <= cutoff && String(row.expires_at).slice(0, 10) >= Utils.today();
    }).map(shape);
    return { items: items, days: days };
  }

  return {
    CATEGORIES: CATEGORIES,
    list: list,
    saveTemplate: saveTemplate,
    generate: generate,
    detail: detail,
    upload: upload,
    download: download,
    onDecision: onDecision,
    expiring: expiring,
    renderText: renderText
  };
})();
