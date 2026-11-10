# FOCUSON HRMS JSON API — Phase 1

## Transport

Endpoint: the Apps Script Web App `/exec` URL configured in `assets/js/config.js`.

- `GET`: minimal health response only.
- `POST`: `Content-Type: text/plain;charset=utf-8` with JSON below. This avoids a CORS preflight unsupported by Apps Script Web Apps.

```json
{
  "action": "dashboard.get",
  "token": "raw-session-token-or-null",
  "payload": {},
  "reqId": "browser-generated-uuid"
}
```

The frontend adds a reserved `payload.__client.userAgent` value. The server removes it before handler validation and retains only its keyed hash. It is a device signal, not a trusted network identity.

Every response has the same envelope:

```json
{ "ok": true, "data": {}, "reqId": "same-request-id" }
```

or:

```json
{
  "ok": false,
  "error": { "code": "VALIDATION", "message": "Clear safe message", "details": {} },
  "reqId": "same-request-id"
}
```

Stable codes are `AUTH_REQUIRED`, `SESSION_EXPIRED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `LOCKED`, `RATE_LIMITED`, `CONFLICT`, and `SERVER`. Unexpected exceptions return `SERVER` without a stack or internal resource ID; the request ID is logged for administrator diagnosis. `LOCKED` and throttling responses can include `retryAfterSeconds`.

Unknown actions return `NOT_FOUND`. Protected actions validate the session and active User/Employee records before any handler executes. A user requiring a password change can call only session inspection, password change, preferences, and logout actions.

## Public actions

### `public.config`

Authentication: none. Read-only.

Payload: `{}`.

Returns only allowlisted public presentation data:

```json
{
  "companyName": "FOCUSON HRMS",
  "tagline": "",
  "logoUrl": "",
  "loginNotice": "",
  "featureHighlights": [],
  "defaultLanguage": "en",
  "defaultTheme": "light",
  "themeTokens": {
    "primaryColor": "#3157d5",
    "accentColor": "#08756f",
    "cornerRadius": 18,
    "cardStyle": "soft",
    "density": "comfortable",
    "font": "system"
  },
  "background": { "type": "gradient", "preset": "astra", "overlayOpacity": 0, "blur": 0 }
}
```

Values shown above are neutral fallback configuration, not employee data. Branding values are length-limited, theme values are allowlisted/validated, and the frontend renders all text with `textContent`. No internal setting, employee record, spreadsheet ID, or feature state is returned.

### `auth.login`

Authentication: none, but per-account and global throttles apply. Writes a hashed session record and audit event.

Payload:

```json
{ "employeeId": "REAL-COMPANY-ID", "password": "user-supplied-password" }
```

`REAL-COMPANY-ID` illustrates the field format only; it is not an account seeded by the application. On success, `data` contains:

- `token`: raw random session token returned only here; the server stores its SHA-256 hash.
- `mustChangePassword`: boolean.
- `effectivePermissions`: current permission-key union after DENY filtering.
- `scopes`: permission-to-scope summary for shell convenience.
- `user`: own Employee ID, display name, organization fields, role IDs, preferences, and Super Admin flag.
- `session`: idle seconds, absolute expiry, last-seen time, and password policy.

Invalid, unknown, and inactive credentials receive the same `AUTH_REQUIRED` message. Repeated failures return `RATE_LIMITED`; lock and threshold values are company settings with documented safe defaults.

## Authenticated self-service actions

These actions operate only on the session owner. They require no separate catalog permission because possession of a valid active session is the authorization boundary. Their payloads are strictly allowlisted by the handler.

### `auth.session`

Read. Payload `{}`. Returns the same session/user shape as login but never returns the raw token.

### `auth.changePassword`

Write. Payload:

```json
{ "currentPassword": "current-secret", "newPassword": "new-secret" }
```

Verifies the current password and configured length/complexity, stores a fresh salt/work factor/hash, clears forced-change status, and revokes other sessions. Returns `{ "changed": true }`.

### `auth.updatePreferences`

Write. Payload can contain either or both:

```json
{ "language": "en", "theme": "dark" }
```

Language allows `en` or `hi`; theme allows `light` or `dark`. Returns the saved pair.

### `auth.logout`

Write. Payload `{}`. Revokes the current session. Returns `{ "loggedOut": true }`.

### `auth.logoutAll`

Write. Payload `{}`. Revokes all active sessions for the current Employee ID in one batch update. Returns `{ "loggedOut": true, "revokedCount": 1 }`; the count is the actual number changed.

### `dashboard.get`

Read. Payload `{}`. Returns only the current employee’s real organization fields, password-change timestamp, effective permission count, and current session timestamps. It does not fabricate company KPIs or charts.

## Permission-protected actions

### `profile.get`

Read. Required permission: `employee.view`. Feature switch: none. Sensitive fields returned: none.

Payload `{}` reads the caller’s profile. An optional `employeeId` selects another target only when the role’s server-resolved scope allows it; a Self-scoped user cannot bypass scope by changing the ID.

Returns `data.profile` with only:

- `employeeId`, `displayName`, `workEmail`, `mobile`
- `department`, `designation`, `branch`, `reportingManagerId`
- `workLocationType`, `joiningDate`

Salary, bank, government-ID, personal email, birth, and medical fields are not returned by this Phase 1 action.

## Authorization registry

Each entry in `Code.gs → actionRegistry()` declares public/authenticated status, read/write behavior, permission key, sensitive field rules, feature key, optional target/scope resolver, and handler. `Permissions.check()` then applies:

1. validated session and active user;
2. explicit DENY;
3. union of roles, active ALLOW overrides, and active delegations;
4. permission presence (or built-in Super Admin);
5. record scope;
6. sensitive-field rule;
7. feature switch;
8. maker-checker;
9. role/grant condition;
10. handler and applicable audit write.

Deny always beats allow. Feature flags are default-off when referenced but absent. Super Admin remains subject to explicit DENY, feature switches, sensitive DENY overrides, and maker-checker rules.
