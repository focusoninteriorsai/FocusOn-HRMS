# FOCUSON HRMS security notes — Phase 1

## Implemented controls

- **Authentication:** Employee ID + password only. Per-user random 256-bit salt material, server-only pepper, and iterated HMAC-SHA-256 (10,000 rounds by default, bounded 10,000–50,000). Passwords are never logged or stored in Sheets.
- **Sessions:** two UUIDs provide the random token; only its SHA-256 hash is stored. Both idle and absolute expiry are enforced server-side. Logout-all revokes in one batch. Password change revokes other devices.
- **Brute force:** per-Employee-ID failure counters/temporary locks and a global per-minute counter use locked CacheService updates. Credential failures are generic and audited. Cache eviction can weaken counters, so monitoring remains necessary.
- **Authorization:** default deny, DENY precedence, scoped role grants, expiring overrides/delegations, sensitive-field permissions, feature checks, SoD, and amount/day/leave-type conditions run on the server.
- **Data access:** all Sheets access passes through `Database.gs`; writes use LockService, schema validation, batch ranges, metadata, soft deletion, and cache invalidation. Strings beginning with `=`, `+`, `-`, `@`, tab, or CR receive an apostrophe before storage.
- **Audit:** login success/failure, password changes, preferences, logout, denied permission checks, sensitive-field views, and foundation maintenance use the protected Audit_Logs tab. Secret-like detail keys are redacted.
- **Browser:** strict CSP without inline JavaScript, `eval`, external scripts, or inline event handlers. Dynamic employee/branding values are inserted with `textContent`/DOM nodes, not HTML templates.
- **Credential storage:** the token lives only in sessionStorage, never in URLs/localStorage/cache. API errors do not log request bodies. The API URL cannot be changed at runtime, preventing a malicious settings value from redirecting credentials to another host.
- **Network:** simple JSON POST with no cookies (`credentials: omit`), no referrer, request timeout, safe-read retry/backoff, read de-duplication, request IDs, and disabled buttons during submission.
- **Offline:** service worker handles only an explicit same-origin static allowlist and navigation fallback. It never caches API responses, arbitrary images, employee data, tokens, or Drive content.
- **Setup:** no default account/password. Temporary owner properties are deleted after successful bootstrap. Resources remain private; code contains no public-sharing call.
- **Configuration:** public branding has a strict key allowlist and value validators. Script Properties contain the pepper, generated database/folder IDs, and temporary bootstrap credential.

## Trust boundaries and operational requirements

1. The dedicated Google owner account is the highest-privilege principal. Use 2-Step Verification, restrict owner access, review executions, and protect recovery methods.
2. Sheets protection prevents accidental/manual edits through the normal Sheets UI but cannot remove the owner’s ultimate control. Audit sheets are application append-only, not independent WORM storage.
3. Apps Script does not provide a trusted source IP or User-Agent to this Web App. The client UA hash detects ordinary device changes but can be spoofed; it is not a replacement for session secrecy.
4. GitHub Pages is public static hosting. No personal rows, exported reports, backups, Script Properties, `.clasp.json`, or credentials may be committed.
5. “Anyone” Web App access is transport accessibility only. Public actions are limited to safe config and login; every other action requires a valid session and server-side checks.
6. HTTPS is required for production, service workers, camera, and reliable geolocation. Keep the Apps Script `/exec` URL exact and review new deployment versions.
7. Google quotas, execution time, and CacheService behavior are platform limits. Use execution logs and request IDs for incident response; do not disable validation to work around quota exhaustion.

## Data protection rules for later modules

- Sensitive field reads must be logged; writes require their separate edit permission.
- Selfie/location capture requires recorded consent and feature/policy/employee precedence. Raw GPS and selfies must be purged on their configured schedules.
- Drive files stay private and are referenced by file ID. Do not enable link sharing.
- Payroll must fail closed on missing statutory settings and retain maker-checker separation.
- Reject direct API use that bypasses hidden menus exactly as the Phase 1 dispatcher does.

## Geolocation limitation

A browser cannot reliably detect mock-GPS apps, rooted devices, modified location providers, or a remote-controlled browser. Server-side Haversine checks prove only that submitted coordinates fall inside a configured radius. Phase 3 mitigations are accuracy thresholds, outside/GPS-denied policy behavior, repeated-coordinate and impossible-travel flags, optional consent-based selfies, retention limits, and manager/HR spot checks. No face recognition is permitted.

## Phase 1 security verification map

| Requirement | Implementation |
|---|---|
| No secrets in repository | `assets/js/config.js` contains only an empty public URL; `.gitignore` excludes clasp/credentials/env/key material. |
| Bootstrap safety | `Setup.gs → bootstrapFirstAdmin`, forced change and property cleanup. |
| Password/token storage | `Utils.gs` cryptographic helpers; `Auth.gs` login/session methods. |
| Full authorization chain | `Permissions.gs → check`; action declarations in `Code.gs`. |
| Input/formula safety | `Utils.gs` JSON/string helpers; `Database.gs → validateRecord`, writes. |
| Failure handling | typed errors and envelopes in `Code.gs`; lock/rate errors in `Auth.gs`/`Database.gs`. |
| Audit | `Audit.gs`, Auth events, permission denials, trigger maintenance. |
| CSP/safe DOM | `index.html`, `assets/js/ui.js`, page modules. |
| No personal offline cache | `sw.js` static URL allowlist. |
| Idempotent schema/setup | `Setup.gs` and `HRMS_SCHEMA_VERSION`. |

The complete 14-case isolated self-test suite is scheduled with its dependent modules; it cannot truthfully test payroll, attendance locks, delegates, or leaver reassignment before those modules exist.
