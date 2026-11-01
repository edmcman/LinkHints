import { expect, test } from "@playwright/test";

Object.assign(globalThis, {
  META_SLUG: "link_hints",
  PROD: false,
  DEFAULT_LOG_LEVEL_CONFIG: "log",
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { removeTabState, restoreAllTabStates, saveTabState } =
  require("../../src/background/tabStateStorage") as typeof import("../../src/background/tabStateStorage");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

test("unavailable session storage does not serialize checkpoints", () => {
  Object.assign(globalThis, { chrome: undefined });
  saveTabState(1, {
    toJSON() {
      throw new Error("Unexpected serialization");
    },
  });
});

test("independent checkpoints preserve snapshots and ordered removal", async () => {
  const store: Record<string, unknown> = {};
  Object.assign(globalThis, {
    chrome: {
      storage: {
        session: {
          async get() {
            await Promise.resolve();
            return { ...store };
          },
          async set(items: Record<string, unknown>) {
            await new Promise((resolve) => {
              setTimeout(resolve, 5);
            });
            Object.assign(store, items);
          },
          async remove(key: string) {
            delete store[key];
            await Promise.resolve();
          },
        },
      },
    },
  });

  const first = { input: "a" };
  saveTabState(1, first);
  saveTabState(3, first);
  first.input = "changed";
  saveTabState(2, { input: "b" });
  saveTabState(1, { input: "c" });
  removeTabState(1);
  await expect
    .poll(() => Object.keys(store).sort())
    .toEqual(["tabState:2", "tabState:3"]);
  expect(await restoreAllTabStates()).toEqual({
    "2": { input: "b" },
    "3": { input: "a" },
  });
});
