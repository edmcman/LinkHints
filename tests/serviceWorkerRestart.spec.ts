import { createServer, ServerResponse } from "http";
import type { AddressInfo } from "net";
import type { BrowserContext, Page, Worker } from "playwright";

import { activateHints, expect, test } from "./fixture";

type SavedState = {
  hintsState?: {
    type: string;
    enteredChars?: string;
    pendingElements?: {
      pendingFrames: { answering: number; collecting: number };
    };
    elementsWithHints?: Array<{
      hint: string;
      frame: { id: number };
      hidden: boolean;
    }>;
  };
};

async function backgroundFor(context: BrowserContext): Promise<Worker> {
  return (
    context.serviceWorkers()[0] ?? (await context.waitForEvent("serviceworker"))
  );
}

async function savedState(
  background: Page | Worker,
  url: string
): Promise<SavedState | undefined> {
  return (background as Worker).evaluate(async (pageUrl: string) => {
    const api = globalThis as unknown as {
      chrome: {
        tabs: {
          query: (query: { url: string }) => Promise<Array<{ id: number }>>;
        };
        storage: {
          session: {
            get: (key: string) => Promise<Record<string, SavedState>>;
          };
        };
      };
    };
    const [tab] = await api.chrome.tabs.query({ url: pageUrl });
    if (tab === undefined) {
      return undefined;
    }
    const key = `tabState:${tab.id}`;
    return (await api.chrome.storage.session.get(key))[key];
  }, url);
}

async function stopBackground(
  context: BrowserContext,
  page: Page
): Promise<void> {
  const session = await context.newCDPSession(page);
  const { targetInfos } = await session.send("Target.getTargets");
  const worker = targetInfos.find(
    ({ type, url }) =>
      type === "service_worker" && url.startsWith("chrome-extension://")
  );
  if (worker === undefined) {
    throw new Error("No extension service worker");
  }
  const result = await session.send("Target.closeTarget", {
    targetId: worker.targetId,
  });
  expect(result.success).toBe(true);
  await session.detach();
}

async function serve(
  handler: (url: string, response: ServerResponse) => void
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    handler(request.url ?? "/", response);
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  return {
    url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error !== undefined) {
            reject(error);
          } else {
            resolve();
          }
        });
      });
    },
  };
}

async function prepare(
  page: Page,
  background: Worker,
  url: string
): Promise<void> {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await expect.poll(async () => savedState(background, url)).toBeDefined();
  await page.bringToFront();
}

test.beforeEach(({ browserName }) => {
  test.skip(
    browserName !== "chromium",
    "Firefox uses a persistent background page"
  );
});

test("detects click listeners attached before an element is inserted", async ({
  context,
}) => {
  const server = await serve((_url, response) => {
    response.end("<main></main>");
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    await prepare(page, background, `${server.url}/`);
    await page.evaluate(() => {
      const element = document.createElement("div");
      element.textContent = "Clickable element";
      element.addEventListener("click", () => {
        location.hash = "clicked";
      });
      document.querySelector("main")?.append(element);
    });
    await activateHints(page);
    const hints = page.locator("#__LinkHintsWebExt .hint:not(.shruggie)");
    await expect(hints).toHaveCount(1);
    const hint = await hints.first().textContent();
    if (hint === null) {
      throw new Error("No hint text");
    }
    await page.keyboard.type(hint);
    await expect(page).toHaveURL(/#clicked$/);
  } finally {
    await server.close();
  }
});

test("renders and follows hints above a modal dialog", async ({ context }) => {
  const server = await serve((_url, response) => {
    response.end(
      '<dialog><a href="#target">Target</a></dialog><script>document.querySelector("dialog").showModal()</script>'
    );
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    await prepare(page, background, `${server.url}/`);
    await activateHints(page);
    const hints = page.locator("#__LinkHintsWebExt .hint:not(.shruggie)");
    await expect(hints).toHaveCount(1);
    const hint = await hints.first().textContent();
    if (hint === null) {
      throw new Error("No hint text");
    }
    await page.keyboard.type(hint);
    await expect(page).toHaveURL(/#target$/);
  } finally {
    await server.close();
  }
});

test("reinjecting content scripts does not duplicate hints", async ({
  context,
}) => {
  const server = await serve((_url, response) => {
    response.end('<a href="#target">Target</a>');
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    const url = `${server.url}/`;
    await prepare(page, background, url);
    await background.evaluate(async (pageUrl) => {
      const api = globalThis as unknown as {
        chrome: {
          tabs: {
            query: (query: { url: string }) => Promise<Array<{ id: number }>>;
          };
          scripting: {
            executeScript: (details: {
              target: { tabId: number; allFrames?: boolean };
              files: Array<string>;
              world?: "MAIN";
            }) => Promise<unknown>;
          };
        };
      };
      const [tab] = await api.chrome.tabs.query({ url: pageUrl });
      for (const [files, world, allFrames] of [
        [["injected.js"], "MAIN", true],
        [["worker.js"], undefined, true],
        [["renderer.js"], undefined, false],
      ] as Array<[Array<string>, "MAIN" | undefined, boolean]>) {
        await api.chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames },
          files,
          world,
        });
      }
    }, url);
    await activateHints(page);
    await expect(page.locator("#__LinkHintsWebExt")).toHaveCount(1);
    await expect(
      page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
    ).toHaveCount(1);
  } finally {
    await server.close();
  }
});

test("active hints survive a service worker restart", async ({ context }) => {
  const server = await serve((_url, response) => {
    response.end(
      `<style>a { display: inline-block; margin: 8px }</style>${Array.from(
        { length: 100 },
        (_, i) => `<a href="#link-${i}">Link ${i}</a>`
      ).join("")}`
    );
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    const url = `${server.url}/`;
    await prepare(page, background, url);
    await activateHints(page);
    const hint = (
      await page.locator("#__LinkHintsWebExt .hint").allTextContents()
    ).find((value) => value.length > 1);
    if (hint === undefined) {
      throw new Error("No multi-character hint");
    }
    await page.keyboard.press(hint[0]);
    await expect
      .poll(
        async () =>
          (
            await savedState(background, url)
          )?.hintsState?.enteredChars
      )
      .toBe(hint[0]);
    await stopBackground(context, page);
    await page.keyboard.type(hint.slice(1));
    await expect(page).toHaveURL(/#link-/);
    await page.keyboard.press("Escape");
    await activateHints(page);
  } finally {
    await server.close();
  }
});

test("restarts interrupted frame collection", async ({ context }) => {
  const server = await serve((url, response) => {
    response.end(
      url.startsWith("/frame")
        ? '<a href="#frame-target">Frame target</a>'
        : '<a href="#top">Top</a><iframe src="/frame" style="width: 500px; height: 200px"></iframe>'
    );
  });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      if (window !== window.top) {
        window.addEventListener(
          "message",
          (event) => {
            if (
              (event.data as { type?: string } | null)?.type ===
                "FindElements" &&
              !document.documentElement.hasAttribute("data-release")
            ) {
              event.stopImmediatePropagation();
            }
          },
          true
        );
      }
    });
    const background = await backgroundFor(context);
    await background.evaluate(async () => {
      const api = globalThis as unknown as {
        chrome: {
          storage: {
            sync: { set: (value: Record<string, number>) => Promise<void> };
          };
        };
      };
      await api.chrome.storage.sync.set({
        "debug.Background.FRAME_REPORT_TIMEOUT": 10000,
      });
    });
    const url = `${server.url}/`;
    await prepare(page, background, url);
    await expect(
      page.frameLocator("iframe").getByText("Frame target")
    ).toBeVisible();
    await page.keyboard.press("Alt+j");
    await expect
      .poll(async () => {
        const state = (await savedState(background, url))?.hintsState;
        return (
          state?.type === "Collecting" &&
          (state.pendingElements?.pendingFrames.answering ?? 0) > 0
        );
      })
      .toBe(true);
    const popupUrl = new URL("popup.html", background.url()).href;
    const popup = await context.newPage();
    await popup.goto(popupUrl);
    await page.bringToFront();
    await page
      .frameLocator("iframe")
      .locator("html")
      .evaluate((element) => {
        element.setAttribute("data-release", "");
      });
    await stopBackground(context, page);
    await popup.evaluate(async () => {
      const api = globalThis as unknown as {
        chrome: {
          runtime: { sendMessage: (message: unknown) => Promise<unknown> };
        };
      };
      await api.chrome.runtime.sendMessage({
        type: "FromPopup",
        message: { type: "PopupScriptAdded" },
      });
    });
    await page.bringToFront();
    const frame = page.frameLocator("iframe");
    await expect(frame.getByText("Frame target")).toBeVisible();
    await expect(
      page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
    ).toHaveCount(2);
    let frameHint: string | undefined;
    await expect
      .poll(async () => {
        frameHint = (
          await savedState(popup, url)
        )?.hintsState?.elementsWithHints?.find(
          ({ frame: item }) => item.id !== 0
        )?.hint;
        return frameHint;
      })
      .toBeDefined();
    if (frameHint === undefined) {
      throw new Error("No hint for recovered frame");
    }
    await page.keyboard.type(frameHint);
    await expect
      .poll(() =>
        page.frames().some((item) => item.url().endsWith("#frame-target"))
      )
      .toBe(true);
  } finally {
    await server.close();
  }
});

test("preserves frame hints and tracks removed frames after restart", async ({
  context,
}) => {
  const server = await serve((url, response) => {
    response.end(
      url === "/frame"
        ? '<a href="#frame-target">Frame target</a>'
        : '<a href="#top-target">Top target</a><iframe src="/frame" style="width: 500px; height: 200px"></iframe>'
    );
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    const url = `${server.url}/`;
    await prepare(page, background, url);
    await expect(
      page.frameLocator("iframe").getByText("Frame target")
    ).toBeVisible();
    await activateHints(page);
    await expect(
      page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
    ).toHaveCount(2);
    const state = await savedState(background, url);
    const frameHint = state?.hintsState?.elementsWithHints?.find(
      ({ frame }) => frame.id !== 0
    )?.hint;
    if (frameHint === undefined) {
      throw new Error("No frame hint");
    }
    const popup = await context.newPage();
    await popup.goto(new URL("popup.html", background.url()).href);
    await page.bringToFront();
    await stopBackground(context, page);
    await page.keyboard.type(frameHint);
    await expect
      .poll(() =>
        page.frames().some((item) => item.url().endsWith("#frame-target"))
      )
      .toBe(true);
    await activateHints(page);
    await expect
      .poll(async () =>
        (
          await savedState(popup, url)
        )?.hintsState?.elementsWithHints?.some(({ frame }) => frame.id !== 0)
      )
      .toBe(true);
    await page.locator("iframe").evaluate((element) => {
      element.remove();
    });
    await expect
      .poll(async () =>
        (
          await savedState(popup, url)
        )?.hintsState?.elementsWithHints?.some(
          ({ frame, hidden }) => frame.id !== 0 && hidden
        )
      )
      .toBe(true);
  } finally {
    await server.close();
  }
});

test("detached shadow hosts remain collectible while the worker runs", async ({
  context,
}) => {
  const server = await serve((_url, response) => {
    response.end("<main></main>");
  });
  try {
    const page = await context.newPage();
    await prepare(page, await backgroundFor(context), `${server.url}/`);
    const registered = page.waitForEvent("console", {
      predicate: (message) =>
        message.text().includes("ElementManager#onClosedShadowRootCreated"),
    });
    await page.evaluate(() => {
      const host = document.createElement("div");
      host.attachShadow({ mode: "closed" });
      Object.assign(window, { detachedHost: new WeakRef(host) });
    });
    await Promise.all(
      (await registered).args().map(async (arg) => {
        await arg.dispose();
      })
    );
    const session = await context.newCDPSession(page);
    // Console inspection retains logged DOM nodes independently of the extension.
    await session.send("Runtime.discardConsoleEntries");
    await expect
      .poll(async () => {
        await session.send("HeapProfiler.collectGarbage");
        return page.evaluate(
          () =>
            (
              window as unknown as { detachedHost: WeakRef<Element> }
            ).detachedHost.deref() === undefined
        );
      })
      .toBe(true);
  } finally {
    await server.close();
  }
});

test("removing an announced frame completes collection without its report", async ({
  context,
}) => {
  const server = await serve((url, response) => {
    response.end(
      url.startsWith("/frame")
        ? '<a href="#frame">Frame target</a>'
        : '<a href="#top">Top target</a><iframe src="/frame"></iframe>'
    );
  });
  try {
    const page = await context.newPage();
    const background = await backgroundFor(context);
    const url = `${server.url}/`;
    await prepare(page, background, url);
    await expect(
      page.frameLocator("iframe").getByText("Frame target")
    ).toBeVisible();
    await background.evaluate(async (pageUrl) => {
      const api = (globalThis as unknown as { chrome: typeof browser }).chrome;
      const [tab] = await api.tabs.query({ url: pageUrl });
      await api.scripting.executeScript({
        target: { tabId: tab.id as number, allFrames: true },
        func: () => {
          if (window === window.top) {
            return;
          }
          const send = browser.runtime.sendMessage.bind(browser.runtime);
          browser.runtime.sendMessage = (message: unknown) =>
            (message as { message?: { type?: string } }).message?.type ===
            "ReportVisibleElements"
              ? Promise.resolve()
              : send(message);
        },
      });
    }, url);
    await page.keyboard.press("Alt+j");
    await expect
      .poll(
        async () =>
          (
            await savedState(background, url)
          )?.hintsState?.pendingElements?.pendingFrames.collecting
      )
      .toBe(1);
    await page.locator("iframe").evaluate((frame) => {
      frame.remove();
    });
    await expect(
      page.locator("#__LinkHintsWebExt .hint:not(.shruggie)")
    ).toHaveCount(1);
    await expect
      .poll(async () => (await savedState(background, url))?.hintsState?.type)
      .toBe("Hinting");
  } finally {
    await server.close();
  }
});
