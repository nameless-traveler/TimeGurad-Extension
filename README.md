# ![TimeGuard logo](icons/icon128.png) TimeGuard

A Chrome/Brave extension that helps you stay aware of how long you spend on each website.

## Installation (Developer Mode)

1. Unzip this project into a permanent folder.
2. Open `chrome://extensions` in Chrome or Brave.
3. Turn on **Developer mode** (top-right).
4. Click **Load unpacked**.
5. Select this project folder (`TimeGuard-Extension`).
6. Pin TimeGuard to your toolbar for quick access.

## What TimeGuard Does

- Tracks how long you spend on each site.
- Lets you set a time limit per website.
- Sends reminders at your chosen interval.
- Shows a color progress bar as you approach your limit.
- Lets you block a site after limit is reached.
- Saves session notes so you can review habits later.
- Includes a dashboard for overview, history, and settings.

## Progress Colors

- Green: on track
- Yellow: around halfway
- Orange: close to limit
- Red: almost at limit
- Pulsing red: limit exceeded

## Dashboard

- **Overview:** Sites tracked today with progress bars.
- **History:** Records grouped by day.
- **Settings:** Reminder defaults, auto-block, daily reset, and data clear.

## Privacy

- All data stays on your device (`chrome.storage.local`).
- No analytics, no server sync, no external data collection.

## Project Structure

```text
TimeGuard-Extension/
|- manifest.json
|- background.js
|- content.js
|- popup.html / popup.css / popup.js
|- dashboard.html / dashboard.css / dashboard.js
`- icons/
```

## Notes

- Timers reset at midnight.
- History remains available for review.
