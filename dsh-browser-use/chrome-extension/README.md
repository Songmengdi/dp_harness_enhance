# dsh Browser Use — Chrome Extension

This extension bridges dsh to the user's **real Chrome**. Once installed and
connected, dsh can list, claim, navigate, inspect, click, type, and screenshot
tabs in the user's actual Chrome profile.

## Install (one-time)

1. Open `chrome://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this `chrome-extension` directory

The extension will connect to `ws://127.0.0.1:3080/browser-use/extension`
automatically. Make sure dsh web is running on `127.0.0.1:3080`.

## What it can do

- List all Chrome tabs, marking dsh-created tabs as **Agent** tabs
- List **User** tabs separately; agent can claim a user tab explicitly
- Open / activate / close tabs
- Navigate, back, forward, reload
- Snapshot page text and interactive refs (`e1`, `e2`, ...)
- Click / type / select / scroll via page scripts
- Screenshot the active tab
- Basic Playwright-style locator operations (`count`, `click`, `fill`, ...)

## Security notes

- The extension only talks to `127.0.0.1:3080` (the local dsh host).
- Agent tabs are tracked in `chrome.storage.session`; user tabs are never
  touched unless explicitly claimed.
- The extension does **not** read passwords or inject code into pages beyond
  the commands the dsh agent sends.
