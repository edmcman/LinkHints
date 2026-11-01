import { expect, test } from "@playwright/test";

class Observer {
  observing = false;

  observe(): void {
    this.observing = true;
  }

  disconnect(): void {
    this.observing = false;
  }
}

Object.assign(globalThis, {
  META_SLUG: "link_hints",
  BUILD_ID: "test",
  BROWSER: "chrome",
  PROD: false,
  DEFAULT_LOG_LEVEL_CONFIG: "log",
  MutationObserver: Observer,
  IntersectionObserver: Observer,
  browser: {
    storage: {
      sync: { get: () => Promise.resolve({}) },
      onChanged: {
        addListener: () => undefined,
        removeListener: () => undefined,
      },
    },
  },
});

/* eslint-disable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */
const { default: ElementManager } =
  require("../../src/worker/ElementManager") as typeof import("../../src/worker/ElementManager");
/* eslint-enable @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports */

test("stop disconnects shadow root observers, including reactivated roots", () => {
  const manager = new ElementManager({
    onMutation: () => undefined,
    onDocumentWrite: () => undefined,
  });
  manager.sendInjectedEvent = () => undefined;
  const shadowRoot = { host: {}, childNodes: [] } as unknown as ShadowRoot;
  manager.setShadowRoot(shadowRoot);
  const first = manager.shadowRoots.get(shadowRoot.host);
  if (first === undefined) {
    throw new Error("Missing shadow root");
  }
  manager.deactivateShadowRoot(first);
  expect((first.mutationObserver as unknown as Observer).observing).toBe(false);
  manager.setShadowRoot(shadowRoot);
  const second = manager.shadowRoots.get(shadowRoot.host);
  expect((second?.mutationObserver as unknown as Observer).observing).toBe(
    true
  );
  manager.stop();
  expect((second?.mutationObserver as unknown as Observer).observing).toBe(
    false
  );
  expect(manager.activeShadowRoots.size).toBe(0);
});

test("stop cancels startup observation and deferred document-write listeners", async () => {
  const manager = new ElementManager({
    onMutation: () => undefined,
    onDocumentWrite: () => {
      throw new Error("Reinstalled worker listeners");
    },
  });
  let listeners = 0;
  manager.addWindowListeners = () => {
    listeners += 1;
  };
  manager.injectScript = () => undefined;
  manager.configureInjected = () => undefined;
  manager.sendInjectedEvent = () => undefined;
  const starting = manager.start();
  manager.onDocumentWrite();
  manager.stop();
  await starting;
  await Promise.resolve();
  expect(listeners).toBe(1);
  expect((manager.mutationObserver as unknown as Observer).observing).toBe(
    false
  );
});

test("a disconnected addition can be revisited after connecting in the same idle queue", () => {
  class Element {
    isConnected = false;

    querySelectorAll(): Array<never> {
      return [];
    }
  }
  const previous = globalThis.HTMLElement;
  Object.assign(globalThis, { HTMLElement: Element });
  try {
    const manager = new ElementManager({
      onMutation: () => undefined,
      onDocumentWrite: () => undefined,
    });
    manager.requestIdleCallback = () => undefined;
    const visits: Array<boolean> = [];
    manager.addOrRemoveElement = (_type, element) => {
      visits.push(element.isConnected);
    };
    const element = new Element();
    const records = [
      {
        addedNodes: [element as unknown as Node],
        removedNodes: [],
        attributeName: null,
        target: element as unknown as Node,
      },
    ];
    manager.queueRecords(records);
    manager.flushQueue({ timeRemaining: () => 0 });
    element.isConnected = true;
    manager.queueRecords(records);
    manager.flushQueue({ timeRemaining: () => Infinity });
    expect(visits).toEqual([false, true]);
  } finally {
    globalThis.HTMLElement = previous;
  }
});
