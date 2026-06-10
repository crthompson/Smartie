# Testing the extension

There are two layers of testing:

1. **Unit tests** (`npm test`) - fast jsdom tests for the content-script logic
   (`clickQuickFilter`, `resetStandupHighlights`, `quickFilterAppearance`).
2. **End-to-end in a real browser** - load the built extension into Chromium and
   exercise it against a live Jira Cloud board.

## 1. Unit tests

```powershell
npm test
```

`pretest` compiles the relevant TS modules to CommonJS under `test/.build/`
(gitignored) and `test/clickQuickFilter.test.js` runs them against a jsdom DOM that
mimics Jira Cloud's react-select "Quick filters" control.

## 2. End-to-end with the real extension

First build the unpacked extension:

```powershell
npm run build   # outputs to ./extension
```

### Option A - manual (simplest)

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode** (top right).
3. Click **Load unpacked** and select the `extension` folder.
4. Open a Jira board, click the Smartie icon, and check **Enabled**.

### Option B - automated, Playwright-controlled Chromium

This is what was used during development to drive/inspect the extension on a live
board. It launches a **persistent** Chromium profile (so your Jira login and the
extension's enabled state survive restarts) with the unpacked extension loaded.

**Prerequisites**

- A Chromium build. The easiest source is Playwright's browser cache; any recent
  `chromium-*` build works. Find one with:

  ```powershell
  Get-ChildItem "$env:USERPROFILE\AppData\Local\ms-playwright\chromium-*\chrome-win64\chrome.exe"
  ```

- `playwright-core` (no browser download). Install it anywhere, e.g. a temp folder:

  ```powershell
  $dir = "$env:TEMP\smartie-ext-test"; New-Item -ItemType Directory -Path $dir -Force | Out-Null
  cd $dir; npm init -y | Out-Null; npm install playwright-core
  ```

**Launcher script** (`launch-ext.js`) - adjust `EXEC` to the chrome.exe path found above:

```js
const { chromium } = require('playwright-core');
const path = require('path');

const EXEC = 'C:\\Users\\<you>\\AppData\\Local\\ms-playwright\\chromium-1217\\chrome-win64\\chrome.exe';
const EXT = 'C:\\dev\\smartie\\extension';
const USER_DATA = path.join(process.env.TEMP, 'smartie-ext-test', 'profile');
const BOARD = 'https://<your-org>.atlassian.net/jira/software/c/projects/<KEY>/boards/<N>';

(async () => {
    const context = await chromium.launchPersistentContext(USER_DATA, {
        executablePath: EXEC,
        headless: false,        // extensions require a headed browser
        viewport: null,
        args: [
            `--disable-extensions-except=${EXT}`,
            `--load-extension=${EXT}`,
        ],
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(BOARD, { waitUntil: 'domcontentloaded' }).catch(() => {});
    console.log('Log into Jira if prompted, then enable Smartie via its popup.');
    await new Promise(() => {}); // keep the browser open
})();
```

**Run it** (point Node at the temp `node_modules` if the script lives elsewhere):

```powershell
$env:NODE_PATH = "$env:TEMP\smartie-ext-test\node_modules"
node launch-ext.js
```

**Notes / gotchas**

- The extension declares **no background service worker** (only content scripts and a
  popup), so there is no extension service worker to detect - that is expected.
- The Smartie panel stays **hidden until you check "Enabled"** in the popup
  (`enabled` defaults to false). On a fresh profile you must enable it once; the
  setting then persists in the profile.
- After rebuilding (`npm run build`), unpacked extensions do **not** auto-reload.
  Either click **Reload** on `chrome://extensions`, or stop and re-run the launcher
  (the persistent profile keeps your login and enabled state).
- Use `headless: false`; Chromium will not load extensions in headless mode.
- To inspect behavior programmatically, you can `await page.evaluate(...)` in the same
  script to read computed styles / DOM state from the board the extension is running on.
