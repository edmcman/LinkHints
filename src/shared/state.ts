import {
  array,
  boolean,
  fieldsAuto,
  fieldsUnion,
  number,
  string,
} from "tiny-decoders";

import type { ElementWithHint, ExtendedElementReport } from "./hints";
import { ElementWithHintDecoder, ExtendedElementReportDecoder } from "./hints";
import type { KeyboardModeBackground } from "./keyboard";
import { HintsMode } from "./keyboard";
import { KeyboardModeBackgroundDecoder } from "./keyboard";
import type { Perf, Stats, TimeTracker, TimeTrackerJSON } from "./perf";
import {
  Perf as PerfDecoder,
  Stats as StatsDecoder,
  TimeTrackerDecoder,
} from "./perf";

export type TabState = {
  hintsState: HintsState;
  keyboardMode: KeyboardModeBackground;
  perf: Perf;
  isOptionsPage: boolean;
  isPinned: boolean;
};

export type SerializedTabState = {
  hintsState:
    | {
        type: "Collecting";
        mode: HintsMode;
        pendingElements: PendingElements;
        startTime: number;
        time: TimeTrackerJSON;
        stats: Array<Stats>;
        refreshing: boolean;
        highlighted: Highlighted;
      }
    | {
        type: "Hinting";
        mode: HintsMode;
        startTime: number;
        time: TimeTrackerJSON;
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
  keyboardMode: KeyboardModeBackground;
  perf: Perf;
  isOptionsPage: boolean;
  isPinned: boolean;
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

// TODO: Define HintsMode, KeyboardModeBackground, TimeTracker, ElementWithHint, ExtendedElementReport, Stats

// Decoders

export const HighlightedItemDecoder = fieldsAuto({
  sinceTimestamp: number,
  element: ElementWithHintDecoder,
});

export const HighlightedDecoder = array(HighlightedItemDecoder);

export const PendingElementsDecoder = fieldsAuto({
  pendingFrames: fieldsAuto({
    answering: number,
    collecting: number,
    lastStartWaitTimestamp: number,
  }),
  elements: array(ExtendedElementReportDecoder),
});

export const UpdateStateDecoder = fieldsUnion("type", {
  WaitingForResponse: fieldsAuto({
    lastUpdateStartTimestamp: number,
  }),
  WaitingForTimeout: fieldsAuto({
    lastUpdateStartTimestamp: number,
  }),
});

export const HintsStateDecoder = fieldsUnion("type", {
  Collecting: fieldsAuto({
    mode: HintsMode,
    pendingElements: PendingElementsDecoder,
    startTime: number,
    time: TimeTrackerDecoder,
    stats: array(StatsDecoder),
    refreshing: boolean,
    highlighted: HighlightedDecoder,
  }),
  Hinting: fieldsAuto({
    mode: HintsMode,
    startTime: number,
    time: TimeTrackerDecoder,
    stats: array(StatsDecoder),
    enteredChars: string,
    enteredText: string,
    elementsWithHints: array(ElementWithHintDecoder),
    highlighted: HighlightedDecoder,
    updateState: UpdateStateDecoder,
    peeking: boolean,
  }),
  Idle: fieldsAuto({
    highlighted: HighlightedDecoder,
  }),
});

export const SerializedTabStateDecoder = fieldsAuto({
  hintsState: fieldsUnion("type", {
    Collecting: fieldsAuto({
      mode: HintsMode,
      pendingElements: PendingElementsDecoder,
      startTime: number,
      time: TimeTrackerDecoder,
      stats: array(StatsDecoder),
      refreshing: boolean,
      highlighted: HighlightedDecoder,
    }),
    Hinting: fieldsAuto({
      mode: HintsMode,
      startTime: number,
      time: TimeTrackerDecoder,
      stats: array(StatsDecoder),
      enteredChars: string,
      enteredText: string,
      elementsWithHints: array(ElementWithHintDecoder),
      highlighted: HighlightedDecoder,
      updateState: UpdateStateDecoder,
      peeking: boolean,
    }),
    Idle: fieldsAuto({
      highlighted: HighlightedDecoder,
    }),
  }),
  keyboardMode: KeyboardModeBackgroundDecoder,
  perf: PerfDecoder,
  isOptionsPage: boolean,
  isPinned: boolean,
});
