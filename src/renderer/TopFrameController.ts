import type {
  ElementRender,
  ElementReport,
  ElementTypes,
  ElementWithHint,
  ExtendedElementReport,
  HintMeasurements,
  HintUpdate,
} from "../shared/hints";
import type {
  HintsMode,
  KeyboardAction,
  KeyboardMapping,
  KeyboardModeBackground,
  NormalizedKeypress,
} from "../shared/keyboard";
import {
  log,
  makeRandomToken,
  Resets,
} from "../shared/main";
import type {
  FromRenderer,
  FromWorker,
  ToRenderer,
  ToWorker,
} from "../shared/messages";
import type { OptionsData } from "../shared/options";
import type {
  Perf,
  Stats,
  TimeTracker,
} from "../shared/perf";
import type RendererProgram from "./Program";

// State types moved from BackgroundProgram
type TabState = {
  hintsState: HintsState;
  keyboardMode: KeyboardModeBackground;
  perf: Perf;
  isOptionsPage: boolean;
  isPinned: boolean;
};

type HintsState =
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

type Highlighted = Array<HighlightedItem>;

type HighlightedItem = {
  sinceTimestamp: number;
  element: ElementWithHint;
};

type PendingElements = {
  pendingFrames: {
    answering: number;
    collecting: number;
    lastStartWaitTimestamp: number;
  };
  elements: Array<ExtendedElementReport>;
};

type UpdateState =
  | {
      type: "WaitingForResponse";
      lastUpdateStartTimestamp: number;
    }
  | {
      type: "WaitingForTimeout";
      lastUpdateStartTimestamp: number;
    };

const TOP_FRAME_ID = 0;

/**
 * TopFrameController manages state for a single tab.
 * It receives messages from worker frames and orchestrates hint mode.
 */
export default class TopFrameController {
  state: TabState;
  
  options: OptionsData | undefined = undefined;
  
  oneTimeWindowMessageToken: string = makeRandomToken();
  
  resets = new Resets();
  
  renderer: RendererProgram;

  constructor(renderer: RendererProgram) {
    this.renderer = renderer;
    
    this.state = {
      hintsState: {
        type: "Idle",
        highlighted: [],
      },
      keyboardMode: { type: "FromHintsState" },
      perf: [],
      isOptionsPage: false,
      isPinned: false,
    };
  }

  start(): void {
    log("log", "TopFrameController#start");
    // TODO: Set up message listeners
  }

  stop(): void {
    log("log", "TopFrameController#stop");
    this.resets.reset();
  }

  // TODO: Implement state management methods
  // These will be moved from BackgroundProgram incrementally
}
