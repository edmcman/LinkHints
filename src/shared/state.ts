import type { ElementWithHint, ExtendedElementReport } from "./hints";
import type { KeyboardModeBackground } from "./keyboard";
import type { HintsMode } from "./keyboard";
import type { Perf, Stats, TimeTracker } from "./perf";

// All HintsState types store the highlighted hints (highlighted due to being
// matched, not due to filtering by text), so that they can stay highlighted for
// `t.MATCH_HIGHLIGHT_DURATION` ms.
export type Highlighted = Array<HighlightedItem>;

export type HighlightedItem = {
  sinceTimestamp: number;
  element: ElementWithHint;
};

export type PendingElements = {
  pendingFrames: {
    answering: number;
    collecting: number;
    lastStartWaitTimestamp: number;
  };
  elements: Array<ExtendedElementReport>;
};

export type UpdateState =
  | {
      type: "WaitingForResponse";
      lastUpdateStartTimestamp: number;
    }
  | {
      type: "WaitingForTimeout";
      lastUpdateStartTimestamp: number;
    };

export type HintsState =
  | {
      type: "Collecting";
      mode: HintsMode;
      pendingElements: PendingElements;
      startTime: number;
      time: TimeTracker;
      stats: Array<Stats>;
      refreshing: boolean;
      highlighted: Highlighted;
    }
  | {
      type: "Hinting";
      mode: HintsMode;
      startTime: number;
      time: TimeTracker;
      stats: Array<Stats>;
      enteredChars: string;
      enteredText: string;
      elementsWithHints: Array<ElementWithHint>;
      highlighted: Highlighted;
      updateState: UpdateState;
      peeking: boolean;
    }
  | {
      type: "Idle";
      highlighted: Highlighted;
    };

export type TabState = {
  hintsState: HintsState;
  keyboardMode: KeyboardModeBackground;
  perf: Perf;
  isOptionsPage: boolean;
  isPinned: boolean;
};
