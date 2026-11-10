// FOCUSON HRMS - Employee Directory & Management Page Module

import { apiRequest } from '../api.js';
import { getState, hasPermission } from '../store.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from '../ui.js';

export async function renderEmployeesPage(container) {
  const state = getState();
  const user = state.user || {};

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1100px; margin: 0 auto;">
      <!-- Action Bar -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Employee Directory</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Manage workforce master data, roles, policies, and reporting hierarchy.</p>
        </div>
        ${(hasPermission('employee.create') || user.isSuperAdmin) ? `
          <button id="btn-add-employee" class="btn btn-primary">
            ${ICONS.users} Add New Employee
          </button>
        ` : ''}
      </div>

      <!-- Filter / Search Card -->
      <div class="astra-card" style="padding: 1rem;">
        <div style="display: flex; gap: 1rem; flex-wrap: wrap;">
          <input type="text" id="filter-search" class="form-input" style="flex: 1; min-width: 240px;" placeholder="Search by name, ID, or designation..." />
          <select id="filter-status" class="form-input" style="width: 160px;">
            <option value="">All Statuses</option>
            <option value="ACTIVE" selected>Active</option>
            <option value="INACTIVE">Inactive</option>
          </select>
          <button id="btn-apply-filters" class="btn btn-secondary">Filter</button>
        </div>
      </div>

      <!-- Employee Directory Table -->
      <div class="astra-card" style="padding: 0; overflow: hidden;">
        <div id="emp-table-container">
          <p style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading employee directory...</p>
        </div>
      </div>
    </div>
  `;

  async function loadEmployees() {
    const mount = document.getElementById('emp-table-container');
    const searchVal = (document.getElementById('filter-search')?.value || '').toLowerCase();
    const statusVal = document.getElementById('filter-status')?.value || 'ACTIVE';

    try {
      const emps = await apiRequest('employee.list', { filters: { status: statusVal } }, { isRead: true }) || [];
      const filtered = emps.filter(e => {
        const full = `${e.first_name} ${e.last_name || ''} ${e.id} ${e.designation || ''}`.toLowerCase();
        return full.includes(searchVal);
      });

      if (filtered.length === 0) {
        mount.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.users}</div>
            <h3 class="empty-state-title">No Employees Found</h3>
            <p class="empty-state-desc">No employee profiles matched the specified filter criteria.</p>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border-subtle); background-color: var(--bg-surface-muted); color: var(--text-muted); text-align: left;">
                <th style="padding: 0.875rem 1rem;">Employee</th>
                <th style="padding: 0.875rem 1rem;">Department</th>
                <th style="padding: 0.875rem 1rem;">Designation</th>
                <th style="padding: 0.875rem 1rem;">Policy</th>
                <th style="padding: 0.875rem 1rem;">Status</th>
                <th style="padding: 0.875rem 1rem; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${filtered.map(emp => `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td style="padding: 0.875rem 1rem;">
                    <div style="display: flex; align-items: center; gap: 0.75rem;">
                      <div class="user-avatar" style="width: 32px; height: 32px; font-size: 0.75rem;">
                        ${(emp.first_name || 'U').substring(0, 1).toUpperCase()}
                      </div>
                      <div>
                        <strong>${emp.first_name} ${emp.last_name || ''}</strong>
                        <div class="meta-cluster"><span>ID: ${emp.id}</span></div>
                      </div>
                    </div>
                  </td>
                  <td style="padding: 0.875rem 1rem;">${emp.department || 'N/A'}</td>
                  <td style="padding: 0.875rem 1rem;">${emp.designation || 'Staff'}</td>
                  <td style="padding: 0.875rem 1rem;">${emp.attendance_policy_id || 'Office'}</td>
                  <td style="padding: 0.875rem 1rem;">
                    <span class="status-indicator">
                      <span class="status-dot ${emp.status === 'ACTIVE' ? 'status-dot-success' : 'status-dot-danger'}"></span>
                      <span>${emp.status}</span>
                    </span>
                  </td>
                  <td style="padding: 0.875rem 1rem; text-align: right;">
                    <button class="btn btn-ghost btn-view-emp" data-id="${emp.id}" style="font-size: 0.8125rem;">View</button>
                    ${user.isSuperAdmin && emp.status === 'ACTIVE' ? `
                      <button class="btn btn-ghost btn-deact-emp" data-id="${emp.id}" style="font-size: 0.8125rem; color: var(--status-danger);">Deactivate</button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;

      // View details handler
      document.querySelectorAll('.btn-view-emp').forEach(btn => {
        btn.onclick = async () => {
          const empId = btn.getAttribute('data-id');
          try {
            const detail = await apiRequest('employee.get', { employeeId: empId }, { isRead: true });
            openEmployeeViewModal(detail);
          } catch (e) {
            showToast(e.message, 'error');
          }
        };
      });

      // Deactivate handler (Leaver Rule)
      document.querySelectorAll('.btn-deact-emp').forEach(btn => {
        btn.onclick = async () => {
          const empId = btn.getAttribute('data-id');
          const confirmed = await confirmDialog(
            'Deactivate Employee',
            `Are you sure you want to deactivate ${empId}? In accordance with the Leaver Rule, active logins and sessions will be revoked, and all pending approval assignments will be safely reassigned.`,
            'Deactivate',
            true
          );

          if (confirmed) {
            try {
              const res = await apiRequest('employee.deactivate', { employeeId: empId, reason: 'Administrative separation' });
              showToast(`Employee deactivated. Reassigned ${res.reassignedApprovals} pending approvals.`, 'success');
              loadEmployees();
            } catch (err) {
              showToast(err.message || 'Deactivation failed', 'error');
            }
          }
        };
      });

    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Failed to load directory: ${err.message}</p>`;
    }
  }

  // Add Employee Modal
  const addBtn = document.getElementById('btn-add-employee');
  if (addBtn) {
    addBtn.onclick = () => openAddEmployeeModal(loadEmployees);
  }

  document.getElementById('btn-apply-filters').onclick = () => loadEmployees();
  document.getElementById('filter-search').onkeydown = (e) => { if (e.key === 'Enter') loadEmployees(); };

  loadEmployees();
}

function openEmployeeViewModal(emp) {
  const content = document.createElement('div');
  content.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1rem;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div><span class="form-hint">Employee ID</span><p><strong>${emp.id}</strong></p></div>
        <div><span class="form-hint">Full Name</span><p><strong>${emp.first_name} ${emp.last_name || ''}</strong></p></div>
        <div><span class="form-hint">Department</span><p>${emp.department || 'N/A'}</p></div>
        <div><span class="form-hint">Designation</span><p>${emp.designation || 'Staff'}</p></div>
        <div><span class="form-hint">Email</span><p>${emp.email || '-'}</p></div>
        <div><span class="form-hint">Phone</span><p>${emp.phone || '-'}</p></div>
        <div><span class="form-hint">Branch</span><p>${emp.branch || 'HQ'}</p></div>
        <div><span class="form-hint">Policy</span><p>${emp.attendance_policy_id || 'Office'}</p></div>
      </div>

      <div style="border-top: 1px solid var(--border-subtle); padding-top: 0.75rem;">
        <h4 style="font-size: 0.875rem; margin-bottom: 0.5rem;">Financial & Statutory Data</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div><span class="form-hint">Bank Account</span><p style="font-family: var(--font-mono);">${emp.bank_account_number || 'Masked'}</p></div>
          <div><span class="form-hint">PAN Number</span><p style="font-family: var(--font-mono);">${emp.pan_number || 'Masked'}</p></div>
          <div><span class="form-hint">Gross Salary</span><p><strong>${emp.gross_salary ? '₹' + emp.gross_salary : (emp.salary_masked ? '•••••• (Masked)' : '-')}</strong></p></div>
          <div><span class="form-hint">Status</span><p>${emp.status}</p></div>
        </div>
      </div>
    </div>
  `;

  openModal({
    title: 'Employee Profile Details',
    contentNode: content
  });
}

function openAddEmployeeModal(onSuccess) {
  const content = document.createElement('div');
  content.innerHTML = `
    <form id="form-create-emp" style="max-height: 70vh; overflow-y: auto; padding-right: 4px;">
      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label">Employee ID *</label>
          <input type="text" id="new-emp-id" class="form-input" placeholder="e.g. EMP082" required />
        </div>
        <div class="form-group">
          <label class="form-label">First Name *</label>
          <input type="text" id="new-emp-fname" class="form-input" required />
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label">Last Name</label>
          <input type="text" id="new-emp-lname" class="form-input" />
        </div>
        <div class="form-group">
          <label class="form-label">Email Address</label>
          <input type="email" id="new-emp-email" class="form-input" />
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label">Department</label>
          <input type="text" id="new-emp-dept" class="form-input" placeholder="e.g. Operations" />
        </div>
        <div class="form-group">
          <label class="form-label">Designation</label>
          <input type="text" id="new-emp-desig" class="form-input" placeholder="e.g. Site Supervisor" />
        </div>
      </div>

      <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
        <div class="form-group">
          <label class="form-label">Attendance Policy</label>
          <select id="new-emp-policy" class="form-input">
            <option value="POL_OFFICE">Office Geofenced Policy</option>
            <option value="POL_SITE">Site / Field Policy (No GPS)</option>
            <option value="POL_EXEMPT">Exempt / Flexible Policy</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Monthly Gross Salary (₹)</label>
          <input type="number" id="new-emp-salary" class="form-input" placeholder="30000" />
        </div>
      </div>

      <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
        <button type="button" class="btn btn-secondary" id="btn-cancel-add-emp">Cancel</button>
        <button type="submit" class="btn btn-primary">Create Employee Profile</button>
      </div>
    </form>
  `;

  openModal({
    title: 'Add New Employee Profile',
    contentNode: content
  });

  document.getElementById('btn-cancel-add-emp').onclick = () => closeModal();
  document.getElementById('form-create-emp').onsubmit = async (e) => {
    e.preventDefault();
    const payload = {
      employee_id: document.getElementById('new-emp-id').value,
      first_name: document.getElementById('new-emp-fname').value,
      last_name: document.getElementById('new-emp-lname').value,
      email: document.getElementById('new-emp-email').value,
      department: document.getElementById('new-emp-dept').value,
      designation: document.getElementById('new-emp-desig').value,
      attendance_policy_id: document.getElementById('new-emp-policy').value,
      gross_salary: parseFloat(document.getElementById('new-emp-salary').value || '0')
    };

    try {
      const res = await apiRequest('employee.save', payload);
      closeModal();
      showToast(`Employee ${payload.employee_id} created with initial temporary password: ${res.initialPassword}`, 'success', 8000);
      onSuccess();
    } catch (err) {
      showToast(err.message || 'Creation failed', 'error');
    }
  };
}
