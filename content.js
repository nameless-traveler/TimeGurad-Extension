// ─── TimeGuard Content Script ─────────────────────────────────────────────────

(async function () {
  if (location.protocol === 'chrome-extension:') return;

  const hostname = location.hostname;
  if (!hostname) return;

  // ── 1. Block check ────────────────────────────────────────────────────────
  try {
    const response = await chrome.runtime.sendMessage({ type: 'CHECK_BLOCKED', hostname });
    if (response && response.blocked) {
      showBlockOverlay();
      return; // don't inject indicator on blocked page
    }
  } catch (e) {}

  // ── 2. Progress indicator bar ─────────────────────────────────────────────
  // A thin (4px) fixed bar at the very top of the page.
  // Fills left-to-right as the time limit is consumed.
  // Color transitions: green → yellow → orange → red → slowly brown.
  // Hidden when no limit is set for this site.

  const bar = document.createElement('div');
  bar.id = 'tg-indicator';
  bar.style.cssText = [
    'position:fixed',
    'top:0',
    'left:0',
    'height:4px',
    'width:0%',
    'z-index:2147483646',
    'transition:width 3s linear, background-color 4s ease',
    'pointer-events:none',
    'background:#22c55e',
    'display:none',  // hidden until we get first update
  ].join(';');

  // Wait for DOM to be ready
  if (document.documentElement) {
    document.documentElement.appendChild(bar);
  } else {
    document.addEventListener('DOMContentLoaded', () => document.documentElement.appendChild(bar));
  }

  // Returns hex color for a 0..2+ progress ratio (same logic as background.js)
  function progressColor(pct) {
    if (pct < 0.4)  return '#22c55e';
    if (pct < 0.65) return '#eab308';
    if (pct < 0.85) return '#f97316';
    if (pct < 1.0)  return '#ef4444';
    const over = Math.min(pct - 1.0, 1.0);
    const r = Math.round(0xef + (0x5a - 0xef) * over);
    const g = Math.round(0x44 + (0x10 - 0x44) * over);
    const b = Math.round(0x44 + (0x10 - 0x44) * over);
    return `#${r.toString(16).padStart(2,'0')}${g.toString(16).padStart(2,'0')}${b.toString(16).padStart(2,'0')}`;
  }

  function applyUpdate(accumulated, timeLimit, pct) {
    if (!timeLimit || pct === null) {
      bar.style.display = 'none';
      return;
    }
    bar.style.display = 'block';
    const fillPct = Math.min(pct * 100, 100); // clamp visual fill at 100%
    bar.style.width = fillPct + '%';
    bar.style.backgroundColor = progressColor(pct);
  }

  // Listen for updates pushed from the background tick (every 30s)
  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'TG_UPDATE') {
      applyUpdate(msg.accumulated, msg.timeLimit, msg.pct);
    }
    if (msg.type === 'TG_STOP') {
      bar.style.display = 'none';
    }
  });

  // Also fetch initial state on load so the bar appears without waiting for first tick
  try {
    const status = await chrome.runtime.sendMessage({ type: 'GET_SITE_STATUS', hostname });
    if (status && status.timeLimit) {
      const pct = status.accumulated / (status.timeLimit * 60);
      applyUpdate(status.accumulated, status.timeLimit, pct);
    }
  } catch(e) {}

  // ── 3. Block overlay ────────────────────────────────────────────────────────

  function showBlockOverlay() {
    // Prevent page load
    document.documentElement.style.overflow = 'hidden';

    const overlay = document.createElement('div');
    overlay.id = 'timeguard-block-overlay';
    overlay.innerHTML = `
      <style>
        #timeguard-block-overlay {
          position: fixed;
          inset: 0;
          background: #0d1117;
          z-index: 2147483647;
          display: flex;
          align-items: center;
          justify-content: center;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        #timeguard-block-overlay .tg-box {
          text-align: center;
          max-width: 400px;
          padding: 40px;
          background: #161b22;
          border: 1px solid #30363d;
          border-radius: 16px;
        }
        #timeguard-block-overlay .tg-icon { font-size: 56px; margin-bottom: 16px; }
        #timeguard-block-overlay h1 { font-size: 22px; font-weight: 700; color: #e6edf3; margin-bottom: 8px; }
        #timeguard-block-overlay p { color: #8b949e; font-size: 14px; margin-bottom: 24px; line-height: 1.6; }
        #timeguard-block-overlay .tg-host { color: #7dd3fc; font-weight: 600; }
        #timeguard-block-overlay .tg-btn {
          padding: 10px 24px;
          border: none;
          border-radius: 8px;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          margin: 4px;
          font-family: inherit;
        }
        #timeguard-block-overlay .tg-btn-danger { background: #ef4444; color: #fff; }
        #timeguard-block-overlay .tg-btn-danger:hover { background: #dc2626; }
        #timeguard-block-overlay .tg-btn-secondary { background: #21262d; color: #e6edf3; border: 1px solid #30363d; }
        #timeguard-block-overlay .tg-btn-secondary:hover { border-color: #64748b; }
        #timeguard-block-overlay .tg-timer {
          font-size: 28px;
          font-weight: 800;
          color: #ef4444;
          margin-bottom: 16px;
        }
      </style>
      <div class="tg-box">
        <div class="tg-icon">🚫</div>
        <h1>Site Blocked</h1>
        <p>You blocked <span class="tg-host">${escapeHtml(hostname)}</span> because you exceeded your time limit.<br>Take a break — your future self will thank you.</p>
        <div>
          <button class="tg-btn tg-btn-secondary" id="tg-go-back">← Go Back</button>
          <button class="tg-btn tg-btn-danger" id="tg-unblock">Unblock Anyway</button>
        </div>
      </div>
    `;

    document.documentElement.appendChild(overlay);

    document.getElementById('tg-go-back').addEventListener('click', () => {
      history.back();
    });

    document.getElementById('tg-unblock').addEventListener('click', async () => {
      try {
        await chrome.runtime.sendMessage({ type: 'UNBLOCK_SITE', hostname });
        overlay.remove();
        document.documentElement.style.overflow = '';
      } catch (e) {}
    });
  }

  function escapeHtml(str) {
    return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }
})();
