import {
  array,
  boolean,
  chain,
  fieldsAuto,
  fieldsUnion,
  number,
  optional,
  string,
  stringUnion,
} from "tiny-decoders";

import { ElementWithHint, ExtendedElementReport } from "../shared/hints";
import { HintsMode, KeyboardModeBackground } from "../shared/keyboard";
import { Durations, Perf, Stats, TimeTracker } from "../shared/perf";

const SavedTimeTracker = chain(
  fieldsAuto({
    _durations: Durations,
    _current: optional(fieldsAuto({ label: string, timestamp: number })),
  }),
  (state) => Object.assign(new TimeTracker(), state)
);

export type PendingElements = ReturnType<typeof PendingElements>;
const PendingElements = fieldsAuto({
  pendingFrames: fieldsAuto({
    answering: number,
    collecting: number,
    lastStartWaitTimestamp: number,
  }),
  elements: array(ExtendedElementReport),
});

export type HighlightedItem = ReturnType<typeof HighlightedItem>;
const HighlightedItem = fieldsAuto({
  sinceTimestamp: number,
  element: ElementWithHint,
});

// Preserve matched hints across state transitions until their highlight expires.
export type Highlighted = ReturnType<typeof Highlighted>;
const Highlighted = array(HighlightedItem);

const activeHintsFields = {
  mode: HintsMode,
  startTime: number,
  time: SavedTimeTracker,
  stats: array(Stats),
  highlighted: Highlighted,
};

export type HintsState = ReturnType<typeof HintsState>;
const HintsState = fieldsUnion("type", {
  Idle: fieldsAuto({
    type: stringUnion({ Idle: null }),
    highlighted: Highlighted,
  }),
  Collecting: fieldsAuto({
    ...activeHintsFields,
    type: stringUnion({ Collecting: null }),
    pendingElements: PendingElements,
    refreshing: boolean,
  }),
  Hinting: fieldsAuto({
    ...activeHintsFields,
    type: stringUnion({ Hinting: null }),
    enteredChars: string,
    enteredText: string,
    elementsWithHints: array(ElementWithHint),
    updateState: fieldsAuto({
      type: stringUnion({ WaitingForResponse: null, WaitingForTimeout: null }),
      lastUpdateStartTimestamp: number,
    }),
    peeking: boolean,
  }),
});

export type TabState = ReturnType<typeof TabState>;
export const TabState = fieldsAuto({
  hintsState: HintsState,
  keyboardMode: KeyboardModeBackground,
  perf: Perf,
  isOptionsPage: boolean,
  isPinned: boolean,
  rendererFrameId: optional(number),
});
