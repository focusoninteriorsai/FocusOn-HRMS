# FOCUSON HRMS

FOCUSON HRMS is a no-build HR and payroll web application for a company of approximately 80 employees, designed to scale to 300. The frontend is a static, mobile-first ES-module application for GitHub Pages. The backend is a Google Apps Script JSON Web App using Google Sheets for data and private Google Drive folders for files.

This branch currently contains **Phase 1: the production security and application foundation**. It deliberately does not show unfinished attendance, leave, payroll, recruitment, or other later-phase menus.

## Phase 1 capabilities

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

## Architecture

```text
GitHub Pages (static HTML/CSS/ES modules)
  index.html → app.js → router/pages → api.js
                                      |
                           POST text/plain JSON
                                      |
Google Apps Script Web App (/exec)
  Code.gs dispatcher
    → Auth.gs session validation
    → Permissions.gs authorization chain
    → Phase 1 handler
    → Database.gs / Audit.gs
                                      |
                    HRMS_CORE_DB + HRMS_ATTENDANCE_YEAR
                    Private Drive folder hierarchy
```

The browser never receives a trusted role decision from storage or navigation state. Menu visibility is only a convenience. Every protected action authenticates and authorizes again on the server.

## Repository layout

```text
index.html, 404.html, manifest.webmanifest, sw.js
assets/
  css/       Astra tokens, base, components, animations, pages
  i18n/      en.json, hi.json
  icons/     Neutral product icons
  js/        API, auth, router, store, i18n, theme, UI, geo/camera helpers
  js/pages/  Dashboard, profile, password change, error pages
backend/
  appsscript.json
  Code.gs, Utils.gs, Database.gs, Setup.gs
  Auth.gs, Audit.gs, Permissions.gs
docs/
  DEPLOYMENT.md, SECURITY.md, API.md
```

## Quick start

Follow **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** in order. There is no `npm install`, bundler, framework compilation, or generated frontend. After the Apps Script deployment, place its `/exec` URL in `assets/js/config.js` and serve the repository root with GitHub Pages.

For local static inspection only, any ordinary static HTTP server can serve the repository root. API login requires the deployed Apps Script backend and an HTTPS production URL.

## Assumptions and deliberate limits

1. **Phased delivery:** only the Phase 1 actions listed in `docs/API.md` exist. Other modules return `NOT_FOUND` rather than presenting dead screens.
2. **Setup identity:** the initial Super Admin’s display name defaults to the supplied Employee ID unless `SETUP_ADMIN_NAME` is provided. HR replaces this with real employee information in the Employees phase.
3. **Safe technical defaults:** empty session/password settings use documented conservative defaults (30-minute idle, 12-hour absolute session, 12-character password with complexity). Statutory and organization settings have no invented defaults.
4. **Device signal:** Apps Script Web Apps do not expose trusted client IP or User-Agent headers to `doPost`. The browser-supplied User-Agent is hashed as a secondary device signal, not treated as proof of identity. A browser UA change can require a new login.
5. **Sheets audit trail:** application code appends audit events and Setup protects tabs from manual edits. The Google account owner ultimately controls Sheets and Drive; owner access and 2-Step Verification are therefore part of the security boundary.
6. **Cache limits:** CacheService can evict rate counters early. The deployment account’s executions and audit logs must be monitored; a larger external abuse-defense layer is outside this no-paid-service architecture.
7. **No statutory filing or values:** PF, ESI, PT, TDS, bonus, gratuity, and wage-definition keys are empty. Payroll cannot silently use assumptions.
8. **No GPS trust claim:** the later attendance phase will enforce geofences on the server, but browsers cannot detect mock-GPS software. This limitation and mitigations are documented in `docs/SECURITY.md`.
9. **Offline privacy:** the service worker caches only an allowlist of static files. API calls, session data, employee data, Drive files, and non-GET requests are never cached.
10. **Time zone:** the Apps Script manifest and displayed dates use Asia/Kolkata. Stored instants are ISO UTC strings; date-only fields remain ISO calendar dates.

## Next phases

Phase 2 adds access administration, organization, employees, workflow, and approval screens. Phase 3 adds attendance and leave. Phase 4 adds payroll, documents, notifications, and reports. Phase 5 completes recruitment, performance, exit, RDash, backup/restore, and the full self-test/audit package.

Stop here for review before typing **NEXT** for Phase 2.
