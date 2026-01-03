import type {
  KeyboardModeBackground,
  KeyboardModeWorker,
} from "../shared/keyboard";
import type { Perf } from "../shared/perf";

// Minimal serializable tab state shape
export type SerializedTabState = {
  perf?: Perf;
  isOptionsPage?: boolean;
  isPinned?: boolean;
  keyboardMode?: KeyboardModeBackground | KeyboardModeWorker; // should already be a plain object
  timeDurations?: Array<[string, number]>;
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
    // Swallow — background should continue even if storage is inaccessible
    // Use `log` to be consistent with repo logging
    // Note: we import log lazily via a dynamic import to avoid cycles in some
    // environments where background modules might load differently.
    try {
      const { log } = await import("../shared/main");
      log("error", "restoreAllTabStates: failed to read storage", error);
    } catch {
      // Fallback
      // eslint-disable-next-line no-console
      console.error("restoreAllTabStates: failed to read storage", error);
    }
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
  const partial: Partial<MinimalTabState> = {};
  if (serial.perf !== undefined) {
    partial.perf = serial.perf;
  }
  if (serial.isOptionsPage !== undefined) {
    partial.isOptionsPage = serial.isOptionsPage;
  }
  if (serial.isPinned !== undefined) {
    partial.isPinned = serial.isPinned;
  }
  if (serial.keyboardMode !== undefined) {
    partial.keyboardMode = serial.keyboardMode;
  }
  return partial;
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
    try {
      const { log } = await import("../shared/main");
      log("error", "saveTabState: failed to write storage", error);
    } catch {
      // eslint-disable-next-line no-console
      console.error("saveTabState: failed to write storage", error);
    }
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
    try {
      const { log } = await import("../shared/main");
      log("error", "removeTabState: failed to modify storage", error);
    } catch {
      // eslint-disable-next-line no-console
      console.error("removeTabState: failed to modify storage", error);
    }
  }
}
