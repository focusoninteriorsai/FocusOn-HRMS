// FOCUSON HRMS - Leave Management Page Module

import { apiRequest } from '../api.js';
import { getState } from '../store.js';
import { ICONS, showToast, openModal, closeModal } from '../ui.js';

export async function renderLeavePage(container) {
  const state = getState();
  const user = state.user || {};

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1000px; margin: 0 auto;">
      <!-- Top Action Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Leave Management</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">View quota balances, track applications, and submit requests.</p>
        </div>
        <button id="btn-apply-leave" class="btn btn-primary">
          ${ICONS.calendar} Apply for Leave
        </button>
      </div>

      <!-- Quota Cards Grid -->
      <div id="leave-balances-grid" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 1rem;">
        <div class="skeleton" style="height: 110px;"></div>
        <div class="skeleton" style="height: 110px;"></div>
        <div class="skeleton" style="height: 110px;"></div>
      </div>

      <!-- Recent Leave Applications -->
      <div class="astra-card">
        <div class="astra-card-header">
          <h3 class="astra-card-title">${ICONS.fileText} My Leave Requests</h3>
          <button id="btn-refresh-leaves" class="btn btn-ghost btn-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
        </div>
        <div id="leave-history-table">
          <p style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading leave records...</p>
        </div>
      </div>
    </div>
  `;

  // Apply Leave Modal
  document.getElementById('btn-apply-leave').onclick = async () => {
    let leaveTypes = [];
    try {
      leaveTypes = await apiRequest('leave.getTypes', {}, { isRead: true }) || [];
    } catch (e) {
      leaveTypes = [{ code: 'CL', name: 'Casual Leave' }, { code: 'SL', name: 'Sick Leave' }, { code: 'EL', name: 'Earned Leave' }];
    }

    const content = document.createElement('div');
    content.innerHTML = `
      <form id="form-apply-leave">
        <div class="form-group">
          <label class="form-label">Leave Type</label>
          <select id="leave-type-select" class="form-input" required>
            ${leaveTypes.map(lt => `<option value="${lt.code}">${lt.name} (${lt.code})</option>`).join('')}
          </select>
        </div>

        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div class="form-group">
            <label class="form-label">Start Date</label>
            <input type="date" id="leave-start" class="form-input" required value="${new Date().toISOString().substring(0, 10)}" />
          </div>
          <div class="form-group">
            <label class="form-label">End Date</label>
            <input type="date" id="leave-end" class="form-input" required value="${new Date().toISOString().substring(0, 10)}" />
          </div>
        </div>

        <div class="form-group">
          <label style="display: flex; align-items: center; gap: 0.5rem; font-size: 0.875rem; cursor: pointer;">
            <input type="checkbox" id="leave-half-day" /> Half Day Leave (0.5 day)
          </label>
        </div>

        <div class="form-group">
          <label class="form-label">Reason / Comments</label>
          <textarea id="leave-reason" class="form-input" rows="3" placeholder="Specify reason for leave..." required></textarea>
        </div>

        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button type="button" class="btn btn-secondary" id="btn-leave-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary" id="btn-submit-leave">Submit Application</button>
        </div>
      </form>
    `;

    openModal({
      title: 'Apply for Leave',
      contentNode: content
    });

    document.getElementById('btn-leave-cancel').onclick = () => closeModal();
    document.getElementById('form-apply-leave').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        leave_type_code: document.getElementById('leave-type-select').value,
        start_date: document.getElementById('leave-start').value,
        end_date: document.getElementById('leave-end').value,
        is_half_day: document.getElementById('leave-half-day').checked,
        reason: document.getElementById('leave-reason').value
      };

      try {
        await apiRequest('leave.apply', payload);
        closeModal();
        showToast('Leave application submitted for approval.', 'success');
        loadBalances();
      } catch (err) {
        showToast(err.message || 'Application failed', 'error');
      }
    };
  };

  async function loadBalances() {
    const grid = document.getElementById('leave-balances-grid');
    const tableMount = document.getElementById('leave-history-table');

    try {
      const balances = await apiRequest('leave.getMyBalances', {}, { isRead: true });
      if (!balances || balances.length === 0) {
        grid.innerHTML = '<p style="color: var(--text-muted);">No balances initialized.</p>';
      } else {
        grid.innerHTML = balances.map(b => `
          <div class="astra-card">
            <span class="astra-card-subtitle">${b.leave_type_code} Balance</span>
            <div style="font-size: 1.75rem; font-weight: 700; color: var(--text-main); margin-top: 4px;">
              ${b.balance} <span style="font-size: 0.9375rem; font-weight: normal; color: var(--text-muted);">Days</span>
            </div>
            <div class="meta-cluster" style="margin-top: 8px;">
              <span>Opening: ${b.opening || 0}</span>
              <span class="meta-dot">·</span>
              <span>Consumed: ${b.consumed || 0}</span>
            </div>
          </div>
        `).join('');
      }

      tableMount.innerHTML = `
        <div class="empty-state" style="padding: 2rem 1rem;">
          <div class="empty-state-icon">${ICONS.calendar}</div>
          <div class="empty-state-title">No Active Applications</div>
          <div class="empty-state-desc">You currently have no pending leave applications in this cycle.</div>
        </div>
      `;
    } catch (err) {
      grid.innerHTML = `<p style="color: var(--status-danger);">Failed to load balances: ${err.message}</p>`;
    }
  }

  document.getElementById('btn-refresh-leaves').onclick = () => loadBalances();
  loadBalances();
}
