// FOCUSON HRMS - Google Tasks, Drive & Keep Hub Module

import { apiRequest } from '../api.js';
import { getState } from '../store.js';
import { ICONS, showToast, openModal, closeModal, confirmDialog } from '../ui.js';
import {
  getWorkspaceUser,
  signInWithGoogle,
  listTasks,
  createTask,
  updateTask,
  deleteTask,
  listDriveFiles,
  createDriveFolder,
  deleteDriveFile
} from '../workspace.js';

export async function renderTasksPage(container) {
  const state = getState();
  const user = state.user || {};
  const wsUser = getWorkspaceUser();

  container.innerHTML = `
    <div style="display: flex; flex-direction: column; gap: 1.5rem; max-width: 1100px; margin: 0 auto;">
      <!-- Page Header -->
      <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem;">
        <div>
          <h2>Tasks & Workspace Operations</h2>
          <p style="font-size: 0.875rem; color: var(--text-muted);">Manage your personal HR to-dos in Google Tasks, organize Google Drive files, and access Google Keep.</p>
        </div>
        <div style="display: flex; gap: 0.75rem; flex-wrap: wrap;">
          <a href="https://keep.google.com/" target="_blank" rel="noopener noreferrer" class="btn btn-secondary">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path><path d="M9 21h6"></path></svg>
            Open Google Keep
          </a>
          <button id="btn-new-task" class="btn btn-primary">
            ${ICONS.plus} New Task
          </button>
        </div>
      </div>

      <!-- Google Workspace Status Banner -->
      <div class="astra-card" style="display: flex; justify-content: space-between; align-items: center; background-color: var(--bg-surface-muted);">
        <div style="display: flex; align-items: center; gap: 0.75rem;">
          <div style="width: 10px; height: 10px; border-radius: 50%; background: ${wsUser ? 'var(--status-success)' : 'var(--status-warning)'};"></div>
          <div>
            <div style="font-size: 0.875rem; font-weight: 600;">
              ${wsUser ? `Connected to Google Workspace (${wsUser.email})` : 'Google Workspace Not Connected'}
            </div>
            <div style="font-size: 0.75rem; color: var(--text-muted);">
              ${wsUser ? 'Live synchronization with Google Tasks API and Google Drive v3 API.' : 'Sign in with your Google Account to manage tasks and files directly.'}
            </div>
          </div>
        </div>
        ${!wsUser ? `
          <button id="btn-connect-tasks-ws" class="btn btn-secondary btn-sm">
            Connect Google Account
          </button>
        ` : ''}
      </div>

      <!-- Main Layout: 2 Columns (Google Tasks on left, Google Drive & Keep on right) -->
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(340px, 1fr)); gap: 1.5rem;">
        
        <!-- Column 1: Google Tasks -->
        <div class="astra-card" style="display: flex; flex-direction: column; gap: 1rem;">
          <div class="astra-card-header">
            <h3 class="astra-card-title">${ICONS.checkCircle} Google Tasks</h3>
            <button id="btn-refresh-tasks" class="btn btn-ghost btn-icon" title="Refresh Tasks">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
            </button>
          </div>

          <!-- Quick Templates Bar -->
          <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
            <button class="btn btn-ghost btn-sm btn-quick-task" data-title="Review Monthly Attendance Records" data-notes="Verify missing punches and regularization requests before payroll run.">
              + Attendance Review
            </button>
            <button class="btn btn-ghost btn-sm btn-quick-task" data-title="Submit Expense Receipts" data-notes="Upload travel and office bills for reimbursement approval.">
              + Submit Receipts
            </button>
            <button class="btn btn-ghost btn-sm btn-quick-task" data-title="PF / ESI Statutory Verification" data-notes="Review Challan generation with CA before 15th.">
              + PF/ESI Check
            </button>
          </div>

          <!-- Tasks List Container -->
          <div id="tasks-list-container" style="min-height: 240px;">
            <p style="text-align: center; padding: 2rem; color: var(--text-muted);">
              ${wsUser ? 'Loading your Google Tasks...' : 'Connect Google Workspace above to view your task items.'}
            </p>
          </div>
        </div>

        <!-- Column 2: Google Drive & HR Notes / Keep -->
        <div style="display: flex; flex-direction: column; gap: 1.5rem;">
          
          <!-- Drive Card -->
          <div class="astra-card">
            <div class="astra-card-header">
              <h3 class="astra-card-title">${ICONS.fileText} Google Drive Files & Folders</h3>
              <div style="display: flex; gap: 0.5rem;">
                <button id="btn-new-folder" class="btn btn-ghost btn-sm" title="Create New Folder in Drive">
                  + Folder
                </button>
                <button id="btn-refresh-drive-hub" class="btn btn-ghost btn-icon" title="Refresh Drive">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 4v6h-6"></path><path d="M1 20v-6h6"></path><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg>
                </button>
              </div>
            </div>

            <div id="drive-hub-container" style="min-height: 180px;">
              <p style="text-align: center; padding: 2rem; color: var(--text-muted);">
                ${wsUser ? 'Loading Drive files...' : 'Connect Google Workspace to view your Drive folders and files.'}
              </p>
            </div>
          </div>

          <!-- Google Keep & Quick HR Notes Card -->
          <div class="astra-card">
            <div class="astra-card-header">
              <h3 class="astra-card-title">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a2 2 0 0 1-2 2h-4a2 2 0 0 1-2-2v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"></path><path d="M9 21h6"></path></svg>
                Google Keep & Quick Memos
              </h3>
              <a href="https://keep.google.com/" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="color: var(--brand-primary);">
                Launch Keep &rarr;
              </a>
            </div>
            <p style="font-size: 0.8125rem; color: var(--text-muted); margin-bottom: 0.75rem;">
              Capture urgent HR reminders, interview questions, or handover notes. Notes saved here are stored in your workspace profile.
            </p>
            <textarea id="hr-memo-input" class="form-input" rows="3" placeholder="Type personal HR notes or checklist items here..."></textarea>
            <div style="display: flex; justify-content: flex-end; margin-top: 0.5rem;">
              <button id="btn-save-memo" class="btn btn-secondary btn-sm">Save Note</button>
            </div>
          </div>

        </div>

      </div>
    </div>
  `;

  // Attach Connect WS button
  const connectBtn = document.getElementById('btn-connect-tasks-ws');
  if (connectBtn) {
    connectBtn.onclick = async () => {
      try {
        await signInWithGoogle();
        showToast('Google Workspace connected!', 'success');
        renderTasksPage(container);
      } catch (err) {
        showToast(err.message || 'Connection failed', 'error');
      }
    };
  }

  // Memo load and save
  const memoInput = document.getElementById('hr-memo-input');
  const savedMemo = localStorage.getItem(`focuson_memo_${user.employeeId}`);
  if (savedMemo && memoInput) {
    memoInput.value = savedMemo;
  }
  document.getElementById('btn-save-memo').onclick = () => {
    localStorage.setItem(`focuson_memo_${user.employeeId}`, memoInput.value);
    showToast('HR memo saved locally.', 'success');
  };

  // Create Task Modal
  const openNewTaskModal = (initialTitle = '', initialNotes = '') => {
    if (!getWorkspaceUser()) {
      showToast('Please connect your Google Account first.', 'warning');
      return;
    }

    const content = document.createElement('div');
    content.innerHTML = `
      <form id="form-create-task">
        <div class="form-group">
          <label class="form-label">Task Title</label>
          <input type="text" id="task-title-input" class="form-input" required value="${initialTitle}" placeholder="e.g., Collect signed PF declaration" />
        </div>
        <div class="form-group">
          <label class="form-label">Notes / Details</label>
          <textarea id="task-notes-input" class="form-input" rows="3" placeholder="Optional notes...">${initialNotes}</textarea>
        </div>
        <div class="form-group">
          <label class="form-label">Due Date (Optional)</label>
          <input type="date" id="task-due-input" class="form-input" value="${new Date().toISOString().substring(0, 10)}" />
        </div>
        <div style="display: flex; justify-content: flex-end; gap: 0.75rem; margin-top: 1rem;">
          <button type="button" class="btn btn-secondary" id="btn-cancel-task">Cancel</button>
          <button type="submit" class="btn btn-primary">Create in Google Tasks</button>
        </div>
      </form>
    `;

    openModal({
      title: 'New Google Task',
      contentNode: content
    });

    document.getElementById('btn-cancel-task').onclick = () => closeModal();
    document.getElementById('form-create-task').onsubmit = async (e) => {
      e.preventDefault();
      const title = document.getElementById('task-title-input').value;
      const notes = document.getElementById('task-notes-input').value;
      const due = document.getElementById('task-due-input').value;
      closeModal();

      const taskData = {
        title: title,
        notes: notes
      };
      if (due) {
        taskData.due = new Date(due).toISOString();
      }

      try {
        await createTask('@default', taskData);
        showToast('Task added to Google Tasks!', 'success');
        loadTasks();
      } catch (err) {
        showToast(err.message || 'Task creation failed', 'error');
      }
    };
  };

  document.getElementById('btn-new-task').onclick = () => openNewTaskModal();

  document.querySelectorAll('.btn-quick-task').forEach(btn => {
    btn.onclick = () => {
      const t = btn.getAttribute('data-title');
      const n = btn.getAttribute('data-notes');
      openNewTaskModal(t, n);
    };
  });

  // Load Tasks
  async function loadTasks() {
    const mount = document.getElementById('tasks-list-container');
    if (!getWorkspaceUser()) return;

    try {
      mount.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Fetching your Google Tasks...</p>`;
      const res = await listTasks('@default');
      const tasks = res.items || [];

      if (tasks.length === 0) {
        mount.innerHTML = `
          <div class="empty-state" style="padding: 2rem 1rem;">
            <div class="empty-state-icon">${ICONS.checkCircle}</div>
            <div class="empty-state-title">No Pending Tasks</div>
            <div class="empty-state-desc">You have no tasks in Google Tasks. Click "+ New Task" above to add one.</div>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${tasks.map(t => {
            const isCompleted = t.status === 'completed';
            return `
              <div class="task-row" style="display: flex; align-items: flex-start; justify-content: space-between; gap: 0.75rem; padding: 0.75rem; border-radius: var(--radius-sm); background: var(--bg-surface-muted); border: 1px solid var(--border-subtle);">
                <div style="display: flex; align-items: flex-start; gap: 0.75rem; flex: 1;">
                  <input
                    type="checkbox"
                    class="task-toggle"
                    data-id="${t.id}"
                    data-status="${t.status}"
                    ${isCompleted ? 'checked' : ''}
                    style="margin-top: 3px; cursor: pointer;"
                  />
                  <div style="flex: 1;">
                    <div style="font-size: 0.875rem; font-weight: 500; text-decoration: ${isCompleted ? 'line-through' : 'none'}; color: ${isCompleted ? 'var(--text-muted)' : 'var(--text-main)'};">
                      ${t.title}
                    </div>
                    ${t.notes ? `<div style="font-size: 0.75rem; color: var(--text-muted); margin-top: 2px;">${t.notes}</div>` : ''}
                    ${t.due ? `<div style="font-size: 0.6875rem; color: var(--brand-primary); margin-top: 4px;">Due: ${new Date(t.due).toLocaleDateString()}</div>` : ''}
                  </div>
                </div>
                <button class="btn btn-ghost btn-sm btn-delete-task" data-id="${t.id}" data-title="${t.title}" style="color: var(--status-danger); padding: 2px 6px;">
                  &times;
                </button>
              </div>
            `;
          }).join('')}
        </div>
      `;

      // Attach task toggle handlers
      mount.querySelectorAll('.task-toggle').forEach(chk => {
        chk.onchange = async () => {
          const taskId = chk.getAttribute('data-id');
          const isDone = chk.checked;
          try {
            await updateTask('@default', taskId, {
              status: isDone ? 'completed' : 'needsAction'
            });
            showToast(isDone ? 'Task marked complete' : 'Task marked pending', 'info');
            loadTasks();
          } catch (err) {
            chk.checked = !isDone;
            showToast(err.message || 'Update failed', 'error');
          }
        };
      });

      // Attach delete task handlers with user confirmation
      mount.querySelectorAll('.btn-delete-task').forEach(btn => {
        btn.onclick = async () => {
          const taskId = btn.getAttribute('data-id');
          const title = btn.getAttribute('data-title');
          try {
            const deleted = await deleteTask('@default', taskId, title);
            if (deleted) {
              showToast('Task removed from Google Tasks.', 'info');
              loadTasks();
            }
          } catch (err) {
            showToast(err.message || 'Delete failed', 'error');
          }
        };
      });

    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Failed to load tasks: ${err.message}</p>`;
    }
  }

  // Load Drive Files
  async function loadDriveHub() {
    const mount = document.getElementById('drive-hub-container');
    if (!getWorkspaceUser()) return;

    try {
      mount.innerHTML = `<p style="text-align: center; padding: 2rem; color: var(--text-muted);">Fetching your Google Drive files...</p>`;
      const data = await listDriveFiles(8);
      const files = data.files || [];

      if (files.length === 0) {
        mount.innerHTML = `
          <div class="empty-state" style="padding: 1.5rem 1rem;">
            <div class="empty-state-icon">${ICONS.fileText}</div>
            <div class="empty-state-title">No Drive Files Found</div>
          </div>
        `;
        return;
      }

      mount.innerHTML = `
        <div style="display: flex; flex-direction: column; gap: 0.5rem;">
          ${files.map(f => `
            <div style="display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; padding: 0.5rem 0.75rem; border-radius: var(--radius-sm); background: var(--bg-surface-muted);">
              <div style="display: flex; align-items: center; gap: 0.5rem; overflow: hidden;">
                ${ICONS.fileText}
                <span style="font-size: 0.8125rem; font-weight: 500; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; max-width: 220px;" title="${f.name}">
                  ${f.name}
                </span>
              </div>
              <div style="display: flex; align-items: center; gap: 0.5rem;">
                <a href="${f.webViewLink}" target="_blank" rel="noopener noreferrer" class="btn btn-ghost btn-sm" style="font-size: 0.75rem; color: var(--brand-primary); padding: 2px 6px;">
                  Open
                </a>
                <button class="btn btn-ghost btn-sm btn-delete-file" data-id="${f.id}" data-name="${f.name}" style="color: var(--status-danger); padding: 2px 6px;" title="Delete File">
                  &times;
                </button>
              </div>
            </div>
          `).join('')}
        </div>
      `;

      // Attach file delete handlers with user confirmation
      mount.querySelectorAll('.btn-delete-file').forEach(btn => {
        btn.onclick = async () => {
          const fileId = btn.getAttribute('data-id');
          const fileName = btn.getAttribute('data-name');
          try {
            const deleted = await deleteDriveFile(fileId, fileName);
            if (deleted) {
              showToast('File deleted from Google Drive.', 'info');
              loadDriveHub();
            }
          } catch (err) {
            showToast(err.message || 'File deletion failed', 'error');
          }
        };
      });

    } catch (err) {
      mount.innerHTML = `<p style="color: var(--status-danger); padding: 1rem;">Could not load Drive files: ${err.message}</p>`;
    }
  }

  // Create Folder Button
  document.getElementById('btn-new-folder').onclick = async () => {
    if (!getWorkspaceUser()) {
      showToast('Please connect your Google Account first.', 'warning');
      return;
    }

    const folderName = prompt('Enter new Google Drive folder name:', 'FOCUSON_HR_Files');
    if (!folderName) return;

    try {
      const folder = await createDriveFolder(folderName);
      if (folder) {
        showToast(`Created folder "${folderName}" in Google Drive!`, 'success');
        loadDriveHub();
      }
    } catch (err) {
      showToast(err.message || 'Folder creation failed', 'error');
    }
  };

  document.getElementById('btn-refresh-tasks').onclick = () => loadTasks();
  document.getElementById('btn-refresh-drive-hub').onclick = () => loadDriveHub();

  if (wsUser) {
    loadTasks();
    loadDriveHub();
  }
}
