import huffman from "n-ary-huffman";

import type {
  elementKey,
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
  KeyboardModeWorker,
  NormalizedKeypress,
} from "../shared/keyboard";
import {
  PREVENT_OVERTYPING_ALLOWED_KEYBOARD_ACTIONS,
} from "../shared/keyboard";
import {
  addListener,
  fireAndForget,
  isMixedCase,
  log,
  makeRandomToken,
  partition,
  Resets,
  splitEnteredText,
} from "../shared/main";
import type {
  FromRenderer,
  FromWorker,
  ToRenderer,
  ToWorker,
} from "../shared/messages";
import type { OptionsData } from "../shared/options";
import {
  MAX_PERF_ENTRIES,
  Perf,
  Stats,
  TimeTracker,
} from "../shared/perf";
import { unsignedInt, bool } from "../shared/tweakable";
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

type HintInput =
  | {
      type: "ActivateHint";
      alt: boolean;
    }
  | {
      type: "Backspace";
    }
  | {
      type: "Input";
      keypress: NormalizedKeypress;
    };

const TOP_FRAME_ID = 0;

export const t = {
  // Some onscreen frames may never respond (if the frame 404s or hasn't loaded
  // yet), but the parent can't now that. If a frame hasn't reported that it is
  // alive after this timeout, ignore it.
  FRAME_REPORT_TIMEOUT: unsignedInt(100), // ms

  // Only show the badge "spinner" if the hints are slow.
  BADGE_COLLECTING_DELAY: unsignedInt(300), // ms

  // Roughly how often to update the hints in hints mode. While a lower number
  // might yield updates faster, that feels very stuttery. Having a somewhat
  // longer interval feels better.
  UPDATE_INTERVAL: unsignedInt(500), // ms
  UPDATE_MIN_TIMEOUT: unsignedInt(100), // ms

  // How long a matched/activated hint should show as highlighted.
  MATCH_HIGHLIGHT_DURATION: unsignedInt(200), // ms

  // For people with tiling window managers who exclusively use windows rather
  // than tabs. This changes basically everything that deals with tabs to
  // instead deal with windows.
  PREFER_WINDOWS: bool(false),
};

/**
 * TopFrameController manages state for a single tab.
 * It receives messages from worker frames and orchestrates hint mode.
 * This is the new architecture where each top frame manages its own state
 * instead of the background script managing all tabs.
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
    
    // Listen for messages from workers in this tab's frames
    this.resets.add(
      addListener(
        browser.runtime.onMessage,
        this.onMessage.bind(this),
        "TopFrameController#onMessage"
      )
    );
  }

  stop(): void {
    log("log", "TopFrameController#stop");
    this.resets.reset();
  }

  // Handle messages - this replaces the background's message handling for this tab
  onMessage(
    message: unknown,
    sender: browser.runtime.MessageSender
  ): void {
    // Only process messages from our own tab
    // TODO: Implement proper message routing
    log("log", "TopFrameController#onMessage", message, sender);
  }

  // Core state management methods
  enterHintsMode({
    timestamp,
    mode,
  }: {
    timestamp: number;
    mode: HintsMode;
  }): void {
    const time = new TimeTracker();
    time.start("collect");

    const refreshing = this.state.hintsState.type !== "Idle";

    this.state.hintsState = {
      type: "Collecting",
      mode,
      pendingElements: {
        pendingFrames: {
          answering: 0,
          collecting: 1, // The top frame is collecting.
          lastStartWaitTimestamp: Date.now(),
        },
        elements: [],
      },
      startTime: timestamp,
      time,
      stats: [],
      refreshing,
      highlighted: this.state.hintsState.highlighted,
    };

    // TODO: Send message to workers to start finding elements
  }

  exitHintsMode({
    delayed = false,
    sendMessages = true,
  }: {
    delayed?: boolean;
    sendMessages?: boolean;
  } = {}): void {
    if (sendMessages) {
      if (delayed) {
        this.setTimeout(t.MATCH_HIGHLIGHT_DURATION.value);
      } else {
        // this.renderer will handle unrendering
      }
    }

    this.state.hintsState = {
      type: "Idle",
      highlighted: this.state.hintsState.highlighted,
    };

    // TODO: Send state sync to workers
  }

  // Timeout handler for various timed operations
  setTimeout(duration: number): void {
    setTimeout(() => {
      try {
        this.onTimeout();
      } catch (error) {
        log("error", "TopFrameController#onTimeout", error);
      }
    }, duration);
  }

  onTimeout(): void {
    // TODO: Implement timeout handling for:
    // - updateBadge
    // - maybeStartHinting
    // - updateElements
    // - unhighlightHints
    // - stopPreventOvertyping
  }

  // Handle keyboard shortcuts
  onKeyboardShortcut(
    action: KeyboardAction,
    timestamp: number
  ): void {
    const enterHintsMode = (mode: HintsMode): void => {
      this.enterHintsMode({ timestamp, mode });
    };

    switch (action) {
      case "EnterHintsMode_Click":
        enterHintsMode("Click");
        break;

      case "EnterHintsMode_BackgroundTab":
        enterHintsMode("BackgroundTab");
        break;

      case "EnterHintsMode_ForegroundTab":
        enterHintsMode("ForegroundTab");
        break;

      case "EnterHintsMode_ManyClick":
        enterHintsMode("ManyClick");
        break;

      case "EnterHintsMode_ManyTab":
        enterHintsMode("ManyTab");
        break;

      case "EnterHintsMode_Select":
        enterHintsMode("Select");
        break;

      case "ExitHintsMode":
        this.exitHintsMode();
        break;

      // TODO: Implement other actions
    }
  }

  // Make worker state message
  makeWorkerState(
    { refreshToken = true }: { refreshToken?: boolean } = {}
  ): ToWorker {
    const { hintsState } = this.state;

    if (refreshToken) {
      this.oneTimeWindowMessageToken = makeRandomToken();
    }

    if (!this.options) {
      throw new Error("Options not initialized");
    }

    const common = {
      logLevel: log.level,
      keyTranslations: this.options.values.useKeyTranslations
        ? this.options.values.keyTranslations
        : {},
      oneTimeWindowMessageToken: this.oneTimeWindowMessageToken,
      mac: this.options.mac,
      isPinned: this.state.isPinned,
    };

    const getKeyboardShortcuts = (
      shortcuts: Array<KeyboardMapping>
    ): Array<KeyboardMapping> =>
      this.state.keyboardMode.type === "PreventOverTyping"
        ? shortcuts.filter((shortcut) =>
            PREVENT_OVERTYPING_ALLOWED_KEYBOARD_ACTIONS.has(shortcut.action)
          )
        : shortcuts;

    const getKeyboardMode = (mode: KeyboardModeWorker): KeyboardModeWorker =>
      this.state.keyboardMode.type === "FromHintsState"
        ? mode
        : this.state.keyboardMode.type;

    return hintsState.type === "Hinting"
      ? {
          type: "StateSync",
          clearElements: false,
          keyboardShortcuts: getKeyboardShortcuts(
            this.options.values.hintsKeyboardShortcuts
          ),
          keyboardMode: getKeyboardMode("Hints"),
          ...common,
        }
      : {
          type: "StateSync",
          clearElements: hintsState.type === "Idle",
          keyboardShortcuts: getKeyboardShortcuts(
            this.options.values.normalKeyboardShortcuts
          ),
          keyboardMode: getKeyboardMode("Normal"),
          ...common,
        };
  }

  // Send message to worker frames
  sendWorkerMessage(
    message: ToWorker,
    frameId: number | "all_frames" = "all_frames"
  ): void {
    log("log", "TopFrameController#sendWorkerMessage", message, frameId);
    // TODO: Route through background or use window.postMessage
    fireAndForget(
      browser.runtime.sendMessage({
        type: "TopFrameToWorker",
        message,
        frameId,
      }),
      "TopFrameController#sendWorkerMessage",
      message,
      frameId
    );
  }
}
