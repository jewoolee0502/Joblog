const API_URL = 'http://localhost:4000';

// DOM elements
const idleEl = document.getElementById('idle');
const loadingEl = document.getElementById('loading');
const successEl = document.getElementById('success');
const errorEl = document.getElementById('error');
const btnSave = document.getElementById('btn-save');
const btnApply = document.getElementById('btn-apply');
const btnRetry = document.getElementById('btn-retry');

function showState(state) {
  idleEl.classList.toggle('hidden', state !== 'idle');
  loadingEl.classList.toggle('hidden', state !== 'loading');
  successEl.classList.toggle('hidden', state !== 'success');
  errorEl.classList.toggle('hidden', state !== 'error');
}

function showSuccess(status, companyName, roleTitle) {
  document.getElementById('success-status').textContent =
    status === 'SAVED' ? 'Saved!' : 'Marked as Applied!';
  document.getElementById('success-company').textContent = companyName;
  document.getElementById('success-role').textContent = roleTitle;
  showState('success');
}

function showError(message) {
  document.getElementById('error-message').textContent = message;
  showState('error');
}

async function getAuthToken() {
  return new Promise((resolve) => {
    chrome.storage.local.get('joblog_token', (data) => {
      resolve(data.joblog_token || null);
    });
  });
}

async function handleClick(status) {
  showState('loading');

  try {
    // Check for auth token
    const token = await getAuthToken();
    if (!token) {
      showError('Not signed in. Open Joblog in your browser and sign in first.');
      return;
    }

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab?.id || !tab.url) {
      showError('Cannot access the current tab.');
      return;
    }

    // Inject a script to extract page text
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.body.innerText.substring(0, 10000),
    });

    const pageText = result?.result;
    if (!pageText || pageText.length < 50) {
      showError('Not enough text on this page. Are you on a job posting?');
      return;
    }

    // Send to backend
    const response = await fetch(`${API_URL}/api/applications/from-extension`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({
        pageText,
        pageUrl: tab.url,
        status,
      }),
    });

    if (!response.ok) {
      if (response.status === 401) {
        // Token expired — clear it
        chrome.storage.local.remove('joblog_token');
        showError('Session expired. Open Joblog in your browser and sign in again.');
        return;
      }
      const body = await response.json().catch(() => null);
      const message = body?.error?.message || body?.error || 'Failed to save application';
      showError(message);
      return;
    }

    const data = await response.json();
    showSuccess(status, data.companyName, data.roleTitle);
  } catch (err) {
    console.error('Joblog extension error:', err);
    showError('Could not connect to Joblog server. Is it running?');
  }
}

// Listen for token updates from the web app
chrome.runtime.onMessageExternal.addListener((message) => {
  if (message?.type === 'JOBLOG_AUTH_TOKEN' && message.token) {
    chrome.storage.local.set({ joblog_token: message.token });
  }
  if (message?.type === 'JOBLOG_SIGN_OUT') {
    chrome.storage.local.remove('joblog_token');
  }
});

btnSave.addEventListener('click', () => handleClick('SAVED'));
btnApply.addEventListener('click', () => handleClick('APPLIED'));
btnRetry.addEventListener('click', () => showState('idle'));
