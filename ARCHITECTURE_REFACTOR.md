# Architecture Refactor: Top Frame State Management

## Overview

This refactor moves tab state management from the background script to the top-level frame of each tab.

## Current Architecture (Before)

```
┌─────────────┐
│  Background │ ← Manages state for ALL tabs
│   Program   │ ← Routes all messages
└──────┬──────┘
       │
       ├──────────────────┬──────────────────┐
       ↓                  ↓                  ↓
┌─────────────┐    ┌─────────────┐    ┌─────────────┐
│   Worker    │    │   Worker    │    │  Renderer   │
│  (Frame 1)  │    │  (Frame 2)  │    │ (Top Frame) │
└─────────────┘    └─────────────┘    └─────────────┘
```

**Problems:**
- Background stores `tabState = new Map<number, TabState>()`
- State persists across page navigations (can be confusing)
- Complex message routing through background

## New Architecture (After)

```
┌─────────────┐
│  Background │ ← Options management only
│   Program   │ ← Minimal routing
└──────┬──────┘
       │
       ↓ (options sync)
┌─────────────────────────────────────┐
│         Top Frame Controller         │
│    ┌───────────────────────────┐    │
│    │  State for THIS tab only  │    │
│    │  - hintsState             │    │
│    │  - keyboardMode           │    │
│    │  - perf                   │    │
│    └───────────────────────────┘    │
│                                      │
│  Manages workers in this tab:       │
└──────┬───────────────────────────┬──┘
       │                           │
       ↓                           ↓
┌─────────────┐            ┌─────────────┐
│   Worker    │            │   Worker    │
│  (Frame 1)  │            │  (Frame 2)  │
└─────────────┘            └─────────────┘
```

**Benefits:**
- Simpler mental model - each tab manages itself
- State automatically cleared when page unloads
- Reduces background script complexity
- Better separation of concerns

## Migration Strategy

### Phase 1: Infrastructure ✅
- Create `TopFrameController.ts` class
- Define state types (TabState, HintsState, etc.)
- Add to RendererProgram

### Phase 2: Core Methods (IN PROGRESS)
Move tab-specific methods from `BackgroundProgram` to `TopFrameController`:

**State Management:**
- `enterHintsMode()`
- `exitHintsMode()`
- `maybeStartHinting()`
- `updateElements()`
- `hideElements()`

**Hint Input/Interaction:**
- `handleHintInput()`
- `handleHintMatch()`
- `refreshHintsRendering()`
- `getTextRects()`

**Keyboard:**
- `onKeyboardShortcut()`
- `updateWorkerStateAfterHintActivation()`
- `stopPreventOvertyping()`

**UI Updates:**
- `updateBadge()`
- `unhighlightHints()`

**Messaging:**
- `sendWorkerMessage()`
- `sendRendererMessage()`

**Helper Functions:**
- `assignHints()`
- `combineByHref()`
- `updateHints()`
- `mergeElements()`
- `matchesText()`
- `getBadgeText()`
- `getElementTypes()`
- `getCombiningUrl()`

### Phase 3: Message Routing
Update message flow:
1. Worker sends message → Runtime message → Top Frame receives
2. Top Frame processes and updates state
3. Top Frame sends commands to workers/renderer as needed
4. Background only handles options and tab lifecycle

### Phase 4: Background Simplification
Reduce `BackgroundProgram` to:
- Options management (`updateOptions`, `saveOptions`, `resetOptions`)
- Options syncing to all tabs
- Popup/options page communication
- Tab lifecycle events (creation/removal)
- Icon updates

Remove:
- `tabState` map (each top frame has its own state)
- All tab-specific state management
- Direct worker message handling

### Phase 5: Testing
- Test all hints modes work
- Test keyboard shortcuts
- Test options sync
- Test with multiple tabs
- Test state loss on page navigation (expected behavior)

## Key Files

- **`src/renderer/TopFrameController.ts`** - New state manager for each tab
- **`src/renderer/Program.ts`** - Integrates TopFrameController
- **`src/background/Program.ts`** - Simplified to options + routing
- **`src/worker/Program.ts`** - Send messages to top frame
- **`src/shared/messages.ts`** - Message type definitions

## State Loss Behavior

### Before (Background manages state)
- User navigates away → State persists in background
- User clicks back → Hints might still be shown (stale)

### After (Top Frame manages state)
- User navigates away → State lost (page unloaded)
- User clicks back → Clean slate, no stale hints
- **This is the intended behavior** - accepting state loss for architectural simplicity

## Implementation Checklist

- [x] Create TopFrameController class
- [x] Define state types
- [x] Add basic methods (enterHintsMode, exitHintsMode, makeWorkerState)
- [ ] Copy all ~20 tab-specific methods to TopFrameController
- [ ] Copy all helper functions to TopFrameController
- [ ] Remove duplicated methods from BackgroundProgram
- [ ] Update message routing
- [ ] Integrate TopFrameController with RendererProgram
- [ ] Test basic functionality
- [ ] Update options syncing
- [ ] Update badge/icon logic
- [ ] Test all hints modes
- [ ] Test keyboard shortcuts
- [ ] Document new architecture

## Breaking Changes

- State is lost on page navigation/reload (accepted)
- Background no longer stores per-tab state
- Message flow changes (workers → top frame → workers)

## Rollback Plan

If issues arise:
1. Git revert to before refactor
2. Keep BackgroundProgram as-is
3. Remove TopFrameController
4. Restore original message flow

## References

- Original issue: User request to move state management to top frame
- Conversation analysis: User explicitly accepts state loss
- Priority: "Get the build working first, then expand TopFrameController"
