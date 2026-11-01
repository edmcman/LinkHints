import type { BrowserContext, Locator, Page } from "playwright";

import type BackgroundProgram from "../src/background/Program";
import { activateHints, dismissHints, expect, test } from "./fixture";

type ProbeWindow = Window & {
  staged: DocumentFragment | HTMLElement;
  controller: AbortController;
  probes: Array<WeakRef<Node>>;
  clicks: number;
};

async function flushDiscovery(page: Page): Promise<void> {
  await page.evaluate(async () => {
    for (let index = 0; index < 2; index++) {
      await new Promise<void>((resolve) => {
        requestIdleCallback(() => {
          resolve();
        });
      });
    }
  });
}

async function preparePage(
  context: BrowserContext,
  url: string
): Promise<Page> {
  const page = await context.newPage();
  await page.goto(url);
  await page.bringToFront();
  await activateHints(page);
  await dismissHints(page);
  return page;
}

const visibleHints = (page: Page): Locator =>
  page.locator("#__LinkHintsWebExt .hint:not(.shruggie):not(.hidden)");

["element", "fragment"].forEach((kind) => {
  test(`discovers listeners in a ${kind} inserted after listener notifications flush`, async ({
    context,
    html,
  }) => {
    const page = await preparePage(
      context,
      html.url("__regression_select.html")
    );
    await page.evaluate((rootKind) => {
      const parent =
        rootKind === "element"
          ? document.createElement("div")
          : document.createDocumentFragment();
      const child = document.createElement("div");
      child.textContent = "Delayed target";
      parent.append(child);
      child.addEventListener("click", () => undefined);
      (window as unknown as ProbeWindow).staged = parent;
    }, kind);
    await flushDiscovery(page);
    await page.evaluate(() => {
      document.body.append((window as unknown as ProbeWindow).staged);
    });
    await activateHints(page);
    await expect(visibleHints(page)).toHaveCount(2);
  });
});

test("native listener removal and duplicate registrations update hints", async ({
  context,
  html,
}) => {
  const page = await preparePage(context, html.url("__regression_select.html"));
  await page.evaluate(() => {
    const scope = window as unknown as ProbeWindow;
    scope.clicks = 0;
    scope.controller = new AbortController();
    const child = document.createElement("div");
    child.id = "abort-target";
    child.textContent = "Abort target";
    child.addEventListener(
      "click",
      () => {
        scope.clicks += 1;
      },
      { signal: scope.controller.signal }
    );
    document.body.append(child);
  });
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(2);
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).controller.signal.dispatchEvent(
      new Event("abort")
    );
  });
  await flushDiscovery(page);
  await dismissHints(page);
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(2);
  await dismissHints(page);
  await page.evaluate(() => {
    (window as unknown as ProbeWindow).controller.abort();
    document.getElementById("abort-target")?.click();
  });
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(1);
  expect(
    await page.evaluate(() => (window as unknown as ProbeWindow).clicks)
  ).toBe(0);
  await dismissHints(page);
  await page.evaluate(() => {
    const scope = window as unknown as ProbeWindow;
    const child = document.getElementById("abort-target") as HTMLElement;
    const listener = (): void => {
      scope.clicks += 1;
    };
    child.addEventListener("click", listener);
    child.addEventListener("click", listener, { once: true });
    child.click();
  });
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(2);
  expect(
    await page.evaluate(() => (window as unknown as ProbeWindow).clicks)
  ).toBe(1);
});

["once", "already aborted", "duplicate signal"].forEach((mode) => {
  test(`native listener tracking respects ${mode} registrations`, async ({
    context,
    html,
  }) => {
    const page = await preparePage(
      context,
      html.url("__regression_select.html")
    );
    const clicks = await page.evaluate((kind) => {
      const child = document.createElement("div");
      child.textContent = "Removed target";
      document.body.append(child);
      let count = 0;
      const listener = (): void => {
        count += 1;
      };
      const controller = new AbortController();
      switch (kind) {
        case "once":
          child.addEventListener("click", listener, { once: true });
          break;
        case "already aborted":
          controller.abort();
          child.addEventListener("click", listener, {
            signal: controller.signal,
          });
          break;
        case "duplicate signal":
          (window as unknown as ProbeWindow).controller = new AbortController();
          child.addEventListener("click", listener, {
            signal: (window as unknown as ProbeWindow).controller.signal,
          });
          child.addEventListener("click", listener, {
            signal: controller.signal,
          });
          controller.abort();
          break;
      }
      child.click();
      return count;
    }, mode);
    expect(clicks).toBe(mode === "already aborted" ? 0 : 1);
    await activateHints(page);
    await expect(visibleHints(page)).toHaveCount(
      mode === "duplicate signal" ? 2 : 1
    );
    if (mode === "duplicate signal") {
      await dismissHints(page);
      await page.evaluate(() => {
        (window as unknown as ProbeWindow).controller.abort();
      });
      await activateHints(page);
      await expect(visibleHints(page)).toHaveCount(1);
    }
  });
});

test("closed shadow contents staged off-document are discovered on insertion", async ({
  context,
  html,
}) => {
  const page = await preparePage(context, html.url("__regression_select.html"));
  await page.evaluate(() => {
    const host = document.createElement("div");
    const button = document.createElement("button");
    button.textContent = "Shadow button";
    host.attachShadow({ mode: "closed" }).append(button);
    (window as unknown as ProbeWindow).staged = host;
  });
  await flushDiscovery(page);
  await page.evaluate(() => {
    document.body.append((window as unknown as ProbeWindow).staged);
  });
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(2);
});

test("new frames reuse their parent's token after activity in another tab", async ({
  context,
  html,
}) => {
  const page = await preparePage(context, html.url("__regression_select.html"));
  await preparePage(context, html.url("__regression_select.html"));
  await page.bringToFront();
  await page.evaluate((url) => {
    const frame = document.createElement("iframe");
    frame.src = url;
    frame.style.cssText = "width:500px;height:200px";
    document.body.append(frame);
  }, html.url("__regression_select.html"));
  await expect(
    page.frameLocator("iframe").getByText("Local target")
  ).toBeVisible();
  await activateHints(page);
  await expect(visibleHints(page)).toHaveCount(2);
});

test("synced options refresh live state and survive unrelated saves", async ({
  context,
  browserName,
  html,
}) => {
  test.skip(
    browserName !== "chromium",
    "Inspects the Chromium background worker"
  );
  const page = await context.newPage();
  await page.goto(html.url("__regression_select.html"));
  const background =
    context.serviceWorkers()[0] ??
    (await context.waitForEvent("serviceworker"));
  await background.evaluate(async () => {
    await browser.storage.sync.set({ css: ".hint { color: red; }" });
  });
  await expect
    .poll(() =>
      background.evaluate(
        () =>
          (globalThis as typeof globalThis & { program: BackgroundProgram })
            .program.options.values.css
      )
    )
    .toBe(".hint { color: red; }");
  await background.evaluate(async () => {
    await (
      globalThis as typeof globalThis & { program: BackgroundProgram }
    ).program.saveOptions({ autoActivate: false });
  });
  expect(
    await background.evaluate(
      async () => (await browser.storage.sync.get()).css as unknown
    )
  ).toBe(".hint { color: red; }");
});

test("detached listener targets and populated shadow hosts are collectible", async ({
  context,
  browserName,
  html,
}) => {
  test.skip(
    browserName !== "chromium",
    "Requires Chromium's forced garbage collection"
  );
  const page = await preparePage(context, html.url("__regression_select.html"));
  await page.evaluate(() => {
    const scope = window as unknown as ProbeWindow;
    scope.controller = new AbortController();
    const child = document.createElement("div");
    child.addEventListener("click", () => undefined);
    const signalled = document.createElement("div");
    signalled.addEventListener("click", () => undefined, {
      signal: scope.controller.signal,
    });
    const host = document.createElement("div");
    host
      .attachShadow({ mode: "closed" })
      .append(document.createElement("button"));
    scope.probes = [child, signalled, host].map((node) => new WeakRef(node));
  });
  await flushDiscovery(page);
  const session = await context.newCDPSession(page);
  await session.send("Runtime.discardConsoleEntries");
  await expect
    .poll(async () => {
      await session.send("HeapProfiler.collectGarbage");
      return page.evaluate(() =>
        (window as unknown as ProbeWindow).probes.every(
          (probe) => probe.deref() === undefined
        )
      );
    })
    .toBe(true);
});
