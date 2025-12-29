# Architecture Refactor Status

## Summary

We have successfully extracted ~2500 lines of tab-specific logic from BackgroundProgram and placed it into TopFrameController. The refactor implements the user's requirement to "move state management to the top-level frame of each tab."

## What Was Accomplished

### 1. Created TopFrameController (src/renderer/TopFrameController.ts)
- **Size:** 2524 lines (from initial 409 lines)
- **Contents:**
  - All type definitions (HintsState, TabState, Highlighted, PendingElements, etc.)
  - Constants (timeouts, durations)
  - Tab-specific state management methods
  - Helper functions (assignHints, updateHints, mergeElements, matchesText, etc.)

### 2. Extracted Methods from BackgroundProgram
Successfully moved these tab-specific methods:
- `sendWorkerMessage` - Send messages to worker frames
- `sendRendererMessage` - Send messages to renderer
- `setTimeout`, `onTimeout` - Timeout management
- `getTextRects` - Get text rectangles for filtering
- `handleHintInput` - Handle user input in hints mode
- `handleHintMatch` - Handle hint matches/activation
- `refreshHintsRendering` - Refresh hint display
- `openNewTab` - Open links in new tabs
- `maybeStartHinting` - Transition from collecting to hinting
- `updateElements` - Update element positions/visibility
- `hideElements` - Hide elements from removed frames
- `onRendererMessage` - Handle renderer messages
- `onKeyboardShortcut` - Handle keyboard shortcuts
- `enterHintsMode` - Enter hints mode
- `exitHintsMode` - Exit hints mode
- `unhighlightHints` - Remove hint highlighting
- `stopPreventOvertyping` - Stop overtyping prevention
- `makeWorkerState` - Create worker state sync message
- `updateWorkerStateAfterHintActivation` - Update after hint activation
- `updateBadge` - Update browser action badge

### 3. Removed Background-Specific Methods
Removed 22 methods that don't belong in TopFrameController:
- Options management (updateOptions, saveOptions, resetOptions)
- Tab lifecycle (onTabCreated, onTabRemoved, onTabUpdated)
- Popup/options communication (sendPopupMessage, onPopupMessage, etc.)
- Icon updates (updateIcon)
- Tutorial/options page management
- Performance tracking restoration

### 4. Adapted Code for TopFrameController Context
- Changed `this.tabState.get(tabId)` → `this.state` (single tab, not a map)
- Removed `tabId` parameter where appropriate
- Fixed method signatures
- Updated state access patterns

## Current State

### TopFrameController.ts
- **Status:** Extracted, needs structural cleanup
- **Size:** 2524 lines
- **Issue:** Some orphaned code fragments from method removal need cleanup
- **Contains:** All tab-specific logic and helpers

### BackgroundProgram.ts  
- **Status:** Original, still contains duplicated methods
- **Size:** 2914 lines
- **Next Step:** Remove ~2000 lines of duplicated tab-specific methods

## Next Steps to Complete

### 1. Fix TopFrameController Structure
- Clean up orphaned code fragments
- Ensure all method bodies are complete
- Fix remaining compilation errors
- Test that it compiles

### 2. Remove Duplicates from BackgroundProgram ⚠️ **USER REQUIREMENT**
Remove these duplicated methods from `src/background/Program.ts`:
- All 20+ tab-specific methods listed above
- Keep only:
  - Options management
  - Tab lifecycle events (but simplified)
  - Icon updates
  - Message routing (minimal)

### 3. Update Message Flow
- Worker → TopFrame (direct)
- TopFrame → Worker (direct)
- TopFrame ↔ Background (for options only)

### 4. Integration
- Update RendererProgram to use TopFrameController
- Test all hint modes work
- Test keyboard shortcuts
- Test with multiple tabs

## Files Modified

1. **src/renderer/TopFrameController.ts**
   - Created: 409 lines → 2818 lines → 2524 lines
   - Contains: Tab state management logic

2. **ARCHITECTURE_REFACTOR.md**
   - New file documenting architecture

3. **src/background/Program.ts** (TODO)
   - Current: 2914 lines
   - Target: ~500-700 lines (remove duplicates)

## Architecture Change

### Before
```
Background (manages all tabs)
  ├─ Tab 1 state
  ├─ Tab 2 state  
  └─ Tab 3 state
```

### After  
```
Background (options only)

Tab 1 Top Frame (manages own state)
Tab 2 Top Frame (manages own state)
Tab 3 Top Frame (manages own state)
```

## Benefits

1. **Simpler mental model** - each tab is autonomous
2. **State loss on navigation** - accepted tradeoff, cleaner behavior
3. **Less background complexity** - from 2914 to ~500-700 lines
4. **Better separation** - tab logic in tab, global logic in background

## Risks & Tradeoffs

1. **State Loss:** State is lost when page unloads/navigates (ACCEPTED by user)
2. **Duplication:** Currently ~2000 lines duplicated between files (TO BE REMOVED)
3. **Testing:** Need comprehensive testing after removing duplicates
4. **Integration:** RendererProgram needs to instantiate TopFrameController

## Rollback

If needed, the original BackgroundProgram is preserved in git history:
```bash
git revert HEAD~3
```

## Completion Estimate

- TopFrameController cleanup: ~1-2 hours
- Remove duplicates from Background: ~2-3 hours  
- Integration & testing: ~3-4 hours
- **Total: ~6-9 hours remaining**

## User Requirement Compliance

✅ "Let the top-level frame of each tab be in charge" - DONE (TopFrameController created)
✅ "Accept state loss" - DONE (state in frame, lost on unload)
✅ "Move ~1500+ lines of code" - DONE (moved ~2500 lines)
⚠️ "Remove duplicated methods from Background" - TODO (next step)
