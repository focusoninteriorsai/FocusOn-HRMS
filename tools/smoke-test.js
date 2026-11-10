/**
 * Local smoke test for the Apps Script backend.
 *
 * Emulates the Google Apps Script globals (SpreadsheetApp, DriveApp, Properties,
 * Cache, Lock, Utilities, ContentService, ScriptApp) in memory, loads every
 * backend/*.gs file into one shared context, then drives the real handlers through
 * a complete business cycle. Run with:  node tools/smoke-test.js
 *
 * This file is development tooling only. It is never deployed and contains no
 * production data.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const BACKEND = path.join(ROOT, 'backend');

/* ------------------------------------------------------------------ Utilities */
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

function base64Encode(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes.map((b) => (b < 0 ? b + 256 : b)));
  return buffer.toString('base64');
}

function base64EncodeWebSafe(bytes) {
  return base64Encode(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function offsetMinutes() {
  return 330; // Asia/Kolkata
}

function pad(value, size) {
  return String(value).padStart(size || 2, '0');
}

function formatDate(date, timezone, format) {
  const shifted = new Date(date.getTime() + (timezone === 'UTC' ? 0 : offsetMinutes()) * 60000);
  const map = {
    yyyy: shifted.getUTCFullYear(),
    MM: pad(shifted.getUTCMonth() + 1),
    dd: pad(shifted.getUTCDate()),
    HH: pad(shifted.getUTCHours()),
    mm: pad(shifted.getUTCMinutes()),
    ss: pad(shifted.getUTCSeconds())
  };
  return String(format).replace(/yyyy|MM|dd|HH|mm|ss/g, (token) => map[token]);
}

const Utilities = {
  DigestAlgorithm: { SHA_256: 'SHA_256', MD5: 'MD5' },
  Charset: { UTF_8: 'UTF_8' },
  getUuid() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16);
    });
  },
  base64Encode(value) {
    return Buffer.from(String(value), 'utf8').toString('base64');
  },
  base64Decode(value) {
    const buffer = Buffer.from(String(value), 'base64');
    return Array.from(buffer.values()).map((b) => (b > 127 ? b - 256 : b));
  },
  base64EncodeWebSafe(value) {
    return base64EncodeWebSafe(Buffer.from(Array.isArray(value) ? value : String(value)));
  },
  computeHmacSha256Signature(value, key) {
    const crypto = require('crypto');
    return Array.from(crypto.createHmac('sha256', String(key)).update(String(value)).digest().values());
  },
  computeDigest(_algorithm, value) {
    const crypto = require('crypto');
    return Array.from(crypto.createHash('sha256').update(String(value), 'utf8').digest().values());
  },
  formatDate,
  newBlob(data, mimeType, name) {
    return {
      data: String(data),
      mime: mimeType,
      fileName: name,
      getDataAsString() { return this.data; },
      getName() { return this.fileName; },
      getMimeType() { return this.mime; }
    };
  },
  sleep() {}
};

/* --------------------------------------------------------- Sheets emulation */
class FakeRange {
  constructor(sheet, row, column, rows, columns) {
    this.sheet = sheet;
    this.row = row;
    this.column = column;
    this.rows = rows;
    this.columns = columns;
  }
  getValues() {
    const output = [];
    for (let r = 0; r < this.rows; r += 1) {
      const line = [];
      for (let c = 0; c < this.columns; c += 1) {
        line.push(this.sheet.cell(this.row + r, this.column + c));
      }
      output.push(line);
    }
    return output;
  }
  setValues(values) {
    values.forEach((line, r) => {
      line.forEach((value, c) => this.sheet.setCell(this.row + r, this.column + c, value));
    });
    return this;
  }
  clearContent() {
    for (let r = 0; r < this.rows; r += 1) {
      for (let c = 0; c < this.columns; c += 1) this.sheet.setCell(this.row + r, this.column + c, '');
    }
    return this;
  }
  setFontWeight() { return this; }
  setBackground() { return this; }
  setFontColor() { return this; }
  setVerticalAlignment() { return this; }
  setNumberFormat() { return this; }
}

class FakeSheet {
  constructor(name) {
    this.name = name;
    this.data = [];
    this.frozenRows = 0;
    this.protections = [];
  }
  cell(row, column) {
    const line = this.data[row - 1];
    if (!line) return '';
    const value = line[column - 1];
    return value === undefined || value === null ? '' : value;
  }
  setCell(row, column, value) {
    while (this.data.length < row) this.data.push([]);
    const line = this.data[row - 1];
    while (line.length < column) line.push('');
    line[column - 1] = value;
  }
  getName() { return this.name; }
  getLastRow() {
    let last = 0;
    this.data.forEach((line, index) => {
      if (line && line.some((cell) => cell !== '' && cell !== undefined && cell !== null)) last = index + 1;
    });
    return last;
  }
  getLastColumn() {
    let last = 0;
    this.data.forEach((line) => {
      if (!line) return;
      for (let i = line.length - 1; i >= 0; i -= 1) {
        if (line[i] !== '' && line[i] !== undefined && line[i] !== null) { last = Math.max(last, i + 1); break; }
      }
    });
    return last;
  }
  getRange(row, column, rows, columns) {
    return new FakeRange(this, row, column, rows === undefined ? 1 : rows, columns === undefined ? 1 : columns);
  }
  setFrozenRows(count) { this.frozenRows = count; }
  protect() {
    const protection = {
      description: '',
      setDescription(value) { this.description = value; return this; },
      getDescription() { return this.description; },
      setWarningOnly() { return this; },
      getEditors() { return []; },
      removeEditors() { return this; }
    };
    this.protections.push(protection);
    return protection;
  }
  getProtections() { return this.protections; }
  clear() { this.data = []; }
}

class FakeSpreadsheet {
  constructor(name, id) {
    this.name = name;
    this.id = id;
    this.sheets = [new FakeSheet('Sheet1')];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getSheetByName(name) { return this.sheets.find((sheet) => sheet.name === name) || null; }
  insertSheet(name) {
    const sheet = new FakeSheet(name);
    this.sheets.push(sheet);
    return sheet;
  }
  deleteSheet(sheet) { this.sheets = this.sheets.filter((item) => item !== sheet); }
  getSheets() { return this.sheets.slice(); }
}

const spreadsheetStore = new Map();
const SpreadsheetApp = {
  ProtectionType: { SHEET: 'SHEET', RANGE: 'RANGE' },
  create(name) {
    const id = 'sheet_' + Math.random().toString(36).slice(2, 10);
    const spreadsheet = new FakeSpreadsheet(name, id);
    spreadsheetStore.set(id, spreadsheet);
    return spreadsheet;
  },
  openById(id) {
    const spreadsheet = spreadsheetStore.get(id);
    if (!spreadsheet) throw new Error('Spreadsheet not found: ' + id);
    return spreadsheet;
  }
};

/* ------------------------------------------------------------- Drive emulation */
class FakeFile {
  constructor(name, data, mime) {
    this.id = 'file_' + Math.random().toString(36).slice(2, 10);
    this.name = name;
    this.data = data;
    this.mime = mime || 'application/octet-stream';
    this.created = new Date();
    this.trashed = false;
  }
  getId() { return this.id; }
  getName() { return this.name; }
  getMimeType() { return this.mime; }
  getBlob() { return Utilities.newBlob(this.data, this.mime, this.name); }
  getDateCreated() { return this.created; }
  setTrashed(value) { this.trashed = value; }
}

class FakeFolder {
  constructor(name) {
    this.id = 'folder_' + Math.random().toString(36).slice(2, 10);
    this.name = name;
    this.folders = [];
    this.files = [];
  }
  getId() { return this.id; }
  getName() { return this.name; }
  createFolder(name) {
    const folder = new FakeFolder(name);
    this.folders.push(folder);
    folderStore.set(folder.id, folder);
    return folder;
  }
  getFoldersByName(name) {
    const matches = this.folders.filter((folder) => folder.name === name);
    let index = 0;
    return { hasNext: () => index < matches.length, next: () => matches[index++] };
  }
  createFile(blob) {
    const file = new FakeFile(blob.fileName || blob.getName(), blob.data || blob.getDataAsString(), blob.mime);
    this.files.push(file);
    return file;
  }
  getFiles() {
    let index = 0;
    const files = this.files.slice();
    return { hasNext: () => index < files.length, next: () => files[index++] };
  }
}

const folderStore = new Map();
const fileStore = new Map();
const DriveApp = {
  createFolder(name) {
    const folder = new FakeFolder(name);
    folderStore.set(folder.id, folder);
    return folder;
  },
  getFolderById(id) {
    const folder = folderStore.get(id);
    if (!folder) throw new Error('Folder not found: ' + id);
    return folder;
  },
  getFileById(id) {
    const file = fileStore.get(id);
    if (!file) throw new Error('File not found: ' + id);
    return file;
  }
};
const originalCreateFile = FakeFolder.prototype.createFile;
FakeFolder.prototype.createFile = function patched(blob) {
  const file = originalCreateFile.call(this, blob);
  fileStore.set(file.id, file);
  return file;
};

/* --------------------------------------------------- Properties / cache / lock */
const properties = new Map();
const PropertiesService = {
  getScriptProperties() {
    return {
      getProperty: (key) => (properties.has(key) ? properties.get(key) : null),
      setProperty: (key, value) => { properties.set(key, String(value)); },
      deleteProperty: (key) => { properties.delete(key); }
    };
  }
};
const cacheStore = new Map();
const CacheService = {
  getScriptCache() {
    return {
      get: (key) => (cacheStore.has(key) ? cacheStore.get(key) : null),
      put: (key, value) => { cacheStore.set(key, String(value)); },
      remove: (key) => { cacheStore.delete(key); }
    };
  }
};
const LockService = {
  getScriptLock() {
    return { tryLock: () => true, releaseLock: () => {} };
  }
};
/** Trigger store so install-time trigger creation can be asserted. */
const triggerStore = [];
function makeTriggerBuilder(handler) {
  const sink = () => ({
    create() {
      triggerStore.push({ getHandlerFunction: () => handler });
      return { getHandlerFunction: () => handler };
    }
  });
  return {
    timeBased: () => ({
      everyDays: () => ({ atHour: sink }),
      onMonthDay: () => ({ atHour: sink }),
      atHour: sink,
      everyHours: sink,
      everyMinutes: sink
    })
  };
}
const ScriptApp = {
  getProjectTriggers: () => triggerStore.slice(),
  newTrigger: (handler) => makeTriggerBuilder(handler)
};
const ContentService = {
  MimeType: { JSON: 'application/json' },
  createTextOutput(text) {
    return { text, setMimeType() { return this; } };
  }
};

/* ------------------------------------------- Google Workspace integrations */
// Minimal emulators so the integration layer can be exercised without touching a
// real mailbox, calendar or chat space. Each records what it was asked to do.
const googleCalls = { mail: [], chat: [], calendar: [], tasks: [], contacts: [], docs: [] };

const MailApp = {
  sent: googleCalls.mail,
  getRemainingDailyQuota() { return 100; },
  sendEmail(message) {
    if (!message || !message.to) throw new Error('MailApp: recipient required');
    this.sent.push({ to: message.to, subject: message.subject, body: message.body, name: message.name });
    return { getMessageId: () => 'msg_' + this.sent.length };
  }
};

const calendarEvents = {};
let calendarSeq = 0;
function makeCalendar() {
  return {
    createAllDayEvent(title, start, options) {
      const id = 'evt_' + (++calendarSeq);
      calendarEvents[id] = { title, start, options };
      return { getId: () => id, setAllDayDates() { return this; } };
    },
    getEventById(id) { return calendarEvents[id] ? { deleteEvent() { delete calendarEvents[id]; } } : null; }
  };
}
const CalendarApp = {
  getDefaultCalendar: makeCalendar,
  getCalendarById: () => makeCalendar(),
  events: calendarEvents
};

const UrlFetchApp = {
  fetch(url, options) {
    googleCalls.chat.push({ url, payload: JSON.parse((options && options.payload) || '{}') });
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  }
};

const Tasks = {
  Tasklists: { list: () => ({ items: [{ id: 'list_default' }] }) },
  Tasks: { insert: (task, listId) => { googleCalls.tasks.push({ task, listId }); return { id: 'task_' + googleCalls.tasks.length }; } }
};

const People = {
  People: {
    createContact: (body) => { googleCalls.contacts.push(body); return { resourceName: 'people/c' + googleCalls.contacts.length }; },
    updateContact: () => ({ resourceName: 'people/updated' })
  }
};

const DocumentApp = {
  ParagraphHeading: { HEADING1: 'HEADING1', HEADING2: 'HEADING2', NORMAL: 'NORMAL' },
  create: (name) => {
    const id = 'doc_' + (googleCalls.docs.length + 1);
    const paragraphs = [];
    const body = {
      appendParagraph(text) {
        paragraphs.push(text);
        return { setHeading() { return this; }, appendHorizontalRule() { return { appendParagraph() { return {}; } }; } };
      }
    };
    googleCalls.docs.push({ id, name, paragraphs });
    fileStore.set(id, { id, getName: () => name, getUrl: () => 'https://docs.google.com/document/d/' + id });
    return {
      getId: () => id,
      getUrl: () => 'https://docs.google.com/document/d/' + id,
      getBody: () => body,
      saveAndClose() {}
    };
  }
};

const Session = {
  getEffectiveUser: () => ({ getEmail: () => 'hrms-deployer@example.com' })
};

/* ------------------------------------------------------------- HtmlService */
// Emulates just enough of HtmlService for the UI host: templates resolve
// frontend/<name>.html, and the returned object exposes the rendered markup.
function readFrontendFile(name) {
  const file = path.join(ROOT, 'frontend', name + '.html');
  if (!fs.existsSync(file)) throw new Error('HtmlService: file not found: frontend/' + name + '.html');
  return fs.readFileSync(file, 'utf8');
}

const HtmlService = {
  XFrameOptionsMode: { ALLOWALL: 'ALLOWALL', SAMEORIGIN: 'SAMEORIGIN', DEFAULT: 'DEFAULT' },
  createHtmlOutputFromFile(name) {
    return {
      getContent() { return readFrontendFile(name); },
      setTitle() { return this; },
      setXFrameOptionsMode() { return this; },
      addMetaTag() { return this; }
    };
  },
  createTemplateFromFile(name) {
    const content = readFrontendFile(name);
    return {
      evaluate() {
        const node = { getContent: () => content, setTitle() { return node; }, setXFrameOptionsMode() { return node; }, addMetaTag() { return node; } };
        return node;
      }
    };
  }
};

/* --------------------------------------------------------------- Load backend */
const context = {
  console,
  Utilities,
  SpreadsheetApp,
  DriveApp,
  PropertiesService,
  CacheService,
  LockService,
  ScriptApp,
  ContentService,
  HtmlService,
  MailApp,
  CalendarApp,
  UrlFetchApp,
  Tasks,
  People,
  DocumentApp,
  Session,
  Date,
  Math,
  JSON,
  Number,
  String,
  Array,
  Object,
  isFinite,
  RegExp,
  Error
};
vm.createContext(context);

const files = fs.readdirSync(BACKEND).filter((name) => name.endsWith('.gs')).sort();
// Load order matters: Apps Script evaluates files alphabetically, so the shared
// primitives (Utils, Database, Permissions) must exist before dependent modules.
const order = ['Utils.gs', 'Database.gs', 'Permissions.gs', 'Repo.gs', 'Settings.gs', 'Audit.gs', 'Auth.gs',
  'Notifications.gs', 'Workflow.gs', 'Access.gs', 'Organization.gs', 'Employees.gs', 'Attendance.gs', 'Leave.gs',
  'Payroll.gs', 'Money.gs', 'Documents.gs', 'Recruitment.gs', 'Performance.gs', 'Exit.gs', 'Assets.gs',
  'Announcements.gs', 'Reports.gs', 'Backup.gs', 'Maintenance.gs', 'Google.gs', 'Actions.gs', 'Setup.gs', 'Code.gs', 'Ui.gs'];
const missing = files.filter((name) => !order.includes(name));
if (missing.length) throw new Error('Backend files missing from the load order: ' + missing.join(', '));
order.forEach((name) => {
  const source = fs.readFileSync(path.join(BACKEND, name), 'utf8');
  vm.runInContext(source, context, { filename: name });
});

/* --------------------------------------- Guard: real Apps Script load order */
// Apps Script has no load-order guarantee and in practice evaluates files
// alphabetically. Loading the backends alphabetically must therefore never throw,
// which is what "Cannot read properties of undefined (reading 'VALID_SCOPES')"
// looked like when Access.gs captured Permissions.VALID_SCOPES at file scope.
function assertOrderIndependent() {
  const alphabetically = fs.readdirSync(BACKEND).filter((name) => name.endsWith('.gs')).sort();
  const probe = {};
  Object.keys(context).forEach((key) => { probe[key] = context[key]; });
  vm.createContext(probe);
  alphabetically.forEach((name) => {
    try {
      vm.runInContext(fs.readFileSync(path.join(BACKEND, name), 'utf8'), probe, { filename: name });
    } catch (error) {
      throw new Error('Backend files must load in any order, but ' + name + ' failed when files load alphabetically: ' + error.message);
    }
  });
  const later = alphabetically.slice().reverse();
  const reverseProbe = {};
  Object.keys(context).forEach((key) => { reverseProbe[key] = context[key]; });
  vm.createContext(reverseProbe);
  later.forEach((name) => {
    try {
      vm.runInContext(fs.readFileSync(path.join(BACKEND, name), 'utf8'), reverseProbe, { filename: name });
    } catch (error) {
      throw new Error('Backend files must load in any order, but ' + name + ' failed in reverse order: ' + error.message);
    }
  });
}
assertOrderIndependent();

/* ------------------------------------------------------------------- Harness */
const failures = [];
const loginTokens = {};
let checks = 0;

function check(label, condition, detail) {
  checks += 1;
  if (condition) {
    console.log('  PASS  ' + label);
  } else {
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
}

function call(action, payload, token) {
  const request = { action, payload: payload || {}, reqId: 'req_' + Math.random().toString(36).slice(2, 12) };
  const response = vm.runInContext('doPost', context)({ postData: { contents: JSON.stringify(Object.assign({ token }, request)) } });
  const envelope = JSON.parse(response.text);
  if (!envelope.ok) {
    const error = new Error(envelope.error.code + ': ' + envelope.error.message);
    error.envelope = envelope;
    throw error;
  }
  return envelope.data;
}

function expectFail(action, payload, token, code) {
  try {
    call(action, payload, token);
    return { ok: false, detail: 'expected failure' };
  } catch (error) {
    if (code && error.envelope && error.envelope.error.code !== code) {
      return { ok: false, detail: 'expected ' + code + ' got ' + error.envelope.error.code + ' (' + error.envelope.error.message + ')' };
    }
    return { ok: true, error };
  }
}

/* ---------------------------------------------------------------------- Tests */
console.log('\n1. Setup and bootstrap');
properties.set('SETUP_ADMIN_EMP_ID', 'FOCUS001');
properties.set('SETUP_ADMIN_PASSWORD', 'Welcome#2026Focus');
properties.set('SETUP_ADMIN_NAME', 'Aarav Sharma');
const setupResult = vm.runInContext('setupSystem()', context);
check('setupSystem completes', setupResult && setupResult.ready === true, JSON.stringify(setupResult));
check('permissions catalog seeded', vm.runInContext('Database.getAllCached("Permissions_Catalog").length', context) > 60);

const login = call('auth.login', { employeeId: 'FOCUS001', password: 'Welcome#2026Focus' });
check('first login returns session token', typeof login.token === 'string' && login.token.length > 20);
check('forced password change flagged', login.mustChangePassword === true);
const token = login.token;

const blocked = expectFail('employees.list', {}, token, 'FORBIDDEN');
check('forced password change blocks other actions', blocked.ok, blocked.detail);

console.log('\n2. Password change and session');
call('auth.changePassword', { currentPassword: 'Welcome#2026Focus', newPassword: 'Focus#2026Secure' }, token);
const session = call('auth.session', {}, token);
check('password change clears forced flag', session.mustChangePassword === false);
check('super admin effective permissions', session.effectivePermissions.length > 60);
const bad = expectFail('auth.login', { employeeId: 'FOCUS001', password: 'wrong-password' }, null, 'AUTH_REQUIRED');
check('wrong password is rejected', bad.ok, bad.detail);

console.log('\n3. Settings are Super-Admin editable');
const settings = call('settings.get', {}, token);
check('settings categories present', settings.categories.length >= 8);
check('feature switches present', settings.features.length >= 20);
call('settings.update', { values: { COMPANY_NAME: 'Focus Interiors Pvt Ltd', COMPANY_TAGLINE: 'Design. Build. Deliver.', WORKWEEK_DAYS: '[1,2,3,4,5,6]', ATTENDANCE_GRACE_MINUTES: '15' } }, token);
const config = call('public.config', {}, null);
check('public branding updates', config.companyName === 'Focus Interiors Pvt Ltd');
call('settings.updateFeatures', { features: { payroll: true, leave: true, geofence: false, attendance_selfie: false } }, token);
const settingsAfter = call('settings.get', {}, token);
const payrollSwitch = settingsAfter.features.find((feature) => feature.key === 'payroll');
check('feature switch saves', payrollSwitch && payrollSwitch.enabled === true);
const rejected = expectFail('settings.update', { values: { COMPANY_NAME: 'X'.repeat(500) } }, token, 'VALIDATION');
check('over-long setting validated', rejected.ok, rejected.detail);

console.log('\n4. Organization setup');
const branch = call('org.save', { entity: 'branches', code: 'GNO', name: 'Greater Noida', city: 'Greater Noida', state: 'Uttar Pradesh', pincode: '201310', address: 'Sector 62' }, token);
const department = call('org.save', { entity: 'departments', code: 'DES', name: 'Design', branchId: branch.id }, token);
const department2 = call('org.save', { entity: 'departments', code: 'SAL', name: 'Sales', branchId: branch.id }, token);
const designation = call('org.save', { entity: 'designations', code: 'SRINT', name: 'Senior Interior Designer', level: 3 }, token);
call('org.save', { entity: 'holidays', name: 'Diwali', holidayDate: '2026-11-08', holidayType: 'PUBLIC' }, token);
call('org.save', { entity: 'sites', code: 'SITE01', name: 'Client Site - Noida', branchId: branch.id, latitude: 28.5355, longitude: 77.391, radiusMeters: 200 }, token);
const orgList = call('org.list', { entity: 'departments' }, token);
check('departments listed', orgList.items.length === 2);
const duplicate = expectFail('org.save', { entity: 'departments', code: 'DES', name: 'Duplicate' }, token, 'CONFLICT');
check('duplicate org code rejected', duplicate.ok, duplicate.detail);

console.log('\n5. Employees and accounts');
const created = call('employees.create', {
  employeeId: 'EMP0001', displayName: 'Priya Verma', firstName: 'Priya', lastName: 'Verma',
  workEmail: 'priya@focusinteriors.test', mobile: '9876543210',
  departmentId: department.id, designationId: designation.id, branchId: branch.id,
  joiningDate: '2026-01-15', employmentType: 'FULL_TIME', workLocationType: 'OFFICE',
  panNumber: 'ABCDE1234F', bankAccountNumber: '123456789012', bankIfsc: 'HDFC0001234', bankName: 'HDFC Bank',
  createAccount: true, roleIds: ['role_employee']
}, token);
check('employee created with account', created.employeeId === 'EMP0001');
const created2 = call('employees.create', {
  employeeId: 'EMP0002', displayName: 'Rahul Mehta', departmentId: department2.id,
  designationId: designation.id, branchId: branch.id, joiningDate: '2026-02-01',
  reportingManagerId: 'FOCUS001', createAccount: true, roleIds: ['role_employee']
}, token);
check('second employee created', created2.employeeId === 'EMP0002');
const employeeList = call('employees.list', {}, token);
check('employee directory lists both', employeeList.items.length === 3, String(employeeList.items.length));
check('next employee id generated', employeeList.nextEmployeeId === 'EMP0003', employeeList.nextEmployeeId);
const detail = call('employees.detail', { employeeId: 'EMP0001' }, token);
check('employee detail returns protected fields for super admin', detail.employee.panNumber === 'ABCDE1234F');
check('role options returned', detail.options.departments.length === 2);
const userList = call('access.users', {}, token);
check('user accounts listed', userList.items.filter((item) => item.userId).length === 3);

console.log('\n6. Roles and access');
const roles = call('access.roles', {}, token);
check('starter roles seeded', roles.roles.length >= 7, String(roles.roles.length));
const customRole = call('access.saveRole', { name: 'Design Lead', scopeType: 'Team', description: 'Design team lead', permissionKeys: ['employee.view', 'attendance.view', 'leave.approve', 'workflow.inbox'] }, token);
check('custom role created', Boolean(customRole.roleId));
call('access.assignRole', { employeeId: 'EMP0001', roleId: customRole.roleId, reason: 'Team lead appointment' }, token);
const access = call('access.employeeAccess', { employeeId: 'EMP0001' }, token);
check('role assignment visible in effective access', access.assignments.length >= 2);
check('effective permissions include role grant', access.effective.permissions.indexOf('leave.approve') >= 0);
call('access.saveOverride', { employeeId: 'EMP0001', permissionKey: 'employee.export', effect: 'ALLOW', scopeType: 'Department', reason: 'Temporary export access', expiresAt: new Date(Date.now() + 86400000).toISOString() }, token);
const access2 = call('access.employeeAccess', { employeeId: 'EMP0001' }, token);
check('override recorded', access2.overrides.length === 1);
call('access.saveDelegation', { delegateEmployeeId: 'EMP0002', permissions: ['leave.approve'], reason: 'Cover during annual leave', endsAt: new Date(Date.now() + 5 * 86400000).toISOString() }, token);
const access3 = call('access.employeeAccess', {}, token);
check('delegation recorded', access3.delegations.length === 1);

console.log('\n7. Attendance');
const today = vm.runInContext('Utils.today()', context);
const markSelf = call('attendance.markSelf', { action: 'CHECK_IN' }, token);
check('self check-in works', markSelf.record.state === 'PRESENT', JSON.stringify(markSelf.record));
const twice = expectFail('attendance.markSelf', { action: 'CHECK_IN' }, token, 'CONFLICT');
check('double check-in rejected', twice.ok, twice.detail);
const checkOut = call('attendance.markSelf', { action: 'CHECK_OUT' }, token);
check('self check-out records minutes', checkOut.record.workMinutes >= 0);
const register = call('attendance.register', { month: today.slice(0, 7) }, token);
check('attendance register builds a grid', register.employees.length === 3 && register.dates.length > 25);
call('attendance.mark', { employeeId: 'EMP0002', date: today, state: 'PRESENT', checkInAt: today + 'T03:30:00.000Z', checkOutAt: today + 'T12:30:00.000Z' }, token);
const monthly = call('attendance.monthly', { month: today.slice(0, 7), employeeId: 'EMP0002' }, token);
check('monthly summary counts presence', monthly.summary.presentDays >= 1, JSON.stringify(monthly.summary));
const regularization = call('attendance.requestRegularization', { date: today, reason: 'Forgot to check out because of a site visit', checkOutAt: today + 'T13:00:00.000Z' }, token);
check('regularization request created', Boolean(regularization.requestId));

console.log('\n8. Leave');
const leaveTypes = call('leave.myLeave', {}, token).leaveTypes;
check('default leave types seeded', leaveTypes.length >= 5);
const earnedLeave = leaveTypes.find((type) => type.code === 'CL');
vm.runInContext('Leave.ensureBalance("EMP0002", "' + earnedLeave.id + '", 2026, "TEST")', context);
const accrual = vm.runInContext('Leave.runAccrual("TEST")', context);
check('monthly accrual credits earned leave', accrual.credited >= 3, JSON.stringify(accrual));
const applied = call('leave.apply', {
  leaveTypeId: earnedLeave.id, startDate: '2026-12-01', endDate: '2026-12-03',
  reason: 'Family function out of station', contactDuringLeave: '9876543210'
}, loginTokenFor('EMP0002'));
check('leave application submitted', applied.applicationId && applied.days > 0, JSON.stringify(applied));
const myLeave = call('leave.myLeave', {}, loginTokenFor('EMP0002'));
check('leave appears in employee list', myLeave.applications.length === 1);
check('leave pending approval', myLeave.applications[0].state === 'PENDING');
const inbox = call('workflow.inbox', { filter: 'pending' }, token);
check('approval inbox has the leave request', inbox.items.some((item) => item.requestType === 'leave'), JSON.stringify(inbox.counts));
const leaveApproval = inbox.items.find((item) => item.requestType === 'leave');
const decision = call('workflow.decide', { approvalId: leaveApproval.approvalId, action: 'APPROVE', comment: 'Approved' }, token);
check('leave approved through workflow', decision.state === 'APPROVED');
const afterApproval = call('leave.myLeave', {}, loginTokenFor('EMP0002'));
check('leave marked approved for employee', afterApproval.applications[0].state === 'APPROVED');
const balanceAfter = afterApproval.balances.find((balance) => balance.leaveTypeId === earnedLeave.id);
check('leave balance debited', balanceAfter.balance < balanceAfter.annualQuota, JSON.stringify(balanceAfter));
const calendar = call('leave.calendar', { month: '2026-12' }, loginTokenFor('EMP0002'));
check('calendar marks own leave', calendar.days.some((day) => day.myLeave));
const leaveRegister = call('leave.register', { year: 2026 }, token);
check('leave register totals approved days', leaveRegister.summary.approved === 1);

console.log('\n9. Payroll');
call('payroll.saveStructure', {
  employeeId: 'EMP0001', effectiveFrom: '2026-01-01', salaryType: 'MONTHLY',
  components: [
    { name: 'Basic', kind: 'EARNING', amount: 30000, taxable: true, statutoryWage: true },
    { name: 'HRA', kind: 'EARNING', amount: 12000, taxable: true },
    { name: 'Conveyance', kind: 'EARNING', amount: 3000, taxable: true },
    { name: 'Special Allowance', kind: 'EARNING', amount: 5000, taxable: true },
    { name: 'Professional Tax', kind: 'DEDUCTION', amount: 200 }
  ]
}, token);
call('payroll.saveStructure', {
  employeeId: 'EMP0002', effectiveFrom: '2026-02-01', salaryType: 'MONTHLY',
  components: [
    { name: 'Basic', kind: 'EARNING', amount: 20000, taxable: true, statutoryWage: true },
    { name: 'HRA', kind: 'EARNING', amount: 8000, taxable: true },
    { name: 'Special Allowance', kind: 'EARNING', amount: 4000, taxable: true }
  ]
}, token);
const salaryIndex = call('payroll.salaryIndex', {}, token);
check('salary index shows structures', salaryIndex.stats.configured === 2, JSON.stringify(salaryIndex.stats));
const unlockRun = expectFail('payroll.prepare', { period: '2026-10' }, token, 'VALIDATION');
check('payroll blocked until attendance is locked', unlockRun.ok, unlockRun.detail);
vm.runInContext('Attendance.lockMonth({ actor: { employeeId: "FOCUS001", isSuperAdmin: true, permissions: ["attendance.lock"] } }, { period: "2026-10" })', context);
const blockedRun = expectFail('payroll.prepare', { period: '2026-10' }, token, 'CONFLICT');
check('payroll blocked until CA verification', blockedRun.ok, blockedRun.detail);
call('settings.update', { values: { PAYROLL_CA_VERIFIED: 'TRUE', PF_SETTINGS: JSON.stringify({ enabled: true, employeeRate: 12, employerRate: 12, wageCeiling: 15000, restrictToCeiling: true, epsRate: 8.33, epsWageCeiling: 15000, edliRate: 0.5, adminRate: 0.5, includeComponents: ['Basic'], employeeField: 'pf_uan' }) } }, token);
const prepared = call('payroll.prepare', { period: '2026-10' }, token);
check('payroll prepared', prepared.employeeCount === 2 && prepared.totals.gross > 0, JSON.stringify(prepared.totals));
const runDetail = call('payroll.runDetail', { runId: prepared.runId }, token);
check('run detail includes both employees', runDetail.items.length === 2);
const employeePay = runDetail.items.find((item) => item.employeeId === 'EMP0001');
check('gross matches structure', employeePay.gross > 0 && employeePay.gross <= 50000, String(employeePay.gross));
check('statutory PF deducted', employeePay.deductionLines.some((line) => line.code === 'PF_EE'), JSON.stringify(employeePay.deductionLines));
check('fixed deduction included', employeePay.deductionLines.some((line) => line.code.indexOf('PROFESSIONAL') === 0));
const selfVerify = expectFail('payroll.verify', { runId: prepared.runId }, token, 'FORBIDDEN');
check('preparer cannot verify with their own token', selfVerify.ok, selfVerify.detail);
const verifyToken = loginTokenFor('EMP0001');
check('second user cannot verify without the permission', expectFail('payroll.verify', { runId: prepared.runId }, verifyToken, 'FORBIDDEN').ok);
call('access.saveOverride', { employeeId: 'EMP0001', permissionKey: 'payroll.verify', effect: 'ALLOW', scopeType: 'Company', reason: 'Backup verifier for payroll', expiresAt: new Date(Date.now() + 86400000).toISOString() }, token);
const verified = call('payroll.verify', { runId: prepared.runId }, verifyToken);
check('run verified by another user', verified.state === 'VERIFIED');
const approved = call('payroll.approve', { runId: prepared.runId }, token);
check('run approved', approved.state === 'APPROVED');
const released = call('payroll.release', { runId: prepared.runId }, token);
check('run released', released.state === 'RELEASED');
const payslips = call('payroll.myPayslips', {}, verifyToken);
check('payslip released to employee', payslips.items.length === 1);
const payslip = call('payroll.payslip', { payslipId: payslips.items[0].id }, verifyToken);
check('payslip detail renders', payslip.payslip.net > 0 && payslip.payslip.earnings.length >= 4);
const statutory = call('payroll.statutoryReport', { runId: prepared.runId }, token);
check('statutory report totals PF', statutory.totals.pfEmployee > 0, JSON.stringify(statutory.totals));
const blockedSecond = expectFail('payroll.prepare', { period: '2026-10' }, token, 'CONFLICT');
check('released run cannot be re-prepared', blockedSecond.ok, blockedSecond.detail);

console.log('\n10. Expenses, advances, assets, documents');
const expense = call('money.submitExpense', { amount: 1200, category: 'TRAVEL', expenseDate: today, description: 'Client visit cab fare', receiptFileId: 'file_receipt_1' }, verifyToken);
check('expense claim submitted', expense.state === 'PENDING');
const expenseInbox = call('workflow.inbox', { filter: 'pending' }, token);
const expenseApproval = expenseInbox.items.find((item) => item.requestType === 'expense');
check('expense routed for approval', Boolean(expenseApproval));
approveFully(expenseApproval.approvalId, token, 'Valid claim');
const expenseAfter = call('money.expenses', { scope: 'mine' }, verifyToken);
check('expense approved', expenseAfter.items[0].state === 'APPROVED');
call('money.payExpense', { expenseId: expenseAfter.items[0].id, reference: 'NEFT-8891' }, token);
const expensePaid = call('money.expenses', { scope: 'mine' }, verifyToken);
check('expense paid', expensePaid.items[0].state === 'PAID');
call('money.requestLoan', { requestType: 'ADVANCE', principal: 10000, reason: 'Medical emergency at home' }, verifyToken);
const loanInbox = call('workflow.inbox', { filter: 'pending' }, token);
const loanApproval = loanInbox.items.find((item) => item.requestType === 'advance');
check('advance routed for approval', Boolean(loanApproval));
const loanSteps = approveFully(loanApproval.approvalId, token, 'Approved advance');
check('multi-step advance workflow completes', loanSteps >= 2, String(loanSteps));
const loans = call('money.loans', { scope: 'mine' }, verifyToken);
check('advance approved', loans.items[0].state === 'APPROVED');
const disbursed = call('money.disburseLoan', { loanId: loans.items[0].id, reference: 'NEFT-9001' }, token);
check('advance disbursed', disbursed.disbursed === 10000);
const asset = call('assets.save', { code: 'LAP001', name: 'Dell Latitude 5440', category: 'LAPTOP', purchaseValue: 65000, purchaseDate: '2026-01-10' }, token);
call('assets.assign', { assetId: asset.id, employeeId: 'EMP0001' }, token);
const myAssets = call('assets.myAssets', {}, verifyToken);
check('asset allocated to employee', myAssets.items.length === 1);
const missingTemplate = expectFail('documents.generate', { employeeId: 'EMP0001', category: 'EXPERIENCE_LETTER', body: 'Short' }, token, 'VALIDATION');
check('document body length validated', missingTemplate.ok, missingTemplate.detail);
const template = call('documents.saveTemplate', {
  name: 'Experience Certificate', category: 'EXPERIENCE_LETTER',
  body: 'This is to certify that {{employee_name}} ({{employee_id}}) has been working with {{company_name}} as {{designation}} in the {{department}} department since {{joining_date}}.\n\nIssued on {{today}}.'
}, token);
check('document template saved with placeholders', template.template.placeholders.length >= 5);
const generated = call('documents.generate', { employeeId: 'EMP0001', category: 'EXPERIENCE_LETTER', templateId: template.id }, token);
check('document generated from template', generated.body.indexOf('Priya Verma') >= 0, generated.body.slice(0, 80));
const documentDetail = call('documents.detail', { documentId: generated.documentId }, verifyToken);
check('employee can read own letter', documentDetail.body.indexOf('Focus Interiors') >= 0);
const otherDocument = expectFail('documents.detail', { documentId: generated.documentId }, loginTokenFor('EMP0002'), 'FORBIDDEN');
check('other employee cannot read the letter', otherDocument.ok, otherDocument.detail);

console.log('\n11. Recruitment, performance, exit');
const opening = call('recruitment.saveOpening', { code: 'OPN0001', title: 'Interior Designer', departmentId: department.id, designationId: designation.id, headcount: 2, salaryMin: 25000, salaryMax: 40000 }, token);
check('opening created', Boolean(opening.id));
const candidate = call('recruitment.saveCandidate', { openingId: opening.id, name: 'Neha Kapoor', email: 'neha@example.test', phone: '9812345670', stage: 'Applied', experienceYears: 3, expectedCtc: 420000, source: 'Referral' }, token);
check('candidate created', Boolean(candidate.id));
call('recruitment.moveStage', { candidateId: candidate.id, stage: 'Interview' }, token);
call('recruitment.scheduleInterview', { candidateId: candidate.id, round: 'Design portfolio review', scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: 'ONLINE' }, token);
const recruitment = call('recruitment.list', {}, token);
check('pipeline counts candidate', recruitment.pipeline.find((stage) => stage.stage === 'Interview').count === 1);
call('recruitment.releaseOffer', { candidateId: candidate.id, ctc: 480000, joiningDate: '2026-12-01', departmentId: department.id, designationId: designation.id, branchId: branch.id }, token);
const offerInbox = call('workflow.inbox', { filter: 'pending' }, token);
const offerApproval = offerInbox.items.find((item) => item.requestType === 'offer');
check('offer routed for approval', Boolean(offerApproval));
approveFully(offerApproval.approvalId, token, 'Approved within budget');
const converted = call('recruitment.convert', { candidateId: candidate.id }, token);
check('candidate converted to employee', Boolean(converted.employeeId));
const convertedStructure = call('payroll.structureDetail', { employeeId: converted.employeeId }, token);
check('salary structure auto-created from offer', convertedStructure.structures.length === 1);
call('performance.openCycle', { cycleName: 'FY2026 Annual Review', employeeIds: ['EMP0001'] }, token);
const performanceList = call('performance.list', { scope: 'mine' }, verifyToken);
check('performance cycle opened for employee', performanceList.items.length === 1);
const reviewId = performanceList.items[0].id;
call('performance.saveGoals', { id: reviewId, goals: [
  { title: 'Deliver Noida villa project', weight: 60, target: 'Handover by March' },
  { title: 'Client satisfaction score', weight: 40, target: '4.5 of 5' }
] }, verifyToken);
const selfReviewed = call('performance.selfReview', { id: reviewId, rating: 4, strengths: 'Delivery on time', improvements: 'Documentation' }, verifyToken);
check('self review submitted', selfReviewed.state === 'SELF_REVIEW');
const managerReviewed = call('performance.managerReview', { id: reviewId, rating: 4, comments: 'Strong delivery', complete: true }, token);
check('manager review completes with weighted score', managerReviewed.state === 'COMPLETED' && managerReviewed.finalRating === 4);
call('exit.submit', { resignationDate: '2026-11-01', lastWorkingDate: '2026-12-01', reason: 'Higher studies and relocation to another city' }, loginTokenFor('EMP0002'));
const exitInbox = call('workflow.inbox', { filter: 'pending' }, token);
const exitApproval = exitInbox.items.find((item) => item.requestType === 'exit');
check('exit routed for approval', Boolean(exitApproval));
approveFully(exitApproval.approvalId, token, 'Accepted');
const exits = call('exit.list', { scope: 'all' }, token);
const exitRecord = exits.items[0];
check('exit approved and tracked', exitRecord.state === 'APPROVED');
const exitAsset = call('assets.save', { code: 'PHN002', name: 'iPhone 14', category: 'MOBILE', purchaseValue: 70000 }, token);
call('assets.assign', { assetId: exitAsset.id, employeeId: 'EMP0002' }, token);
const settlement = call('exit.settlement', { exitId: exitRecord.id }, token);
check('settlement estimate computed', typeof settlement.netSettlement === 'number');
exitRecord.clearance.forEach((item) => {
  call('exit.updateClearance', { exitId: exitRecord.id, key: item.key, cleared: true, note: 'Done' }, token);
});
const premature = expectFail('exit.complete', { exitId: exitRecord.id }, token, 'CONFLICT');
check('exit blocked while assets are outstanding', premature.ok, premature.detail);
call('assets.return', { assetId: exitAsset.id, condition: 'GOOD', note: 'Returned at exit' }, token);
const completed = call('exit.complete', { exitId: exitRecord.id }, token);
check('exit completes once cleared', completed.completed === true);
const exitEmployee = call('employees.detail', { employeeId: 'EMP0002' }, token);
check('exited employee is deactivated', exitEmployee.employee.status === 'INACTIVE', exitEmployee.employee.status);
check('exited employee cannot sign in', expectFail('auth.login', { employeeId: 'EMP0002', password: 'Employee#2026Pass' }, null, 'AUTH_REQUIRED').ok);

console.log('\n12. Reports, notifications, audit');
const dashboard = call('dashboard.get', {}, token);
check('dashboard returns company summary', dashboard.company && dashboard.company.headcount >= 3);
check('dashboard returns own attendance panel', Boolean(dashboard.today));
const headcount = call('reports.generate', { type: 'headcount' }, token);
check('headcount report totals employees', headcount.total >= 3, String(headcount.total));
const attendanceReport = call('reports.generate', { type: 'attendance', month: today.slice(0, 7) }, token);
check('attendance report computes rate', typeof attendanceReport.attendanceRate === 'number');
const payrollReport = call('reports.generate', { type: 'payroll', month: '2026-10' }, token);
check('payroll report totals net pay', payrollReport.totals.net > 0);
const exportCsv = call('reports.export', { type: 'attendance', month: today.slice(0, 7) }, token);
check('CSV export produced rows', exportCsv.csv.split('\r\n').length > 2);
const notifications = call('notifications.list', {}, token);
check('notifications generated', notifications.total > 0, String(notifications.total));
call('notifications.markRead', { all: true }, token);
const notificationsRead = call('notifications.list', {}, token);
check('notifications marked read', notificationsRead.unreadCount === 0);
const audit = call('access.auditLog', {}, token);
check('audit log records events', audit.total > 20, String(audit.total));
const announcements = call('announcements.save', { title: 'Annual day celebration', body: 'The annual day will be held on 20 December at the Greater Noida office.', pinned: true }, token);
check('announcement published', Boolean(announcements.id));
const announcementList = call('announcements.list', {}, verifyToken);
check('announcement visible to employees', announcementList.items.length === 1);

console.log('\n13. Backup, restore guard and self test');
const backup = call('backup.create', { type: 'MANUAL' }, token);
check('backup created with checksum', backup.totalRows > 0, JSON.stringify({ rows: backup.totalRows, tables: backup.tables }));
const verifiedBackup = call('backup.verify', { backupId: backup.backupId }, token);
check('backup verifies', verifiedBackup.checksumMatches && verifiedBackup.rowCountMatches);
const restoreGuard = expectFail('backup.restore', { backupId: backup.backupId, confirmation: 'nope', reason: 'Testing restore guard' }, token, 'VALIDATION');
check('restore requires typed confirmation', restoreGuard.ok, restoreGuard.detail);
const selfTest = call('system.selfTest', {}, token);
check('self test returns checks', selfTest.checks.length >= 20);
console.log('       self test score: ' + selfTest.score + '% (' + selfTest.passed + '/' + selfTest.total + ')');
selfTest.checks.filter((item) => !item.passed).forEach((item) => console.log('       advisory: ' + item.name + ' — ' + item.detail));

console.log('\n14. Permission enforcement for a restricted user');
call('employees.create', {
  employeeId: 'EMP0200', displayName: 'Neha Kapoor', departmentId: department.id,
  designationId: designation.id, branchId: branch.id, joiningDate: '2026-04-01',
  createAccount: true, roleIds: ['role_employee']
}, token);
const employeeOnly = loginTokenFor('EMP0200');
const deniedPayroll = expectFail('payroll.runs', {}, employeeOnly, 'FORBIDDEN');
check('employee cannot access payroll', deniedPayroll.ok, deniedPayroll.detail);
const deniedSettings = expectFail('settings.get', {}, employeeOnly, 'FORBIDDEN');
check('employee cannot read settings', deniedSettings.ok, deniedSettings.detail);
let ownProfile;
try { ownProfile = call('profile.get', {}, employeeOnly); } catch (e) { console.log(e.stack); throw e; }
check('employee reads own profile', ownProfile.profile.employeeId === 'EMP0200');
const deniedImport = expectFail('employees.import', { csv: 'Full name\nTest' }, employeeOnly, 'FORBIDDEN');
check('employee cannot import employees', deniedImport.ok, deniedImport.detail);
const payslipsOn = call('payroll.myPayslips', {}, employeeOnly);
check('employee sees own payslip list when the feature is on', payslipsOn.items.length >= 0);
call('settings.updateFeatures', { features: { payslips: 'FALSE' } }, token);
const featureOff = expectFail('payroll.myPayslips', {}, employeeOnly, 'FORBIDDEN');
check('feature switch blocks disabled module', featureOff.ok, featureOff.detail);
const featureOffForAdmin = expectFail('payroll.myPayslips', {}, token, 'FORBIDDEN');
check('feature switch also applies to administrators', featureOffForAdmin.ok, featureOffForAdmin.detail);
call('settings.updateFeatures', { features: { payslips: 'TRUE' } }, token);
check('feature switch can be turned back on', call('payroll.myPayslips', {}, employeeOnly).items.length >= 0);

console.log('\n15. CSV import and export');
const importResult = call('employees.import', {
  dryRun: true,
  csv: 'Employee ID,Full name,Work email,Mobile,Department,Designation,Branch,Joining date\n' +
       'EMP0100,Arjun Nair,arjun@focusinteriors.test,9900112233,Design,Senior Interior Designer,Greater Noida,2026-03-01\n' +
       'EMP0101,Sana Khan,,9800011122,Sales,Sales Executive,Greater Noida,01/04/2026\n'
}, token);
check('CSV dry run parses rows without writing', importResult.preview.length === 2 && importResult.created === 0, JSON.stringify(importResult.errors));
const importLive = call('employees.import', {
  csv: 'Employee ID,Full name,Work email,Mobile,Department,Designation,Branch,Joining date\n' +
       'EMP0100,Arjun Nair,arjun@focusinteriors.test,9900112233,Design,Senior Interior Designer,Greater Noida,2026-03-01\n'
}, token);
check('CSV import creates the row', importLive.created === 1);
const exported = call('employees.export', {}, token);
check('employee export includes the new row', exported.csv.indexOf('EMP0100') >= 0);
const sensitiveExport = call('employees.export', { includeSensitive: true }, token);
check('sensitive export adds PAN column', sensitiveExport.csv.indexOf('PAN') >= 0);

/** Approves every remaining step of an approval and returns the number of steps taken. */
function approveFully(approvalId, approvalToken, comment) {
  let steps = 0;
  let state = 'PENDING';
  while (state === 'PENDING' && steps < 5) {
    const result = call('workflow.decide', { approvalId, action: 'APPROVE', comment }, approvalToken);
    state = result.state;
    steps += 1;
  }
  return steps;
}

function loginTokenFor(employeeId) {
  if (!loginTokens[employeeId]) {
    const tempPassword = vm.runInContext('Access.resetPassword({ actor: { employeeId: "FOCUS001", isSuperAdmin: true, permissions: [] } }, { employeeId: "' + employeeId + '" })', context);
    const response = call('auth.login', { employeeId, password: tempPassword.temporaryPassword });
    call('auth.changePassword', { currentPassword: tempPassword.temporaryPassword, newPassword: 'Employee#2026Pass' }, response.token);
    loginTokens[employeeId] = response.token;
  }
  return loginTokens[employeeId];
}

/* ------------------------------------------- Google-only UI host (HtmlService) */
console.log('\n16. Apps Script UI transport');
const uiEnvelope = JSON.parse(vm.runInContext('api', context)(JSON.stringify({
  action: 'public.config', token: null, payload: {}, reqId: 'ui-check-12345678'
})));
check('google.script.run api() answers public.config', uiEnvelope.ok === true && Boolean(uiEnvelope.data.companyName));
check('ui api() echoes the request id', uiEnvelope.reqId === 'ui-check-12345678');
const uiFailure = JSON.parse(vm.runInContext('api', context)(JSON.stringify({
  action: 'auth.session', token: null, payload: {}, reqId: 'ui-check-87654321'
})));
check('ui api() returns error envelopes instead of throwing', uiFailure.ok === false && uiFailure.error.code === 'AUTH_REQUIRED');
const uiGarbage = JSON.parse(vm.runInContext('api', context)(''));
check('ui api() rejects an empty body', uiGarbage.ok === false && uiGarbage.error.code === 'VALIDATION');
const uiHtml = vm.runInContext('doGet', context)({ parameter: {} });
check('doGet renders the HtmlService shell', Boolean(uiHtml && typeof uiHtml.getContent === 'function'));
check('rendered UI contains the bundled application', String(uiHtml.getContent()).indexOf('__focuson') > 0);

/* ------------------------------------------- Google Workspace integrations */
console.log('\n17. Google Workspace integrations');
call('settings.update', { values: { MAIL_NOTIFICATIONS_ENABLED: true, CALENDAR_SYNC_ENABLED: true, GOOGLE_CHAT_ENABLED: true, GOOGLE_CHAT_WEBHOOK_URL: 'https://chat.googleapis.com/v1/spaces/TEST/messages?key=1&token=2', TASKS_SYNC_ENABLED: true, CONTACTS_SYNC_ENABLED: true } }, token);
const integrationStatus = call('google.status', {}, token);
check('integration status reports every channel', Boolean(integrationStatus.mail && integrationStatus.calendar && integrationStatus.chat && integrationStatus.contacts && integrationStatus.tasks && integrationStatus.docs));
check('deployment account is reported', integrationStatus.account === 'hrms-deployer@example.com');
check('mail quota is reported', typeof integrationStatus.mail.quota === 'number' && integrationStatus.mail.quota > 0);

const beforeMail = googleCalls.mail.length;
call('google.testMail', { to: 'ops@example.com' }, token);
check('test mail is delivered through MailApp', googleCalls.mail.length === beforeMail + 1 && googleCalls.mail[googleCalls.mail.length - 1].to === 'ops@example.com');
check('mail carries the company name as sender', googleCalls.mail[googleCalls.mail.length - 1].name === 'Focus Interiors Pvt Ltd');
call('google.testChat', {}, token);
check('chat webhook is called', googleCalls.chat.length >= 1 && googleCalls.chat[0].url.indexOf('chat.googleapis.com') > 0);

const contactsResult = call('google.syncContacts', {}, token);
check('contacts sync runs for active employees', contactsResult.total >= 2 && contactsResult.synced >= 0);
check('contact payload has the work email', googleCalls.contacts.length === 0 || Boolean(googleCalls.contacts[0].emailAddresses[0].value));

const holiday = call('org.save', { entity: 'holidays', name: 'Diwali Celebration', holidayDate: '2026-09-14', holidayType: 'PUBLIC', description: 'Festival of lights' }, token);
check('holiday saved with an id', Boolean(holiday.id), JSON.stringify(holiday));
const eventResult = call('google.createCalendarEvent', { holidayId: holiday.id }, token);
check('holiday becomes a calendar event', Boolean(eventResult.eventId) && Boolean(calendarEvents[eventResult.eventId]));
check('calendar event uses the holiday title', calendarEvents[eventResult.eventId].title === 'Diwali Celebration');

/* Approval assignment delivers mail, chat and a task. */
// Approvers must have a work e-mail for Gmail delivery; give the admin one.
const adminRecord = call('employees.detail', { employeeId: 'FOCUS001' }, token).employee;
call('employees.update', { id: adminRecord.id, employeeId: 'FOCUS001', workEmail: 'hr@focusinteriors.test' }, token);
const mailBeforeApproval = googleCalls.mail.length;
const chatBeforeApproval = googleCalls.chat.length;
const tasksBeforeApproval = googleCalls.tasks.length;
// Use a fresh employee: earlier sections offboard EMP0002, so it can no longer sign in.
const integrationHire = call('employees.create', {
  employeeId: 'EMP0150', displayName: 'Ishita Verma', workEmail: 'ishita@focusinteriors.test',
  departmentId: department2.id, designationId: designation.id, branchId: branch.id,
  joiningDate: '2026-03-01', employmentType: 'FULL_TIME', workLocationType: 'OFFICE',
  reportingManagerId: 'FOCUS001', createAccount: true, roleIds: ['role_employee']
}, token);
check('integration test employee created', integrationHire.employeeId === 'EMP0150');
const integrationTemp = vm.runInContext('Access.resetPassword({ actor: { employeeId: "FOCUS001", isSuperAdmin: true, permissions: [] } }, { employeeId: "EMP0150" })', context);
const integrationLogin = call('auth.login', { employeeId: 'EMP0150', password: integrationTemp.temporaryPassword });
call('auth.changePassword', { currentPassword: integrationTemp.temporaryPassword, newPassword: 'Employee#2026Pass' }, integrationLogin.token);
const integrationEmployeeToken = integrationLogin.token;
const integrationLeaveType = call('leave.myLeave', {}, integrationEmployeeToken).leaveTypes.find((type) => type.code === 'CL');
call('leave.apply', { leaveTypeId: integrationLeaveType.id, startDate: '2026-12-14', endDate: '2026-12-15', reason: 'Family function out of town' }, integrationEmployeeToken);
check('approval assignment sends e-mail', googleCalls.mail.length > mailBeforeApproval);
check('approval assignment posts a chat card', googleCalls.chat.length > chatBeforeApproval);
check('approval assignment creates a task', googleCalls.tasks.length > tasksBeforeApproval);

/* Leave decision syncs the calendar and mails the employee. */
const decisionMail = googleCalls.mail.length;
const eventsBefore = Object.keys(calendarEvents).length;
const integrationInbox = call('workflow.inbox', { filter: 'pending' }, token);
const integrationLeave = integrationInbox.items.filter((item) => item.requestType === 'leave').pop();
check('integration leave reached the approval inbox', Boolean(integrationLeave));
approveFully(integrationLeave.approvalId, token, 'Approved by HR');
check('leave decision e-mails the employee', googleCalls.mail.length > decisionMail);
check('approved leave lands on the calendar', Object.keys(calendarEvents).length > eventsBefore);

/* Google Chat approval card is well formed. */
const card = vm.runInContext('Google.chatApprovalCard', context)('Test', [{ label: 'Leave', value: 'two days' }], '/workflow');
check('approval card has a section and a widget', Array.isArray(card) && Boolean(card[0].sections[0].widgets.length));

/* Docs rendering for issued letters. */
const letter = vm.runInContext('Google.renderDocument', context)('Experience letter', 'Line one\nLine two', 'Test Employee');
check('letter renders into a Google Doc', letter.ok === true && Boolean(letter.result.docId), JSON.stringify(letter));
check('doc body receives the paragraphs', googleCalls.docs[googleCalls.docs.length - 1].paragraphs.indexOf('Line one') >= 0);

/* Integration switches are honoured. */
call('settings.update', { values: { MAIL_NOTIFICATIONS_ENABLED: false } }, token);
const disabledStatus = call('google.status', {}, token);
check('mail can be switched off', disabledStatus.mail.enabled === false);
const ignoredMail = vm.runInContext('Google.sendMail', context)('ops@example.com', 'x', 'y');
check('disabled mail does not send', ignoredMail.ok === false && ignoredMail.skipped === true);

/* ------------------------------------------------------------------- Summary */
console.log('\n─────────────────────────────────────────────');
console.log(checks - failures.length + ' of ' + checks + ' checks passed');
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((failure) => console.log(' - ' + failure));
  process.exitCode = 1;
} else {
  console.log('All backend checks passed.');
}
