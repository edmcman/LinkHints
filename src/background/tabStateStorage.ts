import { log } from "../shared/main";

const PREFIX = "tabState:";

type Storage = {
  get: (keys: null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
  remove: (key: string) => Promise<void>;
};

// Chrome's session storage survives service worker termination but is cleared
// on browser restart. Firefox uses a persistent background page instead.
function storage(): Storage | undefined {
  return (
    globalThis as unknown as { chrome?: { storage?: { session?: Storage } } }
  ).chrome?.storage?.session;
}

const pending = new Map<number, Promise<void>>();

function write(
  tabId: number,
  operation: (area: Storage) => Promise<void>
): void {
  const area = storage();
  if (area === undefined) {
    return;
  }
  const previous = pending.get(tabId) ?? Promise.resolve();
  const next = previous
    .then(() => operation(area))
    .catch((error) => {
      log("error", "tabStateStorage: write failed", error);
    });
  pending.set(tabId, next);
  void next.then(() => {
    if (pending.get(tabId) === next) {
      pending.delete(tabId);
    }
  });
}

export async function restoreAllTabStates(): Promise<Record<string, unknown>> {
  const area = storage();
  if (area === undefined) {
    return {};
  }
  try {
    const entries = await area.get(null);
    return Object.fromEntries(
      Object.entries(entries)
        .filter(([key]) => key.startsWith(PREFIX))
        .map(([key, value]) => [key.slice(PREFIX.length), value])
    );
  } catch (error) {
    log("error", "tabStateStorage: read failed", error);
    return {};
  }
}

export function saveTabState(tabId: number, state: unknown): void {
  const snapshot = JSON.parse(JSON.stringify(state)) as unknown;
  write(tabId, (area) => area.set({ [`${PREFIX}${tabId}`]: snapshot }));
}

export function removeTabState(tabId: number): void {
  write(tabId, (area) => area.remove(`${PREFIX}${tabId}`));
}
