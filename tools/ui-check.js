#!/usr/bin/env node
/**
 * Static checks for the no-build frontend.
 *
 * The browser app has no bundler and no type checker, so these checks catch the
 * mistakes that would otherwise only appear as a blank screen in production:
 *
 *   1. an `import` from `_kit.js` that is not exported;
 *   2. a translation key used by a page that is missing from en.json / hi.json;
 *   3. an API action called by a page that is not registered in Actions.gs;
 *   4. an inline `style=` / `style:` attribute, which the CSP blocks;
 *   5. a route in app.js that points at a page module without a renderer.
 *
 * Usage: node tools/ui-check.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const pagesDir = path.join(root, 'assets/js/pages');
const jsFiles = [];

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js')) jsFiles.push(full);
  }
}
walk(path.join(root, 'assets/js'));

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(root, file);

const failures = [];
const notes = [];
function fail(area, message) {
  failures.push(`${area}: ${message}`);
}

/* ------------------------------------------------------------ kit exports */
const kitSource = read(path.join(pagesDir, '_kit.js'));
const kitExports = new Set();
for (const match of kitSource.matchAll(/export (?:async )?function (\w+)/g)) kitExports.add(match[1]);
for (const match of kitSource.matchAll(/export (?:const|let|var) (\w+)/g)) kitExports.add(match[1]);
for (const match of kitSource.matchAll(/export \{([^}]*)\}/g)) {
  for (const part of match[1].split(',')) {
    const name = part.trim().split(/\s+as\s+/).pop();
    if (name) kitExports.add(name);
  }
}

for (const file of jsFiles) {
  const source = read(file);
  for (const match of source.matchAll(/import \{([^}]*)\} from '\.\/_kit\.js'/g)) {
    for (const part of match[1].split(',')) {
      const name = part.trim();
      if (name && !kitExports.has(name)) fail(rel(file), `imports "${name}" from _kit.js, which does not export it`);
    }
  }
  for (const match of source.matchAll(/from '(\.{1,2}\/[^']+)'/g)) {
    const target = path.resolve(path.dirname(file), match[1]);
    if (!fs.existsSync(target)) fail(rel(file), `imports "${match[1]}", which does not exist`);
  }
}

/* ---------------------------------------------------------------- i18n */
const dictionaries = {
  en: JSON.parse(read(path.join(root, 'assets/i18n/en.json'))),
  hi: JSON.parse(read(path.join(root, 'assets/i18n/hi.json')))
};

function hasKey(dictionary, key) {
  return key.split('.').reduce((node, part) => (node && Object.prototype.hasOwnProperty.call(node, part) ? node[part] : undefined), dictionary) !== undefined;
}

const usedKeys = new Set();
const keyPatterns = [
  /\bt\(\s*'([a-zA-Z][\w.]*)'/g,
  /\b(?:labelKey|titleKey|emptyKey|successKey|confirmKey|subtitle|placeholderKey|messageKey):\s*'([a-zA-Z][\w.]*)'/g,
  /\blabel:\s*'([a-z]+(?:\.[\w]+)+)'/g
];
for (const file of jsFiles) {
  const source = read(file);
  for (const pattern of keyPatterns) {
    for (const match of source.matchAll(pattern)) usedKeys.add(match[1]);
  }
}

for (const key of usedKeys) {
  for (const [language, dictionary] of Object.entries(dictionaries)) {
    if (!hasKey(dictionary, key)) fail(`${language}.json`, `missing translation key "${key}"`);
  }
}
const enKeys = Object.keys(dictionaries.en).sort().join(',');
const hiKeys = Object.keys(dictionaries.hi).sort().join(',');
if (enKeys !== hiKeys) fail('i18n', 'en.json and hi.json do not share the same namespaces');
notes.push(`${usedKeys.size} translation keys checked in both dictionaries`);

/* -------------------------------------------------------------- actions */
const actionsSource = read(path.join(root, 'backend/Actions.gs'));
const registered = new Set();
for (const match of actionsSource.matchAll(/^\s*'([a-z]+\.[a-zA-Z]+)':/gm)) registered.add(match[1]);

// Actions that live outside the registry because they run before a session exists.
const sessionActions = new Set(['public.config', 'auth.login']);
const frameworkActions = new Set(['auth.session', 'auth.logout', 'auth.logoutAll', 'auth.changePassword', 'auth.updatePreferences', 'auth.heartbeat']);

const usedActions = new Set();
const actionPatterns = [
  /(?:load|apiRequest|mutate|post)\(\s*'([a-z]+\.[a-zA-Z]+)'/g,
  /action:\s*'([a-z]+\.[a-zA-Z]+)'/g
];
for (const file of jsFiles) {
  const source = read(file);
  for (const pattern of actionPatterns) {
    for (const match of source.matchAll(pattern)) usedActions.add(match[1]);
  }
}
const appSource = read(path.join(root, 'assets/js/auth.js'));
for (const match of appSource.matchAll(/request\(\s*'([a-z]+\.[a-zA-Z]+)'/g)) usedActions.add(match[1]);

for (const action of usedActions) {
  if (!registered.has(action) && !sessionActions.has(action) && !frameworkActions.has(action)) {
    fail('api', `"${action}" is called by the frontend but not registered in backend/Actions.gs`);
  }
}
notes.push(`${usedActions.size} API actions checked against the registry (${registered.size} registered)`);

/* ----------------------------------------------------------------- CSP */
for (const file of jsFiles) {
  const source = read(file);
  if (/\bstyle:\s*['"`]/.test(source)) fail(rel(file), 'uses an inline style attribute, which the Content-Security-Policy blocks');
  if (/\bsetAttribute\(\s*'style'/.test(source)) fail(rel(file), "uses setAttribute('style'), which the Content-Security-Policy blocks");
}
for (const file of fs.readdirSync(root).filter((name) => name.endsWith('.html'))) {
  const source = read(path.join(root, file));
  if (/\sstyle="/.test(source)) fail(file, 'uses an inline style attribute, which the Content-Security-Policy blocks');
}

/* --------------------------------------------------------------- routes */
const renderers = new Set();
for (const file of jsFiles) {
  for (const match of read(file).matchAll(/export (?:async )?function (render\w+)/g)) renderers.add(match[1]);
}
const app = read(path.join(root, 'assets/js/app.js'));
const importsByModule = {};
for (const match of app.matchAll(/import \{([^}]*)\} from '\.\/pages\/([\w-]+\.js)'/g)) {
  importsByModule[match[2]] = match[1].split(',').map((name) => name.trim()).filter(Boolean);
}
for (const [file, names] of Object.entries(importsByModule)) {
  for (const name of names) {
    if (!renderers.has(name)) fail('app.js', `imports "${name}" from pages/${file}, which does not export it`);
  }
}
const routeCount = (app.match(/\{ path: '\//g) || []).length;
notes.push(`${routeCount} navigation routes, ${Object.keys(importsByModule).length} page modules`);

/* -------------------------------------------------------------- classes */
const cssSource = fs.readdirSync(path.join(root, 'assets/css'))
  .map((name) => read(path.join(root, 'assets/css', name)))
  .join('\n');
const definedClasses = new Set();
for (const match of cssSource.matchAll(/\.([a-zA-Z][\w-]*)/g)) definedClasses.add(match[1]);
const usedClasses = new Set();
for (const file of jsFiles) {
  const source = read(file);
  for (const match of source.matchAll(/className:\s*[`'"]([^`'"]+)[`'"]/g)) {
    for (const token of match[1].split(/\s+/)) {
      // Skip template placeholders and expressions inside interpolated classNames.
      if (token && /^[a-zA-Z][\w-]*$/.test(token)) usedClasses.add(token);
    }
  }
}
const unknownClasses = [...usedClasses].filter((name) => !definedClasses.has(name)).sort();
if (unknownClasses.length) notes.push(`classes with no CSS rule (informational): ${unknownClasses.join(', ')}`);

/* --------------------------------------------------------------- report */
for (const note of notes) console.log(`  info  ${note}`);
if (failures.length) {
  console.error(`\n${failures.length} problem(s) found:`);
  for (const failure of failures) console.error(`  FAIL  ${failure}`);
  process.exitCode = 1;
} else {
  console.log('\nAll frontend checks passed.');
}
