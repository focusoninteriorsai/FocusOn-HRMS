/**
 * Every configurable value in the system. The Super Admin can change all of them
 * from the Settings screen (grouped by module) without editing code. Definitions
 * declare type, bounds, options and defaults; validation happens on the server.
 */
var Settings = (function () {
  var TYPES = ['text', 'textarea', 'number', 'boolean', 'select', 'json', 'color', 'time', 'month', 'url'];

  function def(key, category, label, type, value, extra) {
    var output = {
      key: key, category: category, label: label, type: type, value: value,
      options: [], min: null, max: null, help: '', group: '', secret: false
    };
    Object.keys(extra || {}).forEach(function (name) { output[name] = extra[name]; });
    return output;
  }

  /** Ordered definition list. Group order follows this array. */
  var DEFS = [
    // ---------------- Company profile ----------------
    def('COMPANY_NAME', 'COMPANY', 'Company name', 'text', 'FOCUSON HRMS', { group: 'Profile' }),
    def('COMPANY_LEGAL_NAME', 'COMPANY', 'Registered legal name', 'text', '', { group: 'Profile' }),
    def('COMPANY_TAGLINE', 'COMPANY', 'Tagline', 'text', '', { group: 'Profile' }),
    def('COMPANY_LOGO_URL', 'COMPANY', 'Logo URL', 'url', '', { group: 'Profile', help: 'Same-origin path or an uploaded image.' }),
    def('COMPANY_ADDRESS', 'COMPANY', 'Registered address', 'textarea', '', { group: 'Profile' }),
    def('COMPANY_CITY', 'COMPANY', 'City', 'text', '', { group: 'Profile' }),
    def('COMPANY_STATE', 'COMPANY', 'State', 'text', '', { group: 'Profile' }),
    def('COMPANY_PINCODE', 'COMPANY', 'PIN code', 'text', '', { group: 'Profile' }),
    def('COMPANY_COUNTRY', 'COMPANY', 'Country', 'text', 'India', { group: 'Profile' }),
    def('COMPANY_PHONE', 'COMPANY', 'Phone', 'text', '', { group: 'Contact' }),
    def('COMPANY_EMAIL', 'COMPANY', 'Email', 'text', '', { group: 'Contact' }),
    def('COMPANY_WEBSITE', 'COMPANY', 'Website', 'text', '', { group: 'Contact' }),
    def('COMPANY_HR_EMAIL', 'COMPANY', 'HR contact email', 'text', '', { group: 'Contact' }),
    def('COMPANY_HR_PHONE', 'COMPANY', 'HR contact phone', 'text', '', { group: 'Contact' }),
    def('COMPANY_GSTIN', 'COMPANY', 'GSTIN', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_CIN', 'COMPANY', 'CIN', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_PAN', 'COMPANY', 'Company PAN', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_PF_CODE', 'COMPANY', 'PF establishment code', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_ESI_CODE', 'COMPANY', 'ESI establishment code', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_PT_STATE', 'COMPANY', 'Professional Tax state', 'text', '', { group: 'Statutory identifiers' }),
    def('COMPANY_TAN', 'COMPANY', 'TAN', 'text', '', { group: 'Statutory identifiers' }),
    def('FINANCIAL_YEAR_START_MONTH', 'COMPANY', 'Financial year starts in month', 'select', '4', { group: 'Locale', options: [['1', 'January'], ['4', 'April'], ['7', 'July'], ['10', 'October']] }),
    def('CURRENCY_CODE', 'COMPANY', 'Currency code', 'text', 'INR', { group: 'Locale' }),
    def('CURRENCY_SYMBOL', 'COMPANY', 'Currency symbol', 'text', '₹', { group: 'Locale' }),
    def('DATE_FORMAT', 'COMPANY', 'Date display format', 'select', 'dd MMM yyyy', { group: 'Locale', options: [['dd MMM yyyy', '31 Dec 2025'], ['dd/MM/yyyy', '31/12/2025'], ['MM/dd/yyyy', '12/31/2025'], ['yyyy-MM-dd', '2025-12-31']] }),
    def('TIME_FORMAT', 'COMPANY', 'Time display format', 'select', '24', { group: 'Locale', options: [['24', '24 hour'], ['12', '12 hour']] }),
    def('WEEK_START_DAY', 'COMPANY', 'Week starts on', 'select', '1', { group: 'Locale', options: [['0', 'Sunday'], ['1', 'Monday'], ['6', 'Saturday']] }),
    def('WORKWEEK_DAYS', 'COMPANY', 'Working days', 'json', '[1,2,3,4,5]', { group: 'Locale', help: 'JSON array of weekday numbers, 0 = Sunday.' }),
    def('DEFAULT_LANGUAGE', 'COMPANY', 'Default language', 'select', 'en', { group: 'Locale', options: [['en', 'English'], ['hi', 'हिन्दी']] }),
    def('DEFAULT_THEME', 'COMPANY', 'Default theme', 'select', 'light', { group: 'Locale', options: [['light', 'Light'], ['dark', 'Dark']] }),
    def('LOGIN_NOTICE', 'COMPANY', 'Login page notice', 'textarea', '', { group: 'Login page' }),
    def('PUBLIC_FEATURE_HIGHLIGHTS', 'COMPANY', 'Login page highlights', 'json', '[]', { group: 'Login page', help: 'JSON array of up to four short strings.' }),
    def('SHOW_EMPLOYEE_ID_ON_PAYSLIP', 'COMPANY', 'Show Employee ID on payslip', 'boolean', 'TRUE', { group: 'Documents' }),

    // ---------------- Branding ----------------
    def('BRAND_PRIMARY_COLOR', 'BRANDING', 'Primary colour', 'color', '#3157d5', { group: 'Theme' }),
    def('BRAND_ACCENT_COLOR', 'BRANDING', 'Accent colour', 'color', '#08756f', { group: 'Theme' }),
    def('BRAND_CORNER_RADIUS', 'BRANDING', 'Card corner radius (8-24 px)', 'number', '18', { group: 'Theme', min: 8, max: 24 }),
    def('BRAND_CARD_STYLE', 'BRANDING', 'Card style', 'select', 'soft', { group: 'Theme', options: [['flat', 'Flat'], ['soft', 'Soft'], ['glass', 'Glass']] }),
    def('BRAND_DENSITY', 'BRANDING', 'Interface density', 'select', 'comfortable', { group: 'Theme', options: [['comfortable', 'Comfortable'], ['compact', 'Compact']] }),
    def('BRAND_FONT', 'BRANDING', 'Font family', 'select', 'system', { group: 'Theme', options: [['system', 'System'], ['humanist', 'Humanist'], ['readable', 'Readable']] }),
    def('BRAND_ICON_STYLE', 'BRANDING', 'Icon style', 'select', 'outline', { group: 'Theme', options: [['outline', 'Outline'], ['filled', 'Filled']] }),
    def('LOGIN_BACKGROUND_TYPE', 'BRANDING', 'Login background', 'select', 'gradient', { group: 'Login background', options: [['solid', 'Solid'], ['gradient', 'Gradient'], ['animated', 'Animated']] }),
    def('LOGIN_BACKGROUND_PRESET', 'BRANDING', 'Background preset', 'select', 'astra', { group: 'Login background', options: [['astra', 'Astra'], ['dawn', 'Dawn'], ['mono', 'Mono']] }),
    def('LOGIN_BACKGROUND_OVERLAY_OPACITY', 'BRANDING', 'Background overlay (0-0.9)', 'number', '0', { group: 'Login background', min: 0, max: 0.9 }),
    def('LOGIN_BACKGROUND_BLUR', 'BRANDING', 'Background blur (0-20 px)', 'number', '0', { group: 'Login background', min: 0, max: 20 }),
    def('DOCUMENT_WATERMARK_TEXT', 'BRANDING', 'Document watermark text', 'text', 'FOCUSON HRMS', { group: 'Documents' }),
    def('PAYSLIP_HEADER_NOTE', 'BRANDING', 'Payslip header note', 'textarea', '', { group: 'Documents' }),
    def('PAYSLIP_FOOTER_NOTE', 'BRANDING', 'Payslip footer note', 'textarea', 'This is a computer-generated payslip.', { group: 'Documents' }),

    // ---------------- Security ----------------
    def('SESSION_IDLE_MINUTES', 'SECURITY', 'Idle session timeout (minutes)', 'number', '30', { group: 'Sessions', min: 5, max: 480 }),
    def('SESSION_ABSOLUTE_HOURS', 'SECURITY', 'Maximum session length (hours)', 'number', '12', { group: 'Sessions', min: 1, max: 168 }),
    def('SESSION_BIND_DEVICE', 'SECURITY', 'Bind session to device signal', 'boolean', 'TRUE', { group: 'Sessions' }),
    def('LOGIN_MAX_FAILED_ATTEMPTS', 'SECURITY', 'Failed sign-ins before lock', 'number', '5', { group: 'Sign-in defence', min: 3, max: 20 }),
    def('LOGIN_LOCK_MINUTES', 'SECURITY', 'Lock duration (minutes)', 'number', '15', { group: 'Sign-in defence', min: 1, max: 1440 }),
    def('LOGIN_GLOBAL_MAX_PER_MINUTE', 'SECURITY', 'Global sign-in attempts per minute', 'number', '100', { group: 'Sign-in defence', min: 20, max: 1000 }),
    def('PASSWORD_MIN_LENGTH', 'SECURITY', 'Minimum password length', 'number', '12', { group: 'Password policy', min: 8, max: 64 }),
    def('PASSWORD_REQUIRE_COMPLEXITY', 'SECURITY', 'Require complexity', 'boolean', 'TRUE', { group: 'Password policy' }),
    def('MAX_SUPER_ADMINS', 'SECURITY', 'Maximum Super Admin accounts', 'number', '3', { group: 'Privileged access', min: 1, max: 20 }),
    def('ENFORCE_CONSENT', 'SECURITY', 'Record employee consent for attendance media', 'boolean', 'TRUE', { group: 'Privacy' }),
    def('SELFIE_RETENTION_DAYS', 'SECURITY', 'Attendance selfie retention (days)', 'number', '90', { group: 'Privacy', min: 0, max: 3650 }),
    def('RAW_GPS_RETENTION_DAYS', 'SECURITY', 'Raw GPS retention (days)', 'number', '30', { group: 'Privacy', min: 0, max: 3650 }),
    def('AUDIT_RETENTION_DAYS', 'SECURITY', 'Audit log retention (days)', 'number', '365', { group: 'Privacy', min: 30, max: 3650 }),
    def('SESSION_RETENTION_DAYS', 'SECURITY', 'Session record retention (days)', 'number', '30', { group: 'Privacy', min: 7, max: 365 }),

    // ---------------- Attendance ----------------
    def('ATTENDANCE_PERIOD', 'ATTENDANCE', 'Attendance policy period', 'select', 'monthly', { group: 'Day rules', options: [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] }),
    def('ATTENDANCE_REQUIRE_LOCATION', 'ATTENDANCE', 'Require location for self check-in', 'boolean', 'TRUE', { group: 'Day rules' }),
    def('ATTENDANCE_REQUIRE_SELFIE', 'ATTENDANCE', 'Require selfie for self check-in', 'boolean', 'FALSE', { group: 'Day rules' }),
    def('ATTENDANCE_ALLOW_MANUAL', 'ATTENDANCE', 'Allow HR to mark attendance manually', 'boolean', 'TRUE', { group: 'Day rules' }),
    def('ATTENDANCE_AUTO_MARK_ABSENT', 'ATTENDANCE', 'Mark absent automatically when the day closes', 'boolean', 'TRUE', { group: 'Day rules' }),
    def('ATTENDANCE_GRACE_MINUTES', 'ATTENDANCE', 'Late grace period (minutes)', 'number', '10', { group: 'Day rules', min: 0, max: 240 }),
    def('ATTENDANCE_HALF_DAY_MINUTES', 'ATTENDANCE', 'Half-day threshold (worked minutes)', 'number', '240', { group: 'Day rules', min: 60, max: 600 }),
    def('ATTENDANCE_FULL_DAY_MINUTES', 'ATTENDANCE', 'Full-day worked minutes', 'number', '480', { group: 'Day rules', min: 120, max: 960 }),
    def('ATTENDANCE_LATE_MARKER_MINUTES', 'ATTENDANCE', 'Late marker after shift start (minutes)', 'number', '15', { group: 'Day rules', min: 0, max: 240 }),
    def('ATTENDANCE_OVERTIME_AFTER_MINUTES', 'ATTENDANCE', 'Overtime starts after (worked minutes)', 'number', '540', { group: 'Day rules', min: 0, max: 1440 }),
    def('ATTENDANCE_CHECKIN_EARLY_MINUTES', 'ATTENDANCE', 'Earliest check-in before shift (minutes)', 'number', '120', { group: 'Day rules', min: 0, max: 720 }),
    def('ATTENDANCE_LOCK_DAY', 'ATTENDANCE', 'Auto-lock previous month on day', 'number', '5', { group: 'Month close', min: 1, max: 28 }),
    def('ATTENDANCE_MONTHLY_SUMMARY', 'ATTENDANCE', 'Generate monthly summaries on lock', 'boolean', 'TRUE', { group: 'Month close' }),
    def('ATTENDANCE_REGULARIZATION_DAYS', 'ATTENDANCE', 'Regularization window (days back)', 'number', '15', { group: 'Regularization', min: 1, max: 180 }),
    def('GEOFENCE_DEFAULT_RADIUS_METERS', 'ATTENDANCE', 'Default geofence radius (metres)', 'number', '150', { group: 'Geofence', min: 25, max: 5000 }),
    def('GEOFENCE_MAX_ACCURACY_METERS', 'ATTENDANCE', 'Maximum accepted GPS accuracy (metres)', 'number', '120', { group: 'Geofence', min: 10, max: 1000 }),

    // ---------------- Leave ----------------
    def('LEAVE_YEAR_START_MONTH', 'LEAVE', 'Leave year starts in month', 'select', '1', { group: 'Policy', options: [['1', 'January'], ['4', 'April'], ['7', 'July']] }),
    def('LEAVE_ALLOW_HALF_DAY', 'LEAVE', 'Allow half-day leave', 'boolean', 'TRUE', { group: 'Policy' }),
    def('LEAVE_MAX_CONSECUTIVE_DAYS', 'LEAVE', 'Maximum consecutive leave days', 'number', '30', { group: 'Policy', min: 1, max: 365 }),
    def('LEAVE_ALLOW_NEGATIVE_BALANCE', 'LEAVE', 'Allow negative balance', 'boolean', 'FALSE', { group: 'Policy' }),
    def('LEAVE_COUNT_WEEKENDS', 'LEAVE', 'Count weekends and holidays in the requested span', 'boolean', 'FALSE', { group: 'Policy' }),
    def('LEAVE_REQUIRE_ATTACHMENT_AFTER_DAYS', 'LEAVE', 'Require attachment after (days)', 'number', '3', { group: 'Policy', min: 0, max: 90 }),
    def('LEAVE_APPROVAL_REQUIRED', 'LEAVE', 'Leave needs approval', 'boolean', 'TRUE', { group: 'Approvals' }),
    def('LEAVE_SANDBOX_APPLY_OUTSIDE_WINDOW', 'LEAVE', 'Allow back-dated applications', 'boolean', 'FALSE', { group: 'Policy' }),
    def('LEAVE_RETENTION_YEARS', 'LEAVE', 'Balance history retention (years)', 'number', '5', { group: 'Policy', min: 1, max: 20 }),

    // ---------------- Payroll ----------------
    def('PAYROLL_PAYABLE_DAYS_DIVISOR', 'PAYROLL', 'Payable days divisor', 'select', 'calendar', { group: 'Run rules', options: [['calendar', 'Calendar days in month'], ['fixed30', 'Fixed 30 days'], ['working', 'Working days in month']] }),
    def('PAYROLL_ROUNDING', 'PAYROLL', 'Net pay rounding', 'select', 'nearest_rupee', { group: 'Run rules', options: [['none', 'No rounding'], ['nearest_rupee', 'Nearest rupee'], ['nearest_10', 'Nearest 10 rupees']] }),
    def('PAYROLL_CUTOFF_DAY', 'PAYROLL', 'Attendance cut-off day of month', 'number', '25', { group: 'Run rules', min: 1, max: 31 }),
    def('PAYROLL_PAY_DAY', 'PAYROLL', 'Salary pay day', 'number', '1', { group: 'Run rules', min: 1, max: 31 }),
    def('PAYROLL_LOP_BASIS', 'PAYROLL', 'Loss-of-pay basis', 'select', 'gross', { group: 'Run rules', options: [['gross', 'Gross salary'], ['basic', 'Basic salary']] }),
    def('PAYROLL_REQUIRE_ATTENDANCE_LOCK', 'PAYROLL', 'Block run until attendance is locked', 'boolean', 'TRUE', { group: 'Run rules' }),
    def('PAYROLL_REQUIRE_CA_VERIFICATION', 'PAYROLL', 'Block run until statutory values are CA verified', 'boolean', 'TRUE', { group: 'Run rules' }),
    def('PAYROLL_SOD_STRICT', 'PAYROLL', 'Strict maker-checker (preparer cannot verify or approve)', 'boolean', 'TRUE', { group: 'Run rules' }),
    def('PAYROLL_DEFAULT_BASIC_PERCENT', 'PAYROLL', 'Default basic % of gross', 'number', '50', { group: 'Structure defaults', min: 20, max: 100 }),
    def('PAYROLL_DEFAULT_HRA_PERCENT', 'PAYROLL', 'Default HRA % of basic', 'number', '40', { group: 'Structure defaults', min: 0, max: 100 }),
    def('PAYROLL_DEFAULT_DA_PERCENT', 'PAYROLL', 'Default DA % of basic', 'number', '0', { group: 'Structure defaults', min: 0, max: 100 }),
    def('PAYROLL_PAYSLIP_NUMBER_FORMAT', 'PAYROLL', 'Payslip number format', 'text', 'PS/{YYYY}/{MM}/{SEQ}', { group: 'Payslip' }),
    def('PAYROLL_ARREARS_ENABLED', 'PAYROLL', 'Enable arrears processing', 'boolean', 'TRUE', { group: 'Run rules' }),
    def('PAYROLL_HOLD_ON_MISSING_PAN', 'PAYROLL', 'Flag employees without PAN', 'boolean', 'FALSE', { group: 'Compliance' }),

    // ---------------- Statutory ----------------
    def('PF_SETTINGS', 'STATUTORY', 'Provident Fund (PF)', 'json', '{"enabled":false,"employeeRate":12,"employerRate":12,"wageCeiling":15000,"restrictToCeiling":true,"epsRate":8.33,"epsWageCeiling":15000,"edliRate":0.5,"adminRate":0.5,"includeComponents":["Basic","DA"],"employeeField":"pf_uan","employerField":""}', { group: 'PF', help: 'Rates are percentages. Written CA-verified values are required before payroll runs.' }),
    def('ESI_SETTINGS', 'STATUTORY', 'Employee State Insurance (ESI)', 'json', '{"enabled":false,"employeeRate":0.75,"employerRate":3.25,"wageCeiling":21000,"includeComponents":["Basic","DA","HRA"],"employeeField":"esi_number"}', { group: 'ESI' }),
    def('PROFESSIONAL_TAX_SETTINGS', 'STATUTORY', 'Professional Tax (PT)', 'json', '{"enabled":false,"state":"","slabs":[],"employeeField":""}', { group: 'PT', help: 'slabs: [{"from":0,"to":15000,"amount":0}] — monthly amounts.' }),
    def('TDS_SETTINGS', 'STATUTORY', 'Income Tax (TDS)', 'json', '{"enabled":false,"regime":"new","standardDeduction":0,"slabs":[],"rebateLimit":0,"rebateAmount":0,"cessRate":4,"employeeField":"pan_number"}', { group: 'TDS', help: 'Annual slabs: [{"from":0,"to":300000,"rate":0}].' }),
    def('BONUS_SETTINGS', 'STATUTORY', 'Statutory bonus', 'json', '{"enabled":false,"wageCeiling":21000,"eligibilitySalaryLimit":21000,"minimumRate":8.33,"maximumRate":20,"calculationBasis":"basic","paymentMonth":11}', { group: 'Bonus' }),
    def('GRATUITY_SETTINGS', 'STATUTORY', 'Gratuity', 'json', '{"enabled":false,"ratePerYear":4.81,"minimumYears":5,"maximumAmount":2000000,"basis":"basic_da"}', { group: 'Gratuity' }),
    def('WAGE_DEFINITION_SETTINGS', 'STATUTORY', 'Wage definition (Code on Wages)', 'json', '{"includeComponents":["Basic","DA"],"excludeComponents":["HRA","Conveyance","Special Allowance"],"basicFloorPercentage":50,"enabled":false}', { group: 'Wage definition' }),
    def('PAYROLL_CA_VERIFIED', 'STATUTORY', 'Statutory values verified by the company CA', 'boolean', 'FALSE', { group: 'Verification' }),
    def('STATUTORY_ROUNDING', 'STATUTORY', 'Statutory amount rounding', 'select', 'nearest_rupee', { group: 'Verification', options: [['none', 'No rounding'], ['nearest_rupee', 'Nearest rupee']] }),

    // ---------------- Workflow ----------------
    def('WORKFLOW_DEFAULT_SLA_HOURS', 'WORKFLOW', 'Default approval SLA (hours)', 'number', '48', { group: 'Defaults', min: 1, max: 720 }),
    def('WORKFLOW_ESCALATION_HOURS', 'WORKFLOW', 'Escalate to next level after (hours)', 'number', '24', { group: 'Defaults', min: 1, max: 720 }),
    def('WORKFLOW_ALLOW_SELF_APPROVAL', 'WORKFLOW', 'Allow self-approval when no approver exists', 'boolean', 'FALSE', { group: 'Defaults' }),
    def('WORKFLOW_AUTO_APPROVE_SMALL_AMOUNTS', 'WORKFLOW', 'Auto-approve expenses under this amount', 'number', '0', { group: 'Defaults', min: 0, max: 1000000 }),
    def('APPROVAL_INBOX_PAGE_SIZE', 'WORKFLOW', 'Approval inbox page size', 'number', '20', { group: 'Defaults', min: 5, max: 100 }),

    // ---------------- Documents ----------------
    def('DOCUMENT_NUMBER_FORMAT', 'DOCUMENTS', 'Document number format', 'text', '{PREFIX}/{TYPE}/{YYYY}/{SEQ}', { group: 'Numbering' }),
    def('DOCUMENT_DEFAULT_PREFIX', 'DOCUMENTS', 'Default document prefix', 'text', 'FOCUSON', { group: 'Numbering' }),
    def('DOCUMENT_REQUIRE_APPROVAL', 'DOCUMENTS', 'Generated documents need approval', 'boolean', 'FALSE', { group: 'Rules' }),
    def('DOCUMENT_EXPIRY_ALERT_DAYS', 'DOCUMENTS', 'Expiry alert lead time (days)', 'number', '30', { group: 'Rules', min: 0, max: 365 }),
    def('DOCUMENT_ALLOWED_MIME', 'DOCUMENTS', 'Allowed upload types', 'json', '["application/pdf","image/jpeg","image/png"]', { group: 'Uploads' }),
    def('DOCUMENT_MAX_UPLOAD_MB', 'DOCUMENTS', 'Maximum upload size (MB)', 'number', '10', { group: 'Uploads', min: 1, max: 50 }),

    // ---------------- Recruitment ----------------
    def('RECRUITMENT_STAGES', 'RECRUITMENT', 'Selection stages', 'json', '["Applied","Screening","Interview","Offer","Hired","Rejected"]', { group: 'Pipeline' }),
    def('RECRUITMENT_DEFAULT_HEADCOUNT', 'RECRUITMENT', 'Default headcount per opening', 'number', '1', { group: 'Pipeline', min: 1, max: 500 }),
    def('RECRUITMENT_REQUIRE_OFFER_APPROVAL', 'RECRUITMENT', 'Offers need approval', 'boolean', 'TRUE', { group: 'Pipeline' }),
    def('RECRUITMENT_INTERVIEW_DURATION_MIN', 'RECRUITMENT', 'Default interview duration (minutes)', 'number', '45', { group: 'Pipeline', min: 15, max: 480 }),
    def('RECRUITMENT_SOURCES', 'RECRUITMENT', 'Candidate sources', 'json', '["Referral","Job portal","Walk-in","Campus","Agency"]', { group: 'Pipeline' }),

    // ---------------- Performance ----------------
    def('PERFORMANCE_CYCLE', 'PERFORMANCE', 'Default review cycle', 'select', 'annual', { group: 'Cycles', options: [['annual', 'Annual'], ['half_yearly', 'Half-yearly'], ['quarterly', 'Quarterly']] }),
    def('PERFORMANCE_MAX_GOALS', 'PERFORMANCE', 'Maximum goals per employee', 'number', '8', { group: 'Cycles', min: 1, max: 30 }),
    def('PERFORMANCE_RATING_SCALE', 'PERFORMANCE', 'Rating scale maximum', 'select', '5', { group: 'Scoring', options: [['5', '1-5'], ['10', '1-10'], ['100', '1-100']] }),
    def('PERFORMANCE_REQUIRE_SELF_REVIEW', 'PERFORMANCE', 'Require self-review before manager review', 'boolean', 'TRUE', { group: 'Scoring' }),
    def('PERFORMANCE_REVIEW_WEIGHT', 'PERFORMANCE', 'Self-review weight (%)', 'number', '20', { group: 'Scoring', min: 0, max: 100 }),

    // ---------------- Exit ----------------
    def('EXIT_NOTICE_PERIOD_DAYS', 'EXIT', 'Default notice period (days)', 'number', '30', { group: 'Process', min: 0, max: 180 }),
    def('EXIT_CLEARANCE_ITEMS', 'EXIT', 'Clearance checklist', 'json', '["IT assets","Finance dues","Knowledge transfer","HR documents","Access cards"]', { group: 'Process' }),
    def('EXIT_SETTLEMENT_DAYS', 'EXIT', 'Settlement due within (days)', 'number', '30', { group: 'Process', min: 1, max: 180 }),
    def('EXIT_REQUIRE_APPROVAL', 'EXIT', 'Exit needs approval', 'boolean', 'TRUE', { group: 'Process' }),

    // ---------------- Notifications ----------------
    def('NOTIFY_LEAVE_SUBMITTED', 'NOTIFICATIONS', 'Notify approver on leave request', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFY_LEAVE_DECIDED', 'NOTIFICATIONS', 'Notify employee on leave decision', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFY_APPROVAL_ASSIGNED', 'NOTIFICATIONS', 'Notify approver on assignment', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFY_PAYSLIP_RELEASED', 'NOTIFICATIONS', 'Notify employee on payslip release', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFY_ATTENDANCE_MISSING', 'NOTIFICATIONS', 'Notify employee on missing check-out', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFY_ANNOUNCEMENT', 'NOTIFICATIONS', 'Notify on announcements', 'boolean', 'TRUE', { group: 'Events' }),
    def('NOTIFICATION_RETENTION_DAYS', 'NOTIFICATIONS', 'Notification retention (days)', 'number', '180', { group: 'Retention', min: 30, max: 1095 }),

    // ---------------- System ----------------
    def('SCHEMA_VERSION', 'SYSTEM', 'Schema version', 'text', '2', { group: 'Data' }),
    def('IMPORT_MAX_ROWS', 'SYSTEM', 'Maximum rows per import', 'number', '500', { group: 'Data', min: 10, max: 5000 }),
    def('EXPORT_MAX_ROWS', 'SYSTEM', 'Maximum rows per export', 'number', '5000', { group: 'Data', min: 100, max: 20000 }),
    def('BACKUP_RETENTION_DAYS', 'SYSTEM', 'Backup retention (days)', 'number', '30', { group: 'Data', min: 7, max: 365 }),
    def('BACKUP_KEEP_COPIES', 'SYSTEM', 'Backups to keep', 'number', '10', { group: 'Data', min: 1, max: 60 }),
    def('BACKUP_AUTO_DAILY', 'SYSTEM', 'Create a daily automatic backup', 'boolean', 'TRUE', { group: 'Data' }),
    def('SIMPLE_MODE_DEFAULT', 'SYSTEM', 'Start new users in simple mode', 'boolean', 'FALSE', { group: 'Interface' }),
    def('SELF_TEST_ENABLED', 'SYSTEM', 'Allow administrators to run the self test', 'boolean', 'TRUE', { group: 'Diagnostics' }),
    def('API_REQUESTS_PER_MINUTE', 'SYSTEM', 'API requests per user per minute', 'number', '180', { group: 'Limits', min: 30, max: 1200 }),
    def('EMPLOYEE_ID_PREFIX', 'SYSTEM', 'Employee ID prefix', 'text', 'EMP', { group: 'Numbering' }),
    def('COMPANY_SHORT_NAME', 'COMPANY', 'Short name for the tab title', 'text', '', { group: 'Profile' }),
    def('MAINTENANCE_MODE', 'SYSTEM', 'Maintenance mode (blocks sign-in except Super Admin)', 'boolean', 'FALSE', { group: 'Diagnostics' }),
    def('LOGIN_NOTICE_VERSION', 'SYSTEM', 'Login notice version', 'text', '1', { group: 'Diagnostics' })
  ];

  var FEATURES = [
    { key: 'attendance', module: 'Attendance', label: 'Attendance', description: 'Self check-in, registers and month close.', default: true },
    { key: 'geofence', module: 'Attendance', label: 'Geofenced attendance', description: 'Enforce office radius for self check-in.', default: false },
    { key: 'attendance_selfie', module: 'Attendance', label: 'Attendance selfie', description: 'Capture a consent-based selfie at check-in.', default: false },
    { key: 'leave', module: 'Leave', label: 'Leave', description: 'Leave applications, balances and calendar.', default: true },
    { key: 'payroll', module: 'Payroll', label: 'Payroll', description: 'Salary structures, monthly runs and payslips.', default: true },
    { key: 'payslips', module: 'Payroll', label: 'Payslips', description: 'Employee payslip access.', default: true },
    { key: 'expenses', module: 'Money', label: 'Expenses', description: 'Expense claims and reimbursement.', default: true },
    { key: 'advances', module: 'Money', label: 'Loans and advances', description: 'Advance and loan requests.', default: true },
    { key: 'documents', module: 'Documents', label: 'Documents', description: 'Document register and templates.', default: true },
    { key: 'recruitment', module: 'Recruitment', label: 'Recruitment', description: 'Openings, candidates and interviews.', default: true },
    { key: 'performance', module: 'Performance', label: 'Performance', description: 'Goals, self reviews and manager reviews.', default: true },
    { key: 'exit', module: 'Exit', label: 'Exit management', description: 'Resignation, clearance and full and final settlement.', default: true },
    { key: 'reports', module: 'Reports', label: 'Reports', description: 'Operational and statutory reporting.', default: true },
    { key: 'assets', module: 'Assets', label: 'Assets', description: 'Asset register and allocation.', default: true },
    { key: 'announcements', module: 'Announcements', label: 'Announcements', description: 'Company announcements on the dashboard.', default: true },
    { key: 'notifications', module: 'Notifications', label: 'Notifications', description: 'In-app notification centre.', default: true },
    { key: 'workflow', module: 'Workflow', label: 'Approval workflows', description: 'Multi-step approvals with SLA.', default: true },
    { key: 'workflow_override', module: 'Workflow', label: 'Approval override', description: 'Administrator override with mandatory reason.', default: true },
    { key: 'import_export', module: 'System', label: 'Import and export', description: 'CSV import and export.', default: true },
    { key: 'employee_self_service', module: 'Employees', label: 'Employee self service', description: 'Employees can view and request changes to their own record.', default: true },
    { key: 'biometric_integration', module: 'Attendance', label: 'Biometric import', description: 'Machine file import for attendance.', default: false }
  ];

  var defsByKey = {};
  DEFS.forEach(function (item) { defsByKey[item.key] = item; });

  function all() {
    return DEFS;
  }

  function definition(key) {
    return defsByKey[key] || null;
  }

  function normalizeValue(definitionRow, value) {
    var type = definitionRow.type;
    if (type === 'boolean') {
      return (value === true || String(value).toUpperCase() === 'TRUE' || value === 1 || value === '1') ? 'TRUE' : 'FALSE';
    }
    if (type === 'number') {
      var number = Number(value);
      if (!isFinite(number)) Utils.fail('VALIDATION', definitionRow.label + ' must be a number.');
      if (definitionRow.min !== null && number < definitionRow.min) Utils.fail('VALIDATION', definitionRow.label + ' must be at least ' + definitionRow.min + '.');
      if (definitionRow.max !== null && number > definitionRow.max) Utils.fail('VALIDATION', definitionRow.label + ' must be at most ' + definitionRow.max + '.');
      return String(number);
    }
    if (type === 'select') {
      var allowed = definitionRow.options.map(function (option) { return String(option[0]); });
      var selected = Utils.cleanString(value);
      if (allowed.indexOf(selected) < 0) Utils.fail('VALIDATION', definitionRow.label + ' has an unsupported value.');
      return selected;
    }
    if (type === 'color') {
      var color = Utils.cleanString(value);
      if (!/^#[0-9a-fA-F]{6}$/.test(color)) Utils.fail('VALIDATION', definitionRow.label + ' must be a hex colour such as #3157d5.');
      return color;
    }
    if (type === 'json') {
      var text = typeof value === 'string' ? value : JSON.stringify(value);
      if (text.length > 28000) Utils.fail('VALIDATION', definitionRow.label + ' is too large.');
      var parsed = Utils.safeParseJson(text, undefined);
      if (parsed === undefined) Utils.fail('VALIDATION', definitionRow.label + ' must be valid JSON.');
      return JSON.stringify(parsed);
    }
    if (type === 'url') {
      var url = Utils.cleanString(value);
      if (!url) return '';
      if (url.length > 2048) Utils.fail('VALIDATION', definitionRow.label + ' is too long.');
      if (/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(url)) return url;
      if (/^https?:\/\//i.test(url)) return url;
      if (/^\.?\/?[\w\-./]+\.(png|jpe?g|svg|webp)$/i.test(url)) return url;
      Utils.fail('VALIDATION', definitionRow.label + ' must be an https URL or a relative image path.');
      return '';
    }
    if (type === 'time') {
      var time = Utils.cleanString(value);
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) Utils.fail('VALIDATION', definitionRow.label + ' must use HH:MM.');
      return time;
    }
    var maximum = type === 'textarea' ? 8000 : 400;
    var cleaned = Utils.cleanString(value);
    if (cleaned.length > maximum) Utils.fail('VALIDATION', definitionRow.label + ' is too long.');
    return cleaned;
  }

  function stored() {
    return Database.getSettingsMap();
  }

  function raw(key, fallback) {
    if (!PropertiesService.getScriptProperties().getProperty('HRMS_CORE_DB_ID')) return fallback;
    var values = stored();
    if (!Object.prototype.hasOwnProperty.call(values, key)) return fallback;
    var value = values[key];
    return value === '' || value === null || value === undefined ? fallback : value;
  }

  function text(key, fallback) {
    var value = raw(key, fallback);
    return value === undefined || value === null ? (fallback === undefined ? '' : String(fallback)) : String(value);
  }

  function number(key, fallback) {
    return Utils.asNumber(raw(key, fallback), fallback);
  }

  function bool(key, fallback) {
    var value = raw(key, fallback === undefined ? 'FALSE' : (fallback ? 'TRUE' : 'FALSE'));
    return Utils.asBoolean(value);
  }

  function json(key, fallback) {
    var value = raw(key, null);
    if (value === null) return fallback;
    var parsed = Utils.safeParseJson(String(value), undefined);
    return parsed === undefined ? fallback : parsed;
  }

  /** Grouped definitions plus current values for the settings screen. */
  function describe() {
    var current = stored();
    var categories = [];
    var seen = {};
    DEFS.forEach(function (item) {
      if (!seen[item.category]) {
        seen[item.category] = { category: item.category, items: [] };
        categories.push(seen[item.category]);
      }
      var value = Object.prototype.hasOwnProperty.call(current, item.key) ? current[item.key] : item.value;
      seen[item.category].items.push({
        key: item.key, label: item.label, type: item.type, group: item.group,
        options: item.options, min: item.min, max: item.max, help: item.help,
        default: item.value, value: value === undefined ? '' : value
      });
    });
    var features = Database.getAllCached('Feature_Flags').filter(function (flag) {
      return String(flag.status).toUpperCase() === 'ACTIVE' && String(flag.scope_type || 'GLOBAL').toUpperCase() === 'GLOBAL';
    }).map(function (flag) {
      var known = null;
      FEATURES.forEach(function (item) { if (item.key === flag.feature_key) known = item; });
      return {
        key: flag.feature_key,
        label: known ? known.label : flag.feature_key,
        description: known ? known.description : '',
        module: known ? known.module : 'Custom',
        enabled: Utils.asBoolean(flag.enabled),
        id: flag.id
      };
    });
    FEATURES.forEach(function (item) {
      var exists = features.some(function (flag) { return flag.key === item.key; });
      if (!exists) features.push({ key: item.key, label: item.label, description: item.description, module: item.module, enabled: false, id: '' });
    });
    // Flat list keeps the settings console simple; categories stay for grouped UIs.
    var flat = [];
    categories.forEach(function (group) { group.items.forEach(function (item) { flat.push(item); }); });
    return {
      categories: categories, settings: flat, features: features, security: securitySummary(),
      version: text('SCHEMA_VERSION', ''), generatedAt: Utils.nowIso(), settingCount: flat.length
    };
  }

  function securitySummary() {
    return {
      idleMinutes: number('SESSION_IDLE_MINUTES', 30),
      sessionHours: number('SESSION_ABSOLUTE_HOURS', 12),
      passwordMinLength: number('PASSWORD_MIN_LENGTH', 12),
      complexity: bool('PASSWORD_REQUIRE_COMPLEXITY', true),
      maxFailures: number('LOGIN_MAX_FAILED_ATTEMPTS', 5),
      lockMinutes: number('LOGIN_LOCK_MINUTES', 15),
      bindDevice: bool('SESSION_BIND_DEVICE', true),
      maxSuperAdmins: number('MAX_SUPER_ADMINS', 3),
      maintenanceMode: bool('MAINTENANCE_MODE', false),
      enforceConsent: bool('ENFORCE_CONSENT', true)
    };
  }

  /** Validates and saves a batch of setting values. */
  function update(authentication, payload) {
    var values = payload.values;
    Utils.assertObject(values, 'values');
    var keys = Object.keys(values);
    if (!keys.length) Utils.fail('VALIDATION', 'No setting value was supplied.');
    if (keys.length > 200) Utils.fail('VALIDATION', 'Too many settings in one request.');
    var actorId = authentication.actor.employeeId;
    var prepared = [];
    keys.forEach(function (key) {
      var definitionRow = defsByKey[key];
      if (!definitionRow) Utils.fail('VALIDATION', 'Unknown setting: ' + key + '.');
      if (key === 'SCHEMA_VERSION') Utils.fail('FORBIDDEN', 'The schema version is managed by the application.');
      prepared.push({ key: key, value: normalizeValue(definitionRow, values[key]), definition: definitionRow });
    });
    var saved = [];
    prepared.forEach(function (item) {
      var existing = Database.findOne('Company_Settings', function (row) {
        return row.setting_key === item.key && String(row.status).toUpperCase() !== 'DELETED';
      }, { cached: true });
      if (existing) {
        Database.update('Company_Settings', existing.id, { setting_value: item.value }, actorId);
      } else {
        Database.insert('Company_Settings', {
          id: 'setting_' + item.key.toLowerCase(), setting_key: item.key, setting_value: item.value,
          category: item.definition.category, description: item.definition.help || ''
        }, actorId);
      }
      saved.push({ key: item.key, value: item.value });
    });
    Database.invalidateCache('Company_Settings');
    Audit.logEvent('SETTINGS_UPDATED', actorId, 'Company_Settings', keys.join(',').slice(0, 128), 'SUCCESS', {
      keys: keys, category: prepared[0].definition.category
    }, { reqId: payload.reqId });
    return { saved: saved };
  }

  function updateFeatures(authentication, payload) {
    var changes = payload.features;
    Utils.assertObject(changes, 'features');
    var keys = Object.keys(changes);
    if (!keys.length) Utils.fail('VALIDATION', 'No feature switch was supplied.');
    var actorId = authentication.actor.employeeId;
    var saved = [];
    keys.forEach(function (key) {
      if (!/^[a-z][a-z0-9_]{1,60}$/.test(key)) Utils.fail('VALIDATION', 'Invalid feature key.');
      var enabled = valuesToBoolean(changes[key]);
      var existing = Database.findOne('Feature_Flags', function (row) {
        return row.feature_key === key && String(row.status).toUpperCase() === 'ACTIVE' && String(row.scope_type || 'GLOBAL').toUpperCase() === 'GLOBAL';
      }, { cached: true });
      if (existing) {
        Database.update('Feature_Flags', existing.id, { enabled: enabled }, actorId);
      } else {
        Database.insert('Feature_Flags', { feature_key: key, enabled: enabled, scope_type: 'GLOBAL', scope_id: '' }, actorId);
      }
      saved.push({ key: key, enabled: enabled });
    });
    Database.invalidateCache('Feature_Flags');
    Audit.logEvent('FEATURES_UPDATED', actorId, 'Feature_Flags', keys.join(',').slice(0, 128), 'SUCCESS', { changes: changes }, { reqId: payload.reqId });
    return { saved: saved };
  }

  function valuesToBoolean(value) {
    return value === true || String(value).toUpperCase() === 'TRUE';
  }

  /** Idempotent seeding used by setup and by the settings screen on first load. */
  function ensureDefaults() {
    if (!PropertiesService.getScriptProperties().getProperty('HRMS_CORE_DB_ID')) return { settings: 0, features: 0 };
    var now = Utils.nowIso();
    var existing = Database.getAllCached('Company_Settings');
    var known = {};
    existing.forEach(function (row) { known[row.setting_key] = true; });
    var rows = DEFS.filter(function (item) { return !known[item.key]; }).map(function (item) {
      return {
        id: 'setting_' + item.key.toLowerCase(), setting_key: item.key,
        setting_value: item.key === 'SCHEMA_VERSION' ? HRMS_SCHEMA_VERSION : item.value,
        category: item.category, description: item.help || ''
      };
    });
    if (rows.length) {
      Database.appendRows('Company_Settings', rows, 'SETUP');
      Database.invalidateCache('Company_Settings');
    }
    var flags = Database.getAllCached('Feature_Flags');
    var flagKnown = {};
    flags.forEach(function (row) { flagKnown[row.feature_key + '|' + String(row.scope_type || 'GLOBAL')] = true; });
    var featureRows = FEATURES.filter(function (item) { return !flagKnown[item.key + '|GLOBAL']; }).map(function (item) {
      return { feature_key: item.key, enabled: item.default, scope_type: 'GLOBAL', scope_id: '' };
    });
    if (featureRows.length) {
      Database.appendRows('Feature_Flags', featureRows, 'SETUP');
      Database.invalidateCache('Feature_Flags');
    }
    return { settings: rows.length, features: featureRows.length };
  }

  /** Feature switch definition lookup used by the shell. */
  function featureDefinitions() {
    return FEATURES.slice();
  }

  return {
    DEFS: DEFS,
    FEATURES: FEATURES,
    all: all,
    definition: definition,
    raw: raw,
    text: text,
    number: number,
    bool: bool,
    json: json,
    describe: describe,
    update: update,
    updateFeatures: updateFeatures,
    ensureDefaults: ensureDefaults,
    securitySummary: securitySummary,
    featureDefinitions: featureDefinitions
  };
})();
