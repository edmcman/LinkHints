/**
 * DirectChannel: Fast same-frame communication between worker and renderer.
 *
 * ## Purpose
 *
 * In the top frame, both WorkerProgram and RendererProgram run as content
 * scripts. This module provides a fast path for hot messages that bypasses
 * background script routing, reducing latency for time-sensitive operations.
 *
 * ## How it works
 *
 * Uses CustomEvents on the document, which is fast and works because both
 * scripts run in the same content script isolated world context.
 *
 * ## Current usage (MV3 Migration Phase 1)
 *
 * - ReportTextRects: Worker sends text rects directly to renderer for display
 * - ReportUpdatedElements: Worker sends to both direct channel AND background
 *   (background still coordinates multi-frame state)
 *
 * ## Why both direct and background?
 *
 * During migration, messages are sent both ways:
 * 1. Direct channel: Low latency path for renderer to act immediately
 * 2. Background: Still needed for multi-frame coordination and state management
 *
 * Once renderer fully owns state, background routing can be removed for these
 * hot paths in the top frame.
 *
 * ## Limitations
 *
 * - Only works in top frame (isTopFrame() check)
 * - Cannot communicate with iframe workers (they still route via background)
 * - Requires both worker and renderer to be loaded (race at startup)
 */

import { log } from "../shared/main";

/** Event name for worker→renderer messages. */
const WORKER_TO_RENDERER_EVENT = "__LinkHints_WorkerToRenderer__";

/** Event name for renderer→worker messages (if needed in future). */
const RENDERER_TO_WORKER_EVENT = "__LinkHints_RendererToWorker__";

/** Message types that can be sent directly (hot paths). */
export type DirectMessage =
  | {
      type: "ReportTextRects";
      rects: Array<{ x: number; y: number; width: number; height: number }>;
    }
  | {
      type: "ReportUpdatedElements";
      elements: Array<unknown>;
      rects: Array<{ x: number; y: number; width: number; height: number }>;
    };

/**
 * Check if we're in the top frame (where direct channel can be used).
 */
export function isTopFrame(): boolean {
  try {
    return window === window.top;
  } catch {
    // Cross-origin frame, not top frame
    return false;
  }
}

/**
 * Send a message from worker to renderer via direct channel.
 * Returns true if sent, false if not in top frame.
 */
export function sendWorkerToRenderer(message: DirectMessage): boolean {
  if (!isTopFrame()) {
    return false;
  }

  log("log", "DirectChannel: worker→renderer", message.type);
  const event = new CustomEvent(WORKER_TO_RENDERER_EVENT, {
    detail: message,
  });
  document.dispatchEvent(event);
  return true;
}

/**
 * Listen for messages from worker (called by renderer).
 * Returns a cleanup function.
 */
export function listenForWorkerMessages(
  handler: (message: DirectMessage) => void
): () => void {
  if (!isTopFrame()) {
    return () => {
      /* no-op */
    };
  }

  const listener = (event: Event): void => {
    const customEvent = event as CustomEvent<DirectMessage>;
    log("log", "DirectChannel: received", customEvent.detail.type);
    handler(customEvent.detail);
  };

  document.addEventListener(WORKER_TO_RENDERER_EVENT, listener);
  log("log", "DirectChannel: renderer listening");

  return () => {
    document.removeEventListener(WORKER_TO_RENDERER_EVENT, listener);
    log("log", "DirectChannel: renderer stopped listening");
  };
}

/**
 * Send a message from renderer to worker via direct channel.
 * Returns true if sent, false if not in top frame.
 */
export function sendRendererToWorker(message: unknown): boolean {
  if (!isTopFrame()) {
    return false;
  }

  log("log", "DirectChannel: renderer→worker", message);
  const event = new CustomEvent(RENDERER_TO_WORKER_EVENT, {
    detail: message,
  });
  document.dispatchEvent(event);
  return true;
}

/**
 * Listen for messages from renderer (called by worker).
 * Returns a cleanup function.
 */
export function listenForRendererMessages(
  handler: (message: unknown) => void
): () => void {
  if (!isTopFrame()) {
    return () => {
      /* no-op */
    };
  }

  const listener = (event: Event): void => {
    const customEvent = event as CustomEvent<unknown>;
    log("log", "DirectChannel: worker received", customEvent.detail);
    handler(customEvent.detail);
  };

  document.addEventListener(RENDERER_TO_WORKER_EVENT, listener);
  log("log", "DirectChannel: worker listening");

  return () => {
    document.removeEventListener(RENDERER_TO_WORKER_EVENT, listener);
    log("log", "DirectChannel: worker stopped listening");
  };
}
