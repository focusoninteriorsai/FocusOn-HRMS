# FOCUSON HRMS API reference

The browser talks to the Apps Script Web App with a single JSON contract.

## Transport

```json
POST /exec   Content-Type: text/plain;charset=utf-8
{"action":"leave.apply","token":"<session token>","payload":{...},"reqId":"<uuid>"}
```

Success: `{"ok":true,"data":{...},"reqId":"..."}`. Failure: `{"ok":false,"error":{"code":"VALIDATION","message":"...","details":{}},"reqId":"..."}`.

Error codes: `AUTH_REQUIRED`, `SESSION_EXPIRED`, `FORBIDDEN`, `VALIDATION`, `NOT_FOUND`, `LOCKED`, `RATE_LIMITED`, `CONFLICT`, `SERVER`.

Every action below is registered in `backend/Actions.gs`. Anything not registered returns `NOT_FOUND`; the frontend therefore cannot present a screen whose backend does not exist. `read`/`self` actions are non-mutating GET-style reads, `write` actions mutate and are audited.

`self` actions need no permission key: they always operate on the caller's own records. `read`/`write` actions require the listed permission and re-check scope, feature switch, sensitive-field rules, maker-checker and role conditions on the server.

Sensitive values (salary, PAN, Aadhaar, bank details, medical) are removed from a response unless the caller holds the corresponding field rule.

## Access administration

| Action | Type | Permission |
| --- | --- | --- |
| `access.bootstrap` | self | — |
| `access.users` | read | `user.view` |
| `access.createUser` | write | `user.create` |
| `access.resetPassword` | write | `user.resetpassword` |
| `access.setUserStatus` | write | `user.resetpassword` |
| `access.sessions` | read | `user.view` |
| `access.revokeSession` | self | — |
| `access.roles` | read | `role.define` |
| `access.saveRole` | write | `role.define` |
| `access.saveRolePermissions` | write | `role.define` |
| `access.deleteRole` | write | `role.define` |
| `access.assignRole` | write | `role.assign` |
| `access.unassignRole` | write | `role.assign` |
| `access.employeeAccess` | read | `user.view` |
| `access.saveOverride` | write | `override.grant` |
| `access.deleteOverride` | write | `override.grant` |
| `access.saveDelegation` | write | `workflow.delegate` |
| `access.deleteDelegation` | write | `workflow.delegate` |
| `access.auditLog` | read | `accesslog.view` |
| `access.featureScopes` | read | `settings.view` |
| `access.saveFeatureScope` | write | `settings.edit` |
| `access.deleteFeatureScope` | write | `settings.edit` |

## Dashboard

| Action | Type | Permission |
| --- | --- | --- |
| `dashboard.get` | self | — |

## Self profile

| Action | Type | Permission |
| --- | --- | --- |
| `profile.get` | self | — |

## Employees

| Action | Type | Permission |
| --- | --- | --- |
| `employees.list` | read | `employee.view` |
| `employees.detail` | read | `employee.view` |
| `employees.create` | write | `employee.create` |
| `employees.update` | write | `employee.edit` |
| `employees.status` | write | `employee.delete` |
| `employees.import` | write | `employee.create` |
| `employees.export` | read | `employee.export` |
| `employees.picker` | read | `employee.view` |
| `employees.requestChange` | self | — |
| `employees.myChanges` | self | — |
| `employees.nextId` | read | `employee.create` |

## Organization

| Action | Type | Permission |
| --- | --- | --- |
| `org.list` | read | `org.view` |
| `org.save` | write | `org.edit` |
| `org.remove` | write | `org.delete` |
| `org.tree` | read | `org.view` |

## Attendance

| Action | Type | Permission |
| --- | --- | --- |
| `attendance.today` | self | — |
| `attendance.markSelf` | self | — |
| `attendance.register` | read | `attendance.view` |
| `attendance.mark` | write | `attendance.markothers` |
| `attendance.requestRegularization` | self | — |
| `attendance.regularizations` | self | — |
| `attendance.monthly` | self | — |
| `attendance.lockMonth` | write | `attendance.lock` |
| `attendance.unlockMonth` | write | `attendance.lock` |

## Leave

| Action | Type | Permission |
| --- | --- | --- |
| `leave.myLeave` | self | — |
| `leave.apply` | self | — |
| `leave.cancel` | self | — |
| `leave.register` | read | `leave.view` |
| `leave.saveType` | write | `leave.manage` |
| `leave.adjustBalance` | write | `leave.manage` |
| `leave.runAccrual` | write | `leave.manage` |
| `leave.calendar` | self | — |

## Payroll

| Action | Type | Permission |
| --- | --- | --- |
| `payroll.salaryIndex` | read | `salary.view` |
| `payroll.structureDetail` | read | `salary.view` |
| `payroll.saveStructure` | write | `salary.edit` |
| `payroll.requestRevision` | write | `salary.revise` |
| `payroll.runs` | read | `payroll.view` |
| `payroll.prepare` | write | `payroll.prepare` |
| `payroll.runDetail` | read | `payroll.view` |
| `payroll.verify` | write | `payroll.verify` |
| `payroll.approve` | write | `payroll.approve` |
| `payroll.release` | write | `payroll.release` |
| `payroll.close` | write | `payroll.release` |
| `payroll.reopen` | write | `payroll.reopen` |
| `payroll.myPayslips` | self | — |
| `payroll.payslip` | self | — |
| `payroll.statutoryReport` | read | `payroll.view` |

## Expenses and advances

| Action | Type | Permission |
| --- | --- | --- |
| `money.expenses` | self | — |
| `money.submitExpense` | self | — |
| `money.payExpense` | write | `advance.disburse` |
| `money.loans` | self | — |
| `money.requestLoan` | self | — |
| `money.disburseLoan` | write | `advance.disburse` |

## Documents

| Action | Type | Permission |
| --- | --- | --- |
| `documents.list` | self | — |
| `documents.saveTemplate` | write | `document.template.manage` |
| `documents.generate` | self | — |
| `documents.detail` | self | — |
| `documents.upload` | self | — |
| `documents.download` | self | — |
| `documents.expiring` | read | `document.view` |

## Recruitment

| Action | Type | Permission |
| --- | --- | --- |
| `recruitment.list` | read | `recruitment.view` |
| `recruitment.openingDetail` | read | `recruitment.view` |
| `recruitment.saveOpening` | write | `recruitment.edit` |
| `recruitment.saveCandidate` | write | `recruitment.edit` |
| `recruitment.moveStage` | write | `recruitment.edit` |
| `recruitment.scheduleInterview` | write | `recruitment.edit` |
| `recruitment.releaseOffer` | write | `recruitment.approve` |
| `recruitment.convert` | write | `recruitment.approve` |

## Performance

| Action | Type | Permission |
| --- | --- | --- |
| `performance.list` | self | — |
| `performance.detail` | self | — |
| `performance.openCycle` | write | `performance.create` |
| `performance.saveGoals` | self | — |
| `performance.selfReview` | self | — |
| `performance.managerReview` | write | `performance.approve` |

## Exit management

| Action | Type | Permission |
| --- | --- | --- |
| `exit.list` | self | — |
| `exit.submit` | self | — |
| `exit.updateClearance` | write | `exit.edit` |
| `exit.settlement` | read | `exit.view` |
| `exit.complete` | write | `exit.approve` |

## Assets

| Action | Type | Permission |
| --- | --- | --- |
| `assets.list` | read | `asset.view` |
| `assets.myAssets` | self | — |
| `assets.save` | write | `asset.manage` |
| `assets.assign` | write | `asset.manage` |
| `assets.return` | write | `asset.manage` |

## Announcements

| Action | Type | Permission |
| --- | --- | --- |
| `announcements.list` | self | — |
| `announcements.save` | write | `announcement.manage` |
| `announcements.remove` | write | `announcement.manage` |

## Reports

| Action | Type | Permission |
| --- | --- | --- |
| `reports.generate` | self | — |
| `reports.export` | self | — |

## Approvals

| Action | Type | Permission |
| --- | --- | --- |
| `workflow.inbox` | read | `workflow.inbox` |
| `workflow.detail` | self | — |
| `workflow.decide` | self | — |
| `workflow.definitions` | read | `workflow.define` |
| `workflow.saveDefinition` | write | `workflow.define` |

## Notifications

| Action | Type | Permission |
| --- | --- | --- |
| `notifications.list` | self | — |
| `notifications.markRead` | self | — |

## Settings

| Action | Type | Permission |
| --- | --- | --- |
| `settings.get` | read | `settings.view` |
| `settings.update` | write | `settings.edit` |
| `settings.updateFeatures` | write | `settings.edit` |

## Google Workspace integration

Every action is registered behind the same permission chain as the rest of the app. Delivery channels are Settings-gated and fail soft: a disabled channel returns `{ok:false, skipped:true}` instead of an error, and a delivery failure is audited rather than thrown.

| Action | Type | Permission |
| --- | --- | --- |
| `google.status` | read | `settings.view` |
| `google.testMail` | write | `settings.edit` |
| `google.testChat` | write | `settings.edit` |
| `google.syncContacts` | write | `employee.edit` |
| `google.createCalendarEvent` | write | `settings.edit` |
| `google.mailDigest` | write | `settings.edit` |

`google.status` reports `account`, `mail {enabled, quota}`, `calendar`, `chat`, `contacts`, `tasks` and `docs` switches plus the resolved `calendarId` and settings keys. It never sends anything.

## System and maintenance

| Action | Type | Permission |
| --- | --- | --- |
| `system.selfTest` | read | `settings.view` |
| `system.runSetup` | write | `settings.edit` |
| `system.runMaintenance` | write | `settings.edit` |

## Backup and restore

| Action | Type | Permission |
| --- | --- | --- |
| `backup.list` | read | `backup.create` |
| `backup.create` | write | `backup.create` |
| `backup.verify` | write | `backup.create` |
| `backup.restore` | write | `backup.restore` |

## Request shapes for the common writes

Payload keys are validated server-side; unknown keys are ignored, missing required keys fail with `VALIDATION` and a `details.fields` map.

| Action | Payload |
| --- | --- |
| `auth.login` | `{employeeId, password}` → `{token, mustChangePassword, effectivePermissions, scopes, user, session}` |
| `employees.create` / `employees.update` | `{employeeId?, displayName, workEmail, mobile, departmentId, designation, branchId, reportingManagerId, joiningDate, employmentType, ...}` |
| `employees.status` | `{employeeId, status:'ACTIVE'\|'INACTIVE', reason}` |
| `org.save` | `{entity:'Departments'\|'Designations'\|'Branches'\|'Sites'\|'Holidays', id?, ...fields}` |
| `attendance.markSelf` | `{action:'CHECK_IN'\|'CHECK_OUT', latitude?, longitude?, accuracy?}` |
| `attendance.mark` | `{employeeId, date, checkInAt, checkOutAt, note}` |
| `attendance.requestRegularization` | `{date, reason (≥10 chars)}` |
| `attendance.lockMonth` / `unlockMonth` | `{month:'YYYY-MM', reason?}` |
| `leave.apply` | `{leaveTypeId, startDate, endDate, halfDayPeriod, reason (≥5), contactDuringLeave, handoverTo, attachmentFileId}` |
| `leave.saveType` | `{leaveTypeId?, code, name, annualQuota, ...}` |
| `payroll.saveStructure` | `{employeeId, monthlyGross, payableDaysDivisor, components[]}` |
| `payroll.prepare` | `{period:'YYYY-MM'}` |
| `payroll.verify` / `approve` / `release` / `close` | `{runId}` |
| `payroll.reopen` | `{runId, reason (≥10)}` |
| `money.submitExpense` | `{amount, category, expenseDate, receiptFileId, description}` |
| `documents.generate` | `{templateId?, employeeId, title, body?}` |
| `recruitment.saveOpening` | `{openingId?, title, departmentId, headcount, priority, ...}` |
| `recruitment.saveCandidate` | `{candidateId?, openingId, name, email, phone, stage, source, ...}` |
| `recruitment.moveStage` | `{candidateId, stage}` |
| `recruitment.convert` | `{candidateId, employeeId?, joiningDate, ...}` |
| `performance.saveGoals` | `{reviewId, goals:[{text, weight, target}]}` (weights total 100) |
| `performance.selfReview` / `managerReview` | `{reviewId, ratings, comments, strengths, improvements}` |
| `exit.submit` | `{employeeId, exitType, resignationDate, lastWorkingDate, noticeDays}` |
| `exit.updateClearance` | `{exitId, clearance:[{line, cleared}]}` |
| `workflow.decide` | `{requestId, decision:'APPROVE'\|'REJECT'\|'RETURN'\|'OVERRIDE', comment, overrideReason?}` |
| `workflow.saveDefinition` | `{requestType, replaceActive, steps:[{stepType, approverRule, roleCode?, permission?, employeeId?, slaHours}]}` |
| `reports.generate` | `{type:'headcount'\|'attendance'\|'leave'\|'payroll'\|'expiry', month\|year}` |
| `reports.export` | same as `reports.generate` → `{fileName, csv}` |
| `settings.update` | `{values:{key:value}}` (unknown keys and `SCHEMA_VERSION` are rejected) |
| `settings.updateFeatures` | `{features:{moduleKey:boolean}}` |
| `notifications.markRead` | `{all:true}` or `{ids:[...]}` (or `{notificationId}`) |
| `backup.create` | `{type}` |
| `backup.verify` | `{backupId}` |
| `backup.restore` | `{backupId, confirmation:'RESTORE', reason (≥15)}` |
| `system.selfTest` | `{}` → `{score, passed, total, checks[]}` |
| `google.testMail` | `{to?}` → `{to, messageId, quota}`; defaults to the caller's work email |
| `google.testChat` | `{text?}` → `{posted:true}`; needs `GOOGLE_CHAT_WEBHOOK_URL` |
| `google.syncContacts` | `{}` → `{synced, failed, total, enabled}` (max 100 employees per call) |
| `google.createCalendarEvent` | `{holidayId}` → `{eventId}`; all-day event on the holiday date |
| `google.mailDigest` | `{}` → `{sent, approvers}`; one message per approver with their open count |
