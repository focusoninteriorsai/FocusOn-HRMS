// FOCUSON HRMS - Google Workspace Client-Side Integration
// Client-side Firebase Auth with GoogleAuthProvider, in-memory token caching, and Workspace REST APIs.

import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, signOut } from 'firebase/auth';
import { showToast, openModal, closeModal, confirmDialog } from './ui.js';

let app = null;
let auth = null;
let provider = null;
let cachedAccessToken = null;
let currentUser = null;
let isSigningIn = false;

const WORKSPACE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/chat.messages',
  'https://www.googleapis.com/auth/chat.spaces.readonly',
  'https://www.googleapis.com/auth/drive.file',
  'https://www.googleapis.com/auth/tasks',
  'https://www.googleapis.com/auth/tasks.readonly'
];

export async function initWorkspaceAuth(onAuthChange) {
  try {
    const configRes = await fetch('./firebase-applet-config.json');
    if (!configRes.ok) return false;
    const firebaseConfig = await configRes.json();

    if (!firebaseConfig.apiKey) return false;

    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    provider = new GoogleAuthProvider();

    WORKSPACE_SCOPES.forEach(scope => provider.addScope(scope));

    onAuthStateChanged(auth, async (user) => {
      currentUser = user;
      if (!user) {
        cachedAccessToken = null;
      }
      if (onAuthChange) onAuthChange(user, cachedAccessToken);
    });

    return true;
  } catch (err) {
    console.warn('Workspace Firebase Auth init failed:', err);
    return false;
  }
}

export async function signInWithGoogle() {
  if (!auth || !provider) {
    throw new Error('Google Workspace authentication is not initialized.');
  }

  isSigningIn = true;
  try {
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential || !credential.accessToken) {
      throw new Error('Could not obtain Workspace access token from Google.');
    }
    cachedAccessToken = credential.accessToken;
    currentUser = result.user;
    return { user: currentUser, accessToken: cachedAccessToken };
  } finally {
    isSigningIn = false;
  }
}

export function getWorkspaceToken() {
  return cachedAccessToken;
}

export function getWorkspaceUser() {
  return currentUser;
}

export async function disconnectWorkspace() {
  if (auth) {
    await signOut(auth);
  }
  cachedAccessToken = null;
  currentUser = null;
}

// ============================================================================
// Google Workspace REST Clients (Direct Client-Side with in-memory Bearer Token)
// ============================================================================

async function fetchWithToken(url, options = {}) {
  const token = getWorkspaceToken();
  if (!token) {
    throw { code: 'WORKSPACE_AUTH_REQUIRED', message: 'Please sign in with Google Workspace to perform this action.' };
  }

  options.headers = options.headers || {};
  options.headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, options);
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google API Error ${res.status}: ${errText}`);
  }
  return res.json();
}

/**
 * Google Drive: Lists files in user Drive or folders.
 */
export async function listDriveFiles(pageSize = 15) {
  const query = encodeURIComponent("trashed = false");
  return fetchWithToken(`https://www.googleapis.com/drive/v3/files?pageSize=${pageSize}&fields=files(id,name,mimeType,modifiedTime,webViewLink)&q=${query}`);
}

/**
 * Google Sheets: Creates a new spreadsheet in user Drive with payroll data.
 */
export async function exportToGoogleSheet(title, rows) {
  const confirmed = await confirmDialog(
    'Create Google Spreadsheet',
    `Do you want to create a new spreadsheet "${title}" in your Google Drive with ${rows.length} rows?`,
    'Create Sheet'
  );
  if (!confirmed) return null;

  const createRes = await fetchWithToken('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      properties: { title: title }
    })
  });

  const spreadsheetId = createRes.spreadsheetId;
  const spreadsheetUrl = createRes.spreadsheetUrl;

  // Append data rows
  await fetchWithToken(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/Sheet1!A1:append?valueInputOption=USER_ENTERED`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      values: rows
    })
  });

  return { spreadsheetId, spreadsheetUrl };
}

/**
 * Google Calendar: Creates an HR event (interview, shift, holiday).
 */
export async function createCalendarEvent(eventData) {
  const confirmed = await confirmDialog(
    'Schedule Calendar Event',
    `Create "${eventData.summary}" on ${eventData.start.dateTime || eventData.start.date} in your Google Calendar?`,
    'Add Event'
  );
  if (!confirmed) return null;

  return fetchWithToken('https://www.googleapis.com/calendar/v3/calendars/primary/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(eventData)
  });
}

/**
 * Google Docs: Creates a formatted document from HR template.
 */
export async function createGoogleDoc(title, contentText) {
  const confirmed = await confirmDialog(
    'Generate Google Doc',
    `Create document "${title}" in your Google Drive?`,
    'Create Doc'
  );
  if (!confirmed) return null;

  const doc = await fetchWithToken('https://docs.googleapis.com/v1/documents', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: title })
  });

  const documentId = doc.documentId;

  // Insert text into body
  await fetchWithToken(`https://docs.googleapis.com/v1/documents/${documentId}:batchUpdate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      requests: [
        {
          insertText: {
            location: { index: 1 },
            text: contentText
          }
        }
      ]
    })
  });

  return { documentId, webViewLink: `https://docs.google.com/document/d/${documentId}/edit` };
}

/**
 * Google Chat: Lists user spaces.
 */
export async function listChatSpaces() {
  return fetchWithToken('https://chat.googleapis.com/v1/spaces');
}

/**
 * Google Chat: Posts team message/announcement.
 */
export async function sendChatMessage(spaceName, messageText) {
  const confirmed = await confirmDialog(
    'Post to Google Chat',
    `Post this message to Google Chat space "${spaceName}"?`,
    'Send Message'
  );
  if (!confirmed) return null;

  return fetchWithToken(`https://chat.googleapis.com/v1/${spaceName}/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: messageText
    })
  });
}

/**
 * Google Tasks: Lists user task lists.
 */
export async function listTaskLists() {
  return fetchWithToken('https://tasks.googleapis.com/tasks/v1/users/@me/lists');
}

/**
 * Google Tasks: Lists tasks in a specific task list (default: '@default').
 */
export async function listTasks(taskListId = '@default') {
  return fetchWithToken(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks?showCompleted=true&showHidden=true`);
}

/**
 * Google Tasks: Creates a new task.
 */
export async function createTask(taskListId = '@default', task) {
  const confirmed = await confirmDialog(
    'Create Google Task',
    `Create task "${task.title}" in your Google Tasks?`,
    'Create Task'
  );
  if (!confirmed) return null;

  return fetchWithToken(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(task)
  });
}

/**
 * Google Tasks: Updates task status or title.
 */
export async function updateTask(taskListId = '@default', taskId, updateData) {
  return fetchWithToken(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(updateData)
  });
}

/**
 * Google Tasks: Deletes a task with mandatory confirmation.
 */
export async function deleteTask(taskListId = '@default', taskId, taskTitle = 'this task') {
  const confirmed = await confirmDialog(
    'Delete Google Task',
    `Are you sure you want to delete task "${taskTitle}"? This cannot be undone.`,
    'Delete Task',
    true
  );
  if (!confirmed) return false;

  await fetchWithToken(`https://tasks.googleapis.com/tasks/v1/lists/${taskListId}/tasks/${taskId}`, {
    method: 'DELETE'
  });
  return true;
}

/**
 * Google Drive: Creates a new folder in Google Drive.
 */
export async function createDriveFolder(folderName) {
  const confirmed = await confirmDialog(
    'Create Google Drive Folder',
    `Create folder "${folderName}" in your Google Drive?`,
    'Create Folder'
  );
  if (!confirmed) return null;

  return fetchWithToken('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder'
    })
  });
}

/**
 * Google Drive: Deletes a file with mandatory confirmation.
 */
export async function deleteDriveFile(fileId, fileName = 'this file') {
  const confirmed = await confirmDialog(
    'Delete Drive File',
    `Are you sure you want to delete "${fileName}" from Google Drive? This cannot be undone.`,
    'Delete File',
    true
  );
  if (!confirmed) return false;

  await fetchWithToken(`https://www.googleapis.com/drive/v3/files/${fileId}`, {
    method: 'DELETE'
  });
  return true;
}

