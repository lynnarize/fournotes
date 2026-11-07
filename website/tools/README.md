# Re-shooting the app screens

The screens on the site are the real web app, filled with demo data in a throwaway browser
profile. Never shoot from a real container: the Mac snapshots show real notes in the sidebar.

1. Start the web app on port 3125 (`web-ink-paper` in `.claude/launch.json`).
2. In a scratch folder: `npm i playwright-core sharp`, and copy these three files there.
3. `node capture2.mjs <shots>` writes the sheets to `<shots>/s/`. `IPHONE_ONLY=1` shoots just the
   full-screen phone shots, taken with an iPhone's safe areas so the tab bar clears the corners.
4. `node crops.mjs <shots>/s <Website>/assets/app` crops and encodes them. A third argument limits
   it by name, such as `^phone-`.
