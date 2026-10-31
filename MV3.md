# MV3 Checklist

- [x] cnn.com: Google account-selection prompt prevents hints until dismissed. This is Chrome's browser-managed FedCM dialog: normal hint-selection keys cannot reach the page until it closes, while extension commands remain browser-level.
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
- [x] `SelectorString` will not work for `BackgroundProgram` tweakables. There are no background `SelectorString` tweakables.
- [x] Many timers are used in `BackgroundProgram`, but only for very short periods, so they are unlikely to interrupt the hint process.

## Todo

- [x] Fix PROD behavior: production builds do not track page click listeners.
- [x] Chrome: clean up hints and page hooks after extension removal or disablement, including after service-worker restart.
- [x] Firefox 128+: clean up hints and page hooks after extension removal or disablement with a main-world content script.
- [x] Restore shortcuts and click-listener detection after extension reload; tested with an unpacked extension installed through the debugging protocol.
- [x] Ensure that we don't inject into existing tabs on service worker restart.
- [x] Inject content scripts into existing tabs in Chrome.
- [x] Decide how to handle builds since we can't currently build a single version in `compiled` that works with both chrome and firefox.
- [x] Enable chromium playwright tests.
- [x] Restore test to use run-pty
- [x] Update comments in injected.ts
- [x] Support Chrome 148+; `browser` is native at that baseline.
- [x] Remove the background polyfill entrypoint.
- [x] Use native MV3 `browser` APIs.
- [x] Remove API compatibility shims.
- [x] `runContentScriptsInExistingTabs` is not yet implemented for MV3.
- [x] Keep CSS insertion targeted to the top-level renderer frame. MV2 frame targeting is out of scope.
