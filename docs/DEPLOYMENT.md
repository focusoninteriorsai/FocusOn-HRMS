# FOCUSON HRMS deployment guide — Phase 1

This procedure is written for a non-developer. Perform it using the company’s dedicated Google account, not an employee’s personal account.

## 1. Prepare the company accounts

1. Create a dedicated company Google account such as the account your IT team reserves for HR system ownership.
2. Enable **2-Step Verification**, add a second verification method, and store recovery codes in the company’s secure credential vault.
3. Restrict access to this account. Its owner can access the Sheets, Drive files, execution logs, and audit data.
4. Create or open the company GitHub repository that will host the frontend. Do not place Script Properties, credentials, spreadsheet IDs, or exported employee data in Git.

## 2. Create the Apps Script project

1. Sign in at <https://script.google.com> with the dedicated account.
2. Select **New project** and give it a recognizable company HRMS name.
3. Open **Project Settings**, enable **Show “appsscript.json” manifest file in editor**, and confirm the time zone is **Asia/Kolkata** in the manifest.
4. Add each `.gs` file from this repository’s `backend/` directory with exactly the same filename. Apps Script adds `.gs` automatically; do not create names such as `Code.gs.gs`.
5. Replace the manifest with `backend/appsscript.json`.
6. Save all files. The Phase 1 files are `Code.gs`, `Utils.gs`, `Database.gs`, `Audit.gs`, `Permissions.gs`, `Auth.gs`, and `Setup.gs`.

Optional developers can use `clasp`, but `.clasp.json` is intentionally ignored by Git. No local tooling is required.

## 3. Supply the one-time owner credential securely

In **Project Settings → Script Properties**, add:

| Property | Required | Purpose |
|---|---:|---|
| `SETUP_ADMIN_EMP_ID` | First setup | The real Employee ID to assign to the first Super Admin. |
| `SETUP_ADMIN_PASSWORD` | First setup | A unique one-time password generated in the company password vault. It must be 12–128 characters and include uppercase, lowercase, a number, and a symbol. |
| `SETUP_ADMIN_NAME` | Optional | The real display name for that administrator. The Employee ID is used if omitted. |
| `PASSWORD_HASH_ITERATIONS` | Optional | New-password HMAC work factor. Default and minimum: 10,000; maximum accepted: 50,000. Existing users retain their stored work factor. |

Do not email or chat the one-time password. Do not write it in a source file. There is no default administrator ID or password.

## 4. Run the idempotent setup

1. In the editor’s function selector, choose **`setupSystem`** and select **Run**.
2. Review and approve the requested Spreadsheet, Drive, and trigger permissions for the dedicated account.
3. Wait for completion. Setup creates:
   - `HRMS_CORE_DB_ID` and `HRMS_ATTENDANCE_<YEAR>_ID` in Script Properties;
   - every schema tab, frozen/protected header, and additive schema version;
   - a private Drive root with Documents, Selfies, Receipts, Generated, Backups, and Templates folders;
   - the Permissions Catalog, built-in Super Admin role, and empty system/statutory setting keys;
   - the first Super Admin with forced password change;
   - one daily maintenance trigger for session cleanup and yearly attendance-file readiness.
4. Confirm that `SETUP_ADMIN_EMP_ID`, `SETUP_ADMIN_PASSWORD`, and `SETUP_ADMIN_NAME` were removed automatically. Keep all generated resource IDs and `AUTH_PEPPER` in Script Properties.
5. Re-running `setupSystem()` is safe: existing resources and settings are retained, missing tabs/columns/catalog entries are added, and no workflows or employees are fabricated. If the initial run is interrupted before credential cleanup, leave the setup properties in place and run it again so all three admin records can be repaired.

If setup reports that temporary properties are missing, add them and rerun. If it reports an invalid resource ID, correct that property rather than pointing production at an unknown spreadsheet.

## 5. Deploy the JSON Web App

1. Select **Deploy → New deployment → Web app**.
2. Set **Execute as** to **Me** (the dedicated account).
3. Set **Who has access** to **Anyone**. This permits the static site to call the API; it does not bypass login or authorization.
4. Deploy and copy the Web App URL ending in `/exec`.
5. Open the `/exec` URL in a browser. The only GET response is minimal health JSON: `{"ok":true,"data":{"status":"ok"},"reqId":null}`.

The API uses simple `POST` requests with `Content-Type: text/plain;charset=utf-8`; do not change this to a preflighted content type.

## 6. Configure and publish GitHub Pages

1. Open `assets/js/config.js` and assign the exact `/exec` URL to `CONFIG.API_URL`. The URL is public configuration, not a secret.
2. Commit only source files. Confirm no `.clasp.json`, credentials, exported Sheets, backup files, or `.env` files are included.
3. Push the repository to GitHub.
4. In **GitHub → Settings → Pages**, choose **Deploy from a branch**, select the company’s publishing branch and **/(root)**, then save.
5. Wait for the Pages deployment and open the provided HTTPS URL. No build command or output directory is needed.
6. Verify the landing page and language/theme controls. Until `API_URL` is configured correctly, the page displays a configuration notice instead of pretending to connect.

Hash routing (`#/dashboard`) requires no server rewrite. `404.html` redirects accidental root-level requests back to the home page.

## 7. First login and password rotation

1. Enter the owner-supplied Employee ID and one-time password.
2. The server forces the password-change screen before any dashboard/profile action.
3. Enter a unique new password satisfying the displayed policy. Other active sessions for the account are revoked.
4. Verify the real-data dashboard, My Profile, language/theme persistence, sign out, and sign out all devices.
5. Remove the one-time password from any temporary clipboard or insecure note. Retain only the newly chosen password in the company vault.

Forgot-password intentionally instructs users to contact HR. Self-service email/SMS recovery and Google login are not enabled.

## 8. Initial company configuration order

The Phase 1 API exposes only safe public branding values. The editable Branding Studio and company administration screens arrive in Phase 2. For the complete system, configure in this dependency order as those phases are delivered:

1. Organization departments, designations, branches, and work locations.
2. Branch geofence coordinates, radii, accuracy rules, shifts, and attendance policies.
3. Roles, scopes, user overrides, authority ceilings, and feature switches.
4. Versioned workflows and approval delegations.
5. Leave types, holidays, accrual, carry-forward, and calendars.
6. Salary components, employee structures, payable-day rules, and revision workflow.
7. CA-verified PF, ESI, Professional Tax, TDS, bonus, gratuity, and wage-definition settings. Payroll must remain blocked until its required values exist.
8. Branding, public login highlights, notifications, retention, and backup policy.

Do not type statutory rates from examples or assumptions. Obtain the company CA’s written configuration.

## 9. Backup and restore drill

Phase 1 creates private backup storage but does not claim a completed restore workflow. Until the Phase 5 verified backup/restore module is installed, perform this owner-only manual drill without changing production:

1. Open both spreadsheets while signed in as the dedicated owner.
2. Use **File → Make a copy** for each and place copies in the private Backups folder with an accurate timestamp in the filename.
3. Compare every tab name and row count against the source. Record the result in the company’s operational recovery log.
4. Open the copies and verify the schema header and recent audit rows.
5. Do not repoint production Script Properties as an improvised restore. The automated restore process will first make a safety copy and validate row counts before any replacement.

Schedule a real restore test after Phase 5 and restrict backup folder sharing. Never use “anyone with the link.”

## 10. Redeploy without changing the frontend URL

1. Test source changes in a separate Apps Script project/deployment first.
2. In the production project, select **Deploy → Manage deployments**.
3. Edit the active Web App deployment, choose **New version**, review Execute as Me / Anyone, and deploy.
4. The existing `/exec` URL remains the same; do not create a new deployment for routine code updates.
5. Recheck health JSON, login, forced password behavior, profile access, and logout-all. Review Apps Script execution logs by request ID if an error occurs.

## 11. Operational checks and platform limits

- Keep the dedicated owner account active and monitor its Drive/storage and Apps Script quotas.
- Apps Script executions are time-limited; later payroll processing uses batches/resume triggers rather than assuming unlimited runtime.
- Gmail, Calendar, Drive, CacheService, PropertiesService, and trigger quotas are account-specific and can change. Consult current Google Workspace quotas before high-volume use.
- The default 10,000 HMAC rounds are intentionally conservative for Apps Script. Measure login execution time in the company account before increasing the work factor; do not lower it below the enforced minimum.
- Daily maintenance is logged. Session cleanup marks expired sessions and soft-deletes inactive session records after 30 days.
- A browser cannot reliably detect mock-GPS applications. Later geofenced attendance must use accuracy limits, anomaly flags, optional consent-based selfies, and manager spot checks.
