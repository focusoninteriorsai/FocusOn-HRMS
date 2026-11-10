// FOCUSON HRMS - Payroll & Statutory Runs Page Module

import { apiRequest } from '../api.js';
import { getState, hasPermission } from '../store.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from '../ui.js';
import { exportToGoogleSheet, getWorkspaceUser, signInWithGoogle } from '../workspace.js';

export async function renderPayrollPage(container) {
  const state = getState();
  const user = state.user || {};
  const currentMonth = new Date().toISOString().substring(0, 7);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1100px; margin: 0 auto;">
      <!-- Caution Banner: CA Verification Requirement -->
      <div style="background-color: var(--status-warning-bg); border: 1px solid var(--status-warning-border); padding: 1rem; border-radius: var(--radius-md); display: flex; gap: 0.75rem; align-items: flex-start;">
        <span style="color: var(--status-warning);">${ICONS.alertCircle}</span>
        <div style="font-size: 0.8125rem; color: var(--text-main); line-height: 1.5;">
          <strong>Statutory Compliance Notice:</strong> PF, ESI, Professional Tax (PT), and TDS wage definitions and deduction percentages are configured by the Super Admin in Settings. All formulas and statutory parameters must be verified by the company's Chartered Accountant (CA) prior to releasing live salary disbursements.
        </div>
      </div>

      <!-- Action Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Payroll & Statutory Operations</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Multi-stage maker-checker runs: Prepared &rarr; Verified &rarr; Approved &rarr; Released.</p>
        </div>
        ${(hasPermission('payroll.prepare') || user.isSuperAdmin) ? `
          <button id="btn-prepare-payroll" class="btn btn-primary">
            ${ICONS.dollarSign} Prepare Monthly Payroll
          </button>
        ` : ''}
      </div>

      <!-- Active Payroll Run Card -->
      <div class="astra-card" id="active-run-card">
        <div class="astra-card-header">
          <h3 class="astra-card-title">${ICONS.fileText} Payroll Cycle: ${currentMonth}</h3>
          <span id="run-status-badge" class="status-indicator">
            <span class="status-dot status-dot-warning"></span>
            <span>State: DRAFT</span>
          </span>
        </div>

        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem; margin: 1.5rem 0;">
          <div style="background-color: var(--bg-surface-muted); padding: 1rem; border-radius: var(--radius-md);">
            <span class="form-hint">Processed Employees</span>
            <div style="font-size: 1.5rem; font-weight: 700;" id="metric-emp-count">--</div>
          </div>
          <div style="background-color: var(--bg-surface-muted); padding: 1rem; border-radius: var(--radius-md);">
            <span class="form-hint">Total Net Payout</span>
            <div style="font-size: 1.5rem; font-weight: 700;" id="metric-net-payout">₹--</div>
          </div>
          <div style="background-color: var(--bg-surface-muted); padding: 1rem; border-radius: var(--radius-md);">
            <span class="form-hint">Maker-Checker Segregation</span>
            <div style="font-size: 0.875rem; margin-top: 4px;" id="metric-checker-status">Preparer &ne; Verifier &ne; Approver</div>
          </div>
        </div>

        <!-- Maker-Checker Controls -->
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap; border-top: 1px solid var(--border-subtle); padding-top: 1.25rem;">
          <button id="btn-verify-run" class="btn btn-secondary" disabled>Verify Run (Step 1)</button>
          <button id="btn-approve-run" class="btn btn-secondary" disabled>Approve Run (Step 2)</button>
          <button id="btn-release-run" class="btn btn-primary" disabled>Release & Publish Payslips</button>
          <button id="btn-export-bank-csv" class="btn btn-secondary" style="margin-left: auto;">Export Bank Transfer CSV</button>
          <button id="btn-export-sheets" class="btn btn-secondary">${ICONS.fileText} Export to Google Sheets</button>
        </div>
      </div>
    </div>
  `;

  // Prepare Payroll Button Handler
  const prepBtn = document.getElementById('btn-prepare-payroll');
  if (prepBtn) {
    prepBtn.onclick = () => {
      const content = document.createElement('div');
      content.innerHTML = `
        <form id="form-prep-run">
          <p style="font-size: 0.875rem; color: var(--text-muted); margin-bottom: 1rem;">
            Preparing payroll will lock attendance paid days, compute LOP, prorate basic and allowances, and apply statutory PF, ESI, and PT deductions according to Settings.
          </p>
          <div class="form-group">
            <label class="form-label">Pay Cycle (YYYY-MM)</label>
            <input type="month" id="prep-month-input" class="form-input" required value="${currentMonth}" />
          </div>
          <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1.25rem;">
            <button type="button" class="btn btn-secondary" id="btn-prep-cancel">Cancel</button>
            <button type="submit" class="btn btn-primary">Execute Preparation</button>
          </div>
        </form>
      `;

      openModal({
        title: 'Prepare Monthly Payroll',
        contentNode: content
      });

      document.getElementById('btn-prep-cancel').onclick = () => closeModal();
      document.getElementById('form-prep-run').onsubmit = async (e) => {
        e.preventDefault();
        const monthVal = document.getElementById('prep-month-input').value;
        closeModal();

        try {
          const res = await apiRequest('payroll.prepareRun', { monthYear: monthVal });
          showToast(`Payroll prepared for ${res.processedCount} employees. Total Net: ₹${res.totalNetPayout.toLocaleString()}`, 'success');
          updateRunDisplay(res.runId, res.state, res.processedCount, res.totalNetPayout);
        } catch (err) {
          showToast(err.message || 'Preparation failed', 'error');
        }
      };
    };
  }

  let activeRunId = 'payrun_' + currentMonth;

  function updateRunDisplay(runId, stateName, count, net) {
    activeRunId = runId;
    document.getElementById('metric-emp-count').textContent = count;
    document.getElementById('metric-net-payout').textContent = '₹' + net.toLocaleString();
    const badge = document.getElementById('run-status-badge');
    badge.innerHTML = `<span class="status-dot status-dot-success"></span><span>State: ${stateName}</span>`;

    const vBtn = document.getElementById('btn-verify-run');
    const aBtn = document.getElementById('btn-approve-run');
    const rBtn = document.getElementById('btn-release-run');

    if (stateName === 'PREPARED') {
      vBtn.disabled = false;
      aBtn.disabled = true;
      rBtn.disabled = true;
    } else if (stateName === 'VERIFIED') {
      vBtn.disabled = true;
      aBtn.disabled = false;
      rBtn.disabled = true;
    } else if (stateName === 'APPROVED') {
      vBtn.disabled = true;
      aBtn.disabled = true;
      rBtn.disabled = false;
    } else if (stateName === 'RELEASED') {
      vBtn.disabled = true;
      aBtn.disabled = true;
      rBtn.disabled = true;
    }
  }

  // Maker-Checker Step 1: Verify
  document.getElementById('btn-verify-run').onclick = async () => {
    try {
      const res = await apiRequest('payroll.verifyRun', { runId: activeRunId });
      showToast('Payroll run verified successfully.', 'success');
      document.getElementById('run-status-badge').innerHTML = '<span class="status-dot status-dot-success"></span><span>State: VERIFIED</span>';
      document.getElementById('btn-verify-run').disabled = true;
      document.getElementById('btn-approve-run').disabled = false;
    } catch (err) {
      showToast(err.message || 'Verification failed (Maker cannot verify)', 'error');
    }
  };

  // Maker-Checker Step 2: Approve
  document.getElementById('btn-approve-run').onclick = async () => {
    try {
      const res = await apiRequest('payroll.approveRun', { runId: activeRunId });
      showToast('Payroll run approved.', 'success');
      document.getElementById('run-status-badge').innerHTML = '<span class="status-dot status-dot-success"></span><span>State: APPROVED</span>';
      document.getElementById('btn-approve-run').disabled = true;
      document.getElementById('btn-release-run').disabled = false;
    } catch (err) {
      showToast(err.message || 'Approval failed (Maker/Verifier cannot approve)', 'error');
    }
  };

  // Maker-Checker Step 3: Release
  document.getElementById('btn-release-run').onclick = async () => {
    try {
      const res = await apiRequest('payroll.releaseRun', { runId: activeRunId });
      showToast('Payroll released! Payslips are now accessible to employees.', 'success');
      document.getElementById('run-status-badge').innerHTML = '<span class="status-dot status-dot-success"></span><span>State: RELEASED</span>';
      document.getElementById('btn-release-run').disabled = true;
    } catch (err) {
      showToast(err.message || 'Release failed', 'error');
    }
  };

  // Export Bank CSV
  document.getElementById('btn-export-bank-csv').onclick = async () => {
    try {
      const csvStr = await apiRequest('payroll.exportBankCsv', { runId: activeRunId });
      const blob = new Blob([csvStr], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `bank_transfer_${activeRunId}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Bank transfer sheet downloaded.', 'success');
    } catch (err) {
      showToast(err.message || 'CSV Export failed', 'error');
    }
  };

  // Export to Google Sheets
  document.getElementById('btn-export-sheets').onclick = async () => {
    const wsUser = getWorkspaceUser();
    if (!wsUser) {
      const connectConfirm = await confirmDialog(
        'Google Workspace Sign-In',
        'Exporting to Google Sheets requires connecting your Google account. Connect now?',
        'Connect Workspace'
      );
      if (connectConfirm) {
        try {
          await signInWithGoogle();
          showToast('Google Workspace connected!', 'success');
        } catch (e) {
          showToast(e.message || 'Sign in failed', 'error');
          return;
        }
      } else {
        return;
      }
    }

    try {
      showToast('Preparing payroll sheet data...', 'info');
      // Prepare sheet rows
      const sheetRows = [
        ['FOCUSON HRMS - PAYROLL REGISTER', '', '', '', '', '', '', '', '', '', '', '', '', '', '', ''],
        ['Run ID:', activeRunId, 'Generated:', new Date().toLocaleString(), '', '', '', '', '', '', '', '', '', '', '', ''],
        [''],
        [
          'Employee ID',
          'Employee Name',
          'Designation',
          'Department',
          'Gross Wage (₹)',
          'Paid Days',
          'LOP Days',
          'Basic (₹)',
          'HRA (₹)',
          'Special Allow. (₹)',
          'PF Employee (₹)',
          'ESI Employee (₹)',
          'PT (₹)',
          'TDS (₹)',
          'Total Deductions (₹)',
          'Net Payout (₹)'
        ]
      ];

      // Add sample run summary row
      sheetRows.push([
        user.employeeId || 'EMP001',
        user.name || 'Staff Member',
        user.designation || 'Engineer',
        user.department || 'Operations',
        '45000',
        '30',
        '0',
        '22500',
        '11250',
        '11250',
        '1800',
        '0',
        '200',
        '500',
        '2500',
        '42500'
      ]);

      const title = `FOCUSON_Payroll_${activeRunId}_${new Date().toISOString().substring(0, 10)}`;
      const result = await exportToGoogleSheet(title, sheetRows);
      if (result && result.spreadsheetUrl) {
        showToast('Successfully exported to Google Sheets!', 'success');
        window.open(result.spreadsheetUrl, '_blank');
      }
    } catch (err) {
      showToast(err.message || 'Export to Google Sheets failed', 'error');
    }
  };
}
