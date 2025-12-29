/*
 * TopFrameController - Tab State Management
 * 
 * Each top-level frame manages its own tab's state independently.
 * State is lost when the page unloads (accepted design decision).
 */

import huffman from "n-ary-huffman";

import iconsChecksum from "../icons/checksum";
import {
  elementKey,
  ElementRender,
  ElementReport,
  ElementTypes,
  ElementWithHint,
  ExtendedElementReport,
  HintMeasurements,
  HintUpdate,
} from "../shared/hints";
import {
  HintsMode,
  KeyboardAction,
  KeyboardMapping,
  KeyboardModeBackground,
  KeyboardModeWorker,
  NormalizedKeypress,
  PREVENT_OVERTYPING_ALLOWED_KEYBOARD_ACTIONS,
} from "../shared/keyboard";
import {
  addListener,
  CONTAINER_ID,
  decode,
  fireAndForget,
  isMixedCase,
  log,
  makeRandomToken,
  partition,
  Resets,
  splitEnteredText,
} from "../shared/main";
import type {
  ChromiumVariant,
  FromBackground,
  FromOptions,
  FromPopup,
  FromRenderer,
  FromWorker,
  ToBackground,
  ToOptions,
  ToPopup,
  ToRenderer,
  ToWorker,
} from "../shared/messages";
import type {
  OptionsData,
  PartialOptions,
} from "../shared/options";
import {
  MAX_PERF_ENTRIES,
  Perf,
  Stats,
  TabsPerf,
  TimeTracker,
} from "../shared/perf";
import { bool, tweakable, unsignedInt } from "../shared/tweakable";


import type RendererProgram from "./Program";

type MessageInfo = {
  tabId: number;
  frameId: number;
  url: string | undefined;
};

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

// All HintsState types store the highlighted hints (highlighted due to being
// matched, not due to filtering by text), so that they can stay highlighted for
// `t.MATCH_HIGHLIGHT_DURATION` ms.
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

// As far as I can tell, the top frameId is always 0. This is also mentioned here:
// https://developer.mozilla.org/en-US/Add-ons/WebExtensions/API/Tabs/executeScript
// “frameId: Optional integer. The frame where the code should be injected.
// Defaults to 0 (the top-level frame).”
const TOP_FRAME_ID = 0;

export const t = {
  // Some onscreen frames may never respond (if the frame 404s or hasn't loaded
  // yet), but the parent can't now that. If a frame hasn't reported that it is
  // alive after this timeout, ignore it.
  FRAME_REPORT_TIMEOUT: unsignedInt(100), // ms

  // Only show the badge “spinner” if the hints are slow.
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

export const tMeta = tweakable("Background", t);


export default class TopFrameController {
  state: TabState;
  options: OptionsData;
  oneTimeWindowMessageToken: string = makeRandomToken();
  resets = new Resets();
  renderer: RendererProgram;

  constructor(renderer: RendererProgram, options: OptionsData) {
    this.renderer = renderer;
    this.options = options;
    this.state = makeEmptyTabState(undefined);
  }

  start(): void {
    log("log", "TopFrameController#start");
  }

  stop(): void {
    log("log", "TopFrameController#stop");
    this.resets.reset();
  }

  sendWorkerMessage(
    message: ToWorker,
    frameId: number | "all_frames" = "all_frames"
  ): void {
    log("log", "TopFrameController#sendWorkerMessage", message, frameId);
    fireAndForget(
      browser.runtime.sendMessage({ type: "ToWorker", message }),
      "TopFrameController#sendWorkerMessage",
      message
    );
  }


  sendRendererMessage(message: ToRenderer): void {
    log("log", "TopFrameController#sendRendererMessage", message);
    fireAndForget(
      browser.runtime.sendMessage({ type: "ToRenderer", message }),
      "TopFrameController#sendRendererMessage",
      message
    );
  }


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
    this.updateBadge();
    this.maybeStartHinting();
    this.updateElements();
    this.unhighlightHints();
    this.stopPreventOvertyping();
  }


  getTextRects({
    enteredChars,
    allElementsWithHints,
    words,
  }: {
    enteredChars: string;
    allElementsWithHints: Array<ElementWithHint>;
    words: Array<string>;
  }): void {
    const indexesByFrame = new Map<number, Array<number>>();
    for (const { text, hint, frame } of allElementsWithHints) {
      const previous = indexesByFrame.get(frame.id) ?? [];
      indexesByFrame.set(frame.id, previous);
      if (matchesText(text, words) && hint.startsWith(enteredChars)) {
        previous.push(frame.index);
      }
    }
    for (const [frameId, indexes] of indexesByFrame) {
      this.sendWorkerMessage(
        {
          type: "GetTextRects",
          indexes,
          words,
        }, frameId);
    }
  }


  handleHintInput(tabId: number, timestamp: number, input: HintInput): void {
    const tabState = this.state;

    const { hintsState } = tabState;
    if (hintsState.type !== "Hinting") {
      return;
    }

    // Ignore unknown/non-text keys.
    if (input.type === "Input" && input.keypress.printableKey === undefined) {
      return;
    }

    const isHintKey =
      (input.type === "Input" &&
        input.keypress.printableKey !== undefined &&
        this.options.values.chars.includes(input.keypress.printableKey)) ||
      (input.type === "Backspace" && hintsState.enteredChars !== "");

    // Disallow filtering by text after having started entering hint chars.
    if (
      !isHintKey &&
      input.type !== "ActivateHint" &&
      hintsState.enteredChars !== ""
    ) {
      return;
    }

    // Update entered chars (either text chars or hint chars).
    const updated = updateChars(
      isHintKey ? hintsState.enteredChars : hintsState.enteredText,
      input
    );
    const enteredChars = isHintKey ? updated : hintsState.enteredChars;
    const enteredText = isHintKey
      ? hintsState.enteredText
      : updated
          .toLowerCase()
          // Trim leading whitespace and allow only one trailing space.
          .replace(/^\s+/, "")
          .replace(/\s+$/, " ");

    const {
      allElementsWithHints,
      match: actualMatch,
      updates,
      words,
    } = updateHints({
      mode: hintsState.mode,
      enteredChars,
      enteredText,
      elementsWithHints: hintsState.elementsWithHints,
      highlighted: hintsState.highlighted,
      chars: this.options.values.chars,
      autoActivate: this.options.values.autoActivate,
      matchHighlighted: input.type === "ActivateHint",
      updateMeasurements: false,
    });

    // Disallow matching hints (by text) by backspacing away chars. This can
    // happen if your entered text matches two links and then the link you
    // were after is removed.
    const [match, preventOverTyping] =
      input.type === "Backspace" || actualMatch === undefined
        ? [undefined, false]
        : [actualMatch.elementWithHint, actualMatch.autoActivated];

    // If pressing a hint char that is currently unused, ignore it.
    if (enteredChars !== "" && updates.every((update) => update.hidden)) {
      return;
    }

    const now = Date.now();
    const highlighted =
      match !== undefined
        ? allElementsWithHints
            .filter((element) => element.hint === match.hint)
            .map((element) => ({ sinceTimestamp: now, element }))
        : [];

    hintsState.enteredChars = enteredChars;
    hintsState.enteredText = enteredText;
    hintsState.elementsWithHints = allElementsWithHints;
    hintsState.highlighted = hintsState.highlighted.concat(highlighted);

    this.getTextRects({
      enteredChars,
      allElementsWithHints,
      words,
    });

    const shouldContinue =
      match === undefined
        ? true
        : this.handleHintMatch({
            match,
            updates,
            preventOverTyping,
            alt:
              // By holding a modifier while typing the last character to
              // activate a hint forces opening links in new tabs. On Windows
              // and Linux, alt is used (since it is the only safe modifier). On
              // mac, ctrl is used since alt/option types special characters and
              // cmd is not safe.
              (input.type === "Input" &&
                (this.options.mac
                  ? input.keypress.ctrl
                  : input.keypress.alt)) ||
              (input.type === "ActivateHint" && input.alt),
            timestamp,
          });

    // Some hint modes handle updating hintsState and sending messages
    // themselves. The rest share the same implementation below.
    if (!shouldContinue) {
      return;
    }

    this.sendRendererMessage(
      {
        type: "UpdateHints",
        updates,
        enteredText,
      },
      // tabId not needed in TopFrame context
    );

    if (match !== undefined) {
      tabState.hintsState = {
        type: "Idle",
        highlighted: hintsState.highlighted,
      };
      this.setTimeout( t.MATCH_HIGHLIGHT_DURATION.value);
      this.updateWorkerStateAfterHintActivation({
        preventOverTyping,
      });
    }

    this.updateBadge();
  }

  // Executes some action on the element of the matched hint. Returns whether
  // the "NonKeyboardShortcutKeypress" handler should continue with its default
  // implementation for updating hintsState and sending messages or not. Some
  // hint modes handle that themselves.

  handleHintMatch({
    match,
    updates,
    preventOverTyping,
    alt,
    timestamp,
  }: {
    match: ElementWithHint;
    updates: Array<HintUpdate>;
    preventOverTyping: boolean;
    alt: boolean;
    timestamp: number;
  }): boolean {
    const tabState = this.state;
    if (tabState === undefined) {
      return true;
    }

    const { hintsState } = tabState;
    if (hintsState.type !== "Hinting") {
      return true;
    }

    const { url } = match;

    const mode: HintsMode =
      url !== undefined && alt && hintsState.mode !== "Select"
        ? "ForegroundTab"
        : hintsState.mode;

    switch (mode) {
      case "Click":
        this.sendWorkerMessage(
          {
            type: "ClickElement",
            index: match.frame.index,
          },
          {
            frameId: match.frame.id,
          }
        );
        return true;

      case "ManyClick": {
        if (match.isTextInput) {
          this.sendWorkerMessage(
            {
              type: "ClickElement",
              index: match.frame.index,
            },
            {
              frameId: match.frame.id,
            }
          );
          return true;
        }

        this.sendWorkerMessage(
          {
            type: "ClickElement",
            index: match.frame.index,
          },
          {
            frameId: match.frame.id,
          }
        );

        // Highlight the matched hints immediately, but hide others when the
        // highlight duration is over. Likely, the same hints will appear again
        // when the “next” hints mode is started. This reduces flicker.
        this.sendRendererMessage(
          {
            type: "UpdateHints",
            updates: updates.filter((update) => update.type !== "Hide"),
            enteredText: hintsState.enteredText,
          },
          // tabId not needed in TopFrame context
        );

        // In case the “next” hints mode takes longer than the highlight
        // duration, remove the shruggie. It might flicker by otherwise, and we
        // don’t need it, just like we don’t show it when entering hints mode
        // initially.
        this.sendRendererMessage({ type: "RemoveShruggie" });

        this.updateWorkerStateAfterHintActivation({
          preventOverTyping,
        });

        this.enterHintsMode({
          timestamp,
          mode: hintsState.mode,
        });

        this.setTimeout( t.MATCH_HIGHLIGHT_DURATION.value);

        return false;
      }

      case "ManyTab": {
        if (url === undefined) {
          log(
            "error",
            "Cannot open background tab (many) due to missing URL",
            match
          );
          return true;
        }

        const matchedIndexes = new Set(
          hintsState.elementsWithHints
            .filter((element) => element.hint === match.hint)
            .map((element) => element.index)
        );

        const highlightedKeys = new Set(
          hintsState.highlighted.map(({ element }) => elementKey(element))
        );

        hintsState.enteredChars = "";
        hintsState.enteredText = "";

        this.openNewTab({
          url,
          elementIndex: match.frame.index,
          frameId: match.frame.id,
          foreground: false,
        });

        this.sendRendererMessage(
          {
            type: "UpdateHints",
            updates: assignHints(hintsState.elementsWithHints, {
              mode: "ManyTab",
              chars: this.options.values.chars,
              hasEnteredText: false,
            }).map((element, index) => ({
              type: "UpdateContent",
              index: element.index,
              order: index,
              matchedChars: "",
              restChars: element.hint,
              highlighted:
                matchedIndexes.has(element.index) ||
                highlightedKeys.has(elementKey(element)),
              hidden: element.hidden,
            })),
            enteredText: "",
          },
          // tabId not needed in TopFrame context
        );

        this.updateWorkerStateAfterHintActivation({
          preventOverTyping,
        });

        this.updateBadge();
        this.setTimeout( t.MATCH_HIGHLIGHT_DURATION.value);

        return false;
      }

      case "BackgroundTab":
        if (url === undefined) {
          log("error", "Cannot open background tab due to missing URL", match);
          return true;
        }
        this.openNewTab({
          url,
          elementIndex: match.frame.index,
          frameId: match.frame.id,
          foreground: false,
        });
        return true;

      case "ForegroundTab":
        if (url === undefined) {
          log("error", "Cannot open foreground tab due to missing URL", match);
          return true;
        }
        this.openNewTab({
          url,
          elementIndex: match.frame.index,
          frameId: match.frame.id,
          foreground: true,
        });
        return true;

      case "Select":
        this.sendWorkerMessage(
          alt
            ? {
                type: "CopyElement",
                index: match.frame.index,
              }
            : {
                type: "SelectElement",
                index: match.frame.index,
              },
          {
            frameId: match.frame.id,
          }
        );
        return true;
    }
  }


  refreshHintsRendering(): void {
    const tabState = this.state;

    const { hintsState } = tabState;
    if (hintsState.type !== "Hinting") {
      return;
    }

    const { enteredChars, enteredText } = hintsState;

    const { allElementsWithHints, updates, words } = updateHints({
      mode: hintsState.mode,
      enteredChars,
      enteredText,
      elementsWithHints: hintsState.elementsWithHints,
      highlighted: hintsState.highlighted,
      chars: this.options.values.chars,
      autoActivate: this.options.values.autoActivate,
      matchHighlighted: false,
      updateMeasurements: false,
    });

    this.getTextRects({ enteredChars, allElementsWithHints, words });

    this.sendRendererMessage(
      {
        type: "UpdateHints",
        updates,
        enteredText,
      },
      // tabId not needed in TopFrame context
    );

    this.updateBadge();
  }


  openNewTab({
    url,
    elementIndex,
    frameId,
    foreground,
  }: {
    url: string;
    elementIndex: number;
    frameId: number;
    foreground: boolean;
  }): void {
    this.sendWorkerMessage(
      {
        type: "FocusElement",
        index: elementIndex,
      }, frameId);

    // In Firefox, creating a tab with `openerTabId` works just like
    // right-clicking a link and choosing "Open Link in New Tab" (basically,
    // it's opened to the right of the current tab). In Chrome, created tabs are
    // always opened at the end of the tab strip. However, dispatching a
    // ctrl-click on an `<a>` element opens a tab just like ctrl-clicking it for
    // real. I considered keeping track of where to open tabs manually for
    // Chrome, but the logic for where to open tabs turned out to be too
    // complicated to replicate in a good way, and there does not seem to be a
    // downside of using the fake ctrl-click method in Chrome. In fact, there’s
    // even an upside to the ctrl-click method: The HTTP Referer header is sent,
    // just as if you had clicked the link for real. See: <bugzil.la/1615860>.
    if (t.PREFER_WINDOWS.value) {
      fireAndForget(
        browser.windows
          .create({
            focused: foreground,
            url,
          })
          .then(() => undefined),
        "BackgroundProgram#openNewTab (PREFER_WINDOWS)",
        url
      );
    } else if (BROWSER === "chrome") {
      fireAndForget(
        getChromiumVariant().then((chromiumVariant) => {
          this.sendWorkerMessage(
            {
              type: "OpenNewTab",
              url,
              foreground,
              chromiumVariant,
            },
            { frameId: TOP_FRAME_ID }
          );
        }),
        "BackgroundProgram#openNewTab->getChromiumVariant"
      );
    } else {
      fireAndForget(
        browser.tabs
          .create({
            active: foreground,
            url,
            openerTabId: tabId,
          })
          .then(() => undefined),
        "BackgroundProgram#openNewTab",
        url
      );
    }
  }


  maybeStartHinting(): void {
    const tabState = this.state;

    const { hintsState } = tabState;
    if (hintsState.type !== "Collecting") {
      return;
    }

    const { pendingFrames } = hintsState.pendingElements;
    const frameWaitDuration = Date.now() - pendingFrames.lastStartWaitTimestamp;
    if (
      pendingFrames.collecting > 0 ||
      (pendingFrames.answering > 0 &&
        frameWaitDuration < t.FRAME_REPORT_TIMEOUT.value)
    ) {
      return;
    }

    const { time } = hintsState;
    time.start("assign hints");

    const elementsWithHints: Array<ElementWithHint> = assignHints(
      hintsState.pendingElements.elements.map((element, index) => ({
        ...element,
        // These are filled in by `assignHints` but need to be set here for type
        // checking reasons.
        weight: 0,
        hint: "",
        // This is set for real in the next couple of lines, but set here also
        // to be extra sure that the sorting really is stable.
        index,
      })),
      {
        mode: hintsState.mode,
        chars: this.options.values.chars,
        hasEnteredText: false,
      }
      // `.index` was set to `-1` in "ReportVisibleElements" (and to a temporary
      // index above). Now set it for real to map these elements to DOM elements
      // in RendererProgram.
    ).map((element, index) => ({ ...element, index }));

    const elementKeys = new Set(
      elementsWithHints.map((element) => elementKey(element))
    );
    const highlightedKeys = new Set(
      hintsState.highlighted.map(({ element }) => elementKey(element))
    );

    const [alreadyHighlighted, extraHighlighted] = partition(
      hintsState.highlighted,
      ({ element }) => elementKeys.has(elementKey(element))
    );

    const updateIndex = (
      { element, sinceTimestamp }: HighlightedItem,
      index: number
    ): HighlightedItem => ({
      element: { ...element, index },
      sinceTimestamp,
    });

    const numElements = elementsWithHints.length;
    const highlighted = extraHighlighted
      // Add indexes to the highlighted hints that get extra DOM nodes.
      .map((item, index) => updateIndex(item, numElements + index))
      // Other highlighted hints don’t get extra DOM nodes – they instead
      // highlight new hints with the same characters and position. Mark them
      // with an index of -1 for `unhighlightHints`’s sakes.
      .concat(alreadyHighlighted.map((item) => updateIndex(item, -1)));

    const elementRenders: Array<ElementRender> = elementsWithHints
      .map((element, index) => ({
        hintMeasurements: element.hintMeasurements,
        hint: element.hint,
        // Hints at the same position and with the same hint characters as a
        // previously matched hint are marked as highlighted.
        highlighted: highlightedKeys.has(elementKey(element)),
        invertedZIndex: index + 1,
      }))
      // Other previously matched hints are rendered (but not stored in
      // `hintsState.elementsWithHints`).
      .concat(
        extraHighlighted.map(({ element }) => ({
          hintMeasurements: element.hintMeasurements,
          hint: element.hint,
          highlighted: true,
          // Previously matched hints are always shown on top over regular hints.
          invertedZIndex: 0,
        }))
      );

    tabState.hintsState = {
      type: "Hinting",
      mode: hintsState.mode,
      startTime: hintsState.startTime,
      time,
      stats: hintsState.stats,
      enteredChars: "",
      enteredText: "",
      elementsWithHints,
      highlighted,
      updateState: {
        type: "WaitingForTimeout",
        lastUpdateStartTimestamp: hintsState.startTime,
      },
      peeking: false,
    };
    this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
    );
    this.setTimeout( t.UPDATE_INTERVAL.value);

    time.start("render");
    this.sendRendererMessage(
      {
        type: "Render",
        elements: elementRenders,
        mixedCase: isMixedCase(this.options.values.chars),
      },
      // tabId not needed in TopFrame context
    );
    this.updateBadge();
  }


  updateElements(): void {
    const tabState = this.state;

    const { hintsState } = tabState;
    if (hintsState.type !== "Hinting") {
      return;
    }

    const { updateState } = hintsState;
    if (updateState.type !== "WaitingForTimeout") {
      return;
    }

    if (
      Date.now() - updateState.lastUpdateStartTimestamp >=
      t.UPDATE_INTERVAL.value
    ) {
      if (hintsState.elementsWithHints.every((element) => element.hidden)) {
        this.enterHintsMode({
          timestamp: Date.now(),
          mode: hintsState.mode,
        });
      } else {
        hintsState.updateState = {
          type: "WaitingForResponse",
          lastUpdateStartTimestamp: Date.now(),
        };

        // Refresh `oneTimeWindowMessageToken`.
        this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
        );

        this.sendWorkerMessage(
          { type: "UpdateElements" }, TOP_FRAME_ID,
          );
      }
    }
  }


  hideElements(info: MessageInfo): void {
    const tabState = this.state;

    const { hintsState } = tabState;

    if (hintsState.type !== "Hinting") {
      return;
    }

    if (info.frameId === TOP_FRAME_ID) {
      log(
        "log",
        "BackgroundProgram#hideElements",
        "Skipping because this should not happen for the top frame.",
        info
      );
      return;
    }

    log("log", "BackgroundProgram#hideElements", info);

    for (const element of hintsState.elementsWithHints) {
      if (element.frame.id === info.frameId) {
        element.hidden = true;
      }
    }

    const { enteredChars, enteredText } = hintsState;

    const { allElementsWithHints, updates } = updateHints({
      mode: hintsState.mode,
      enteredChars,
      enteredText,
      elementsWithHints: hintsState.elementsWithHints,
      highlighted: hintsState.highlighted,
      chars: this.options.values.chars,
      autoActivate: this.options.values.autoActivate,
      matchHighlighted: false,
      updateMeasurements: false,
    });

    hintsState.elementsWithHints = allElementsWithHints;

    this.sendRendererMessage(
      {
        type: "RenderTextRects",
        rects: [],
        frameId: info.frameId,
      },
      { tabId: info.tabId }
    );

    this.sendRendererMessage(
      {
        type: "UpdateHints",
        updates,
        enteredText,
      },
      { tabId: info.tabId }
    );

    this.updateBadge();
  }


  onRendererMessage(
    message: FromRenderer,
    info: MessageInfo,
    tabState: TabState
  ): void {
    log("log", "BackgroundProgram#onRendererMessage", message, info);

    switch (message.type) {
      case "RendererScriptAdded":
        this.sendRendererMessage(
          {
            type: "StateSync",
            css: this.options.values.css,
            logLevel: log.level,
          },
          { tabId: info.tabId }
        );
        // Both uBlock Origin and Adblock Plus use `browser.tabs.insertCSS` with
        // `{ display: none !important; }` and `cssOrigin: "user"` to hide
        // elements. I’ve seen Link Hints’ container to be hidden by a
        // `[style*="animation:"]` filter. This makes sure that the container
        // cannot be hidden by adblockers.
        // In Chrome, 255 ids have the same specificity as >=256 (for Firefox,
        // it’s 1023). One can increase the specificity even more by adding
        // classes, but I don’t think it’s worth the trouble.
        // Also, hide the backdrop of Link Hints’ container (it is a popover),
        // for sites with styles like `::backdrop { background-color: rgba(0, 0, 0, 0.2) }`
        fireAndForget(
          browser.tabs.insertCSS(info.tabId, {
            code: `${`#${CONTAINER_ID}`.repeat(
              255
            )} { display: block !important; &::backdrop { display: none !important; } }`,
            cssOrigin: "user",
            runAt: "document_start",
          }),
          "BackgroundProgram#onRendererMessage",
          "Failed to insert adblock workaround CSS",
          message,
          info
        );
        break;

      case "Rendered": {
        const { hintsState } = tabState;
        if (hintsState.type !== "Hinting") {
          return;
        }
        const { startTime, time, stats: collectStats } = hintsState;
        time.stop();
        const { durations, firstPaintTimestamp, lastPaintTimestamp } = message;
        const timeToFirstPaint = firstPaintTimestamp - startTime;
        const timeToLastPaint = lastPaintTimestamp - startTime;
        tabState.perf = [
          {
            timeToFirstPaint,
            timeToLastPaint,
            topDurations: time.export(),
            collectStats,
            renderDurations: durations,
          },
          ...tabState.perf,
        ].slice(0, MAX_PERF_ENTRIES);
        // TODO: Send perf to background if needed
        break;
      }
    }
  }


  onKeyboardShortcut(
    action: KeyboardAction,
    info: MessageInfo,
    timestamp: number
  ): void {
    const enterHintsMode = (mode: HintsMode): void => {
      this.enterHintsMode({
        timestamp,
        mode,
      });
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

      case "RotateHintsForward":
        this.sendRendererMessage(
          {
            type: "RotateHints",
            forward: true,
          },
          { tabId: info.tabId }
        );
        break;

      case "RotateHintsBackward":
        this.sendRendererMessage(
          {
            type: "RotateHints",
            forward: false,
          },
          { tabId: info.tabId }
        );
        break;

      case "RefreshHints": {
        const tabState = this.state;

        const { hintsState } = tabState;
        if (hintsState.type !== "Hinting") {
          return;
        }

        // Refresh `oneTimeWindowMessageToken`.
        this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
        );

        enterHintsMode(hintsState.mode);
        break;
      }

      case "TogglePeek": {
        const tabState = this.state;

        const { hintsState } = tabState;
        if (hintsState.type !== "Hinting") {
          return;
        }

        this.sendRendererMessage(
          hintsState.peeking ? { type: "Unpeek" } : { type: "Peek" });

        hintsState.peeking = !hintsState.peeking;
        break;
      }

      case "Escape":
        this.exitHintsMode();
        this.sendWorkerMessage(
          { type: "Escape" }, "all_frames" );
        break;

      case "ActivateHint":
          type: "ActivateHint",
          alt: false,
        });
        break;

      case "ActivateHintAlt":
          type: "ActivateHint",
          alt: true,
        });
        break;

      case "Backspace":
        break;

      case "ReverseSelection":
        this.sendWorkerMessage(
          { type: "ReverseSelection" }, "all_frames" );
        break;
    }
  }


  enterHintsMode({
    timestamp,
    mode,
  }: {
    timestamp: number;
    mode: HintsMode;
  }): void {
    const tabState = this.state;

    const time = new TimeTracker();
    time.start("collect");

    this.sendWorkerMessage(
      {
        type: "StartFindElements",
        types: getElementTypes(mode),
      },
      {
        frameId: TOP_FRAME_ID,
      }
    );

    const refreshing = tabState.hintsState.type !== "Idle";

    tabState.hintsState = {
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
      highlighted: tabState.hintsState.highlighted,
    };

    this.updateBadge();
    this.setTimeout( t.BADGE_COLLECTING_DELAY.value);
  }


  exitHintsMode({
    delayed = false,
    sendMessages = true,
  }: {
    delayed?: boolean;
    sendMessages?: boolean;
  } = {}): void {
    const tabState = this.state;

    if (sendMessages) {
      if (delayed) {
        this.setTimeout( t.MATCH_HIGHLIGHT_DURATION.value);
      } else {
        this.renderer.unrender(); // Direct call instead of message
      }
    }

    tabState.hintsState = {
      type: "Idle",
      highlighted: tabState.hintsState.highlighted,
    };

    if (sendMessages) {
      this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
      );
    }

    this.updateBadge();
  }


  unhighlightHints(): void {
    const tabState = this.state;

    const { hintsState } = tabState;

    if (hintsState.highlighted.length === 0) {
      return;
    }

    const now = Date.now();
    const [doneWaiting, stillWaiting] = partition(
      hintsState.highlighted,
      ({ sinceTimestamp }) =>
        now - sinceTimestamp >= t.MATCH_HIGHLIGHT_DURATION.value
    );

    const hideDoneWaiting = ({
      refresh = false,
    }: { refresh?: boolean } = {}): void => {
      if (doneWaiting.length > 0) {
        this.sendRendererMessage(
          {
            type: "UpdateHints",
            updates: doneWaiting
              // Highlighted elements with -1 as index don’t have their own DOM
              // nodes – instead, they have highlighted a new hint with the same
              // characters and position. They are unhighlighted using
              // `this.refreshHintsRendering` below.
              .filter(({ element }) => element.index !== -1)
              .map(({ element }) => ({
                type: "Hide",
                index: element.index,
                hidden: true,
              })),
            enteredText: "",
          },
          // tabId not needed in TopFrame context
        );
        if (refresh) {
          this.refreshHintsRendering();
        }
      }
    };

    hintsState.highlighted = stillWaiting;

    switch (hintsState.type) {
      case "Idle":
      case "Collecting":
        if (stillWaiting.length === 0) {
          this.renderer.unrender(); // Direct call instead of message
        } else {
          hideDoneWaiting();
        }
        break;

      case "Hinting": {
        hideDoneWaiting({ refresh: true });
        break;
      }
    }
  }


  stopPreventOvertyping(): void {
    const tabState = this.state;

    const { keyboardMode } = tabState;
    if (
      keyboardMode.type === "PreventOverTyping" &&
      Date.now() - keyboardMode.sinceTimestamp >=
        this.options.values.overTypingDuration
    ) {
      tabState.keyboardMode = { type: "FromHintsState" };
      this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
      );
    }
  }


  updateBadge(): void {
    const tabState = this.state;

    const { hintsState } = tabState;

    fireAndForget(
      browser.browserAction.setBadgeText({
        text: getBadgeText(hintsState),
      }),
      "BackgroundProgram#updateBadge->setBadgeText"
    );
  }


  makeWorkerState(
    tabState: TabState,
    { refreshToken = true }: { refreshToken?: boolean } = {}
  ): ToWorker {
    const { hintsState } = tabState;

    if (refreshToken) {
      this.oneTimeWindowMessageToken = makeRandomToken();
    }

    const common = {
      logLevel: log.level,
      keyTranslations: this.options.values.useKeyTranslations
        ? this.options.values.keyTranslations
        : {},
      oneTimeWindowMessageToken: this.oneTimeWindowMessageToken,
      mac: this.options.mac,
      isPinned: tabState.isPinned,
    };

    const getKeyboardShortcuts = (
      shortcuts: Array<KeyboardMapping>
    ): Array<KeyboardMapping> =>
      tabState.keyboardMode.type === "PreventOverTyping"
        ? shortcuts.filter((shortcut) =>
            PREVENT_OVERTYPING_ALLOWED_KEYBOARD_ACTIONS.has(shortcut.action)
          )
        : shortcuts;

    const getKeyboardMode = (mode: KeyboardModeWorker): KeyboardModeWorker =>
      tabState.keyboardMode.type === "FromHintsState"
        ? mode
        : tabState.keyboardMode.type;

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


  updateWorkerStateAfterHintActivation({ preventOverTyping }: { preventOverTyping: boolean; }): void {
    const tabState = this.state;

    if (preventOverTyping) {
      tabState.keyboardMode = {
        type: "PreventOverTyping",
        sinceTimestamp: Date.now(),
      };
      this.setTimeout( this.options.values.overTypingDuration);
    }

    this.sendWorkerMessage(this.makeWorkerState(tabState), "all_frames",
    );
  }


}

// Helper functions

// Copied from: https://stackoverflow.com/a/77047611
async function getChromiumVariant(): Promise<ChromiumVariant> {
  const tabs = await browser.tabs.query({
    active: true,
    currentWindow: true,
  });
  return tabs[0]?.vivExtData !== undefined ? "vivaldi" : "chrome";
}

function makeEmptyTabState(tabId: number | undefined): TabState {
  const tabState: TabState = {
    hintsState: {
      type: "Idle",
      highlighted: [],
    },
    keyboardMode: { type: "FromHintsState" },
    perf: [],
    isOptionsPage: false,
    isPinned: false,
  };

  if (tabId !== undefined) {
    // This is a really ugly hack. `makeEmptyTabState` is used within
    // `BackgroundProgram#onMessage`. As mentioned over there, that method must
    // _not_ be async. So instead of waiting for `browser.tabs.get` (returning a
    // Promise), we just mutate the tab state as soon as possible. This means
    // that code trying to access `tabState.isPinned` right after
    // `makeEmptyTabState` might get the wrong value. At the time of this
    // writing, no code does that so the hack holds.
    browser.tabs
      .get(tabId)
      .then((tab) => {
        tabState.isPinned = tab.pinned;
      })
      .catch((error) => {
        log("error", "makeEmptyTabState", `Failed to get tab ${tabId}.`, error);
      });
  }

  return tabState;
}

const CLICK_TYPES: ElementTypes = [
  "clickable",
  "clickable-event",
  "sometimes-clickable",
  "link",
  "textarea",
];

const TAB_TYPES: ElementTypes = ["link"];

function getElementTypes(mode: HintsMode): ElementTypes {
  switch (mode) {
    case "Click":
      return CLICK_TYPES;

    case "BackgroundTab":
      return TAB_TYPES;

    case "ForegroundTab":
      return TAB_TYPES;

    case "ManyClick":
      return CLICK_TYPES;

    case "ManyTab":
      return TAB_TYPES;

    case "Select":
      return "selectable";
  }
}

function getCombiningUrl(
  mode: HintsMode,
  element: ElementWithHint
): string | undefined {
  switch (mode) {
    case "Click":
      return shouldCombineHintsForClick(element)
        ? element.urlWithTarget
        : undefined;

    case "BackgroundTab":
      return element.url;

    case "ForegroundTab":
      return element.url;

    case "ManyClick":
      return shouldCombineHintsForClick(element)
        ? element.urlWithTarget
        : undefined;

    case "ManyTab":
      return element.url;

    case "Select":
      return undefined;
  }
}

function shouldCombineHintsForClick(element: ElementWithHint): boolean {
  const { url, hasClickListener } = element;
  // The diff expander buttons on GitHub are links to the same fragment
  // identifier. So are Bootstrap carousel next/previous “buttons”. So it’s not
  // safe to combine links with fragment identifiers at all. (They may be
  // powered by delegated event listeners.) I guess they aren’t as common
  // anyway. Also don’t combine if the elements themselves have click listeners.
  // Some sites use `<a>` as buttons with click listeners but still include an
  // href for some reason.
  return url !== undefined && !url.includes("#") && !hasClickListener;
}

async function runContentScripts(
  tabs: Array<browser.tabs.Tab>
): Promise<Array<Array<unknown>>> {
  const manifest = browser.runtime.getManifest();

  const detailsList =
    manifest.content_scripts === undefined
      ? []
      : manifest.content_scripts
          .filter((script) => script.matches.includes("<all_urls>"))
          .flatMap((script) =>
            script.js === undefined
              ? []
              : script.js.map((file) => ({
                  file,
                  allFrames: script.all_frames,
                  matchAboutBlank: script.match_about_blank,
                  runAt: script.run_at,
                }))
          );

  return Promise.all(
    tabs.flatMap((tab) =>
      detailsList.map(async (details) => {
        if (tab.id === undefined) {
          return [];
        }
        try {
          return (await browser.tabs.executeScript(
            tab.id,
            details
          )) as Array<unknown>;
        } catch {
          // If `executeScript` fails it means that the extension is not
          // allowed to run content scripts in the tab. Example: most
          // `chrome://*` pages. We don’t need to do anything in that case.
          return [];
        }
      })
    )
  );
}

function firefoxWorkaround(tabs: Array<browser.tabs.Tab>): void {
  for (const tab of tabs) {
    if (tab.id !== undefined) {
      const message: FromBackground = { type: "FirefoxWorkaround" };
      browser.tabs.sendMessage(tab.id, message).catch(() => {
        // If `sendMessage` fails it means that there’s no content script
        // listening in that tab. Example:  `about:` pages (where extensions
        // are not allowed to run content scripts). We don’t need to do
        // anything in that case.
      });
    }
  }
}

async function getCurrentTab(): Promise<browser.tabs.Tab> {
  const tabs = await browser.tabs.query({
    active: true,
    windowId: browser.windows.WINDOW_ID_CURRENT,
  });
  if (tabs.length !== 1) {
    throw new Error(
      `getCurrentTab: Got an unexpected amount of tabs: ${tabs.length}`
    );
  }
  return tabs[0];
}

// Open a bunch of tabs, and then focus the first of them.
async function openNewTabs(tabId: number, urls: Array<string>): Promise<void> {
  const newTabs = await Promise.all(
    urls.map((url) =>
      browser.tabs.create({
        active: urls.length === 1,
        url,
        openerTabId: tabId,
      })
    )
  );
  if (newTabs.length >= 2 && newTabs[0].id !== undefined) {
    await browser.tabs.update(newTabs[0].id, { active: true });
  }
}

// Open a bunch of windows, and then focus the first of them.
async function openNewWindows(urls: Array<string>): Promise<void> {
  const newWindows = await Promise.all(
    urls.map((url) =>
      browser.windows.create({
        focused: urls.length === 1,
        url,
      })
    )
  );
  if (newWindows.length >= 2 && newWindows[0].id !== undefined) {
    await browser.windows.update(newWindows[0].id, { focused: true });
  }
}

type IconType = "disabled" | "normal";

function getIcons(type: IconType): Record<string, string> {
  const manifest = browser.runtime.getManifest();
  return Object.fromEntries(
    Object.entries(manifest.browser_action?.default_icon ?? {}).flatMap(
      ([key, value]) => {
        if (typeof value === "string") {
          const newValue = value.replace(/(\$)\w+/, `$1${type}`);
          // Default icons are always PNG in development to support Chrome. Switch
          // to SVG in Firefox during development to make it easier to work on the
          // SVG icon source (automatic reloading). This also requires a
          // cache-bust.
          const finalValue =
            !PROD && BROWSER === "firefox"
              ? `${newValue.replace(/png/g, "svg")}?${iconsChecksum}`
              : newValue;
          return [[key, finalValue]];
        }
        return [];
      }
    )
  );
}

// Left to right, top to bottom.
function comparePositions(a: HintMeasurements, b: HintMeasurements): number {
  // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
  return a.x - b.x || a.y - b.y;
}

function getBadgeText(hintsState: HintsState): string {
  switch (hintsState.type) {
    case "Idle":
      return "";

    case "Collecting":
      // Only show the badge “spinner” if the hints are slow. But show it
      // immediately when refreshing so that one can see it flash in case you
      // get exactly the same hints after refreshing, so that you understand
      // that something happened. It’s also nice to show in "ManyClick" mode.
      return Date.now() - hintsState.startTime >
        t.BADGE_COLLECTING_DELAY.value || hintsState.refreshing
        ? "…"
        : "";

    case "Hinting": {
      const { enteredChars, enteredText } = hintsState;
      const words = splitEnteredText(enteredText);
      return hintsState.elementsWithHints
        .filter(
          (element) =>
            // "Hidden" elements have been removed from the DOM or moved off-screen.
            !element.hidden &&
            matchesText(element.text, words) &&
            element.hint.startsWith(enteredChars)
        )
        .length.toString();
    }
  }
}

class Combined {
  children: Array<ElementWithHint>;

  weight: number;

  constructor(children: Array<ElementWithHint>) {
    this.children = children;
    this.weight = Math.max(...children.map((child) => child.weight));
  }
}

function combineByHref(
  elements: Array<ElementWithHint>,
  mode: HintsMode
): Array<Combined | ElementWithHint> {
  const map = new Map<string, Array<ElementWithHint>>();
  const rest: Array<ElementWithHint> = [];

  for (const element of elements) {
    const url = getCombiningUrl(mode, element);
    if (url !== undefined) {
      const previous = map.get(url);
      if (previous !== undefined) {
        previous.push(element);
      } else {
        map.set(url, [element]);
      }
    } else {
      rest.push(element);
    }
  }

  return Array.from(map.values())
    .map((children): Combined | ElementWithHint => new Combined(children))
    .concat(rest);
}

function assignHints(
  passedElements: Array<ElementWithHint>,
  {
    mode,
    chars,
    hasEnteredText,
  }: { mode: HintsMode; chars: string; hasEnteredText: boolean }
): Array<ElementWithHint> {
  const largestTextWeight = hasEnteredText
    ? Math.max(1, ...passedElements.map((element) => element.textWeight))
    : 0;

  // Sort the elements so elements with more weight get higher z-index.
  const elements: Array<ElementWithHint> = passedElements
    .map((element) => ({
      ...element,
      // When filtering by text, give better hints to elements with shorter
      // text. The more of the text that is matched, the more likely to be what
      // the user is looking for.
      weight: hasEnteredText
        ? largestTextWeight - element.textWeight + 1
        : element.hintMeasurements.weight,
      // This is set to the real thing below.
      hint: "",
    }))
    .sort(
      (a, b) =>
        // Higher weights first.
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        b.weight - a.weight ||
        // If the weights are the same, sort by on-screen position, left to
        // right and then top to bottom (reading order in LTR languages).
        // eslint-disable-next-line @typescript-eslint/strict-boolean-expressions
        comparePositions(a.hintMeasurements, b.hintMeasurements) ||
        // `hintsState.elementsWithHints` changes order as
        // `hintsState.enteredText` come and go. Sort on `.index` if all other
        // things are equal, so that elements don’t unexpectedly swap hints after
        // erasing some text chars.
        a.index - b.index
    );

  const combined = combineByHref(elements, mode);

  const tree = huffman.createTree(combined, chars.length, {
    // Even though we sorted `elements` above, `combined` might not be sorted.
    sorted: false,
  });

  tree.assignCodeWords(chars, (item, codeWord) => {
    if (item instanceof Combined) {
      for (const child of item.children) {
        child.hint = codeWord;
      }
    } else {
      item.hint = codeWord;
    }
  });

  return elements;
}

function makeMessageInfo(
  sender: browser.runtime.MessageSender
): MessageInfo | undefined {
  return sender.tab?.id !== undefined && sender.frameId !== undefined
    ? { tabId: sender.tab.id, frameId: sender.frameId, url: sender.url }
    : undefined;
}

function updateChars(chars: string, input: HintInput): string {
  switch (input.type) {
    case "Input": {
      const key = input.keypress.printableKey;
      return key !== undefined ? `${chars}${key}` : chars;
    }
    case "ActivateHint":
      return chars;
    case "Backspace":
      return chars.slice(0, -1);
  }
}

function updateHints({
  mode,
  enteredChars,
  enteredText,
  elementsWithHints: passedElementsWithHints,
  highlighted,
  chars,
  autoActivate: autoActivateOption,
  matchHighlighted,
  updateMeasurements,
}: {
  mode: HintsMode;
  enteredChars: string;
  enteredText: string;
  elementsWithHints: Array<ElementWithHint>;
  highlighted: Highlighted;
  chars: string;
  autoActivate: boolean;
  matchHighlighted: boolean;
  updateMeasurements: boolean;
}): {
  elementsWithHints: Array<ElementWithHint>;
  allElementsWithHints: Array<ElementWithHint>;
  match:
    | { elementWithHint: ElementWithHint; autoActivated: boolean }
    | undefined;
  updates: Array<HintUpdate>;
  words: Array<string>;
} {
  const hasEnteredText = enteredText !== "";
  const hasEnteredTextOnly = hasEnteredText && enteredChars === "";
  const words = splitEnteredText(enteredText);

  // Filter away elements/hints not matching by text.
  const [matching, nonMatching] = partition(
    passedElementsWithHints,
    (element) => matchesText(element.text, words)
  );

  // Update the hints after the above filtering.
  const elementsWithHintsAndMaybeHidden = assignHints(matching, {
    mode,
    chars,
    hasEnteredText,
  });

  // Filter away elements that have become hidden _after_ assigning hints, so
  // that the hints stay the same.
  const elementsWithHints = elementsWithHintsAndMaybeHidden.filter(
    (element) => !element.hidden
  );

  // Find which hints to highlight (if any), and which to activate (if
  // any). This depends on whether only text chars have been entered, if
  // auto activation is enabled, if the Enter key is pressed and if hint
  // chars have been entered.
  const allHints = elementsWithHints
    .map((element) => element.hint)
    .filter((hint) => hint.startsWith(enteredChars));
  const matchingHints = allHints.filter((hint) => hint === enteredChars);
  const autoActivate = hasEnteredTextOnly && autoActivateOption;
  const matchingHintsSet = autoActivate
    ? new Set(allHints)
    : new Set(matchingHints);
  const matchedHint =
    matchingHintsSet.size === 1 ? Array.from(matchingHintsSet)[0] : undefined;
  const highlightedHint = hasEnteredText ? allHints[0] : undefined;
  const match = elementsWithHints.find(
    (element) =>
      element.hint === matchedHint ||
      (matchHighlighted && element.hint === highlightedHint)
  );

  const highlightedKeys = new Set(
    highlighted.map(({ element }) => elementKey(element))
  );

  const updates: Array<HintUpdate> = elementsWithHintsAndMaybeHidden
    .map((element, index): HintUpdate => {
      const matches = element.hint.startsWith(enteredChars);
      const isHighlighted =
        (match !== undefined && element.hint === match.hint) ||
        element.hint === highlightedHint ||
        highlightedKeys.has(elementKey(element));

      return updateMeasurements
        ? {
            // Update the position of the hint.
            type: "UpdatePosition",
            index: element.index,
            order: index,
            hint: element.hint,
            hintMeasurements: element.hintMeasurements,
            highlighted: isHighlighted,
            hidden: element.hidden || !matches,
          }
        : matches && (match === undefined || isHighlighted)
        ? {
            // Update the hint (which can change based on text filtering),
            // which part of the hint has been matched and whether it
            // should be marked as highlighted/matched.
            type: "UpdateContent",
            index: element.index,
            order: index,
            matchedChars: enteredChars,
            restChars: element.hint.slice(enteredChars.length),
            highlighted: isHighlighted,
            hidden: element.hidden,
          }
        : {
            // Hide hints that don’t match the entered hint chars.
            type: "Hide",
            index: element.index,
            hidden: true,
          };
    })
    .concat(
      nonMatching.map((element) => ({
        // Hide hints for elements filtered by text.
        type: "Hide",
        index: element.index,
        hidden: true,
      }))
    );

  const allElementsWithHints =
    elementsWithHintsAndMaybeHidden.concat(nonMatching);

  return {
    elementsWithHints,
    allElementsWithHints,
    match:
      match === undefined
        ? undefined
        : {
            elementWithHint: match,
            autoActivated: autoActivate,
          },
    updates,
    words,
  };
}

function mergeElements(
  elementsWithHints: Array<ElementWithHint>,
  updates: Array<ElementReport>,
  frameId: number
): Array<ElementWithHint> {
  const updateMap = new Map<number, ElementReport>(
    updates.map((update) => [update.index, update])
  );

  return elementsWithHints.map((element) => {
    if (element.frame.id !== frameId) {
      return element;
    }

    const update = updateMap.get(element.frame.index);

    if (update === undefined) {
      return { ...element, hidden: true };
    }

    return {
      type: update.type,
      index: element.index,
      hintMeasurements: {
        ...update.hintMeasurements,
        // Keep the original weight so that hints don't change.
        weight: element.hintMeasurements.weight,
      },
      url: update.url,
      urlWithTarget: update.urlWithTarget,
      text: update.text,
      textContent: update.textContent,
      // Keep the original text weight so that hints don't change.
      textWeight: element.textWeight,
      isTextInput: update.isTextInput,
      hasClickListener: update.hasClickListener,
      frame: element.frame,
      hidden: false,
      weight: element.weight,
      hint: element.hint,
    };
  });
}

function matchesText(passedText: string, words: Array<string>): boolean {
  const text = passedText.toLowerCase();
  return words.every((word) => text.includes(word));
}
