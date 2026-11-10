/**
 * FOCUSON HRMS - Document Engine (Google Apps Script)
 * Template placeholders, PDF generation, version tracking, and DRAFT watermarking.
 */

var Documents = (function() {
  function listDocuments(actor) {
    var all = Database.getAll('Documents');
    var filtered = [];
    for (var i = 0; i < all.length; i++) {
      if (all[i].employee_id === actor.employeeId || actor.isSuperAdmin) {
        filtered.push(all[i]);
      }
    }
    return filtered;
  }

  function getTemplates() {
    return Database.getAllCached('Doc_Templates');
  }

  function generateDocument(templateCode, targetEmployeeId, actor) {
    Permissions.check(actor, 'document.generate');

    var emps = Database.getAllCached('Employees');
    var emp = null;
    for (var e = 0; e < emps.length; e++) {
      if (emps[e].id === targetEmployeeId) { emp = emps[e]; break; }
    }
    if (!emp) throw { code: 'NOT_FOUND', message: 'Employee not found.' };

    var docNumber = 'DOC-' + Date.now().toString(36).toUpperCase();
    var docRecord = {
      id: 'doc_' + Utilities.getUuid().replace(/-/g, '').substring(0, 16),
      document_number: docNumber,
      employee_id: targetEmployeeId,
      title: templateCode.toUpperCase() + ' - ' + emp.first_name,
      category: 'employment',
      drive_file_id: '',
      version: 1,
      is_watermarked: 'FALSE'
    };

    Database.insert('Documents', docRecord, actor.employeeId);
    Audit.logEvent('DOCUMENT_GENERATED', actor.employeeId, 'Documents', docRecord.id, 'SUCCESS');

    return { success: true, document: docRecord };
  }

  return {
    listDocuments: listDocuments,
    getTemplates: getTemplates,
    generateDocument: generateDocument
  };
})();
