# MV3 Checklist

- [x] Serialize storage
- [x] Browser actions
- [x] Remove DOM usage from background
- [x] Replace timers with alarms: not going to
- [x] Update the manifest
- [x] Inject into pre-existing tabs. tabs.executeScript? Do we need this with MV3?
- [ ] Add listeners synchronously at top level in service worker

## Minor

- [ ] `window.program` not set to `BackgroundProgram` in MV3.
- [ ] `SelectorString` will not work for `BackgroundProgram` tweakables. Currently there are none.
- [ ] Many timers are used in `BackgroundProgram`, but for very short periods. It seems unlikely these will cause issues with the hint process.

## Todo

- [ ] Fix PROD behavior
- [ ] Detect/handle extension removal (previously onDisconnect code)
- [ ] Ensure that we don't inject into existing tabs on service worker restart
- [ ] Injecting into existing tabs does not seem to be working on chrome
- [ ] Decide how to handle builds since we can't currently build a single version in `compiled` that works with both chrome and firefox.
- [x] Enable chromium playwright tests.
- [ ] Restore test to use run-pty
- [ ] Update comments in injected.ts
- [ ] Remove polyfill
- [ ] Remove src/background/entry.ts after removing polyfill
- [ ] Switch to chrome apis
- [ ] Remove api compatibility shims
- [x] `runContentScriptsInExistingTabs` is not yet implemented for MV3.
- [ ] Figure out browser_style
- [ ] insertCSSInTab frame for mv2?
