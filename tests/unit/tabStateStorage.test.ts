import { expect, test } from "@playwright/test";

// Define build-time globals for the test environment
// This happens because this test imports directly from the source code, which is kind of a hack.
Object.assign(globalThis as unknown as Record<string, unknown>, {
  META_SLUG: "link_hints",
  PROD: false,
  DEFAULT_LOG_LEVEL_CONFIG: "log",
});

// Require the module after setting globals so top-level evaluation sees them
/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const mod =
  require("../../src/background/tabStateStorage") as unknown as typeof import("../../src/background/tabStateStorage");
const {
  deserializeTabState,
  removeTabState,
  restoreAllTabStates,
  saveTabState,
  serializeTabState,
} = mod;
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

// Type-only import for TS types
import type { SerializedTabState } from "../../src/background/tabStateStorage";

type BrowserMock = {
  storage: {
    local: {
      get: (
        key: string
      ) => Promise<
        Record<string, unknown> | { [k: string]: unknown } | undefined
      >;
      set: (obj: Record<string, unknown>) => Promise<void>;
    };
  };
};

// Helper to mock browser.storage.local
function mockBrowserStorage(): Record<string, unknown> {
  const store: Record<string, unknown> = {};

  (globalThis as unknown as { browser?: BrowserMock }).browser = {
    storage: {
      local: {
        async get(key: string) {
          if (typeof key === "string") {
            return Promise.resolve({ [key]: store[key] });
          }
          return Promise.resolve(store);
        },
        async set(obj: Record<string, unknown>) {
          Object.assign(store, obj);
          return Promise.resolve();
        },
      },
    },
  };
  return store;
}

test("serialize/deserialize round-trip", () => {
  const serial: SerializedTabState = {
    perf: [
      {
        timeToFirstPaint: 10,
        timeToLastPaint: 20,
        topDurations: [],
        collectStats: [],
        renderDurations: [],
      },
    ],
    isOptionsPage: true,
    isPinned: false,
    keyboardMode: { type: "Capture" as const },
  };

  const partial = deserializeTabState(serial);
  expect(partial.perf).toEqual(serial.perf);
  expect(partial.isOptionsPage).toBe(true);
  expect(partial.isPinned).toBe(false);

  const pkm = partial.keyboardMode as unknown as { type: string };
  expect(pkm.type).toBe("Capture");

  // Verify serialize produces the expected serializable form. Cast to a
  // minimal compatible shape (no `any`).
  type MinimalLike = {
    perf?: SerializedTabState["perf"];
    isOptionsPage?: boolean;
    isPinned?: boolean;
    keyboardMode?: SerializedTabState["keyboardMode"];
  };
  const out = serializeTabState(42, serial as unknown as MinimalLike);
  expect(out.perf).toEqual(serial.perf);
  expect(out.isOptionsPage).toBe(true);
  expect(out.isPinned).toBe(false);
  const okm = out.keyboardMode as unknown as { type: string };
  expect(okm.type).toBe("Capture");
});

test("save/restore/remove tab state via storage", async () => {
  mockBrowserStorage();

  const serial: SerializedTabState = {
    perf: [],
    isOptionsPage: false,
    isPinned: true,
    keyboardMode: { type: "Capture" as const },
  };

  await saveTabState(7, serial);

  const all = await restoreAllTabStates();
  expect(all["7"]).toBeDefined();
  expect(all["7"].isPinned).toBe(true);

  // Remove and verify
  await removeTabState(7);
  const all2 = await restoreAllTabStates();
  expect(all2["7"]).toBeUndefined();
});
