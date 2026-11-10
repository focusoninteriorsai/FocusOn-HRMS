/**
 * FOCUSON HRMS - Organization Setup Engine (Google Apps Script)
 * Manages Departments, Designations, Branches, and Sites.
 */

var Org = (function() {
  function getOrgHierarchy() {
    return {
      departments: Database.getAllCached('Departments'),
      designations: Database.getAllCached('Designations'),
      branches: Database.getAllCached('Branches'),
      sites: Database.getAllCached('Sites')
    };
  }

  function saveDepartment(dept, actor) {
    Permissions.check(actor, 'org.manage', null, { scope: 'Company' });
    if (!dept.name || !dept.code) {
      throw { code: 'VALIDATION', message: 'Department code and name are required.' };
    }

    if (dept.id) {
      Database.update('Departments', dept.id, {
        code: dept.code.toUpperCase(),
        name: dept.name,
        head_employee_id: dept.head_employee_id || ''
      }, actor.employeeId);
      Audit.logEvent('DEPT_UPDATED', actor.employeeId, 'Departments', dept.id, 'SUCCESS', dept);
      return { id: dept.id, success: true };
    } else {
      var id = 'dept_' + dept.code.toLowerCase().replace(/[^a-z0-9]/g, '');
      Database.insert('Departments', {
        id: id,
        code: dept.code.toUpperCase(),
        name: dept.name,
        head_employee_id: dept.head_employee_id || ''
      }, actor.employeeId);
      Audit.logEvent('DEPT_CREATED', actor.employeeId, 'Departments', id, 'SUCCESS', dept);
      return { id: id, success: true };
    }
  }

  function saveDesignation(desig, actor) {
    Permissions.check(actor, 'org.manage', null, { scope: 'Company' });
    if (!desig.title || !desig.code) {
      throw { code: 'VALIDATION', message: 'Designation code and title are required.' };
    }

    if (desig.id) {
      Database.update('Designations', desig.id, {
        code: desig.code.toUpperCase(),
        title: desig.title,
        level: parseInt(desig.level || '1', 10)
      }, actor.employeeId);
      Audit.logEvent('DESIG_UPDATED', actor.employeeId, 'Designations', desig.id, 'SUCCESS', desig);
      return { id: desig.id, success: true };
    } else {
      var id = 'desig_' + desig.code.toLowerCase().replace(/[^a-z0-9]/g, '');
      Database.insert('Designations', {
        id: id,
        code: desig.code.toUpperCase(),
        title: desig.title,
        level: parseInt(desig.level || '1', 10)
      }, actor.employeeId);
      Audit.logEvent('DESIG_CREATED', actor.employeeId, 'Designations', id, 'SUCCESS', desig);
      return { id: id, success: true };
    }
  }

  function saveBranch(branch, actor) {
    Permissions.check(actor, 'org.manage', null, { scope: 'Company' });
    if (!branch.name || !branch.code) {
      throw { code: 'VALIDATION', message: 'Branch code and name are required.' };
    }

    if (branch.id) {
      Database.update('Branches', branch.id, {
        code: branch.code.toUpperCase(),
        name: branch.name,
        address: branch.address || '',
        city: branch.city || '',
        state: branch.state || ''
      }, actor.employeeId);
      Audit.logEvent('BRANCH_UPDATED', actor.employeeId, 'Branches', branch.id, 'SUCCESS', branch);
      return { id: branch.id, success: true };
    } else {
      var id = 'br_' + branch.code.toLowerCase().replace(/[^a-z0-9]/g, '');
      Database.insert('Branches', {
        id: id,
        code: branch.code.toUpperCase(),
        name: branch.name,
        address: branch.address || '',
        city: branch.city || '',
        state: branch.state || ''
      }, actor.employeeId);
      Audit.logEvent('BRANCH_CREATED', actor.employeeId, 'Branches', id, 'SUCCESS', branch);
      return { id: id, success: true };
    }
  }

  function saveSite(site, actor) {
    Permissions.check(actor, 'org.manage', null, { scope: 'Company' });
    if (!site.name || !site.code) {
      throw { code: 'VALIDATION', message: 'Site code and name are required.' };
    }

    if (site.id) {
      Database.update('Sites', site.id, {
        code: site.code.toUpperCase(),
        name: site.name,
        client_name: site.client_name || '',
        city: site.city || ''
      }, actor.employeeId);
      return { id: site.id, success: true };
    } else {
      var id = 'site_' + site.code.toLowerCase().replace(/[^a-z0-9]/g, '');
      Database.insert('Sites', {
        id: id,
        code: site.code.toUpperCase(),
        name: site.name,
        client_name: site.client_name || '',
        city: site.city || ''
      }, actor.employeeId);
      return { id: id, success: true };
    }
  }

  return {
    getOrgHierarchy: getOrgHierarchy,
    saveDepartment: saveDepartment,
    saveDesignation: saveDesignation,
    saveBranch: saveBranch,
    saveSite: saveSite
  };
})();
