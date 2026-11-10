# FOCUSON HRMS: Deployment & Setup Guide

This guide walks through deploying the FOCUSON HRMS system from scratch using a dedicated Google Workspace account and GitHub Pages. No paid databases or server hosting are required.

---

## 1. Prerequisites

1. **Dedicated Google Account**: Create a dedicated Google Workspace account (e.g. `hrms-system@yourcompany.com`) with 2-Step Verification enabled. Do not use a personal Google account.
2. **GitHub Repository**: A GitHub repository with GitHub Pages enabled serving from the root branch.

---

## 2. Google Apps Script Backend Deployment

### Step 2.1: Create Apps Script Project
1. Open [Google Apps Script](https://script.google.com) signed into the dedicated company account.
2. Click **New Project** and rename it to `FOCUSON_HRMS_BACKEND`.

### Step 2.2: Add Backend Files
In the Apps Script editor, copy the contents of the files in the `backend/` directory into matching Apps Script files:
- `appsscript.json` (Enable "Show appsscript.json manifest" in Project Settings first)
- `Code.gs`
- `Utils.gs`
- `Database.gs`
- `Audit.gs`
- `Permissions.gs`
- `Auth.gs`
- `Setup.gs`

### Step 2.3: Configure Setup Script Properties
1. In the Apps Script editor, click **Project Settings** (gear icon on the left menu).
2. Scroll to **Script Properties** and add the following temporary properties:
   - `SETUP_ADMIN_EMP_ID`: Desired Super Admin Employee ID (e.g., `ADMIN001`)
   - `SETUP_ADMIN_PASSWORD`: A strong initial one-time temporary password (e.g., `FocusOnInit@2026!`)
3. Click **Save script properties**.

### Step 2.4: Execute Initial Bootstrap
1. In the Apps Script code editor, select the file `Setup.gs`.
2. From the function dropdown at the top, select **`setupSystem`** and click **Run**.
3. Authorize the necessary Google permissions when prompted (Spreadsheets, Drive).
4. `setupSystem()` will:
   - Create `FOCUSON_HRMS_CORE_DB` and `FOCUSON_HRMS_ATTENDANCE_<YEAR>` Google Spreadsheets.
   - Set up all tabs with protected, frozen header rows.
   - Create the private Google Drive folder hierarchy (`Documents`, `Selfies`, `Receipts`, `Generated`, `Backups`, `Templates`).
   - Seed the `Permissions_Catalog` and built-in `Super Admin` role.
   - Create the initial Super Admin account with `must_change_password: true`.
   - Automatically delete the plain `SETUP_ADMIN_PASSWORD` from Script Properties.

### Step 2.5: Deploy as Web App
1. Click **Deploy** > **New deployment** (top right).
2. Click the gear icon next to "Select type" and choose **Web app**.
3. Configure the deployment settings:
   - **Description**: `FOCUSON HRMS Production v1`
   - **Execute as**: **Me** (`hrms-system@yourcompany.com`)
   - **Who has access**: **Anyone** *(Required so the static frontend on GitHub Pages can make API POST requests)*
4. Click **Deploy**.
5. Copy the **Web App URL** (e.g., `https://script.google.com/macros/s/AKfycbx.../exec`).

---

## 3. Frontend Deployment (GitHub Pages)

### Step 3.1: Configure Backend URL
Open `assets/js/config.js` and set `DEFAULT_API_URL` to your copied Web App URL:
```javascript
export const CONFIG = {
  DEFAULT_API_URL: 'https://script.google.com/macros/s/AKfycbx.../exec',
  ...
};
```
*(Alternatively, you can leave it empty and enter the URL in the in-app setup banner using localStorage during your initial session).*

### Step 3.2: Enable GitHub Pages
1. Push your repository to GitHub.
2. In your repository on GitHub, navigate to **Settings** > **Pages**.
3. Under **Build and deployment**:
   - **Source**: Deploy from a branch
   - **Branch**: `main` (or `master`), folder: `/ (root)`
4. Click **Save**. Your site will be live at `https://<organization>.github.io/<repo>/`.

---

## 4. First-Time Administrator Login & Initial Setup Order

1. Visit your GitHub Pages URL in your browser.
2. Sign in with the credentials set during bootstrap:
   - **Employee ID**: The value configured in `SETUP_ADMIN_EMP_ID` (e.g. `ADMIN001`)
   - **Password**: The temporary password configured in `SETUP_ADMIN_PASSWORD`
3. The system will detect `must_change_password: true` and immediately prompt for a new secure password (minimum 8 characters).
4. After updating your password, perform initial configuration in this exact order:
   - **Organization Setup**: Enter company branches and departments.
   - **Geofence Locations**: Set branch latitude, longitude, and radius in meters.
   - **Attendance Policies**: Assign Office Geofenced or Field policies to departments.
   - **Leave Types**: Configure Casual, Sick, and Earned leave quotas and carry-forward rules.
   - **Salary Components**: Define basic salary, HRA, statutory allowances, PF, and ESI flags.
   - **Company Settings**: Enter company logo URL, primary branding color, and CA-verified statutory rules.

---

## 5. How to Redeploy Backend Code Without Changing the Web App URL

When deploying updates to `Code.gs` or other backend files:
1. In the Apps Script editor, click **Deploy** > **Manage deployments**.
2. Select your active deployment from the list on the left.
3. Click the **Edit** (pencil) icon in the top right.
4. In the **Version** dropdown, select **New version**.
5. Click **Deploy**.
6. The Web App URL remains **identical**, ensuring no downtime or configuration changes on the frontend.
