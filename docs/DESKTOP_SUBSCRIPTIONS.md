# Bloom Search desktop setup

Verified locally on September 5, 2026.

Open `Bloom Search.app` from your Applications folder. Click **Assistant** in the browser toolbar
(the accessibility label is **Ask Bloom Search**) to open the task sidebar. Its
provider menu offers **Claude (subscription)** and **ChatGPT (Codex)**. Both use
existing native CLI subscription sign-ins; no API key was entered for this setup.
The user approved the native connectors' command execution and file access.

Type a task into the sidebar and press Send. Keep **Agent Mode ON** for browser
actions. Use **Attach tabs (@)** to provide an existing tab, **Stop** to cancel,
and **Chat history** to reopen a task. Provider selection and conversations are
stored in the app profile at `~/Library/Application Support/AI Browser/Profile`.
This is a separate browser profile; website sign-ins happen inside this app.

## Verified behavior

- Claude opened Hacker News in the app, read the front page, and returned the
  correct top three titles with article links. The page and visible sidebar
  actions were inspected against the answer.
- ChatGPT read the attached Hacker News tab, opened its top article in a new tab,
  and produced a two-sentence summary with the source link. The opened article
  was independently inspected and matched the summary.
- Both native providers were saved. The installed app was restarted, its
  matching server started from the installed bundle, and both conversations
  were still available through the sidebar's history.
- The installed bundle passed `codesign --verify --deep --strict`. Its launcher
  remains a development/ad-hoc signed launcher, not a notarized independent
  browser release.

Local verification records are in `.context/subscription-desktop-verification.json`.
The two tested conversation IDs are `7c829beb-cd29-4137-866f-28b0e5c4b544`
(Claude) and `0260a492-2b03-4734-806e-cc14b99f1411` (ChatGPT).

## Packaging

The working v3 package pairs the extension with server 0.0.155 built from the
same source. The launcher passes `--browseros-server-resources-dir` to use that
server while preserving the signed vendor browser. The earlier v2 package used
an older server without the provider/ACP endpoints and must not be used.

The first startup tab can appear as Chromium's normal new-tab page while the
extension loads. The toolbar's Assistant button still opens the sidebar, and
subsequent new tabs open the assistant home page.

Local subscription browser tasks work independently of the Research link.
The baked Render research URL is a separate service and was not deployed or
validated by these tests. These two tasks establish basic desktop integration;
they do not establish full Aside parity or completion of the original CLI's
three broader acceptance tasks.

## Bloom Search branding release

Version 0.1.1 renames the launcher, assistant, tabs, and app icons to Bloom Search.
It repackages the verified v3 runtime without changing browser or server behavior.
The existing `AI Browser/Profile` data path is retained so the rebrand does not
reset saved conversations, provider connections, or browser sessions. Native
BrowserOS internals and license notices remain those of the bundled upstream
runtime; the launcher remains ad-hoc signed, not Apple-notarized.

Version 0.1.2 replaces the flower with the approved teal compass for the Mac app
and assistant extension icons. The profile and provider connections are unchanged.
