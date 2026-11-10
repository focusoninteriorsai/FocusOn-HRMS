// FOCUSON HRMS - Attendance & Geo-fencing Page Module

import { apiRequest } from '../api.js';
import { getState } from '../store.js';
import { t } from '../i18n.js';
import { ICONS, showToast, openModal, closeModal } from '../ui.js';
import { getBrowserLocation } from '../geo.js';
import { openCameraCaptureModal } from '../camera.js';
import { renderGeofenceMap } from '../maps.js';

export async function renderAttendancePage(container) {
  const state = getState();
  const user = state.user || {};
  const currentMonth = new Date().toISOString().substring(0, 7);

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1000px; margin: 0 auto;">
      <!-- Hero Action Card: Live Clock & Punch -->
      <div class="astra-card astra-card-glass" style="display: flex; flex-direction: column; align-items: center; text-align: center; padding: 2rem;">
        <span class="astra-card-subtitle" style="text-transform: uppercase; letter-spacing: 0.05em; font-weight: 600;">Office Geofenced Attendance</span>
        <div id="live-clock" style="font-size: 2.75rem; font-weight: 800; font-family: var(--font-mono); margin: 0.5rem 0; color: var(--text-main);">
          --:--:--
        </div>
        <p id="live-date" style="font-size: 0.9375rem; color: var(--text-muted); margin-bottom: 1.5rem;">...</p>

        <!-- Status & Geofence Indicator -->
        <div id="geo-status-banner" style="display: inline-flex; align-items: center; gap: 0.5rem; background-color: var(--bg-surface-muted); padding: 0.5rem 1rem; border-radius: var(--radius-pill); font-size: 0.8125rem; margin-bottom: 1.5rem;">
          <span class="status-dot status-dot-info"></span>
          <span id="geo-status-text">Ready to verify location & selfie</span>
        </div>

        <div style="display: flex; gap: 1rem; flex-wrap: wrap; justify-content: center;">
          <button id="btn-punch-in" class="btn btn-primary" style="min-width: 160px; min-height: 48px; font-size: 1rem;">
            ${ICONS.clock} Check-In
          </button>
          <button id="btn-punch-out" class="btn btn-secondary" style="min-width: 160px; min-height: 48px; font-size: 1rem;">
            Check-Out
          </button>
        </div>

        <div style="margin-top: 1.25rem;">
          <button id="btn-open-regularize" class="btn btn-ghost" style="font-size: 0.8125rem;">
            Forgot punch? Request Regularization
          </button>
        </div>
      </div>

      <!-- Google Maps Interactive Geofence Map -->
      <div class="astra-card" style="padding: 1.25rem;">
        <div class="astra-card-header" style="margin-bottom: 0.75rem;">
          <h3 class="astra-card-title">${ICONS.building} Live Geofence Radar</h3>
          <span class="meta-cluster">
            <span>Radius: 150m</span>
            <span class="meta-dot">·</span>
            <span>Office HQ</span>
          </span>
        </div>
        <div id="attendance-map-canvas" style="width: 100%; height: 280px; border-radius: var(--radius-md); background-color: var(--bg-surface-muted); overflow: hidden;"></div>
      </div>

      <!-- Monthly Log History -->
      <div class="astra-card">
        <div class="astra-card-header">
          <h3 class="astra-card-title">${ICONS.calendar} Monthly Attendance Log (${currentMonth})</h3>
          <button id="btn-refresh-log" class="btn btn-ghost btn-icon" title="Refresh">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
          </button>
        </div>

        <div id="log-table-container">
          <p style="text-align: center; padding: 2rem; color: var(--text-muted);">Loading monthly log...</p>
        </div>
      </div>
    </div>
  `;

  // Start live clock
  const updateClock = () => {
    const el = document.getElementById('live-clock');
    const dateEl = document.getElementById('live-date');
    if (!el) return;
    const now = new Date();
    el.textContent = now.toLocaleTimeString();
    if (dateEl) dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  };
  updateClock();
  const clockInterval = setInterval(updateClock, 1000);

  // Initialize Google Maps Canvas
  const mapCanvas = document.getElementById('attendance-map-canvas');
  if (mapCanvas) {
    renderGeofenceMap(mapCanvas, null, null).catch(err => {
      console.warn('Map initialization:', err);
    });
  }

  // Check-In Handler
  document.getElementById('btn-punch-in').onclick = async () => {
    const geoText = document.getElementById('geo-status-text');
    geoText.textContent = 'Acquiring GPS location...';

    let location = null;
    try {
      location = await getBrowserLocation();
      geoText.textContent = `GPS acquired (accuracy: ${Math.round(location.accuracy)}m)`;
      // Update interactive map with user's live position
      if (mapCanvas) {
        renderGeofenceMap(mapCanvas, location.latitude, location.longitude).catch(() => {});
      }
    } catch (locErr) {
      showToast(locErr.message, 'warning');
      geoText.textContent = 'GPS failed: ' + locErr.message;
      return;
    }

    // In-app selfie capture modal
    let cameraModalRef = null;
    cameraModalRef = openCameraCaptureModal({
      onCapture: async (selfieBase64) => {
        closeModal();
        geoText.textContent = 'Submitting check-in to server...';

        try {
          const res = await apiRequest('attendance.checkIn', {
            latitude: location.latitude,
            longitude: location.longitude,
            accuracy: location.accuracy,
            selfie_base64: selfieBase64
          });

          showToast(`Check-in successful at ${res.checkInTime} (${res.statusFlag})`, 'success');
          geoText.textContent = `Checked In at ${res.checkInTime} (${res.distance}m from office)`;
          loadMonthlyLog();
        } catch (err) {
          showToast(err.message || 'Check-in failed', 'error');
          geoText.textContent = err.message;
        }
      },
      onCancel: () => {
        closeModal();
        geoText.textContent = 'Check-in cancelled.';
      }
    });

    openModal({
      title: 'Take Verification Selfie',
      contentNode: cameraModalRef.node,
      onClose: () => cameraModalRef.cleanup()
    });
  };

  // Check-Out Handler
  document.getElementById('btn-punch-out').onclick = async () => {
    const geoText = document.getElementById('geo-status-text');
    geoText.textContent = 'Checking out...';

    try {
      const res = await apiRequest('attendance.checkOut', {});
      showToast(`Checked out at ${res.checkOutTime}. Total hours: ${res.totalHours} hrs`, 'success');
      geoText.textContent = `Checked Out at ${res.checkOutTime} (${res.totalHours} hrs worked)`;
      loadMonthlyLog();
    } catch (err) {
      showToast(err.message || 'Check-out failed', 'error');
      geoText.textContent = err.message;
    }
  };

  // Regularization Modal
  document.getElementById('btn-open-regularize').onclick = () => {
    const content = document.createElement('div');
    content.innerHTML = `
      <form id="form-reg">
        <div class="form-group">
          <label class="form-label">Missed Date</label>
          <input type="date" id="reg-date" class="form-input" required value="${new Date().toISOString().substring(0, 10)}" />
        </div>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 0.75rem;">
          <div class="form-group">
            <label class="form-label">Requested In Time</label>
            <input type="time" id="reg-in" class="form-input" required value="09:30" />
          </div>
          <div class="form-group">
            <label class="form-label">Requested Out Time</label>
            <input type="time" id="reg-out" class="form-input" required value="18:30" />
          </div>
        </div>
        <div class="form-group">
          <label class="form-label">Reason for Regularization</label>
          <textarea id="reg-reason" class="form-input" rows="3" placeholder="Explain reason (e.g. client visit, biometric failure)" required></textarea>
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button type="button" class="btn btn-secondary" id="btn-reg-cancel">Cancel</button>
          <button type="submit" class="btn btn-primary">Submit Request</button>
        </div>
      </form>
    `;

    openModal({
      title: 'Attendance Regularization Request',
      contentNode: content
    });

    document.getElementById('btn-reg-cancel').onclick = () => closeModal();
    document.getElementById('form-reg').onsubmit = async (e) => {
      e.preventDefault();
      const payload = {
        date: document.getElementById('reg-date').value,
        requested_check_in: document.getElementById('reg-in').value + ':00',
        requested_check_out: document.getElementById('reg-out').value + ':00',
        reason: document.getElementById('reg-reason').value
      };

      try {
        await apiRequest('attendance.regularize', payload);
        closeModal();
        showToast('Regularization request submitted to your manager.', 'success');
      } catch (err) {
        showToast(err.message || 'Submission failed', 'error');
      }
    };
  };

  // Load Monthly Log History
  async function loadMonthlyLog() {
    const mount = document.getElementById('log-table-container');
    if (!mount) return;

    try {
      const logs = await apiRequest('attendance.getMyLog', { monthYear: currentMonth }, { isRead: true });
      if (!logs || logs.length === 0) {
        mount.innerHTML = `
          <div class="empty-state">
            <div class="empty-state-icon">${ICONS.clock}</div>
            <div class="empty-state-title">No Attendance Logs</div>
            <div class="empty-state-desc">You have no marked attendance records for this month yet.</div>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="overflow-x: auto;">
          <table style="width: 100%; border-collapse: collapse; font-size: 0.875rem;">
            <thead>
              <tr style="border-bottom: 2px solid var(--border-subtle); text-align: left; color: var(--text-muted);">
                <th style="padding: 0.75rem 0.5rem;">Date</th>
                <th style="padding: 0.75rem 0.5rem;">Check-In</th>
                <th style="padding: 0.75rem 0.5rem;">Check-Out</th>
                <th style="padding: 0.75rem 0.5rem;">Hours</th>
                <th style="padding: 0.75rem 0.5rem;">Distance</th>
                <th style="padding: 0.75rem 0.5rem;">Status</th>
              </tr>
            </thead>
            <tbody>
              ${logs.map(l => `
                <tr style="border-bottom: 1px solid var(--border-subtle);">
                  <td style="padding: 0.75rem 0.5rem; font-weight: 500;">${l.date}</td>
                  <td style="padding: 0.75rem 0.5rem; font-family: var(--font-mono);">${l.check_in_time || '-'}</td>
                  <td style="padding: 0.75rem 0.5rem; font-family: var(--font-mono);">${l.check_out_time || '-'}</td>
                  <td style="padding: 0.75rem 0.5rem;">${l.total_hours ? l.total_hours + ' hrs' : '-'}</td>
                  <td style="padding: 0.75rem 0.5rem;">${l.check_in_distance ? l.check_in_distance + 'm' : '-'}</td>
                  <td style="padding: 0.75rem 0.5rem;">
                    <span class="status-indicator">
                      <span class="status-dot ${l.status_flag === 'PRESENT' ? 'status-dot-success' : 'status-dot-warning'}"></span>
                      <span>${l.status_flag}</span>
                    </span>
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      `;
    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Failed to load attendance log: ${err.message}</p>`;
    }
  }

  document.getElementById('btn-refresh-log').onclick = () => loadMonthlyLog();
  loadMonthlyLog();
}
