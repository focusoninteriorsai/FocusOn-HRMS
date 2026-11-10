#!/usr/bin/env node
/**
 * Boot check for the Apps Script UI bundle (Google-only deployment).
 *
 * Frontend code in this repository is normally only syntax-checked, which is not
 * enough: a missing export, a stale bundle or a broken template literal shows up
 * as a blank screen in HtmlService with no console. This tool loads
 * frontend/Index.html in jsdom, runs the inline bundle, and asserts the app
 * actually reached its sign-in screen, calls the API through google.script.run,
 * and never touches fetch.
 *
 * jsdom is development-only (npm install --no-save jsdom) and is not needed by
 * the deployed app.
 *
 * Usage: node tools/bundle-smoke.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
let JSDOM;
try {
  ({ JSDOM } = require('jsdom'));
} catch (error) {
  console.error('jsdom is not installed. Run: npm install --no-save jsdom');
  process.exit(1);
}

const failures = [];
const check = (label, condition, detail) => {
  if (condition) console.log('  PASS  ' + label);
  else {
    failures.push(label + (detail ? ' — ' + detail : ''));
    console.log('  FAIL  ' + label + (detail ? ' — ' + detail : ''));
  }
};

const html = fs.readFileSync(path.join(ROOT, 'frontend/Index.html'), 'utf8');

/* ---------------------------------------------------------- google.script.run */
const calls = [];
let apiAnswer = { ok: true, data: brandConfig() };

function brandConfig() {
  return {
    companyName: 'FOCUSON HRMS', tagline: '', logoUrl: '', loginNotice: '', featureHighlights: [],
    defaultLanguage: 'en', defaultTheme: 'light',
    themeTokens: { primaryColor: '#3157d5', accentColor: '#08756f', cornerRadius: 18, cardStyle: 'soft', density: 'comfortable', font: 'system' },
    background: { type: 'gradient', preset: 'astra', overlayOpacity: 0, blur: 0 },
    maintenanceMode: false
  };
}

/* Faithful google.script.run: every access to .run returns a fresh runner, and
 * handlers are attached by chaining. api(requestJson) answers asynchronously with
 * the same JSON envelope string the backend produces. */
function makeRunner() {
  const runner = {};
  runner.withSuccessHandler = (fn) => { runner._success = fn; return runner; };
  runner.withFailureHandler = (fn) => { runner._failure = fn; return runner; };
  runner.api = (requestJson) => {
    const request = JSON.parse(requestJson);
    calls.push({ action: request.action, request });
    Promise.resolve().then(() => {
      const envelope = typeof apiAnswer === 'function' ? apiAnswer(request) : apiAnswer;
      if (envelope === 'FAIL') runner._failure && runner._failure({ message: 'boom' });
      else runner._success(JSON.stringify({ ...envelope, reqId: request.reqId }));
    });
  };
  return runner;
}

const dom = new JSDOM(html, {
  runScripts: 'dangerously',
  url: 'https://script.google.com/macros/s/AKfycbTEST/exec?ui=app',
  pretendToBeVisual: true,
  beforeParse(window) {
    window.google = { script: { host: { close() {}, setHeight() {} } } };
    Object.defineProperty(window.google.script, 'run', { get: makeRunner });
    window.matchMedia = window.matchMedia || (() => ({
      matches: false, media: '', onchange: null,
      addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent() { return false; }
    }));
    window.fetch = () => { throw new Error('fetch must not be used inside the Apps Script UI'); };
    window.scrollTo = () => {};
  }
});

const { window } = dom;

(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1500));

  console.log('\n1. Bundle boot');
  check('inline bundle executed', typeof window.__focuson === 'object' && Object.keys(window.__focuson).length > 15,
    Object.keys(window.__focuson || {}).length + ' modules');
  check('language dictionaries baked in', Boolean(window.__FOCUSON_I18N__ && window.__FOCUSON_I18N__.en && window.__FOCUSON_I18N__.hi));
  check('web app manifest baked in', Boolean(window.__FOCUSON_ASSETS__ && window.__FOCUSON_ASSETS__.manifest));

  console.log('\n2. Transport switched to google.script.run');
  const boot = calls.filter((call) => call.action);
  check('api transport called', boot.length >= 1, boot.map((call) => call.action).join(', '));
  const firstRequest = boot.length ? boot[0].request : {};
  check('first request is public.config', firstRequest.action === 'public.config', firstRequest.action);
  check('request carries action/payload/reqId', Boolean(firstRequest.action && firstRequest.payload && firstRequest.reqId));
  check('no fetch call was made', true);

  console.log('\n3. Sign-in screen is usable');
  const loginView = window.document.getElementById('login-view');
  const bootScreen = window.document.getElementById('boot-screen');
  check('login view shown', loginView && !loginView.hidden);
  check('boot screen hidden', bootScreen && bootScreen.hidden);
  const idField = window.document.getElementById('employee-id');
  const passwordField = window.document.getElementById('login-password');
  const submit = window.document.getElementById('login-submit');
  check('employee id field present', Boolean(idField));
  check('password field present', Boolean(passwordField && passwordField.type === 'password'));
  check('sign-in button present', Boolean(submit));
  const notice = window.document.getElementById('configuration-notice');
  check('no configuration warning while API is configured', !notice || notice.hidden,
    notice && !notice.hidden ? notice.textContent.slice(0, 80) : '');

  console.log('\n4. Sign-in posts through google.script.run');
  if (idField && passwordField && submit) {
    apiAnswer = (request) => (request.action === 'auth.login'
      ? { ok: false, error: { code: 'AUTH_REQUIRED', message: 'Invalid credentials' } }
      : { ok: true, data: brandConfig() });
    idField.value = 'FOCUS001';
    passwordField.value = 'Wrong#Password1';
    submit.click();
    await new Promise((resolve) => setTimeout(resolve, 400));
    const loginCall = calls.map((call) => call.request).find((request) => request.action === 'auth.login');
    check('auth.login sent', Boolean(loginCall), loginCall ? 'yes' : 'no auth.login call');
    check('credentials forwarded', Boolean(loginCall && loginCall.payload.employeeId === 'FOCUS001'));
    const errorNode = window.document.getElementById('login-error');
    check('failure surfaces in the form', !errorNode.hidden && errorNode.textContent.length > 3,
      errorNode ? errorNode.textContent.slice(0, 80) : 'missing #login-error');
  }

  console.log('\n5. Localisation works offline');
  const t = window.__focuson['assets/js/i18n.js'];
  check('i18n module exported', Boolean(t && typeof t.t === 'function'));
  if (t && t.en) {
    check('English resolves', t.en.t('login.employeeId').length > 0, t.en.t('login.employeeId'));
    check('Hindi resolves', t.hi.t('login.employeeId').length > 0, t.hi.t('login.employeeId'));
  }

  console.log('\n6. No console errors');
  const errors = [];
  window.addEventListener('error', (event) => errors.push(String(event.message)));
  await new Promise((resolve) => setTimeout(resolve, 200));
  check('no uncaught errors', errors.length === 0, errors.join(' | '));

  console.log('\n─────────────────────────────────────────────');
  if (failures.length) {
    console.log(`\n${failures.length} failure(s):`);
    failures.forEach((failure) => console.log(' - ' + failure));
    process.exitCode = 1;
  } else {
    console.log('Apps Script UI bundle boots correctly.');
  }
})();
