// FOCUSON HRMS - Reports & Muster Roll Page Module

import { apiRequest } from '../api.js';
import { ICONS, showToast } from '../ui.js';

export async function renderReportsPage(container) {
  const currentMonth = new Date().toISOString().substring(0, 7);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1100px; margin: 0 auto;">
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Operational Reports</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Muster rolls, headcount analysis, and statutory compliance logs.</p>
        </div>
        <div style="display: flex; gap: 0.75rem;">
          <input type="month" id="report-month" class="form-input" style="width: 160px;" value="${currentMonth}" />
          <button id="btn-export-muster-csv" class="btn btn-secondary">${ICONS.fileText} Export Muster CSV</button>
        </div>
      </div>

      <!-- Muster Roll Card -->
      <div class="astra-card" style="padding: 0; overflow: hidden;">
        <div style="padding: 1rem; border-bottom: 1px solid var(--border-subtle); display: flex; justify-content: space-between; align-items: center;">
          <h3 class="astra-card-title">${ICONS.calendar} Monthly Muster Roll Register</h3>
          <span class="meta-cluster">
            <span><strong>P</strong>: Present</span>
            <span class="meta-dot">·</span>
            <span><strong>HD</strong>: Half-Day</span>
            <span class="meta-dot">·</span>
            <span><strong>F</strong>: Flagged / Outside</span>
            <span class="meta-dot">·</span>
            <span><strong>-</strong>: Absent/Off</span>
          </span>
        </div>
        <div id="muster-mount" style="overflow-x: auto;">
          <p style="padding: 2rem; text-align: center; color: var(--text-muted);">Loading muster roll register...</p>
        </div>
      </div>
    </div>
  `;

  async function loadMuster() {
    const mount = document.getElementById('muster-mount');
    const monthVal = document.getElementById('report-month').value;

    try {
      const records = await apiRequest('reports.musterRoll', { monthYear: monthVal }, { isRead: true }) || [];
      if (records.length === 0) {
        mount.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.calendar}</div>
            <h3 class="empty-state-title">No Attendance Marked</h3>
            <p class="empty-state-desc">No attendance records found for month ${monthVal}.</p>
          </div>
        `;
        return;
      }

      const days = [];
      for (let i = 1; i <= 31; i++) days.push(i < 10 ? '0' + i : '' + i);

      mount.innerHTML = `
        <table style="width: 100%; border-collapse: collapse; font-size: 0.75rem;">
          <thead>
            <tr style="background-color: var(--bg-surface-muted); border-bottom: 2px solid var(--border-subtle);">
              <th style="padding: 6px 8px; text-align: left; position: sticky; left: 0; background: var(--bg-surface-muted); z-index: 2;">Employee</th>
              ${days.map(d => `<th style="padding: 6px 4px; text-align: center;">${d}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${records.map(r => `
              <tr style="border-bottom: 1px solid var(--border-subtle);">
                <td style="padding: 6px 8px; font-weight: 600; white-space: nowrap; position: sticky; left: 0; background: var(--bg-surface); z-index: 1;">
                  ${r.name} <span style="font-size: 0.6875rem; color: var(--text-muted);">(${r.employeeId})</span>
                </td>
                ${days.map(d => {
                  const val = r.attendance[d] || '-';
                  const color = val === 'P' ? 'var(--status-success)' : (val === 'HD' ? 'var(--status-warning)' : 'var(--text-muted)');
                  return `<td style="padding: 6px 4px; text-align: center; font-family: var(--font-mono); font-weight: 600; color: ${color};">${val}</td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      `;
    } catch (e) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Failed to load muster: ${e.message}</p>`;
    }
  }

  document.getElementById('report-month').onchange = () => loadMuster();

  document.getElementById('btn-export-muster-csv').onclick = async () => {
    try {
      const monthVal = document.getElementById('report-month').value;
      const records = await apiRequest('reports.musterRoll', { monthYear: monthVal }, { isRead: true }) || [];
      const days = [];
      for (let i = 1; i <= 31; i++) days.push(i < 10 ? '0' + i : '' + i);

      const header = ['Employee ID,Employee Name,Department,' + days.join(',')];
      const rows = records.map(r => {
        const dVals = days.map(d => r.attendance[d] || '-');
        return `"${r.employeeId}","${r.name}","${r.department || ''}",${dVals.join(',')}`;
      });

      const csv = header.concat(rows).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `muster_roll_${monthVal}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      showToast('Muster roll CSV downloaded.', 'success');
    } catch (err) {
      showToast(err.message, 'error');
    }
  };

  loadMuster();
}
