# MV3 Checklist

- [ ] cnn.com: Google account-selection prompt prevents hints until dismissed. CNN requests FedCM; a local FedCM chooser also captures physical keys, but it is not yet confirmed to match the user's prompt. A Chrome extension command receives its shortcut while the local chooser is open, but normal hint-selection keys do not reach the page.
- [x] service worker restart test
- [x] Serialize storage
- [x] Browser actions
- [x] Remove DOM usage from background
- [x] Replace timers with alarms: not going to
- [x] Update the manifest
- [x] Inject into pre-existing tabs. tabs.executeScript? Do we need this with MV3?
- [x] Add listeners synchronously at top level in service worker
- [x] Fix website distortion problems (e.g., missing menu in edmcman.github.io). See Hidden test.

## Minor

- [x] Expose `BackgroundProgram` as `globalThis.program` for debugging.
- [ ] `SelectorString` will not work for `BackgroundProgram` tweakables. Currently there are none.
- [ ] Many timers are used in `BackgroundProgram`, but for very short periods. It seems unlikely these will cause issues with the hint process.

## Todo

- [ ] Fix PROD behavior
- [ ] Detect/handle extension removal (previously onDisconnect code).
- [x] Restore shortcuts and click-listener detection after extension reload; tested with an unpacked extension installed through the debugging protocol.
- [x] Ensure that we don't inject into existing tabs on service worker restart.
- [x] Inject content scripts into existing tabs in Chrome.
- [x] Decide how to handle builds since we can't currently build a single version in `compiled` that works with both chrome and firefox.
- [x] Enable chromium playwright tests.
- [ ] Restore test to use run-pty
- [x] Update comments in injected.ts
- [ ] Decide minimum Chrome version before removing the polyfill (`browser` is native starting in Chrome 148; older supported versions need it).
- [ ] Remove src/background/entry.ts after removing polyfill
- [ ] Switch to chrome apis
- [ ] Remove api compatibility shims
- [x] `runContentScriptsInExistingTabs` is not yet implemented for MV3.
- [ ] Figure out browser_style
- [ ] insertCSSInTab frame for mv2?
