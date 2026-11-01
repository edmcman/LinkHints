import { expect, test } from "@playwright/test";

import type { FromWorker } from "../../src/shared/messages";

const store: Record<string, unknown> = {};
let beforeWrite = (): Promise<void> => Promise.resolve();
Object.assign(globalThis, {
  META_SLUG: "link_hints",
  PROD: true,
  BROWSER: "chrome",
  DEFAULT_LOG_LEVEL_CONFIG: "warn",
  browser: {
    runtime: { getPlatformInfo: () => Promise.resolve({ os: "linux" }) },
    storage: {
      sync: {
        get: () => Promise.resolve({ ...store }),
        remove: async (keys: Array<string>) => {
          await beforeWrite();
          keys.forEach((key) => delete store[key]);
        },
        set: (values: Record<string, unknown>) =>
          Promise.resolve(Object.assign(store, values)),
        clear: () => {
          Object.keys(store).forEach((key) => delete store[key]);
          return Promise.resolve();
        },
      },
      onChanged: { addListener: () => undefined },
    },
  },
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { default: BackgroundProgram } =
  require("../../src/background/Program") as typeof import("../../src/background/Program");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

test.beforeEach(() => {
  Object.keys(store).forEach((key) => delete store[key]);
  beforeWrite = () => Promise.resolve();
});

test("overlapping saves merge after the preceding write finishes", async () => {
  const program = new BackgroundProgram();
  let release = (): void => undefined;
  let writing = false;
  beforeWrite = () =>
    new Promise<void>((resolve) => {
      release = resolve;
      writing = true;
    });
  const first = program.saveOptions({ css: "a{}" });
  const second = program.saveOptions({ autoActivate: false });
  await expect.poll(() => writing).toBe(true);
  beforeWrite = () => Promise.resolve();
  release();
  await Promise.all([first, second]);
  expect(program.options.values.css).toBe("a{}");
  expect(program.options.values.autoActivate).toBe(false);
});

test("save and reset follow request order and recover after a failed write", async () => {
  const program = new BackgroundProgram();
  await Promise.all([
    program.saveOptions({ css: "a{}" }),
    program.resetOptions(),
    program.saveOptions({ autoActivate: false }),
  ]);
  expect(program.options.values.css).toBe("");
  expect(program.options.values.autoActivate).toBe(false);
  beforeWrite = () => Promise.reject(new Error("write failed"));
  await program.saveOptions({ css: "b{}" });
  expect(program.options.errors).toEqual(["write failed"]);
  beforeWrite = () => Promise.resolve();
  await program.saveOptions({ css: "c{}" });
  expect(program.options.values.css).toBe("c{}");
  expect(program.options.errors).toEqual([]);
});

test("removed collecting frames settle once and replaced ports cannot settle them", () => {
  const program = new BackgroundProgram();
  program.ready = true;
  program.sendWorkerMessage = () => undefined;
  program.updateBadge = () => undefined;
  program.setTimeout = () => undefined;
  program.checkpoint = () => undefined;
  program.hideElements = () => undefined;
  const state = {
    hintsState: { type: "Idle", highlighted: [] },
  } as unknown as ReturnType<typeof program.tabState.get>;
  if (state === undefined) {
    throw new Error("Missing state");
  }
  program.tabState.set(1, state);
  program.enterHintsMode({ tabId: 1, timestamp: 0, mode: "Click" });
  const info = { tabId: 1, frameId: 2, url: undefined };
  const message = { type: "ReportVisibleFrame" } as const;
  program.onWorkerMessage(message, info, state);
  program.onWorkerMessage(message, info, state);
  if (state.hintsState.type !== "Collecting") {
    throw new Error("Not collecting");
  }
  const pending = state.hintsState.pendingElements;
  const reportedInfo = { ...info, frameId: 3 };
  program.onWorkerMessage(message, reportedInfo, state);
  const report: FromWorker = {
    type: "ReportVisibleElements",
    numFrames: 0,
    stats: {
      url: "",
      numTotalElements: 1,
      numTrackedElements: 1,
      numVisibleFrames: 0,
      durations: [],
    },
    elements: [
      {
        type: "link",
        index: 0,
        hintMeasurements: {
          x: 0,
          y: 0,
          maxX: 1,
          weight: 1,
          align: "left",
          debug: "",
        },
        url: undefined,
        urlWithTarget: undefined,
        text: "Link",
        textContent: true,
        textWeight: 1,
        isTextInput: false,
        hasClickListener: false,
      },
    ],
  };
  program.onWorkerMessage(report, reportedInfo, state);
  program.onWorkerMessage(report, reportedInfo, state);
  program.onWorkerMessage(message, reportedInfo, state);
  expect(pending.pendingFrames.collecting).toBe(2);
  expect(pending.elements).toHaveLength(1);
  let disconnect = (): void => undefined;
  const port = (frameId = 2): browser.runtime.Port =>
    ({
      name: "worker",
      sender: { tab: { id: 1 }, frameId },
      onDisconnect: {
        addListener: (fn: () => void) => {
          disconnect = fn;
        },
      },
    } as unknown as browser.runtime.Port);
  program.onConnect(port(3));
  disconnect();
  expect(pending.elements).toHaveLength(0);
  expect(pending.pendingFrames.collecting).toBe(2);
  program.onConnect(port());
  const stale = disconnect;
  program.onConnect(port());
  stale();
  expect(pending.pendingFrames.collecting).toBe(2);
  let finishes = 0;
  program.maybeStartHinting = () => {
    finishes += 1;
  };
  disconnect();
  disconnect();
  program.onWorkerMessage(message, info, state);
  expect(pending.pendingFrames.collecting).toBe(1);
  expect(finishes).toBe(1);
});

test("saves merge current sync storage, including newly added and deleted values", async () => {
  const program = new BackgroundProgram();
  await program.saveOptions({ autoActivate: false });
  store.css = "synced{}";
  delete store.autoActivate;
  await program.saveOptions({ overTypingDuration: 900 });
  expect(program.options.values.css).toBe("synced{}");
  expect(program.options.values.autoActivate).toBe(true);
  expect(program.options.values.overTypingDuration).toBe(900);
});

test("a save can repair an invalid synced value without losing other synced options", async () => {
  const program = new BackgroundProgram();
  store.chars = "";
  store.css = "synced{}";
  await program.saveOptions({ chars: "ab" });
  expect(program.options.errors).toEqual([]);
  expect(program.options.values.chars).toBe("ab");
  expect(program.options.values.css).toBe("synced{}");
});

test("frame tokens belong to their tab and new frames reuse that tab's token", () => {
  const program = new BackgroundProgram();
  const state: Parameters<typeof program.makeWorkerState>[0] = {
    hintsState: { type: "Idle", highlighted: [] },
    keyboardMode: { type: "FromHintsState" },
    perf: [],
    isOptionsPage: false,
    isPinned: false,
  };
  const other = { ...state };
  const first = program.makeWorkerState(state);
  program.makeWorkerState(other);
  const added = program.makeWorkerState(state, { refreshToken: false });
  expect(added).toEqual(first);
  program.makeWorkerState(other);
  expect(program.makeWorkerState(state, { refreshToken: false })).toEqual(
    first
  );
  expect(program.makeWorkerState(state)).not.toEqual(first);
});

test("a malformed saved tab cannot prevent startup or other tab restoration", async () => {
  const program = new BackgroundProgram();
  const savedState = {
    hintsState: { type: "Idle", highlighted: [] },
    keyboardMode: { type: "Capture" },
    perf: [],
    isOptionsPage: false,
    isPinned: false,
  };
  const browserBefore = { ...browser };
  const chromeBefore = (globalThis as { chrome?: unknown }).chrome;
  const removed: Array<string> = [];
  Object.assign(globalThis, {
    chrome: {
      storage: {
        session: {
          get: () =>
            Promise.resolve({
              "tabState:1": {
                ...savedState,
                hintsState: { type: "Idle", highlighted: [null] },
              },
              "tabState:2": savedState,
            }),
          remove: (key: string) => {
            removed.push(key);
            return Promise.resolve();
          },
        },
      },
    },
    COLOR_BADGE: "yellow",
  });
  Object.assign(browser, {
    tabs: {
      query: () =>
        Promise.resolve([
          { id: 1, pinned: false },
          { id: 2, pinned: true },
        ]),
      get: () => Promise.resolve({ pinned: false }),
    },
    action: { setBadgeBackgroundColor: () => Promise.resolve() },
  });
  program.updateOptions = () => Promise.resolve();
  program.updateIcon = () => Promise.resolve();
  program.maybeOpenTutorial = () => Promise.resolve();
  program.maybeReopenOptions = () => Promise.resolve();
  program.sendWorkerMessage = () => undefined;
  const unrendered: Array<number> = [];
  program.sendRendererMessage = (message, { tabId }) => {
    if (message.type === "Unrender") {
      unrendered.push(tabId);
    }
  };
  program.setTimeout = () => undefined;
  program.checkpoint = () => undefined;
  let handled = false;
  program.whenReady(() => {
    handled = true;
  });
  try {
    await program.start();
    expect(program.ready).toBe(true);
    expect(handled).toBe(true);
    expect(program.tabState.get(1)?.hintsState).toEqual({
      type: "Idle",
      highlighted: [],
    });
    expect(program.tabState.get(2)?.keyboardMode).toEqual({ type: "Capture" });
    expect(program.tabState.get(2)?.isPinned).toBe(true);
    expect(unrendered).toEqual([1]);
    expect(removed).toEqual(["tabState:1"]);
  } finally {
    Object.assign(browser, browserBefore);
    Object.assign(globalThis, { chrome: chromeBefore });
  }
});
