// ─── TimeGuard Background Service Worker ───────────────────────────────────

// State: { hostname -> { startTime, tabId } }
// NOTE: We no longer store accumulated here — it's always in chrome.storage.local.
// activeSessions only stores the *start* of the current live segment.
// Every 30s a tick alarm flushes elapsed → storage so the SW can safely sleep.
let activeSessions = {};
const sessionVersions = {};

// On SW restart, recover any sessions that were "open" when SW went to sleep
(async function recoverSessions() {
  try {
    const r = await chrome.storage.local.get('__openSessions__');
    const open = r['__openSessions__'] || {};
    // open = { hostname: { tabId, startTime } }
    // We re-anchor startTime to now because real elapsed was already flushed by the last tick
    for (const [hostname, info] of Object.entries(open)) {
      activeSessions[hostname] = { startTime: Date.now(), tabId: info.tabId };
      scheduleReminder(hostname);
    }
  } catch (e) {}
})();

// ─── Helpers ────────────────────────────────────────────────────────────────

function getHostname(url) {
  try {
    if (!url || url.startsWith('chrome') || url.startsWith('about')) return null;
    return new URL(url).hostname;
  } catch { return null; }
}

function todayKey() {
  return new Date().toISOString().split('T')[0];
}

async function getSiteData(hostname) {
  const result = await chrome.storage.local.get(hostname);
  return result[hostname] || { sessions: {}, timeLimit: null, reminderInterval: null };
}

async function saveSiteData(hostname, data) {
  await chrome.storage.local.set({ [hostname]: data });
}

async function getSettings() {
  const r = await chrome.storage.local.get('__settings__');
  return r['__settings__'] || {
    defaultReminderInterval: 10,
    autoBlock: false,
    dailyReset: true
  };
}

// Get accumulated seconds for a site today
async function getTodayAccumulated(hostname) {
  const data = await getSiteData(hostname);
  const today = todayKey();
  const session = data.sessions[today] || {};
  return session.accumulated || 0;
}

// Add seconds to today's accumulated total
async function addAccumulated(hostname, seconds) {
  if (seconds <= 0) return;
  const data = await getSiteData(hostname);
  const today = todayKey();
  if (!data.sessions[today]) data.sessions[today] = { accumulated: 0 };
  data.sessions[today].accumulated = (data.sessions[today].accumulated || 0) + seconds;
  await saveSiteData(hostname, data);
  return data.sessions[today].accumulated;
}

function getSessionVersion(hostname) {
  return sessionVersions[hostname] || 0;
}

function bumpSessionVersion(hostname) {
  sessionVersions[hostname] = getSessionVersion(hostname) + 1;
  return sessionVersions[hostname];
}

// Prevent stale tick writes from re-applying elapsed time that existed before a reset.
async function addAccumulatedIfSessionUnchanged(hostname, seconds, expectedStartTime, expectedVersion) {
  if (seconds <= 0) return null;
  if (getSessionVersion(hostname) !== expectedVersion) return null;

  const live = activeSessions[hostname];
  if (!live || live.startTime !== expectedStartTime) return null;

  const data = await getSiteData(hostname);

  if (getSessionVersion(hostname) !== expectedVersion) return null;
  const liveAfterRead = activeSessions[hostname];
  if (!liveAfterRead || liveAfterRead.startTime !== expectedStartTime) return null;

  const today = todayKey();
  if (!data.sessions[today]) data.sessions[today] = { accumulated: 0 };
  data.sessions[today].accumulated = (data.sessions[today].accumulated || 0) + seconds;
  await saveSiteData(hostname, data);
  return data.sessions[today].accumulated;
}

// Used by stopTracking to avoid writing stale elapsed time after a reset.
async function addAccumulatedIfVersionUnchanged(hostname, seconds, expectedVersion) {
  if (seconds <= 0) return null;
  if (getSessionVersion(hostname) !== expectedVersion) return null;

  const data = await getSiteData(hostname);

  if (getSessionVersion(hostname) !== expectedVersion) return null;
  const today = todayKey();
  if (!data.sessions[today]) data.sessions[today] = { accumulated: 0 };
  data.sessions[today].accumulated = (data.sessions[today].accumulated || 0) + seconds;
  await saveSiteData(hostname, data);
  return data.sessions[today].accumulated;
}

// ─── Tab / Focus Tracking ────────────────────────────────────────────────────

async function startTracking(tabId, hostname) {
  if (!hostname) return;
  if (activeSessions[hostname]) {
    activeSessions[hostname].tabId = tabId;
    await persistOpenSessions();
    return;
  }
  activeSessions[hostname] = { startTime: Date.now(), tabId };
  scheduleReminder(hostname);
  await persistOpenSessions();
  updateBadge(hostname); // fire-and-forget
}

// Save which hostnames are actively tracked so SW restart can recover
async function persistOpenSessions() {
  const open = {};
  for (const [hostname, info] of Object.entries(activeSessions)) {
    open[hostname] = { tabId: info.tabId, startTime: info.startTime };
  }
  await chrome.storage.local.set({ '__openSessions__': open });
}

async function stopTracking(hostname) {
  if (!hostname || !activeSessions[hostname]) return;
  const session = activeSessions[hostname];
  const expectedVersion = getSessionVersion(hostname);
  const elapsed = Math.floor((Date.now() - session.startTime) / 1000);
  delete activeSessions[hostname];
  clearReminder(hostname);
  await persistOpenSessions(); // remove from persisted map

  const newTotal = await addAccumulatedIfVersionUnchanged(hostname, elapsed, expectedVersion);

  // Update badge to inactive
  try { chrome.action.setBadgeText({ text: '', tabId: session.tabId }); } catch(e) {}

  // Notify content script to hide/dim indicator
  try {
    chrome.tabs.sendMessage(session.tabId, { type: 'TG_STOP' }).catch(() => {});
  } catch(e) {}

  // Check if exceeded limit
  const data = await getSiteData(hostname);
  const totalForLimit = newTotal !== null ? newTotal : await getTodayAccumulated(hostname);
  if (data.timeLimit) {
    const limitSecs = data.timeLimit * 60;
    if (totalForLimit > limitSecs) {
      await chrome.storage.local.set({ [`__exceeded__${hostname}`]: true });
    }
  }

  return elapsed;
}

async function shouldContinueTracking(hostname, session) {
  try {
    const tab = await chrome.tabs.get(session.tabId);
    if (!tab || !tab.active) return false;
    if (getHostname(tab.url) !== hostname) return false;

    const win = await chrome.windows.get(tab.windowId);
    if (!win || !win.focused || win.state === 'minimized') return false;

    return true;
  } catch (e) {
    return false;
  }
}

function scheduleReminder(hostname) {
  chrome.storage.local.get([hostname, '__settings__'], async (result) => {
    const data = result[hostname] || {};
    const settings = result['__settings__'] || { defaultReminderInterval: 10 };
    const interval = data.reminderInterval || settings.defaultReminderInterval || 10;
    chrome.alarms.create(`reminder_${hostname}`, { periodInMinutes: interval });
  });
}

function clearReminder(hostname) {
  chrome.alarms.clear(`reminder_${hostname}`);
}

// ─── Event Listeners ─────────────────────────────────────────────────────────

chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await chrome.tabs.get(tabId);
    const hostname = getHostname(tab.url);

    // Stop tracking all active sessions that aren't this tab
    for (const [host, session] of Object.entries(activeSessions)) {
      if (session.tabId !== tabId) {
        await stopTracking(host);
      }
    }

    if (hostname) await startTracking(tabId, hostname);
  } catch (e) {}
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  const hostname = getHostname(tab.url);

  // If this tab was tracking a different hostname, stop it
  for (const [host, session] of Object.entries(activeSessions)) {
    if (session.tabId === tabId && host !== hostname) {
      await stopTracking(host);
    }
  }

  if (hostname) {
    // Check if this is the active tab
    try {
      const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (activeTab && activeTab.id === tabId) {
        await startTracking(tabId, hostname);
      }
    } catch (e) {}
  }
});

chrome.tabs.onRemoved.addListener(async (tabId) => {
  for (const [host, session] of Object.entries(activeSessions)) {
    if (session.tabId === tabId) {
      await stopTracking(host);
    }
  }
});

chrome.windows.onFocusChanged.addListener(async (windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Browser lost focus – pause all
    for (const hostname of Object.keys(activeSessions)) {
      await stopTracking(hostname);
    }
  } else {
    try {
      const [tab] = await chrome.tabs.query({ active: true, windowId });
      if (tab) {
        const hostname = getHostname(tab.url);
        if (hostname) await startTracking(tab.id, hostname);
      }
    } catch (e) {}
  }
});

chrome.windows.onBoundsChanged.addListener(async (window) => {
  if (!window || window.state !== 'minimized') return;

  for (const [hostname, session] of Object.entries(activeSessions)) {
    try {
      const tab = await chrome.tabs.get(session.tabId);
      if (tab && tab.windowId === window.id) {
        await stopTracking(hostname);
      }
    } catch (e) {
      await stopTracking(hostname);
    }
  }
});

// ─── Alarms (Tick, Reminders & Daily Reset) ───────────────────────────────────

// 30-second tick: flush live elapsed → storage + refresh badges + ping content scripts
chrome.alarms.create('__tick__', { periodInMinutes: 0.5 });

chrome.alarms.create('__daily_reset__', {
  when: getNextMidnight(),
  periodInMinutes: 1440
});

function getNextMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime();
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === '__tick__') {
    await handleTick();
    return;
  }

  if (alarm.name === '__daily_reset__') {
    await handleDailyReset();
    return;
  }

  if (alarm.name.startsWith('reminder_')) {
    const hostname = alarm.name.replace('reminder_', '');
    await handleReminder(hostname);
  }
});

// Flush elapsed seconds from live sessions into storage every 30s.
// This means the SW can safely sleep — max data loss is 30 seconds.
async function handleTick() {
  const now = Date.now();
  for (const [hostname, session] of Object.entries(activeSessions)) {
    if (!(await shouldContinueTracking(hostname, session))) {
      await stopTracking(hostname);
      continue;
    }

    const expectedStartTime = session.startTime;
    const expectedVersion = getSessionVersion(hostname);
    const elapsed = Math.floor((now - expectedStartTime) / 1000);
    if (elapsed > 0) {
      const updated = await addAccumulatedIfSessionUnchanged(
        hostname,
        elapsed,
        expectedStartTime,
        expectedVersion
      );

      // Re-anchor only when the flush was still valid for the same live session.
      if (updated !== null) {
        const live = activeSessions[hostname];
        if (live && live.startTime === expectedStartTime && getSessionVersion(hostname) === expectedVersion) {
          activeSessions[hostname].startTime = now;
          await persistOpenSessions();
        }
      }
    }
    // Update badge color and ping content script with current status
    await updateBadge(hostname);
    const total = await getTodayAccumulated(hostname);
    const data = await getSiteData(hostname);
    const pct = data.timeLimit ? total / (data.timeLimit * 60) : null;
    try {
      chrome.tabs.sendMessage(session.tabId, {
        type: 'TG_UPDATE',
        accumulated: total,
        timeLimit: data.timeLimit,
        pct
      }).catch(() => {});
    } catch(e) {}
  }
}

// Set the extension icon badge color based on time progress
async function updateBadge(hostname) {
  const session = activeSessions[hostname];
  if (!session) return;
  const accumulated = await getTodayAccumulated(hostname);
  const data = await getSiteData(hostname);

  const color = getProgressColor(accumulated, data.timeLimit);
  try {
    chrome.action.setBadgeText({ text: '●', tabId: session.tabId });
    chrome.action.setBadgeBackgroundColor({ color, tabId: session.tabId });
  } catch(e) {}
}

// Returns hex color based on how much of the limit has been used.
// After 100%, red slowly transitions toward dark brown.
function getProgressColor(seconds, timeLimitMinutes) {
  if (!timeLimitMinutes) return '#7dd3fc'; // no limit → blue

  const limitSecs = timeLimitMinutes * 60;
  const pct = seconds / limitSecs;

  if (pct < 0.4)  return '#22c55e'; // green
  if (pct < 0.65) return '#eab308'; // yellow
  if (pct < 0.85) return '#f97316'; // orange
  if (pct < 1.0)  return '#ef4444'; // red

  // Over limit: interpolate red → dark brown over the next 100% of overtime
  // pct=1.0 → red (#ef4444), pct=2.0+ → dark brown (#5a1010)
  const over = Math.min(pct - 1.0, 1.0); // 0..1
  const r = Math.round(0xef + (0x5a - 0xef) * over);
  const g = Math.round(0x44 + (0x10 - 0x44) * over);
  const b = Math.round(0x44 + (0x10 - 0x44) * over);
  return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
}

async function handleDailyReset() {
  const settings = await getSettings();
  if (!settings.dailyReset) return;

  // Flush active sessions
  for (const hostname of Object.keys(activeSessions)) {
    await stopTracking(hostname);
  }

  // Prompt remark for all sites with activity today
  const allData = await chrome.storage.local.get(null);
  const today = todayKey();

  for (const [key, value] of Object.entries(allData)) {
    if (key.startsWith('__')) continue;
    if (value.sessions && value.sessions[today] && value.sessions[today].accumulated > 0) {
      await chrome.storage.local.set({ [`__needsRemark__${key}`]: true });
    }
  }
}

async function handleReminder(hostname) {
  if (!activeSessions[hostname]) return;

  const accumulated = await getTodayAccumulated(hostname);
  const session = activeSessions[hostname];
  if (session) {
    const extra = Math.floor((Date.now() - session.startTime) / 1000);
    const total = accumulated + extra;
    const data = await getSiteData(hostname);
    const limitSecs = data.timeLimit ? data.timeLimit * 60 : null;

    let message = `You've spent ${formatTime(total)} on ${hostname} today.`;
    if (limitSecs) {
      if (total >= limitSecs) {
        message = `⚠️ Time limit exceeded on ${hostname}! You've been here ${formatTime(total)}.`;
      } else {
        const remaining = limitSecs - total;
        message = `${formatTime(total)} spent on ${hostname}. ${formatTime(remaining)} remaining.`;
      }
    }

    chrome.notifications.create(`reminder_${hostname}_${Date.now()}`, {
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: '⏱ TimeGuard Reminder',
      message,
      buttons: [{ title: 'Dismiss' }]
    });
  }
}

// ─── Icon Update (badge-based, replaces old icon swap) ────────────────────────
// updateBadge() is now the primary icon update — called from tick and startTracking.

// ─── Message Handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  handleMessage(msg, sender).then(sendResponse).catch(err => sendResponse({ error: err.message }));
  return true; // Keep channel open for async
});

async function handleMessage(msg, sender) {
  switch (msg.type) {
    case 'GET_SITE_STATUS': {
      const { hostname } = msg;
      const data = await getSiteData(hostname);
      const today = todayKey();
      const session = data.sessions[today] || {};
      let accumulated = session.accumulated || 0;

      // Add live time if currently tracking
      if (activeSessions[hostname]) {
        accumulated += Math.floor((Date.now() - activeSessions[hostname].startTime) / 1000);
      }

      // Get yesterday's session for "last visit" display
      const dates = Object.keys(data.sessions).sort().reverse();
      const lastDate = dates.find(d => d !== today);
      const lastSession = lastDate ? data.sessions[lastDate] : null;

      const exceeded = data.timeLimit ? accumulated >= data.timeLimit * 60 : false;
      const needsRemark = !!(await chrome.storage.local.get(`__needsRemark__${hostname}`))[`__needsRemark__${hostname}`];

      return {
        hostname,
        accumulated,
        timeLimit: data.timeLimit,
        reminderInterval: data.reminderInterval,
        remark: session.remark,
        lastSession: lastDate ? { date: lastDate, ...lastSession } : null,
        exceeded,
        isTracking: !!activeSessions[hostname],
        needsRemark
      };
    }

    case 'SET_TIME_LIMIT': {
      const { hostname, timeLimit, reminderInterval } = msg;
      const data = await getSiteData(hostname);
      data.timeLimit = timeLimit;
      if (reminderInterval) data.reminderInterval = reminderInterval;
      await saveSiteData(hostname, data);

      // Restart reminder with new interval
      if (activeSessions[hostname]) {
        clearReminder(hostname);
        scheduleReminder(hostname);
      }
      return { ok: true };
    }

    case 'SAVE_REMARK': {
      const { hostname, remark } = msg;
      const data = await getSiteData(hostname);
      const today = todayKey();
      if (!data.sessions[today]) data.sessions[today] = { accumulated: 0 };
      data.sessions[today].remark = remark;
      await saveSiteData(hostname, data);
      await chrome.storage.local.remove(`__needsRemark__${hostname}`);
      return { ok: true };
    }

    case 'RESET_TIMER': {
      const { hostname } = msg;
      bumpSessionVersion(hostname);
      const data = await getSiteData(hostname);
      const today = todayKey();
      data.sessions[today] = { accumulated: 0 };
      await saveSiteData(hostname, data);
      await chrome.storage.local.remove(`__exceeded__${hostname}`);
      if (activeSessions[hostname]) {
        activeSessions[hostname].startTime = Date.now();
      }
      return { ok: true };
    }

    case 'BLOCK_SITE': {
      const { hostname } = msg;
      const data = await getSiteData(hostname);
      data.blocked = true;
      await saveSiteData(hostname, data);
      return { ok: true };
    }

    case 'UNBLOCK_SITE': {
      const { hostname } = msg;
      const data = await getSiteData(hostname);
      data.blocked = false;
      await saveSiteData(hostname, data);
      return { ok: true };
    }

    case 'CHECK_BLOCKED': {
      const { hostname } = msg;
      const data = await getSiteData(hostname);
      return { blocked: !!data.blocked };
    }

    case 'GET_ALL_SITES': {
      const all = await chrome.storage.local.get(null);
      const sites = [];
      for (const [key, val] of Object.entries(all)) {
        if (key.startsWith('__')) continue;
        if (typeof val === 'object' && val.sessions) {
          sites.push({ hostname: key, ...val });
        }
      }
      return { sites };
    }

    case 'GET_SETTINGS': {
      return await getSettings();
    }

    case 'SAVE_SETTINGS': {
      await chrome.storage.local.set({ '__settings__': msg.settings });
      return { ok: true };
    }

    case 'GET_LIVE_TIME': {
      const { hostname } = msg;
      let accumulated = await getTodayAccumulated(hostname);
      if (activeSessions[hostname]) {
        accumulated += Math.floor((Date.now() - activeSessions[hostname].startTime) / 1000);
      }
      return { accumulated };
    }

    case 'CLEAR_SITE_DATA': {
      const { hostname } = msg;
      await chrome.storage.local.remove(hostname);
      return { ok: true };
    }

    default:
      return { error: 'Unknown message type' };
  }
}

// ─── Utility ─────────────────────────────────────────────────────────────────

function formatTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}
