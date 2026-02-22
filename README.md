# ⏱ TimeGuard – Site Time Tracker

A Chrome/Brave browser extension to help you track, limit, and reflect on your browsing habits.

---

## 🚀 Installation (Developer Mode)

1. **Unzip** this folder somewhere permanent on your computer
2. Open Chrome/Brave and navigate to `chrome://extensions`
3. Toggle **Developer mode** ON (top-right corner)
4. Click **"Load unpacked"**
5. Select the unzipped `extension/` folder
6. The TimeGuard icon will appear in your toolbar — pin it for easy access!

---

## 🎯 Features

### When You Visit a Site
- Click the extension icon to see your time on that site
- Choose to set a **time limit** (in minutes)
- Pick a **reminder interval** (every 5, 10, 20, or 30 min)
- See your **previous visit data** (time spent + your remark)

### Progress Bar
- 🟢 **Green** → On track
- 🟡 **Yellow** → Halfway there
- 🟠 **Orange** → Getting close
- 🔴 **Red** → Nearly at limit
- ⚠️ **Pulsing Red** → Limit exceeded!

### When Limit is Exceeded
- Warning banner appears in the popup
- Option to **Block the Site** (shows a block screen on reload)
- Option to **Continue Anyway**

### Reminders
- Desktop notifications at your chosen interval
- Shows time spent + remaining time in the notification

### Remarks / Notes
- Leave a note for any session (e.g. "Spent too long on Reddit")
- Notes appear next time you visit the site
- Edit notes anytime from the Dashboard

### Dashboard (`📊` button)
- **Overview Tab**: All sites tracked today, with progress bars
- **History Tab**: Grouped by day — Today, Yesterday, This Week
- **Settings Tab**: Default reminder interval, auto-block toggle, daily reset

### Daily Reset
- Timers reset automatically at midnight
- Full history is preserved — daily totals are never lost

---

## 🔒 Privacy

- All data is stored **locally** in your browser using `chrome.storage.local`
- No data is sent to any server
- You can clear all data from Settings → "Clear All"

---

## 📁 File Structure

```
extension/
├── manifest.json       # Extension config (Manifest V3)
├── background.js       # Service worker: time tracking, reminders, alarms
├── content.js          # Injected script: site blocking overlay
├── popup.html/css/js   # Extension popup UI
├── dashboard.html/css/js # Full dashboard page
└── icons/              # Extension icons
```
