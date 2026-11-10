# FOCUSON HRMS - Web App API Reference

The FOCUSON HRMS backend operates as a Google Apps Script Web App JSON API.

---

## 1. Request & Response Contract

### 1.1 Request Specification
- **Method**: `POST`
- **Content-Type**: `text/plain;charset=utf-8` (avoids CORS preflight restrictions)
- **Body**:
```json
{
  "action": "module.actionName",
  "token": "fcs_session_token_string",
  "payload": { ... },
  "reqId": "req_unique_id"
}
```

### 1.2 Success Envelope
```json
{
  "ok": true,
  "data": { ... },
  "reqId": "req_unique_id"
}
```

### 1.3 Error Envelope & Stable Error Codes
```json
{
  "ok": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Specific human-readable message"
  },
  "reqId": "req_unique_id"
}
```

| Error Code | Description |
|---|---|
| `AUTH_REQUIRED` | Missing or invalid session token |
| `SESSION_EXPIRED`| Session token has expired or was revoked |
| `FORBIDDEN` | Missing permission, outside scope, or SoD violation |
| `VALIDATION` | Mandatory field missing or malformed input |
| `NOT_FOUND` | Target record or action does not exist |
| `LOCKED` | Concurrency lock timeout or account temporarily locked |
| `CONFLICT` | State conflict (e.g. duplicate punch or duplicate run) |
| `SERVER` | Internal unhandled exception |

---

## 2. API Action Catalog

### Public Actions (No Token)
- `public.config`: Returns safe branding (name, logo, notice, theme).
- `auth.login`: Payload `{ employeeId, password }`. Returns `{ token, user, mustChangePassword, effectivePermissions }`.

### Authentication
- `auth.validateSession`: Validates token and returns current user context.
- `auth.changePassword`: Payload `{ currentPassword, newPassword }`.
- `auth.logout`: Invalidates current session token.
- `auth.logoutAll`: Revokes all active sessions for the authenticated user.

### Organization & Workforce
- `org.get`: Returns branches, departments, designations, and sites.
- `org.saveDepartment`, `org.saveDesignation`, `org.saveBranch`, `org.saveSite`.
- `employee.list`: Payload `{ filters: { status, department, branch } }`.
- `employee.get`: Payload `{ employeeId }`.
- `employee.save`: Payload `{ employee_id, first_name, ... }`.
- `employee.deactivate`: Payload `{ employeeId, reason }`.

### Attendance & Leaves
- `attendance.checkIn`: Payload `{ latitude, longitude, accuracy, selfie_base64 }`.
- `attendance.checkOut`: Payload `{ latitude, longitude }`.
- `attendance.getMyLog`: Payload `{ monthYear }`.
- `attendance.regularize`: Payload `{ date, requested_check_in, requested_check_out, reason }`.
- `leave.getTypes`: Returns active leave categories.
- `leave.getMyBalances`: Returns available leave ledger balances.
- `leave.apply`: Payload `{ leave_type_code, start_date, end_date, is_half_day, reason }`.

### Payroll & Finance
- `payroll.prepareRun`: Payload `{ monthYear }`.
- `payroll.verifyRun`: Payload `{ runId }`. Enforces Maker != Verifier.
- `payroll.approveRun`: Payload `{ runId }`. Enforces Maker/Verifier != Approver.
- `payroll.releaseRun`: Payload `{ runId }`.
- `payroll.exportBankCsv`: Payload `{ runId }`. Returns formatted bank transfer CSV.
- `expenses.list`, `expenses.apply`: Expense claims and reimbursement submissions.

### Workflow & Inbox
- `workflow.inbox`: Returns pending approval items for authenticated user.
- `workflow.action`: Payload `{ approval_id, action: 'APPROVE' | 'REJECT', comments }`.

### Security, Settings & Diagnostics
- `settings.get`, `settings.save`: Master configuration and CA statutory rates.
- `roles.list`, `roles.save`, `roles.assign`: Role builder and user role assignment.
- `permissions.getCatalog`: Complete catalog of granular system permissions.
- `backup.create`, `backup.list`: Database snapshots and recovery logs.
- `tests.run`: Executes the 14-case automated security and compliance test suite.
