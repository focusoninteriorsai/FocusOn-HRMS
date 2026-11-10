// FOCUSON HRMS - Unified Approval Inbox Page Module

import { apiRequest } from '../api.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from '../ui.js';

export async function renderInboxPage(container) {
  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1000px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Approval Inbox</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Unified queue for team leaves, regularizations, and expense claims.</p>
        </div>
        <button id="btn-refresh-inbox" class="btn btn-secondary">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          Refresh Queue
        </button>
      </div>

      <div id="inbox-list-container">
        <p style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading approval requests...</p>
      </div>
    </div>
  `;

  async function loadInbox() {
    const mount = document.getElementById('inbox-list-container');
    if (!mount) return;

    try {
      const items = await apiRequest('workflow.inbox', {}, { isRead: true });
      if (!items || items.length === 0) {
        mount.innerHTML = `
          <div class="astra-card">
            <div class="empty-state">
              <div class="empty-state-icon">${ICONS.checkCircle}</div>
              <h3 class="empty-state-title">Inbox Zero!</h3>
              <p class="empty-state-desc">You have no pending requests awaiting your review or action.</p>
            </div>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 1rem;">
          ${items.map(item => `
            <div class="astra-card astra-card-hover" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
              <div>
                <div style="display: flex; align-items: center; gap: 0.5rem;">
                  <span class="status-indicator">
                    <span class="status-dot status-dot-warning"></span>
                    <strong style="text-transform: uppercase; font-size: 0.8125rem;">${item.request_type}</strong>
                  </span>
                  <span class="meta-dot">·</span>
                  <span style="font-size: 0.8125rem; color: var(--text-muted);">ID: ${item.request_id}</span>
                </div>
                <h4 style="margin: 0.35rem 0 0.25rem 0;">Applicant: ${item.applicant_id}</h4>
                <div class="meta-cluster">
                  <span>Step: ${item.current_step_id || 'Manager Review'}</span>
                  <span class="meta-dot">·</span>
                  <span>Submitted: ${item.created_at ? item.created_at.substring(0, 10) : 'Recent'}</span>
                </div>
              </div>

              <div style="display: flex; gap: 0.5rem;">
                <button class="btn btn-secondary btn-action-reject" data-id="${item.id}" style="color: var(--status-danger);">
                  Reject
                </button>
                <button class="btn btn-primary btn-action-approve" data-id="${item.id}">
                  Approve
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Bind approve buttons
      document.querySelectorAll('.btn-action-approve').forEach(btn => {
        btn.onclick = async () => {
          const id = btn.getAttribute('data-id');
          const confirmed = await confirmDialog('Approve Request', 'Are you sure you wish to approve this request?');
          if (confirmed) {
            try {
              await apiRequest('workflow.action', { approval_id: id, action: 'APPROVE' });
              showToast('Request approved successfully.', 'success');
              loadInbox();
            } catch (err) {
              showToast(err.message || 'Action failed', 'error');
            }
          }
        };
      });

      // Bind reject buttons with mandatory comment prompt
      document.querySelectorAll('.btn-action-reject').forEach(btn => {
        btn.onclick = () => {
          const id = btn.getAttribute('data-id');
          const content = document.createElement('div');
          content.innerHTML = `
            <div class="form-group">
              <label class="form-label">Mandatory Rejection Comment</label>
              <textarea id="reject-comment" class="form-input" rows="3" placeholder="Explain reason for rejection..." required></textarea>
            </div>
            <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
              <button class="btn btn-secondary" id="btn-reject-cancel">Cancel</button>
              <button class="btn btn-danger" id="btn-reject-confirm">Confirm Rejection</button>
            </div>
          `;

          openModal({
            title: 'Reject Request',
            contentNode: content
          });

          document.getElementById('btn-reject-cancel').onclick = () => closeModal();
          document.getElementById('btn-reject-confirm').onclick = async () => {
            const comment = document.getElementById('reject-comment').value;
            if (!comment || comment.trim().length === 0) {
              showToast('A reason is mandatory for rejection.', 'warning');
              return;
            }

            try {
              await apiRequest('workflow.action', { approval_id: id, action: 'REJECT', comments: comment });
              closeModal();
              showToast('Request rejected.', 'info');
              loadInbox();
            } catch (err) {
              showToast(err.message || 'Action failed', 'error');
            }
          };
        };
      });

    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger);">Failed to load inbox: ${err.message}</p>`;
    }
  }

  document.getElementById('btn-refresh-inbox').onclick = () => loadInbox();
  loadInbox();
}
