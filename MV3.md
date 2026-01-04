# MV3 Checklist

- [x] Serialize storage
- [x] Browser actions
- [x] Remove DOM usage from background
- [x] Replace timers with alarms: not going to
- [ ] Update the manifest
- [ ] Inject into pre-existing tabs. tabs.executeScript? Do we need this with MV3?
- [ ] How are hints injected?

## Minor

- [ ] `window.program` not set to `BackgroundProgram` in MV3.
- [ ] `SelectorString` will not work for `BackgroundProgram` tweakables. Currently there are none.
- [ ] Many timers are used in `BackgroundProgram`, but for very short periods. It seems unlikely these will cause issues with the hint process.
