# FOCUSON HRMS - Security & Hardening Architecture

This document outlines the security architecture, threat model, and defense-in-depth safeguards implemented in FOCUSON HRMS.

---

## 1. Zero-Trust Security Philosophy

The system enforces a **Server-Side Authoritative** security model:
- The frontend UI hides buttons, menus, and views strictly for visual convenience.
- Every API invocation re-authenticates the session token, recalculates active permissions, validates scope boundaries, verifies feature flags, and checks segregation-of-duties rules before reading or writing any data.

---

## 2. Authentication & Credential Storage

### 2.1 Password Storage & Cryptography
- Plaintext passwords are never stored, transmitted in URLs, or logged.
- Passwords are hashed using **per-user cryptographic salt** + **server-side pepper** (stored in Google Apps Script `Script Properties`) + **1,000 iterations of HMAC-SHA256** using Google Apps Script's `Utilities` service.
- First login or administrative reset triggers a mandatory `must_change_password: true` flag. The router blocks navigation to all other routes until a new password meeting complexity criteria (minimum 8 characters) is saved.

### 2.2 Session Management
- Session tokens are generated cryptographically (`fcs_` + UUID + random bytes).
- Only the **SHA-256 hash** of the session token is stored in the `Sessions` sheet.
- Sessions automatically expire after 12 hours of absolute duration or after 30 minutes of client-side inactivity.
- "Log Out All Devices" immediately revokes all active session hashes associated with the user account.

### 2.3 Brute-Force Rate Limiting & Account Lockout
- Failed login attempts are tracked per Employee ID using `CacheService`.
- Exceeding 5 failed attempts triggers an automated 15-minute temporary lockout.
- Authentication responses return generic error messages ("Invalid credentials or inactive account") to prevent Employee ID enumeration attacks.

---

## 3. Access Control (9-Step Evaluation Order)

Every request touching data is evaluated in this exact sequence:

1. **Session & User Validation**: Token must match an active session hash; employee status must be `ACTIVE`.
2. **Explicit DENY Override**: User-specific `DENY` overrides take absolute precedence over any granted role.
3. **Union of Grants**: Roles + Active `ALLOW` overrides + Active Delegations.
4. **Catalog Presence**: The requested `module.action` key must exist in `Permissions_Catalog`.
5. **Scope Check**: Target entity must fall within the actor's scope (`Self`, `Direct reports`, `Team` [recursive downline], `Department`, `Branch`, `Company`).
6. **Field-Level Protection**: Sensitive fields (`basic_salary`, `ctc_annual`, `bank_account_number`, `pan_number`, `aadhaar_number`) are masked unless explicit field view permissions are held.
7. **Feature Switch**: The underlying module or action must be enabled in `Feature_Flags`.
8. **Maker-Checker Segregation of Duties**: A user who prepared a record (e.g. prepared payroll run) is strictly blocked from verifying, approving, or releasing that run.
9. **Condition Checks**: Ceiling limits (e.g., maximum approval amount) are verified.
10. **Audit Log**: The outcome is immutably recorded in `Audit_Logs`.

---

## 4. Formula Injection Protection (CSV / Spreadsheet Injection)

Google Sheets evaluates cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` as formulas. 
- In `Utils.sanitizeForSheet()`, all user-supplied text values starting with these characters are automatically prefixed with an apostrophe (`'`).
- This renders malicious formulas as plain literal strings, eliminating remote code execution or data exfiltration via spreadsheet export.

---

## 5. Leaver Rule (Automated Separation Protocol)

When an employee is deactivated (`employee.deactivate`):
1. Employee record is marked `INACTIVE`.
2. Associated login account in `Users` is immediately set to `INACTIVE`.
3. All active session tokens across all devices are permanently revoked.
4. All pending approval requests currently assigned to the exited employee are automatically reassigned to the department head or Super Admin, preventing stalled company workflows.

---

## 6. Geofence Spoofing Mitigations & Disclosures

HTML5 Geolocation relies on operating system location providers. Browsers running on rooted or developer-enabled mobile devices can spoof GPS coordinates via third-party mock GPS apps. To mitigate this risk without requiring proprietary native spyware:
- High accuracy is requested (`enableHighAccuracy: true`).
- Very low accuracy signals (>300m) are automatically flagged as anomalies.
- In-app verification selfies are compressed client-side and saved to private Drive storage.
- Anomaly flags (`OUTSIDE_RADIUS`, `LOW_ACCURACY`) alert HR and managers during review.
