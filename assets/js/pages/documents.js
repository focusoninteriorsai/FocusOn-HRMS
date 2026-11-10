// FOCUSON HRMS - Documents & Google Docs / Drive Integration Module

import { apiRequest } from '../api.js';
import { getState, hasPermission } from '../store.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from '../ui.js';
import { createGoogleDoc, listDriveFiles, getWorkspaceUser, signInWithGoogle } from '../workspace.js';

export async function renderDocumentsPage(container) {
  const state = getState();
  const user = state.user || {};
  const wsUser = getWorkspaceUser();

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1000px; margin: 0 auto;">
      <!-- Page Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Employee Documents & Letters</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Generate HR certificate letters in Google Docs and view company policy documents.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <button id="btn-generate-doc" class="btn btn-primary">
            ${ICONS.fileText} Generate Official Letter
          </button>
        </div>
      </div>

      <!-- Google Workspace Status Banner -->
      <div class="astra-card" style="display: flex; justify-content: space-between; align-items: center; background-color: var(--bg-surface-muted);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: ${wsUser ? 'var(--status-success)' : 'var(--status-warning)'};"></div>
          <div>
            <div style="font-size: 0.875rem; font-weight: 600;">
              ${wsUser ? `Google Workspace Connected (${wsUser.email})` : 'Google Workspace Not Connected'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${wsUser ? 'Ready to generate documents directly into Google Docs & save to Google Drive.' : 'Connect your Google account to enable 1-click Google Docs creation and Drive syncing.'}
            </div>
          </div>
        </div>
        ${!wsUser ? `
          <button id="btn-connect-docs-ws" class="btn btn-secondary btn-sm">
            Connect Google Workspace
          </button>
        ` : ''}
      </div>

      <!-- Document Generation Templates Grid -->
      <div class="astra-card">
        <div class="astra-card-header">
          <h3 class="astra-card-title">${ICONS.fileText} Official HR Letter Templates</h3>
        </div>
        <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 1rem; margin-top: 1rem;">
          
          <div class="astra-card" style="border: 1px solid var(--border-subtle); padding: 1.25rem;">
            <h4 style="margin: 0 0 0.5rem 0;">Employment Verification</h4>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
              Proof of employment stating designation, joining date, and active employment status for visa, bank, or rental verification.
            </p>
            <button class="btn btn-secondary btn-sm btn-generate-tpl" data-template="employment">
              Create in Google Docs
            </button>
          </div>

          <div class="astra-card" style="border: 1px solid var(--border-subtle); padding: 1.25rem;">
            <h4 style="margin: 0 0 0.5rem 0;">Salary Certificate</h4>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
              Certified salary breakdown showing current CTC, basic allowances, and statutory PF/ESI coverage.
            </p>
            <button class="btn btn-secondary btn-sm btn-generate-tpl" data-template="salary">
              Create in Google Docs
            </button>
          </div>

          <div class="astra-card" style="border: 1px solid var(--border-subtle); padding: 1.25rem;">
            <h4 style="margin: 0 0 0.5rem 0;">Experience & Relieving Letter</h4>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 1rem; line-height: 1.5;">
              Formal certificate acknowledging tenure, contributions, and confirmation of standard relief.
            </p>
            <button class="btn btn-secondary btn-sm btn-generate-tpl" data-template="experience">
              Create in Google Docs
            </button>
          </div>

        </div>
      </div>

      <!-- Google Drive Files Section -->
      <div class="astra-card">
        <div class="astra-card-header">
          <h3 class="astra-card-title">${ICONS.fileText} My Google Drive HR Files</h3>
          <button id="btn-refresh-drive" class="btn btn-ghost btn-icon" title="Refresh files">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
        </div>
        <div id="drive-files-container" style="margin-top: 1rem;">
          <p style="text-align: center; padding: 2rem; color: var(--text-muted);">
            ${wsUser ? 'Loading Drive files...' : 'Connect Google Workspace above to view and open your documents.'}
          </p>
        </div>
      </div>
    </div>
  `;

  // Attach Connect WS button
  const connectBtn = document.getElementById('btn-connect-docs-ws');
  if (connectBtn) {
    connectBtn.onclick = async () => {
      try {
        await signInWithGoogle();
        showToast('Google Workspace connected!', 'success');
        renderDocumentsPage(container);
      } catch (err) {
        showToast(err.message || 'Connection failed', 'error');
      }
    };
  }

  // Handle Template Generation
  const generateDoc = async (templateType) => {
    const ws = getWorkspaceUser();
    if (!ws) {
      showToast('Please connect Google Workspace at the top right to generate Google Docs.', 'warning');
      return;
    }

    const todayStr = new Date().toLocaleDateString('en-IN', { year: 'numeric', month: 'long', day: 'numeric' });
    let title = '';
    let body = '';

    if (templateType === 'employment') {
      title = `Employment_Verification_${user.employeeId}_${new Date().toISOString().substring(0, 10)}`;
      body = `TO WHOMSOEVER IT MAY CONCERN\n\n` +
        `Date: ${todayStr}\n\n` +
        `This is to certify that ${user.name || user.employeeId} (Employee ID: ${user.employeeId}) ` +
        `is currently employed with FOCUSON in the position of ${user.designation || 'Staff'} ` +
        `in the ${user.department || 'Operations'} Department.\n\n` +
        `This letter is issued at the specific request of the employee for verification purposes.\n\n` +
        `For FOCUSON Management,\n` +
        `Human Resources Department\n` +
        `Authorized Signatory\n`;
    } else if (templateType === 'salary') {
      title = `Salary_Certificate_${user.employeeId}_${new Date().toISOString().substring(0, 10)}`;
      body = `SALARY CERTIFICATE\n\n` +
        `Date: ${todayStr}\n\n` +
        `Employee Name: ${user.name || user.employeeId}\n` +
        `Employee ID: ${user.employeeId}\n` +
        `Designation: ${user.designation || 'Staff'}\n` +
        `Department: ${user.department || 'Operations'}\n\n` +
        `This is to confirm that the above named employee is on our active payroll.\n` +
        `Statutory PF and ESI contributions are deposited in compliance with government regulations.\n\n` +
        `For FOCUSON Management,\n` +
        `Authorized Signatory\n`;
    } else if (templateType === 'experience') {
      title = `Relieving_and_Experience_${user.employeeId}_${new Date().toISOString().substring(0, 10)}`;
      body = `EXPERIENCE & RELIEVING CERTIFICATE\n\n` +
        `Date: ${todayStr}\n\n` +
        `This is to certify that ${user.name || user.employeeId} (Employee ID: ${user.employeeId}) ` +
        `served FOCUSON as ${user.designation || 'Staff'}.\n\n` +
        `During their tenure, they demonstrated commitment and professionalism.\n` +
        `We wish them all the best in their future endeavors.\n\n` +
        `For FOCUSON Management,\n` +
        `Human Resources Department\n`;
    }

    try {
      showToast('Creating Google Doc...', 'info');
      const doc = await createGoogleDoc(title, body);
      if (doc && doc.webViewLink) {
        showToast('Google Doc created successfully!', 'success');
        window.open(doc.webViewLink, '_blank');
        loadDriveFiles();
      }
    } catch (err) {
      showToast(err.message || 'Failed to create Google Doc', 'error');
    }
  };

  document.querySelectorAll('.btn-generate-tpl').forEach(btn => {
    btn.onclick = () => {
      const tpl = btn.getAttribute('data-template');
      generateDoc(tpl);
    };
  });

  const customBtn = document.getElementById('btn-generate-doc');
  if (customBtn) {
    customBtn.onclick = () => generateDoc('employment');
  }

  // Load Drive files if Workspace connected
  async function loadDriveFiles() {
    const mount = document.getElementById('drive-files-container');
    if (!getWorkspaceUser()) return;

    try {
      mount.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Fetching your Google Drive files...</p>`;
      const data = await listDriveFiles(10);
      const files = data.files || [];

      if (files.length === 0) {
        mount.innerHTML = `
          <div class="empty-state" style="padding: 2rem 1rem;">
            <div class="empty-state-icon">${ICONS.fileText}</div>
            <div class="empty-state-title">No Recent Drive Documents</div>
            <div class="empty-state-desc">Generate an official letter above to create your first document.</div>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="overflow-x: auto;">
          <table class="data-table" style="width: 100%;">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Type</th>
                <th>Modified</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              ${files.map(f => `
                <tr>
                  <td style="font-weight: 500;">
                    <div style="display: flex; align-items: center; gap: 0.5rem;">
                      ${ICONS.fileText}
                      <span>${f.name}</span>
                    </div>
                  </td>
                  <td style="font-size: 0.75rem; color: var(--text-muted);">${f.mimeType.split('.').pop()}</td>
                  <td style="font-size: 0.8125rem;">${new Date(f.modifiedTime).toLocaleDateString()}</td>
                  <td>
                    <a href="${f.webViewLink}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="color: var(--brand-primary);">
                      Open in Drive &rarr;
                    </a>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Could not load Drive files: ${err.message}</p>`;
    }
  }

  const refreshBtn = document.getElementById('btn-refresh-drive');
  if (refreshBtn) {
    refreshBtn.onclick = () => loadDriveFiles();
  }

  if (wsUser) {
    loadDriveFiles();
  }
}
