import type {
  KeyboardModeBackground,
  KeyboardModeWorker,
} from "../shared/keyboard";
import { log } from "../shared/main";
import type { Perf } from "../shared/perf";

// Minimal serializable tab state shape
export type SerializedTabState = {
  perf?: Perf;
  isOptionsPage?: boolean;
  isPinned?: boolean;
  keyboardMode?: KeyboardModeBackground | KeyboardModeWorker; // should already be a plain object
};

type MinimalTabState = {
  perf?: Perf;
  isOptionsPage?: boolean;
  isPinned?: boolean;
  keyboardMode?: KeyboardModeBackground | KeyboardModeWorker;
};

const STORAGE_KEY = "tabStates";

export async function restoreAllTabStates(): Promise<
  Record<string, SerializedTabState>
> {
  try {
    const stored = (await browser.storage.local.get(STORAGE_KEY)) as
      | Record<string, unknown>
      | undefined;
    const tabStates =
      stored !== undefined && stored !== null ? stored[STORAGE_KEY] : undefined;
    if (tabStates !== undefined && typeof tabStates === "object") {
      return tabStates as Record<string, SerializedTabState>;
    }
  } catch (error) {
    // If reading fails, keep going without restored data.
    log("error", "restoreAllTabStates: failed to read storage", error);
  }
  return {};
}

export function serializeTabState(
  _tabId: number,
  ts: MinimalTabState
): SerializedTabState {
  return {
    perf: ts.perf,
    isOptionsPage: ts.isOptionsPage,
    isPinned: ts.isPinned,
    keyboardMode: ts.keyboardMode,
    // We do not serialize the TimeTracker instance itself. If callers want
    // durations they must export them explicitly.
  };
}

export function deserializeTabState(
  serial: SerializedTabState
): Partial<MinimalTabState> {
  return serial;
}

export async function saveTabState(
  tabId: number,
  serial: SerializedTabState
): Promise<void> {
  try {
    const key = STORAGE_KEY;
    const stored = (await browser.storage.local.get(key)) as
      | Record<string, unknown>
      | undefined;
    const maybeMap =
      stored !== undefined && stored !== null ? stored[key] : undefined;
    const map = maybeMap as Record<string, SerializedTabState> | undefined;
    const next =
      map === undefined
        ? { [String(tabId)]: serial }
        : { ...map, [String(tabId)]: serial };
    await browser.storage.local.set({ [key]: next });
  } catch (error) {
    log("error", "saveTabState: failed to write storage", error);
  }
}

export async function removeTabState(tabId: number): Promise<void> {
  try {
    const key = STORAGE_KEY;
    const stored = (await browser.storage.local.get(key)) as
      | Record<string, unknown>
      | undefined;
    const maybeMap =
      stored !== undefined && stored !== null ? stored[key] : undefined;
    const map = maybeMap as Record<string, SerializedTabState> | undefined;
    if (map === undefined) {
      return;
    }
    const next = { ...map };
    delete next[String(tabId)];
    await browser.storage.local.set({ [key]: next });
  } catch (error) {
    log("error", "removeTabState: failed to modify storage", error);
  }
}
