// ─── TimeGuard Dashboard Script ──────────────────────────────────────────────

let allSites = [];
let editingHostname = null;
let editingDate = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

async function init() {
  document.getElementById('today-date').textContent = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  setupTabs();
  await loadData();
  await loadSettings();
  setupEventListeners();
}

// ─── Tabs ─────────────────────────────────────────────────────────────────────

function setupTabs() {
  document.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const tab = link.dataset.tab;
      document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      link.classList.add('active');
      document.getElementById(`tab-${tab}`).classList.add('active');
      if (tab === 'history') renderHistory();
    });
  });
}

// ─── Data Loading ─────────────────────────────────────────────────────────────

async function loadData() {
  const response = await chrome.runtime.sendMessage({ type: 'GET_ALL_SITES' });
  allSites = response.sites || [];
  renderOverview();
}

function renderOverview() {
  const today = todayKey();
  const todaySites = allSites.map(site => ({
    ...site,
    todayData: site.sessions[today] || null
  })).filter(s => s.todayData && s.todayData.accumulated > 0);

  // Stats
  const totalToday = todaySites.reduce((sum, s) => sum + (s.todayData.accumulated || 0), 0);
  const exceeded = todaySites.filter(s => s.timeLimit && s.todayData.accumulated >= s.timeLimit * 60).length;

  document.getElementById('stat-total-today').textContent = formatTime(totalToday);
  document.getElementById('stat-sites-count').textContent = todaySites.length;
  document.getElementById('stat-exceeded').textContent = exceeded;

  renderSitesList(todaySites, today);
}

function renderSitesList(sites, today) {
  const container = document.getElementById('sites-list');

  if (sites.length === 0) {
    container.innerHTML = '<div class="empty-state">No sites tracked today. Start browsing to see your data here.</div>';
    return;
  }

  const header = `
    <div class="site-table-header">
      <span>Site</span>
      <span>Time Spent</span>
      <span>Limit</span>
      <span>Progress</span>
      <span>Actions</span>
    </div>
  `;

  const rows = sites.sort((a, b) => (b.todayData.accumulated || 0) - (a.todayData.accumulated || 0)).map(site => {
    const accumulated = site.todayData?.accumulated || 0;
    const limitSecs = site.timeLimit ? site.timeLimit * 60 : null;
    const pct = limitSecs ? Math.min((accumulated / limitSecs) * 100, 100) : 0;
    const exceeded = limitSecs && accumulated >= limitSecs;

    const progressColor = pct >= 100 ? '#ef4444' : pct >= 80 ? '#f97316' : pct >= 50 ? '#eab308' : '#22c55e';
    const remark = site.todayData?.remark || '';
    const isBlocked = site.blocked ? '<span class="site-status-badge badge-blocked">BLOCKED</span>' : '';
    const badge = exceeded
      ? '<span class="site-status-badge badge-exceeded">EXCEEDED</span>'
      : limitSecs ? '<span class="site-status-badge badge-ok">OK</span>' : '';

    return `
      <div class="site-row" data-hostname="${escapeHtml(site.hostname)}">
        <div class="site-name">
          <span>${escapeHtml(site.hostname)} ${isBlocked} ${badge}</span>
          ${remark ? `<span class="site-remark">"${escapeHtml(remark)}"</span>` : ''}
        </div>
        <div class="site-time">${formatTime(accumulated)}</div>
        <div class="site-limit">${site.timeLimit ? site.timeLimit + ' min' : '–'}</div>
        <div>
          <div class="site-progress">
            <div class="site-progress-fill" style="width:${pct}%;background:${progressColor}"></div>
          </div>
        </div>
        <div class="site-actions">
          <button class="btn btn-ghost" onclick="openRemarkModal('${escapeHtml(site.hostname)}', '${today}', '${escapeAttr(remark)}')">✏️ Note</button>
          <button class="btn btn-ghost" onclick="resetSiteTimer('${escapeHtml(site.hostname)}')">🔄 Reset</button>
          ${site.blocked
            ? `<button class="btn btn-ghost" onclick="unblockSite('${escapeHtml(site.hostname)}')">🔓 Unblock</button>`
            : ''}
        </div>
      </div>
    `;
  }).join('');

  container.innerHTML = header + rows;
}

// ─── History ──────────────────────────────────────────────────────────────────

function renderHistory() {
  const container = document.getElementById('history-list');
  const byDate = {};

  allSites.forEach(site => {
    Object.entries(site.sessions).forEach(([date, session]) => {
      if (!byDate[date]) byDate[date] = [];
      if (session.accumulated > 0) {
        byDate[date].push({
          hostname: site.hostname,
          accumulated: session.accumulated,
          remark: session.remark || '',
          timeLimit: site.timeLimit
        });
      }
    });
  });

  const dates = Object.keys(byDate).sort().reverse();
  if (dates.length === 0) {
    container.innerHTML = '<div class="empty-state">No history yet. Start tracking sites from the extension popup.</div>';
    return;
  }

  const today = todayKey();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  const html = dates.map(date => {
    const label = date === today ? '📅 Today' : date === yesterday ? '📅 Yesterday'
      : '📅 ' + new Date(date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

    const rows = byDate[date]
      .sort((a, b) => b.accumulated - a.accumulated)
      .map(entry => `
        <div class="history-row">
          <div class="history-site">${escapeHtml(entry.hostname)}</div>
          <div class="history-meta">
            <span class="history-time">${formatTime(entry.accumulated)}</span>
            ${entry.timeLimit ? `<span>${entry.timeLimit}m limit</span>` : ''}
            ${entry.remark ? `<span class="history-remark">"${escapeHtml(entry.remark)}"</span>` : ''}
            <button class="btn btn-ghost" style="padding:3px 8px;font-size:11px" onclick="openRemarkModal('${escapeHtml(entry.hostname)}', '${date}', '${escapeAttr(entry.remark)}')">✏️</button>
          </div>
        </div>
      `).join('');

    return `<div class="history-group">
      <div class="history-date-label">${label}</div>
      ${rows}
    </div>`;
  }).join('');

  container.innerHTML = html;
}

// ─── Settings ─────────────────────────────────────────────────────────────────

async function loadSettings() {
  const settings = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
  document.getElementById('setting-reminder').value = settings.defaultReminderInterval || 10;
  document.getElementById('setting-auto-block').checked = !!settings.autoBlock;
  document.getElementById('setting-daily-reset').checked = settings.dailyReset !== false;
}

async function saveSettings() {
  const settings = {
    defaultReminderInterval: parseInt(document.getElementById('setting-reminder').value),
    autoBlock: document.getElementById('setting-auto-block').checked,
    dailyReset: document.getElementById('setting-daily-reset').checked
  };
  await chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings });
  const msg = document.getElementById('settings-saved');
  msg.style.display = 'block';
  setTimeout(() => msg.style.display = 'none', 2000);
}

// ─── Actions ──────────────────────────────────────────────────────────────────

async function resetSiteTimer(hostname) {
  if (!confirm(`Reset today's timer for ${hostname}?`)) return;
  await chrome.runtime.sendMessage({ type: 'RESET_TIMER', hostname });
  await loadData();
}

async function unblockSite(hostname) {
  await chrome.runtime.sendMessage({ type: 'UNBLOCK_SITE', hostname });
  await loadData();
}

function openRemarkModal(hostname, date, currentRemark) {
  editingHostname = hostname;
  editingDate = date;
  document.getElementById('modal-remark-title').textContent = 'Edit Note';
  document.getElementById('modal-remark-site').textContent = `${hostname} · ${formatDate(date)}`;
  document.getElementById('modal-remark-input').value = currentRemark || '';
  document.getElementById('modal-remark').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-remark').style.display = 'none';
  editingHostname = null;
  editingDate = null;
}

async function saveModalRemark() {
  if (!editingHostname) return;
  const remark = document.getElementById('modal-remark-input').value.trim();
  await chrome.runtime.sendMessage({ type: 'SAVE_REMARK', hostname: editingHostname, remark });
  closeModal();
  await loadData();
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

function setupEventListeners() {
  document.getElementById('btn-save-settings').addEventListener('click', saveSettings);
  document.getElementById('btn-clear-all').addEventListener('click', async () => {
    if (!confirm('Clear ALL tracking data? This cannot be undone.')) return;
    await chrome.storage.local.clear();
    allSites = [];
    renderOverview();
  });

  document.getElementById('btn-modal-cancel').addEventListener('click', closeModal);
  document.getElementById('btn-modal-save').addEventListener('click', saveModalRemark);
  document.getElementById('modal-remark').addEventListener('click', (e) => {
    if (e.target === document.getElementById('modal-remark')) closeModal();
  });

  document.getElementById('search-sites').addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    document.querySelectorAll('.site-row').forEach(row => {
      const name = row.dataset.hostname || '';
      row.style.display = name.includes(q) ? '' : 'none';
    });
  });
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function todayKey() { return new Date().toISOString().split('T')[0]; }

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function formatDate(dateStr) {
  const today = todayKey();
  const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
  if (dateStr === today) return 'Today';
  if (dateStr === yesterday) return 'Yesterday';
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/'/g, "\\'").replace(/\n/g, ' ');
}

// Make these accessible from inline HTML onclick
window.openRemarkModal = openRemarkModal;
window.resetSiteTimer = resetSiteTimer;
window.unblockSite = unblockSite;

document.addEventListener('DOMContentLoaded', init);
