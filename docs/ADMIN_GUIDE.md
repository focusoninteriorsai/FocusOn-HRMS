# FOCUSON HRMS - Administrator & Authority Guide

This guide details day-to-day administrative governance, role building, statutory parameters, and disaster recovery.

---

## 1. Super Admin vs Delegated Authorities

- **Super Admin (Max 2 Accounts)**: Built-in immutable role with full system privileges. Only Super Admins can configure system settings, statutory parameters, execute disaster restores, and assign authority profiles.
- **Delegated Authority (CEO / Directors / HR Head)**: Granted an **Authority Profile** defining:
  - Allowed Scope (e.g. specific departments or branches)
  - Capability Ceiling (the subset of permissions they are authorized to grant to subordinate staff)
  - Validity Dates
  - *Authorities can never grant permissions beyond their ceiling, modify Super Admin accounts, or escalate their own privileges.*

---

## 2. Managing Roles & Permissions (Role Builder)

Navigate to **Super Admin Console** > **Roles & Matrix**:
1. Click **+ Create New Role**.
2. Provide a unique code (e.g., `ROLE_SITE_SUPERVISOR`) and human-readable name.
3. Select granted permissions from the catalog.
4. Set default scope (e.g. `Direct reports`, `Team`, or `Department`).
5. Save the role.
6. To assign to an employee: Navigate to **Employee Directory** > Select Employee > Assign Role.

---

## 3. Configuring Geofence Locations & Attendance Policies

### 3.1 Geofence Locations
1. Go to **Settings** > **Geofences**.
2. Add branch latitude, longitude, and radius in meters (typically 100m to 200m).
3. Set minimum GPS accuracy threshold (recommended: 100m).

### 3.2 Attendance Policies
- **Office Geofenced Policy (`POL_OFFICE`)**: Requires GPS coordinates within registered geofence radius. Prompts for selfie if selfie switch is active.
- **Site / Field Policy (`POL_SITE`)**: Never requests GPS coordinates or blocks check-in; suitable for mobile engineers, site supervisors, and traveling staff.
- **Exempt / Flexible Policy (`POL_EXEMPT`)**: Excluded from strict tardiness calculations and punch window limits.

---

## 4. Statutory & Payroll Setup (CA Verified)

Navigate to **Super Admin Console** > **Statutory & CA**:
1. Enter the company's verified statutory percentages:
   - **PF Employee Rate**: Standard 12%
   - **PF Employer Rate**: Standard 12%
   - **PF Wage Ceiling**: Standard ₹15,000
   - **ESI Employee Rate**: Standard 0.75%
   - **ESI Wage Ceiling**: Standard ₹21,000
   - **Payable Days Divisor**: Standard 30 days
   - **Professional Tax (PT)**: Regional slab (e.g. ₹200)
2. Save parameters.
3. **Mandatory Check:** Payroll will display a block message if any of these required values are missing.

---

## 5. Disaster Recovery & Backup Protocol

### 5.1 Automated Nightly Backups
- The time-driven trigger runs automatically at 02:00 AM IST.
- Copies both `FOCUSON_HRMS_CORE_DB` and `FOCUSON_HRMS_ATTENDANCE_<YEAR>` spreadsheets to the private Google Drive `Backups` folder with timestamped filenames.
- Verifies and logs row-count integrity in `Backup_Logs`.

### 5.2 Manual Backup
1. In **Super Admin Console** > **Backups**, click **Create Manual Backup Now**.
2. A verified snapshot is saved immediately.
