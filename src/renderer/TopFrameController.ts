/**
 * TopFrameController: Foundation for single-writer per-tab state ownership.
 *
 * This controller lives in the top-level frame and is designed to eventually
 * own the hinting lifecycle, timers, and element state for this tab. The
 * background script will become a minimal router/privileged-API caller.
 *
 * ## Current Status (MV3 Migration Phase 1)
 *
 * ✅ COMPLETE:
 * - State tracking: Infers hinting state from existing ToRenderer messages
 * - UI state: Tracks peeking and status text
 * - Direct channel: Receives hot messages from top-frame worker
 * - Text rects: Renders text rects via direct channel (bypasses background)
 *
 * ⏳ TODO (Future migration steps):
 * - Multi-frame coordination: Currently background owns pendingFrames tracking
 * - Element state: Background owns elementsWithHints and hint assignment
 * - Timers: Background owns setTimeout/onTimeout for updates and highlighting
 * - Hint input handling: Background processes keystrokes and hint matching
 *
 * ## Why not fully migrated?
 *
 * The background's HintsState contains complex multi-frame coordination:
 * - `pendingFrames.answering` / `pendingFrames.collecting` track iframe responses
 * - Element aggregation from multiple frames happens in background
 * - Hint assignment (assignHints) requires all elements from all frames
 *
 * Moving this requires either:
 * 1. Implementing frame coordination in top-frame (complex, needs iframe comms)
 * 2. Keeping background as coordinator but making it stateless (send state back)
 *
 * For MV3, the current implementation is sufficient because:
 * - Service worker can restart; renderer tracks enough state to recover
 * - Direct channel reduces latency for hot paths
 * - Background can rebuild tabState on restart from renderer's tracked state
 */

import {
  DirectMessage,
  isTopFrame,
  listenForWorkerMessages,
} from "../shared/DirectChannel";
import { log } from "../shared/main";
import type { ToRenderer } from "../shared/messages";

/** Hinting lifecycle state (mirrors background's HintsState.type). */
export type HintingState =
  | { type: "Idle" }
  | { type: "Collecting" }
  | { type: "Hinting" };

/**
 * Simple UI state owned by the renderer.
 */
export type UIState = {
  peeking: boolean;
  statusText: string;
};

export default class TopFrameController {
  /** Current hinting lifecycle state (inferred from messages). */
  hintingState: HintingState = { type: "Idle" };

  /** UI state for peek mode and status display. */
  uiState: UIState = {
    peeking: false,
    statusText: "",
  };

  /** Cleanup function for direct channel listener. */
  private directChannelCleanup: (() => void) | undefined = undefined;

  /** Callback to notify RendererProgram of direct messages. */
  private onDirectMessageCallback:
    | ((message: DirectMessage) => void)
    | undefined = undefined;

  /**
   * Start the controller. Called from RendererProgram.start().
   */
  start(): void {
    log("log", "TopFrameController#start");

    // Set up direct channel listener (only works in top frame)
    if (isTopFrame()) {
      this.directChannelCleanup = listenForWorkerMessages(
        this.onDirectMessage.bind(this)
      );
    }
  }

  /**
   * Stop the controller and clean up. Called from RendererProgram.stop().
   */
  stop(): void {
    log("log", "TopFrameController#stop");
    this.hintingState = { type: "Idle" };
    this.uiState = { peeking: false, statusText: "" };
    this.directChannelCleanup?.();
    this.directChannelCleanup = undefined;
  }

  /**
   * Set a callback for direct messages from worker.
   * The RendererProgram uses this to forward messages that need UI updates.
   */
  setDirectMessageCallback(callback: (message: DirectMessage) => void): void {
    this.onDirectMessageCallback = callback;
  }

  /**
   * Handle direct messages from worker (fast path, same-frame only).
   */
  private onDirectMessage(message: DirectMessage): void {
    log("log", "TopFrameController#onDirectMessage", message.type);

    // Track elements locally (placeholder for future full ownership)
    if (message.type === "ReportUpdatedElements") {
      // Currently just log; will implement full element tracking later
      log(
        "log",
        "TopFrameController: received direct ReportUpdatedElements",
        message.elements.length,
        "elements"
      );
    }

    // Forward to RendererProgram if callback is set
    this.onDirectMessageCallback?.(message);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // State tracking from existing messages (no background changes needed)
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Process a ToRenderer message and update local state accordingly.
   * Called from RendererProgram.onMessage() for each incoming message.
   */
  onRendererMessage(message: ToRenderer): void {
    switch (message.type) {
      case "Render":
        // Receiving Render means we're now in Hinting state
        this.hintingState = { type: "Hinting" };
        log("log", "TopFrameController: state -> Hinting");
        break;

      case "Unrender":
        // Receiving Unrender means we're back to Idle
        this.hintingState = { type: "Idle" };
        this.uiState.peeking = false;
        this.uiState.statusText = "";
        log("log", "TopFrameController: state -> Idle");
        break;

      case "UpdateHints":
        // Still hinting, update status text
        this.uiState.statusText = message.enteredText;
        break;

      case "Peek":
        this.uiState.peeking = true;
        break;

      case "Unpeek":
        this.uiState.peeking = false;
        break;

      // StateSync, RenderTextRects, RotateHints, RemoveShruggie don't change
      // hinting lifecycle state.
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Placeholder methods for future migration
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Request to start hints mode. Currently a placeholder.
   */
  startHinting(): void {
    log("log", "TopFrameController#startHinting (placeholder)");
    // TODO: Implement local hinting lifecycle
  }

  /**
   * Request to stop hints mode. Currently a placeholder.
   */
  stopHinting(): void {
    log("log", "TopFrameController#stopHinting (placeholder)");
    // TODO: Implement local hinting lifecycle
  }

  /**
   * Handle element updates from workers. Currently a placeholder.
   */
  applyUpdateElements(_elements: unknown): void {
    log(
      "log",
      "TopFrameController#applyUpdateElements (placeholder)",
      _elements
    );
    // TODO: Implement local element state management
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Accessors for current state
  // ──────────────────────────────────────────────────────────────────────────

  /** Returns true if currently showing hints. */
  isHinting(): boolean {
    return this.hintingState.type === "Hinting";
  }

  /** Returns true if currently collecting elements. */
  isCollecting(): boolean {
    return this.hintingState.type === "Collecting";
  }

  /** Returns true if idle (not hinting or collecting). */
  isIdle(): boolean {
    return this.hintingState.type === "Idle";
  }
}
