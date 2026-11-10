# FOCUSON HRMS

FOCUSON HRMS is a no-build HR and payroll web application for a company of approximately 80 employees, designed to scale to 300. Everything runs inside one Google account: a single Google Apps Script Web App serves both the mobile-first screens (HtmlService) and the API, Google Sheets is the database, and private Google Drive folders hold files. One deployment, one `/exec` URL, no GitHub Pages, no static host, no build step for the user.

This branch contains the **complete application**: the Phase 1 security foundation, the full module backend, and the desktop-grade module screens for every function listed in `docs/API.md`. Menus stay hidden unless the signed-in user holds the module permission *and* the module feature switch is on.

## Capabilities

- Premium Astra landing/login interface, light/dark themes, responsive app shell, English/Hindi dictionaries, accessible forms/dialogs, reduced-motion support, and safe offline shell caching.
- Employee ID + password login; no consumer Google login and no email login.
- Owner-supplied one-time first Super Admin credential; forced password change at first login.
- Per-user random salt, server-side Script Properties pepper, and 10,000-round HMAC-SHA-256 password derivation by default. The work factor is stored per user for future migration.
- Cryptographically random session tokens; only SHA-256 token hashes are stored. Configurable idle and absolute expiry, device fingerprint hash, logout, and logout-all.
- Per-account and global sign-in throttling, generic credential errors, and security audit events.
- Schema-validated, formula-injection-protected, batch-oriented Sheets access with additive migrations and soft deletion.
- Default-deny permission engine with explicit DENY precedence, multiple roles, ALLOW overrides with expiry, bounded delegations, seven scope types, field protection, feature switches, maker-checker, and conditions.
- Declarative API action registry, safe public branding configuration, and consistent JSON error envelopes.
- Real-data dashboard and self-profile page. Empty values are shown as “Not provided”; no demo employee, chart, payroll value, or statutory rate is seeded.

### Modules

| Area | Screens |
| --- | --- |
| Workspace | Dashboard with company snapshot, quick links and pending-approval badges; notifications centre |
| People | Employees directory and editor, organization master (departments, designations, branches, sites, holidays), recruitment openings and candidate pipeline, performance goals and reviews, exit with clearance and settlement |
| Time | Attendance (punch with optional geofence, monthly summary, day register, month close, corrections), leave (balances, applications, calendar, register, leave types) |
| Pay | Payroll (salary index and structures, monthly runs through maker-checker, payslips, statutory report), expenses and advances, reports with CSV export |
| Records | Documents register and templates, asset register and allocation, announcements |
| Administration | Approval inbox with per-step decisions and workflow definitions, access administration (users, roles, overrides, delegations, feature switches, audit trail), settings (company, modules, system, self test, backups) |

Every screen is server-authorised: navigation is a convenience only, and each action re-checks permission, scope, feature switch, maker-checker and record conditions.

## Architecture

```text
Browser → /exec (one URL, one Google account)
  Ui.gs doGet()        → HtmlService template "Index"
                         (frontend/Index.html: every module, dictionary,
                          icon and manifest inlined by tools/build-apps-script-ui.js)
  google.script.run.api(requestJson)
    → Ui.gs api()      → Code.gs doPost() dispatcher
      → Auth.gs session validation
      → Permissions.gs authorization chain
      → Actions.gs registry → module handler
      → Database.gs / Audit.gs
                         |
      Sheets: HRMS_CORE_DB + HRMS_ATTENDANCE_<YEAR>
      Drive:  private folder hierarchy
      Gmail / Calendar / Docs / Chat / Contacts / Tasks (Settings-gated)
```

The screens and the API ship together, so there is no API URL to configure and no CORS. `assets/js/api.js` uses `google.script.run` when it is available and only falls back to `fetch` for local static inspection.

The browser never receives a trusted role decision from storage or navigation state. Menu visibility is only a convenience. Every protected action authenticates and authorizes again on the server.

## Repository layout

```text
index.html, 404.html, manifest.webmanifest, sw.js
assets/
  css/       Astra tokens, base, components, animations, pages, app modules
  i18n/      en.json, hi.json
  icons/     Neutral product icons
  js/        API (google.script.run transport), auth, router, store, i18n, theme, UI, geo/camera helpers
  js/pages/  _kit.js shared page kit + one module per screen
backend/
  appsscript.json     (Sheets/Drive/Gmail/Calendar/Docs/Contacts/Tasks/Chat scopes)
  Ui.gs               HtmlService host: doGet, api(), include()
  Google.gs           Gmail, Calendar, Chat, Contacts, Tasks, Docs integration
  Code.gs, Actions.gs dispatcher and registry
  Auth, Audit, Permissions, Database, Repo, Utils, Setup
  Employees, Organization, Attendance, Leave, Payroll, Money, Documents,
  Recruitment, Performance, Exit, Assets, Announcements, Reports, Workflow,
  Notifications, Access, Settings, Backup, Maintenance
frontend/
  Index.html          generated HtmlService bundle (paste into the "Index" HTML file)
tools/
  build-apps-script-ui.js  inline bundler (write / --check)
  bundle-smoke.js          jsdom boot test of the generated bundle
  smoke-test.js            in-memory Apps Script emulator with the full check suite
docs/
  DEPLOYMENT.md, SECURITY.md, API.md
```

## Quick start

Follow **[docs/FOCUSON_HRMS_SETUP_GUIDE.docx](docs/FOCUSON_HRMS_SETUP_GUIDE.docx)** (Word, step-by-step with troubleshooting) or **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** in order. You paste the `backend/*.gs` files and the generated `frontend/Index.html` into one Apps Script project, run `setupSystem()` once, and deploy that project as a Web App. The `/exec` URL of that deployment *is* the application — there is nothing else to host.

Maintainers change the screens by editing `assets/js/**` and running `node tools/build-apps-script-ui.js`; the regenerated `frontend/Index.html` is pasted into the `Index` HTML file. The full local gate is:

```bash
node tools/build-apps-script-ui.js --check && \
node tools/bundle-smoke.js && \
node tools/smoke-test.js && \
node tools/ui-check.js && \
node tools/contract-check.js
```

## Assumptions and deliberate limits

1. **Single registry:** every action the browser may call is listed in `docs/API.md` and registered in `backend/Actions.gs`. Anything else returns `NOT_FOUND` rather than presenting a dead screen.
2. **Setup identity:** the initial Super Admin’s display name defaults to the supplied Employee ID unless `SETUP_ADMIN_NAME` is provided. HR replaces this with real employee information in the Employees phase.
3. **Safe technical defaults:** empty session/password settings use documented conservative defaults (30-minute idle, 12-hour absolute session, 12-character password with complexity). Statutory and organization settings have no invented defaults.
4. **Device signal:** Apps Script Web Apps do not expose trusted client IP or User-Agent headers to `doPost`. The browser-supplied User-Agent is hashed as a secondary device signal, not treated as proof of identity. A browser UA change can require a new login.
5. **Sheets audit trail:** application code appends audit events and Setup protects tabs from manual edits. The Google account owner ultimately controls Sheets and Drive; owner access and 2-Step Verification are therefore part of the security boundary.
6. **Cache limits:** CacheService can evict rate counters early. The deployment account’s executions and audit logs must be monitored; a larger external abuse-defense layer is outside this no-paid-service architecture.
7. **No statutory filing or values:** PF, ESI, PT, TDS, bonus, gratuity, and wage-definition keys are empty. Payroll cannot silently use assumptions.
8. **No GPS trust claim:** the later attendance phase will enforce geofences on the server, but browsers cannot detect mock-GPS software. This limitation and mitigations are documented in `docs/SECURITY.md`.
9. **No offline shell on the hosted path:** HtmlService cannot serve a service worker or external assets, so `google.script.run` deployments skip service-worker registration and load everything from the inlined bundle. The service-worker/manifest assets remain for local static inspection only.
10. **Time zone:** the Apps Script manifest and displayed dates use Asia/Kolkata. Stored instants are ISO UTC strings; date-only fields remain ISO calendar dates.
11. **Google delivery is optional and off by default:** Gmail, Calendar, Chat, Contacts and Tasks each have a Settings switch and fail soft. A disabled channel returns a skipped result and an audited event instead of blocking the workflow, and mail is sent as the deployment account, so its daily recipient quota applies. Google Docs export is on by default because it only writes into the HRMS Drive folder.

## Verification

```bash
node tools/smoke-test.js       # 119 backend checks
node tools/ui-check.js         # kit imports, i18n, action registry, CSP, routes
node tools/contract-check.js   # 42 response contracts the screens read
```

The suite boots the whole backend in memory against a Sheets/Drive emulator and exercises 119 checks across setup, authentication, sessions, permissions, employees, organization, attendance, leave, payroll, money, documents, recruitment, performance, exit, assets, announcements, reports, workflow, notifications, settings, backup/restore, self test, restricted-user enforcement and CSV import/export. It must stay green before any deployment.

## Operating notes

- Month close for attendance is a prerequisite for a payroll run; payroll then moves VERIFIED → APPROVED → RELEASED → CLOSED with maker-checker enforced on every transition.
- Settings and module switches are read from the server on every sign-in and refreshed after any write, so a disabled module disappears without a reload.
- Backups are full JSON snapshots in private Drive storage, checksum-verified, and restore requires the typed `RESTORE` confirmation plus a reason; a safety copy is always taken first.
