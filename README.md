# FOCUSON HRMS

**FOCUSON HRMS** is an enterprise-grade, production-ready Human Resources and Payroll web application built for 80 to 300+ employees. It runs with zero database subscription costs by leveraging Google Apps Script as a JSON API, Google Sheets as a relational datastore, and Google Drive for secure file storage, with a responsive static frontend hosted on GitHub Pages.

---

## Architecture Overview

```
┌────────────────────────────────────────┐
│   GitHub Pages Frontend (Static)       │
│   Vanilla ES Modules, Astra Theme      │
│   Hash Routing, WCAG AA Dark/Light     │
└──────────────────┬─────────────────────┘
                   │ POST (text/plain JSON)
                   ▼
┌────────────────────────────────────────┐
│   Google Apps Script Web App API       │
│   Action Dispatcher & 9-Step RBAC      │
│   Iterated HMAC-SHA256 Auth & Sessions │
└─────────┬──────────────────┬───────────┘
          │                  │
          ▼                  ▼
┌──────────────────┐ ┌───────────────────┐
│  Google Sheets   │ │   Google Drive    │
│  HRMS_CORE_DB    │ │ Private Storage:  │
│  Attendance/Year │ │ Documents/Selfies │
└──────────────────┘ └───────────────────┘
```

- **Frontend:** Static SPA hosted on GitHub Pages or any static CDN. Pure vanilla HTML5, CSS3 with Astra design system variables, and modern ES modules. No Node build pipeline or compilation step required.
- **Backend:** Google Apps Script Web App deployed as *Execute as Me*, *Access Anyone*. Employs a single action dispatcher using `POST` with `Content-Type: text/plain;charset=utf-8` to bypass browser CORS preflight restrictions.
- **Database:** Google Sheets accessed via batched operations in `Database.gs`, protected with LockService and formula-injection guards (`= + - @ \t \r` escaped with `'`).
- **File Storage:** Private Google Drive folders for employee documents, geofence verification selfies, and generated payslips.
- **Access Control:** 9-step evaluation engine enforcing Default Deny, explicit DENY override precedence, recursive downline team scopes, field-level financial masking, and maker-checker segregation of duties.

---

## Core Security Tenets

1. **Server-Side Authoritative:** The server validates session, permissions, scope, and segregation of duties on every action. Frontend UI gating exists solely for convenience.
2. **Zero Hardcoded Secrets:** No spreadsheet IDs, passwords, or salts exist in source code. All secrets and server peppers reside exclusively in Script Properties.
3. **Cryptographic Protection:** Passwords use user-specific salts combined with a server pepper, hashed via iterated HMAC-SHA256. Session tokens are generated cryptographically and stored only as SHA-256 hashes.
4. **Formula Injection Guard:** All user inputs stored in spreadsheets are prefixed with `'` if starting with calculation characters (`=`, `+`, `-`, `@`).
5. **Maker-Checker Segregation:** A user who prepares a payroll run or financial transaction is strictly prevented from verifying, approving, or releasing that run.

---

## Assumptions & Design Decisions

- **Browser Geo-Fencing:** HTML5 Geolocation provides GPS coordinates and accuracy circles. As documented in Section 7 of the specification, browsers cannot reliably detect simulated GPS apps; therefore, the system relies on server-side Haversine validation, accuracy thresholds, anomaly flags, and optional selfie capture.
- **Dual Language Support:** English and Hindi strings are maintained in separate JSON dictionaries (`assets/i18n/en.json` and `hi.json`), switchable on demand and saved per user.
- **Simple Mode:** Designed for storekeeper and basic mobile users on slow networks, providing 4 large direct touch actions (Check-in, Leave, Payslip, Profile).

---

## Implementation Roadmap

- **Phase 1 (Complete):** Repo skeleton, Astra design system (tokens, components, animations, pages), responsive `index.html` landing & login card, app shell, router, i18n engine, theme manager, API client; backend `Code.gs`, `Utils.gs`, `Database.gs`, `Setup.gs`, `Auth.gs`, `Audit.gs`, `Permissions.gs`, `public.config`, and `DEPLOYMENT.md`.
- **Phase 2:** Super Admin Console, Role Builder, Permission Matrix, Authority Setup, User Access, Feature Switches, Audit Viewer, Branding Studio, Org Setup, Employees, Users, Workflow Engine, Approval Inbox.
- **Phase 3:** Attendance Policies, Geo-fencing Haversine validation, Optional Selfie capture, Regularization, Leave Management, Calendar, Triggers.
- **Phase 4:** Statutory Payroll Runs, Salary Structures, Loans/Advances, Payslip PDF Generation, Bank Transfer Sheets, Reports.
- **Phase 5:** Recruitment, Performance, Exit/F&F, RDash Integration, Backup/Restore, PWA Offline Shell, Full Automated Test Suite (`Tests.gs`), Security & Admin Documentation.
