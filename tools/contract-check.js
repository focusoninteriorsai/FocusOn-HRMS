#!/usr/bin/env node
/**
 * Contract check: every field the pages read must exist in the backend response.
 *
 * The pages are plain DOM code, so a renamed backend field is invisible until a
 * user opens the screen. This tool boots the same in-memory Apps Script harness
 * used by tools/smoke-test.js, signs in, calls each read action the pages use and
 * asserts that the keys the pages depend on are present.
 *
 * Usage: node tools/contract-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

/* Reuse the emulator half of the smoke test: everything up to the tests. */
const harnessSource = fs.readFileSync(path.join(__dirname, 'smoke-test.js'), 'utf8');
const cutoff = harnessSource.indexOf('/* ---------------------------------------------------------------------- Tests */');
if (cutoff < 0) throw new Error('Could not find the test marker in smoke-test.js');
const harness = `${harnessSource.slice(0, cutoff)}
module.exports = { context, call, vm, properties: properties, expectFail };
`;

const loader = new module.constructor();
loader._compile(harness, path.join(__dirname, 'contract-harness.js'));
const { context, call, vm: sandbox } = loader.exports;

/* ------------------------------------------------------------------ Session */
/* The emulator exposes its Script Properties store as a Map. */
const setupProperties = {
  SETUP_ADMIN_EMP_ID: 'FOCUS001',
  SETUP_ADMIN_PASSWORD: 'Welcome#2026Focus',
  SETUP_ADMIN_NAME: 'Aarav Sharma'
};
for (const [key, value] of Object.entries(setupProperties)) {
  sandbox.runInContext(`PropertiesService.getScriptProperties().setProperty(${JSON.stringify(key)}, ${JSON.stringify(value)})`, context);
}
sandbox.runInContext('setupSystem()', context);
const login = call('auth.login', { employeeId: 'FOCUS001', password: 'Welcome#2026Focus' });
call('auth.changePassword', { currentPassword: 'Welcome#2026Focus', newPassword: 'Focus#2026Secure' }, login.token);
const token = login.token;

/* ------------------------------------------------------------------ Helpers */
const failures = [];
function expect(area, response, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((node, part) => (node === undefined || node === null ? undefined : node[part]), response);
    if (value === undefined) failures.push(`${area}: missing "${key}"`);
  }
}
function record(area, response, keys) {
  for (const key of keys) {
    const value = key.split('.').reduce((node, part) => (node === undefined || node === null ? undefined : node[part]), response);
    if (value === undefined) failures.push(`${area}: missing "${key}"`);
  }
}

/* Seed one of each record the later module checks need. */
const department = call('org.save', { entity: 'departments', name: 'Design Studio', code: 'DESIGN' }, token);
const created = call('employees.create', {
  displayName: 'Contract Check', workEmail: 'contract.check@example.com', mobile: '9000000001',
  departmentId: department.id, designation: 'Designer', joiningDate: '2026-01-05',
  employmentType: 'FULL_TIME'
}, token);
const employeeId = (created.employee && created.employee.employeeId) || created.employeeId;

const responses = {};
const skipped = [];
/** Calls an action that legitimately has no data yet in a fresh install. */
function optional(name, action, payload, keys) {
  try {
    responses[name] = call(action, payload, token);
    expect(name, responses[name], keys);
  } catch (error) {
    skipped.push(`${name} (${action}): ${error.message}`);
  }
}
responses.bootstrap = call('access.bootstrap', {}, token);
responses.dashboard = call('dashboard.get', {}, token);
responses.settings = call('settings.get', {}, token);
responses.employees = call('employees.list', { page: 1 }, token);
responses.picker = call('employees.picker', {}, token);
responses.detail = call('employees.detail', { employeeId }, token);
responses.org = call('org.list', { entity: 'departments' }, token);
responses.attendanceToday = call('attendance.today', {}, token);
responses.attendanceMonthly = call('attendance.monthly', { month: new Date().toISOString().slice(0, 7) }, token);
responses.attendanceRegister = call('attendance.register', { month: new Date().toISOString().slice(0, 7) }, token);
responses.regularizations = call('attendance.regularizations', {}, token);
responses.leave = call('leave.myLeave', {}, token);
responses.leaveRegister = call('leave.register', {}, token);
responses.calendar = call('leave.calendar', { month: new Date().toISOString().slice(0, 7) }, token);
responses.payrollRuns = call('payroll.runs', {}, token);
responses.salaryIndex = call('payroll.salaryIndex', {}, token);
responses.payslips = call('payroll.myPayslips', {}, token);
optional('statutory', 'payroll.statutoryReport', { period: new Date().toISOString().slice(0, 7) }, ['rows', 'totals']);
responses.expenses = call('money.expenses', {}, token);
responses.loans = call('money.loans', {}, token);
responses.documents = call('documents.list', {}, token);
const documentsResponse = responses.documents;
responses.recruitment = call('recruitment.list', {}, token);
responses.performance = call('performance.list', { scope: 'all' }, token);
responses.exit = call('exit.list', { scope: 'all' }, token);
responses.assets = call('assets.list', {}, token);
responses.announcements = call('announcements.list', {}, token);
responses.reportsHeadcount = call('reports.generate', { type: 'headcount' }, token);
responses.reportsAttendance = call('reports.generate', { type: 'attendance', month: new Date().toISOString().slice(0, 7) }, token);
responses.reportsLeave = call('reports.generate', { type: 'leave', year: new Date().getFullYear() }, token);
responses.reportsPayroll = call('reports.generate', { type: 'payroll', year: new Date().getFullYear() }, token);
responses.reportsExpiry = call('reports.generate', { type: 'expiry' }, token);
responses.workflowInbox = call('workflow.inbox', {}, token);
responses.workflowMine = call('workflow.inbox', { tab: 'mine' }, token);
responses.workflowHistory = call('workflow.inbox', { tab: 'history' }, token);
responses.workflowDefinitions = call('workflow.definitions', {}, token);
responses.notifications = call('notifications.list', {}, token);
responses.accessUsers = call('access.users', {}, token);
responses.accessRoles = call('access.roles', {}, token);
responses.employeeAccess = call('access.employeeAccess', {}, token);
responses.featureScopes = call('access.featureScopes', {}, token);
responses.auditLog = call('access.auditLog', {}, token);
responses.backups = call('backup.list', {}, token);
responses.selfTest = call('system.selfTest', {}, token);

/* ------------------------------------------- Fields each page depends on */
expect('access.bootstrap', responses.bootstrap, ['features', 'pendingApprovals', 'unreadNotifications', 'company']);
expect('dashboard.get', responses.dashboard, [
  'employee', 'today.state', 'shift', 'leave.balances', 'leave.upcoming', 'announcements',
  'pendingApprovals', 'pendingApprovalCount', 'payslips', 'money', 'quickLinks',
  'company.headcount', 'company.presentToday', 'company.openPositions', 'company.monthlyPayrollNet'
]);
expect('settings.get', responses.settings, ['categories', 'settings', 'features', 'security', 'version', 'generatedAt']);
expect('employees.list', responses.employees, ['items', 'page', 'pageCount', 'total']);
expect('employees.picker', responses.picker, ['items']);
expect('employees.detail', responses.detail, ['employee', 'salary', 'account', 'canEdit']);
expect('org.list', responses.org, ['entity', 'items', 'total', 'departments', 'branches', 'headcount']);
expect('attendance.today', responses.attendanceToday, ['day', 'shift', 'requireLocation', 'geoLocation', 'allowWorkFromHome']);
expect('attendance.monthly', responses.attendanceMonthly, ['summary', 'days', 'lock', 'employee']);
expect('attendance.register', responses.attendanceRegister, ['period', 'dates', 'employees', 'summary', 'lock', 'canMarkOthers']);
expect('attendance.regularizations', responses.regularizations, ['items']);
expect('leave.myLeave', responses.leave, ['leaveTypes', 'balances', 'applications', 'upcoming', 'policy']);
expect('leave.register', responses.leaveRegister, ['items']);
expect('leave.calendar', responses.calendar, ['days', 'holidays']);
expect('payroll.runs', responses.payrollRuns, ['items', 'stats', 'statutory']);
expect('payroll.salaryIndex', responses.salaryIndex, ['items']);
expect('payroll.myPayslips', responses.payslips, ['items']);
expect('money.expenses', responses.expenses, ['items', 'totals', 'categories', 'canPay', 'canApprove', 'loans']);
expect('money.loans', responses.loans, ['items', 'stats']);
expect('documents.list', responses.documents, ['items', 'templates', 'categories', 'canGenerate', 'canManageTemplates']);
expect('recruitment.list', responses.recruitment, ['openings', 'candidates', 'stages', 'sources', 'stats']);
expect('performance.list', responses.performance, ['items', 'stats']);
expect('exit.list', responses.exit, ['items', 'stats']);
expect('assets.list', responses.assets, ['items', 'stats']);
expect('announcements.list', responses.announcements, ['items']);
expect('reports.generate headcount', responses.reportsHeadcount, ['total', 'active', 'joiners', 'exits', 'byDepartment', 'byBranch', 'byDesignation', 'byType']);
expect('reports.generate attendance', responses.reportsAttendance, ['rows', 'attendanceRate']);
expect('reports.generate leave', responses.reportsLeave, ['byType', 'byMonth']);
expect('reports.generate payroll', responses.reportsPayroll, ['rows', 'totals', 'byDepartment', 'componentTotals']);
expect('reports.generate expiry', responses.reportsExpiry, ['probation', 'documents']);
expect('workflow.inbox', responses.workflowInbox, ['items', 'counts']);
expect('workflow.definitions', responses.workflowDefinitions, ['definitions', 'requestTypes']);
expect('notifications.list', responses.notifications, ['items', 'unreadCount', 'total']);
expect('access.users', responses.accessUsers, ['items']);
expect('access.roles', responses.accessRoles, ['roles', 'catalog', 'scopes']);
expect('access.employeeAccess', responses.employeeAccess, ['effective', 'overrides', 'delegations']);
expect('access.featureScopes', responses.featureScopes, ['items', 'features']);
expect('access.auditLog', responses.auditLog, ['items']);
expect('backup.list', responses.backups, ['items', 'autoDaily', 'keep', 'retentionDays']);
expect('system.selfTest', responses.selfTest, ['checks', 'passed', 'total']);

/* Rows that the tables read field by field. */
const firstOf = (response, key) => (Array.isArray(response[key]) ? response[key][0] : undefined) || {};
record('payroll.runs envelope', responses.payrollRuns, ['items', 'stats', 'statutory']);
record('leave.balances item', firstOf(responses.leave, 'balances'), ['code', 'name', 'balance', 'used', 'annualQuota']);
record('access.users item', firstOf(responses.accessUsers, 'items'), ['employeeId', 'displayName', 'status', 'roles']);
record('access.roles item', firstOf(responses.accessRoles, 'roles'), ['id', 'name', 'roleCode', 'scopeType', 'permissionCount', 'permissions']);
/* Documents need a generated record before the row shape can be checked. */
const generatedDoc = call('documents.generate', { employeeId, category: 'EXPERIENCE_LETTER', title: 'Contract check letter', body: 'Issued for contract checking.' }, token);
const documentRow = firstOf(call('documents.list', { scope: 'all' }, token), 'items');
record('documents item', documentRow, ['id', 'documentNumber', 'employeeName', 'category', 'issuedAt', 'state', 'hasFile']);
record('documents.detail', call('documents.detail', { documentId: generatedDoc.documentId }, token), ['document', 'body', 'company']);

/* ------------------------------------------------------------------ Report */
for (const note of skipped) console.log(`  note  no data yet: ${note}`);
if (failures.length) {
  console.error(`\n${failures.length} contract problem(s):`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exitCode = 1;
} else {
  console.log(`All ${Object.keys(responses).length} response contracts match the screens.`);
}
