// ─── TimeGuard Popup Script ──────────────────────────────────────────────────

let currentHostname = null;
let siteStatus = null;
let liveInterval = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !tab.url) { showError('No active tab'); return; }

  try {
    const url = new URL(tab.url);
    if (url.protocol === 'chrome:' || url.protocol === 'about:') {
      showError('Cannot track this page');
      return;
    }
    currentHostname = url.hostname;
  } catch {
    showError('Cannot track this page');
    return;
  }

  document.getElementById('hostname-badge').textContent = `🌐 ${currentHostname}`;

  siteStatus = await sendMessage({ type: 'GET_SITE_STATUS', hostname: currentHostname });
  render();
  startLiveUpdate();
}

// ─── Render ───────────────────────────────────────────────────────────────────

function render() {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';

  hideAll();

  // Previous visit banner
  if (siteStatus.lastSession) {
    const { date, accumulated, remark } = siteStatus.lastSession;
    const el = document.getElementById('prev-visit-banner');
    el.style.display = 'block';
    let html = `<strong>${formatDate(date)}:</strong> ${formatTime(accumulated)} spent`;
    if (remark) html += `<br><em>"${escapeHtml(remark)}"</em>`;
    document.getElementById('prev-visit-info').innerHTML = html;
  }

  // Remark needed from yesterday
  if (siteStatus.needsRemark) {
    document.getElementById('remark-needed-banner').style.display = 'block';
  }

  // Decide section
  if (siteStatus.timeLimit) {
    showTimerSection();
  } else {
    showNoLimitSection();
  }
}

function hideAll() {
  ['section-no-limit', 'section-set-limit-form', 'section-timer',
   'prev-visit-banner', 'remark-needed-banner'].forEach(id => {
    document.getElementById(id).style.display = 'none';
  });
}

function showNoLimitSection() {
  const sec = document.getElementById('section-no-limit');
  sec.style.display = 'block';
  const display = document.getElementById('today-time-display');
  if (siteStatus.accumulated > 0) {
    display.textContent = `Today: ${formatTime(siteStatus.accumulated)}`;
  } else {
    display.style.display = 'none';
  }
}

function showTimerSection() {
  const sec = document.getElementById('section-timer');
  sec.style.display = 'block';

  document.getElementById('time-limit-label').textContent =
    `of ${siteStatus.timeLimit} min limit`;
  document.getElementById('progress-limit-label').textContent =
    `${siteStatus.timeLimit}m`;

  if (siteStatus.remark) {
    document.getElementById('remark-input').value = siteStatus.remark;
  }

  updateTimerDisplay(siteStatus.accumulated);
}

function updateTimerDisplay(seconds) {
  const timeEl = document.getElementById('time-spent-display');
  timeEl.textContent = formatTimeClock(seconds);

  if (!siteStatus.timeLimit) return;

  const limitSecs = siteStatus.timeLimit * 60;
  const pct = Math.min((seconds / limitSecs) * 100, 100);
  const bar = document.getElementById('progress-bar');
  bar.style.width = pct + '%';

  // Color phases
  bar.classList.remove('yellow', 'orange', 'red', 'over');
  if (seconds >= limitSecs) {
    bar.classList.add('over');
    document.getElementById('progress-warning').style.display = 'block';
    document.getElementById('exceeded-warning').style.display = 'block';
  } else if (pct >= 80) {
    bar.classList.add('red');
  } else if (pct >= 60) {
    bar.classList.add('orange');
  } else if (pct >= 40) {
    bar.classList.add('yellow');
  }
}

// ─── Live Timer (local increment for smooth display, re-sync every 10s) ────────

let liveBase = 0;      // accumulated seconds from last sync
let liveSyncAt = 0;    // Date.now() when liveBase was set

function startLiveUpdate() {
  if (liveInterval) clearInterval(liveInterval);

  // Set initial base from the status we already fetched
  liveBase = siteStatus.accumulated || 0;
  liveSyncAt = Date.now();

  let syncCounter = 0;

  liveInterval = setInterval(async () => {
    if (!siteStatus || !siteStatus.timeLimit) return;

    syncCounter++;
    // Re-sync with background every 10 seconds to stay accurate
    if (syncCounter % 10 === 0) {
      const { accumulated } = await sendMessage({ type: 'GET_LIVE_TIME', hostname: currentHostname });
      liveBase = accumulated;
      liveSyncAt = Date.now();
    }

    // Compute current total locally — no async wait, perfectly smooth
    const localElapsed = Math.floor((Date.now() - liveSyncAt) / 1000);
    const total = liveBase + localElapsed;
    updateTimerDisplay(total);
  }, 1000); // ← every second for smooth clock
}

// ─── Event Handlers ───────────────────────────────────────────────────────────

// Dashboard
document.getElementById('btn-dashboard').addEventListener('click', openDashboard);
document.getElementById('btn-open-dashboard').addEventListener('click', openDashboard);

function openDashboard() {
  chrome.tabs.create({ url: chrome.runtime.getURL('dashboard.html') });
  window.close();
}

// No limit section
document.getElementById('btn-set-limit').addEventListener('click', () => {
  document.getElementById('section-no-limit').style.display = 'none';
  document.getElementById('section-set-limit-form').style.display = 'block';
});

document.getElementById('btn-no-limit').addEventListener('click', () => {
  // Just show passive time
  document.getElementById('btn-no-limit').disabled = true;
  document.getElementById('btn-set-limit').disabled = true;
});

// Set limit form
document.getElementById('btn-cancel-limit').addEventListener('click', () => {
  document.getElementById('section-set-limit-form').style.display = 'none';
  document.getElementById('section-no-limit').style.display = 'block';
});

document.getElementById('btn-save-limit').addEventListener('click', async () => {
  const timeLimit = parseInt(document.getElementById('input-time-limit').value);
  const reminderInterval = parseInt(document.getElementById('input-reminder').value);
  if (!timeLimit || timeLimit < 1) {
    alert('Please enter a valid time limit.');
    return;
  }
  await sendMessage({ type: 'SET_TIME_LIMIT', hostname: currentHostname, timeLimit, reminderInterval });
  siteStatus = await sendMessage({ type: 'GET_SITE_STATUS', hostname: currentHostname });
  render();
});

// Change limit
document.getElementById('btn-change-limit').addEventListener('click', () => {
  document.getElementById('section-timer').style.display = 'none';
  document.getElementById('section-set-limit-form').style.display = 'block';
  document.getElementById('input-time-limit').value = siteStatus.timeLimit || '';
});

// Reset timer
document.getElementById('btn-reset-timer').addEventListener('click', async () => {
  if (confirm('Reset today\'s timer for this site?')) {
    await sendMessage({ type: 'RESET_TIMER', hostname: currentHostname });
    siteStatus = await sendMessage({ type: 'GET_SITE_STATUS', hostname: currentHostname });
    liveBase = 0;
    liveSyncAt = Date.now();
    document.getElementById('exceeded-warning').style.display = 'none';
    document.getElementById('progress-warning').style.display = 'none';
    render();
  }
});

// Save remark (in timer section)
document.getElementById('btn-save-remark-now').addEventListener('click', async () => {
  const remark = document.getElementById('remark-input').value.trim();
  await sendMessage({ type: 'SAVE_REMARK', hostname: currentHostname, remark });
  const btn = document.getElementById('btn-save-remark-now');
  btn.textContent = '✓ Saved';
  setTimeout(() => btn.textContent = 'Save Note', 1500);
});

// Block site
document.getElementById('btn-block-site').addEventListener('click', async () => {
  await sendMessage({ type: 'BLOCK_SITE', hostname: currentHostname });
  chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
    if (tabs[0]) chrome.tabs.reload(tabs[0].id);
  });
  window.close();
});

// Continue anyway
document.getElementById('btn-continue').addEventListener('click', () => {
  document.getElementById('exceeded-warning').style.display = 'none';
});

// Remark needed
document.getElementById('btn-save-remark-needed').addEventListener('click', async () => {
  const remark = document.getElementById('remark-needed-input').value.trim();
  await sendMessage({ type: 'SAVE_REMARK', hostname: currentHostname, remark });
  document.getElementById('remark-needed-banner').style.display = 'none';
});

document.getElementById('btn-skip-remark').addEventListener('click', async () => {
  await sendMessage({ type: 'SAVE_REMARK', hostname: currentHostname, remark: '' });
  document.getElementById('remark-needed-banner').style.display = 'none';
});

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatTimeClock(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${m}:${String(s).padStart(2,'0')}`;
}

function formatDate(dateStr) {
  const today = new Date().toISOString().split('T')[0];
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function escapeHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function showError(msg) {
  document.getElementById('loading').style.display = 'none';
  document.getElementById('main-content').style.display = 'block';
  document.getElementById('main-content').innerHTML = `<div class="center" style="color:#64748b;">${msg}</div>`;
}

async function sendMessage(msg) {
  return chrome.runtime.sendMessage(msg);
}

// ─── Start ────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', init);
window.addEventListener('unload', () => { if (liveInterval) clearInterval(liveInterval); });
