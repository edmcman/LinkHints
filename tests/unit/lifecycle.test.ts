import { expect, test } from "@playwright/test";

import type Renderer from "../../src/renderer/Program";
import type Worker from "../../src/worker/Program";

let finishMessage = (): void => undefined;
let connections = 0;
const event = { addListener: () => undefined, removeListener: () => undefined };
Object.assign(globalThis, {
  META_SLUG: "link_hints",
  BUILD_ID: "test",
  PROD: true,
  BROWSER: "chrome",
  DEFAULT_LOG_LEVEL_CONFIG: "warn",
  COLOR_YELLOW: "yellow",
  COLOR_GREEN: "green",
  COLOR_PURPLE: "purple",
  browser: {
    runtime: {
      onMessage: event,
      sendMessage: () =>
        new Promise<void>((resolve) => {
          finishMessage = resolve;
        }),
      connect: () => {
        connections += 1;
        return { onDisconnect: event, disconnect: () => undefined };
      },
      getManifest: () => ({}),
    },
    storage: { sync: { get: () => Promise.resolve({}) }, onChanged: event },
  },
  window: {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  },
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { default: WorkerProgram } =
  require("../../src/worker/Program") as typeof import("../../src/worker/Program");
const { default: RendererProgram } =
  require("../../src/renderer/Program") as typeof import("../../src/renderer/Program");
const { onInvalidated, Resets } =
  require("../../src/shared/main") as typeof import("../../src/shared/main");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

[WorkerProgram, RendererProgram].forEach((Program) => {
  test(`${Program.name} replaces reconnect checks and cancels them on stop`, () => {
    const originalConnect = browser.runtime.connect;
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    const timers = new Map<number, () => void>();
    let nextTimer = 0;
    let disconnect = (): void => undefined;
    let reconnects = 0;
    Object.assign(browser.runtime, {
      connect: () => {
        reconnects += 1;
        const port = {
          onDisconnect: {
            addListener: (callback: () => void) => {
              disconnect = callback;
            },
          },
          disconnect: () => {
            disconnect();
          },
        };
        return port;
      },
    });
    Object.assign(globalThis, {
      setTimeout: (callback: () => void) => {
        timers.set(++nextTimer, callback);
        return nextTimer;
      },
      clearTimeout: (id: number) => timers.delete(id),
    });
    try {
      const program = Object.assign(
        Object.create(Program.prototype) as Renderer & Worker,
        {
          running: true,
          lifecycleGeneration: 0,
          resets: new Resets(),
          elementManager: { stop: () => undefined },
          unrender: () => undefined,
          clearCurrent: () => undefined,
        }
      );
      program.connect();
      for (let cycle = 0; cycle < 20; cycle += 1) {
        disconnect();
        expect(timers.size).toBe(1);
        const [id, callback] = Array.from(timers)[0];
        timers.delete(id);
        callback();
        expect(program.resets._callbacks.length).toBeLessThanOrEqual(1);
      }
      expect(reconnects).toBe(21);
      const staleCallbacks = Array.from(timers.values());
      program.stop();
      expect(timers.size).toBe(0);
      staleCallbacks.forEach((callback) => {
        callback();
      });
      disconnect();
      expect(reconnects).toBe(21);
      expect(timers.size).toBe(0);
    } finally {
      browser.runtime.connect = originalConnect;
      globalThis.setTimeout = originalSetTimeout;
      globalThis.clearTimeout = originalClearTimeout;
    }
  });

  test(`${Program.name} does not connect after stopping during startup`, async () => {
    const program = Object.assign(
      Object.create(Program.prototype) as Renderer & Worker,
      {
        lifecycleGeneration: 0,
        running: false,
        resets: new Resets(),
        elementManager: {
          start: () => Promise.resolve(),
          stop: () => undefined,
        },
        addWindowListeners: () => undefined,
        markTutorial: () => undefined,
        unrender: () => undefined,
        removeStaleContainers: () => undefined,
        clearCurrent: () => undefined,
      }
    );
    const starting = program.start();
    await Promise.resolve();
    program.stop();
    const previousConnections = connections;
    finishMessage();
    await starting;
    program.connect();
    expect(connections).toBe(previousConnections);
  });
});

test("worker does not resume after stopping while the element manager starts", async () => {
  let finish = (): void => undefined;
  const program = Object.assign(
    Object.create(WorkerProgram.prototype) as Worker,
    {
      lifecycleGeneration: 0,
      running: false,
      resets: new Resets(),
      elementManager: {
        start: () =>
          new Promise<void>((resolve) => {
            finish = resolve;
          }),
        stop: () => undefined,
      },
      addWindowListeners: () => undefined,
      clearCurrent: () => undefined,
      markTutorial: () => {
        throw new Error("Startup resumed");
      },
    }
  );
  const starting = program.start();
  program.stop();
  finish();
  await starting;
});

test("stopping cancels pending reconnect checks", () => {
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  let callback = (): void => undefined;
  let cancelled = false;
  Object.assign(globalThis, {
    setTimeout: (fn: () => void) => {
      callback = fn;
      return 1;
    },
    clearTimeout: () => {
      cancelled = true;
    },
  });
  try {
    let reconnects = 0;
    const cancel = onInvalidated(
      () => undefined,
      () => {
        reconnects += 1;
      }
    );
    cancel();
    callback();
    expect(cancelled).toBe(true);
    expect(reconnects).toBe(0);
  } finally {
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
