#!/usr/bin/env node
/**
 * Builds the Apps Script UI bundle (Google-only deployment, no GitHub Pages).
 *
 * The browser app is written as native ES modules so it also works as plain
 * static files. Apps Script cannot serve ES modules from Drive, so this tool
 * produces a single offline HTML file that HtmlService renders directly:
 *
 *   frontend/Index.html                     built shell (HtmlService file name)
 *   assets/i18n/en.json  -> __FOCUSON_I18N__.en
 *   assets/i18n/hi.json  -> __FOCUSON_I18N__.hi
 *   ASSETS array in index.html              icon + webmanifest data URIs
 *
 * Bundling is a small deterministic linker, not a general bundler: it supports
 * the import forms this codebase actually uses (`import { a, b } from './x.js'`,
 * `export function`, `export const`, `export { ... }`, `export default`, dynamic
 * `import(...)` of already-included modules, and `import.meta.url`).
 *
 * Usage:
 *   node tools/build-apps-script-ui.js          write frontend/Index.html
 *   node tools/build-apps-script-ui.js --check  fail if the bundle is stale
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const ENTRY = path.join(ASSETS, 'js/app.js');
const OUTPUT = path.join(ROOT, 'frontend/Index.html');
const SHELL = path.join(ROOT, 'index.html');

const read = (file) => fs.readFileSync(file, 'utf8');
const rel = (file) => path.relative(ROOT, file).split(path.sep).join('/');

/* --------------------------------------------------------------- ES modules */
const IMPORT_RE = /^[ \t]*import\s+([\s\S]*?)\s+from\s+'([^']+)';?[ \t]*$/gm;
const SIDE_EFFECT_IMPORT_RE = /^[ \t]*import\s+'([^']+)';?[ \t]*$/gm;
const EXPORT_LIST_RE = /^[ \t]*export\s*\{([^}]*)\};?[ \t]*$/gm;
const EXPORT_DECL_RE = /^[ \t]*export\s+(?=(?:async\s+)?(?:function|const|let|var|class)\b)/gm;
const EXPORT_DEFAULT_RE = /^[ \t]*export\s+default\s+/gm;
const DYNAMIC_IMPORT_RE = /import\(\s*'([^']+)'\s*\)/g;
const IMPORT_META_RE = /import\.meta\.url/g;

const FOCUSON_NS = '__focuson';

function parseSpecifiers(clause) {
  const specifiers = [];
  const text = clause.trim();
  if (text.startsWith('{')) {
    text.replace(/^\{|\}$/g, '').split(',').forEach((part) => {
      const piece = part.trim();
      if (!piece) return;
      const [imported, alias] = piece.split(/\s+as\s+/);
      specifiers.push({ imported: imported.trim(), local: (alias || imported).trim() });
    });
    return specifiers;
  }
  if (text.startsWith('*')) {
    const match = /^\*\s+as\s+(\w+)$/.exec(text);
    if (match) specifiers.push({ namespace: true, local: match[1] });
    return specifiers;
  }
  const [defaultName, rest] = text.split(',').map((part) => part.trim());
  if (defaultName) specifiers.push({ default: true, local: defaultName });
  if (rest) specifiers.push(...parseSpecifiers(rest));
  return specifiers;
}

function moduleId(file) {
  return rel(file);
}

function transformModule(file) {
  let source = read(file);
  const id = moduleId(file);
  const dependencies = [];

  source = source.replace(IMPORT_RE, (match, clause, specifier) => {
    const target = path.resolve(path.dirname(file), specifier);
    dependencies.push(target);
    const specifiers = parseSpecifiers(clause);
    const lines = specifiers.map((entry) => {
      if (entry.namespace) return `    const ${entry.local} = __import(__focuson[${JSON.stringify(moduleId(target))}]);`;
      if (entry.default) return `    const ${entry.local} = __focuson[${JSON.stringify(moduleId(target))}].default;`;
      return `    const ${entry.local} = __focuson[${JSON.stringify(moduleId(target))}].${entry.imported};`;
    });
    return lines.join('\n');
  });

  source = source.replace(SIDE_EFFECT_IMPORT_RE, (match, specifier) => {
    const target = path.resolve(path.dirname(file), specifier);
    dependencies.push(target);
    return '';
  });

  const exportedNames = [];

  source = source.replace(EXPORT_LIST_RE, (match, inner) => {
    const lines = inner.split(',').map((part) => part.trim()).filter(Boolean).map((part) => {
      const [local, alias] = part.split(/\s+as\s+/);
      const publicName = (alias || local).trim();
      exportedNames.push(publicName);
      return `  d(${JSON.stringify(publicName)}, function () { return ${local.trim()}; });`;
    });
    return lines.join('\n');
  });

  const declarations = /^[ \t]*export\s+(?:async\s+)?(?:function|const|let|var|class)\s+(\w+)/gm;
  let declaration;
  while ((declaration = declarations.exec(source))) exportedNames.push(declaration[1]);

  // Drop the keyword only: the declarations stay in the module body so their
  // normal hoisting and block scope are preserved exactly as in ES modules.
  source = source.replace(EXPORT_DECL_RE, '');

  // `export default` is not used by this codebase; fail loudly instead of guessing.
  if (EXPORT_DEFAULT_RE.test(source)) {
    throw new Error(rel(file) + ': "export default" is not supported by the bundler');
  }

  return { id, source, dependencies, exportedNames };
}

function collectModules(entry) {
  const modules = new Map();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift();
    const id = moduleId(file);
    if (modules.has(id)) continue;
    const transformed = transformModule(file);
    modules.set(id, transformed);
    transformed.dependencies.forEach((dependency) => {
      if (!fs.existsSync(dependency)) throw new Error(rel(file) + ' imports a missing file: ' + rel(dependency));
      if (!modules.has(moduleId(dependency))) queue.push(dependency);
    });
  }
  return modules;
}

/* Export names must be known before the module bodies run, because the generated
 * code declares `const` bindings for imported names. Collecting them in a first
 * pass keeps the output readable and avoids a runtime dependency on `export`. */
function exportedNamesOf(transformed) {
  // Names collected from `export function|const|...` declarations during the
  // transform, plus the entries of any `export { a, b as c }` list.
  return [...new Set(transformed.exportedNames)];
}

function buildBundle() {
  const modules = collectModules(ENTRY);
  const order = [];
  const state = new Map();

  const visit = (file, stack) => {
    const id = moduleId(file);
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting') throw new Error('Import cycle: ' + stack.concat(id).join(' -> '));
    state.set(id, 'visiting');
    modules.get(id).dependencies.forEach((dependency) => visit(dependency, stack.concat(id)));
    state.set(id, 'done');
    order.push(id);
  };
  visit(ENTRY, []);

  const prelude = `var __focuson = {};
function __import(module) { return module; }
var __module = (function (definition) {
  var namespace = { default: undefined };
  var define = function (name, getter) {
    if (Object.prototype.hasOwnProperty.call(namespace, name)) return;
    Object.defineProperty(namespace, name, { enumerable: true, configurable: true, get: getter });
  };
  definition(define);
  return namespace;
});`;

  const blocks = order.map((id) => {
    const transformed = modules.get(id);
    let body = transformed.source;
    // Dynamic imports of modules that are already in the bundle collapse to the
    // module namespace, which keeps the lazily-loaded dialogs working.
    body = body.replace(DYNAMIC_IMPORT_RE, (match, specifier) => {
      const target = moduleId(path.resolve(path.dirname(path.join(ROOT, id)), specifier));
      return `Promise.resolve(__focuson[${JSON.stringify(target)}])`;
    });
    body = body.replace(IMPORT_META_RE, JSON.stringify('apps-script-ui'));
    // Re-attach the export getters: EXPORT_DECL_RE stripped the keyword, so the
    // declarations are in scope and the getters below reference them.
    const names = exportedNamesOf(transformed);
    const getters = names.map((name) => `  d(${JSON.stringify(name)}, function () { return ${name}; });`).join('\n');
    return `/* ---- ${id} ---- */\n__focuson[${JSON.stringify(id)}] = __module(function (d) {\n${body}\n${getters}\n});`;
  });

  return `${prelude}\n${blocks.join('\n\n')}\n__import(__focuson['assets/js/app.js']);`;
}

function buildI18n() {
  const data = {};
  ['en', 'hi'].forEach((locale) => {
    data[locale] = JSON.parse(read(path.join(ROOT, 'assets/i18n', locale + '.json')));
  });
  return `window.__FOCUSON_I18N__ = ${JSON.stringify(data)};`;
}

function buildAssets() {
  const icons = [
    ['icon-192.svg', '192x192', 'any'],
    ['icon-512.svg', '512x512', 'any'],
    ['icon-512.svg', '192x192', 'maskable'],
    ['icon-512.svg', '512x512', 'maskable']
  ];
  const entries = [];
  icons.forEach(([file, sizes, purpose]) => {
    const bytes = fs.readFileSync(path.join(ASSETS, 'icons', file));
    entries.push({ src: 'data:image/svg+xml;base64,' + bytes.toString('base64'), sizes, purpose });
  });
  const manifest = {
    name: 'FOCUSON HRMS',
    short_name: 'FOCUSON',
    description: 'Secure employee HR and payroll workspace',
    start_url: '?ui=app#/dashboard',
    display: 'standalone',
    background_color: '#f4f7fc',
    theme_color: '#3157d5',
    icons: entries
  };
  const assets = {
    manifest: 'data:application/manifest+json;base64,' + Buffer.from(JSON.stringify(manifest)).toString('base64'),
    icons: entries.map((entry) => entry.src)
  };
  return `window.__FOCUSON_ASSETS__ = ${JSON.stringify(assets)};`;
}

function buildShell(bundle, i18n, assets) {
  let html = read(SHELL);
  // Apps Script serves this inline, so the module manifests and the service
  // worker (a static-hosting feature) are removed and the policy is tightened.
  html = html.replace(/\s*<link rel="manifest"[^>]*>/, '');
  html = html.replace(/<meta http-equiv="Content-Security-Policy"[\s\S]*?>/, [
    '<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\' \'unsafe-inline\'; ',
    'style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; font-src \'self\' data:; ',
    'connect-src \'none\'; object-src \'none\'; base-uri \'self\'; form-action \'self\'; frame-ancestors \'self\'">'
  ].join(''));
  html = html.replace(/<script type="module"[^>]*><\/script>/, '');
  html = html.replace('</head>', `  <script>\n${assets}\n  </script>\n  <script>\n${i18n}\n  </script>\n</head>`);
  html = html.replace('</body>', `  <script>\n${bundle}\n  </script>\n</body>`);
  html = html.replace('<title>', '<!-- GENERATED by tools/build-apps-script-ui.js — do not edit by hand -->\n    <title>');
  return html;
}

function main() {
  const check = process.argv.includes('--check');
  const bundle = buildBundle();
  const i18n = buildI18n();
  const assets = buildAssets();
  const html = buildShell(bundle, i18n, assets);

  if (check) {
    const previous = fs.existsSync(OUTPUT) ? read(OUTPUT) : '';
    if (previous !== html) {
      console.error('frontend/Index.html is out of date. Run node tools/build-apps-script-ui.js');
      process.exitCode = 1;
      return;
    }
    console.log('Apps Script UI bundle is up to date (' + (html.length / 1024).toFixed(0) + ' KB).');
    return;
  }

  fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
  fs.writeFileSync(OUTPUT, html);
  console.log('wrote ' + rel(OUTPUT) + ' (' + (html.length / 1024).toFixed(0) + ' KB)');
}

main();
